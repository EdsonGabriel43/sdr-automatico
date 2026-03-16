-- =============================================
-- SDR Automático WhatsApp — Schema Supabase
-- SYNEOS CONSULTORIA — Agente Nexa
-- =============================================

-- Enum: status da conversa
CREATE TYPE conversation_status AS ENUM (
    'pending',           -- Aguardando primeira mensagem
    'contacted',         -- Primeira mensagem enviada
    'responded',         -- Lead respondeu
    'qualified',         -- Decisor confirmado
    'nurturing',         -- Não é decisor, mas pode indicar
    'not_interested',    -- Sem interesse
    'wrong_person',      -- Pessoa/telefone errado
    'blocked',           -- Lead bloqueou
    'handed_off',        -- Transferido para closer
    'negotiating_elsewhere', -- Já negocia com outra consultoria
    'no_response'        -- Sem resposta após todos follow-ups
);

-- Enum: status do chip
CREATE TYPE chip_status AS ENUM (
    'warming',       -- Em aquecimento
    'active',        -- Ativo e operacional
    'paused',        -- Pausado manualmente
    'banned',        -- Banido pelo WhatsApp
    'disconnected'   -- Desconectado
);

-- Enum: direção da mensagem
CREATE TYPE message_direction AS ENUM ('outbound', 'inbound');

-- Enum: status do handoff
CREATE TYPE handoff_status AS ENUM ('pending', 'accepted', 'completed', 'lost');

-- =============================================
-- TABELAS
-- =============================================

-- Leads (dados do devedor PGFN + contato)
CREATE TABLE leads (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    telefone VARCHAR(20),
    empresa VARCHAR(500),
    cnpj VARCHAR(20),
    cargo VARCHAR(255),
    valor_divida NUMERIC(15,2),
    tipo_divida VARCHAR(255),
    situacao_divida VARCHAR(255),
    uf VARCHAR(2),
    socios TEXT,
    email VARCHAR(255),
    dominio VARCHAR(255),
    fonte VARCHAR(50) DEFAULT 'pgfn',
    notas TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para busca eficiente
CREATE INDEX idx_leads_cnpj ON leads(cnpj);
CREATE INDEX idx_leads_telefone ON leads(telefone);
CREATE INDEX idx_leads_empresa ON leads(empresa);

-- Chips WhatsApp
CREATE TABLE chips (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    instance_name VARCHAR(100) NOT NULL UNIQUE,
    phone_number VARCHAR(20),
    status chip_status DEFAULT 'warming',
    warming_start_date DATE,
    warming_day INTEGER DEFAULT 0,
    daily_limit INTEGER DEFAULT 5,
    messages_sent_today INTEGER DEFAULT 0,
    total_messages_sent INTEGER DEFAULT 0,
    last_message_at TIMESTAMPTZ,
    last_reset_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Campanhas
CREATE TABLE campaigns (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(20) DEFAULT 'draft', -- draft, active, paused, completed
    chip_id UUID REFERENCES chips(id),
    total_leads INTEGER DEFAULT 0,
    leads_contacted INTEGER DEFAULT 0,
    leads_responded INTEGER DEFAULT 0,
    leads_qualified INTEGER DEFAULT 0,
    leads_blocked INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Conversas (uma por lead por campanha)
CREATE TABLE conversations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES campaigns(id),
    chip_id UUID REFERENCES chips(id),
    status conversation_status DEFAULT 'pending',
    current_step INTEGER DEFAULT 0,
    follow_up_count INTEGER DEFAULT 0,
    next_follow_up_at TIMESTAMPTZ,
    intent_classification VARCHAR(50),
    confidence_score NUMERIC(3,2),
    extracted_info JSONB DEFAULT '{}',
    summary TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_conversations_status ON conversations(status);
CREATE INDEX idx_conversations_next_followup ON conversations(next_follow_up_at)
    WHERE next_follow_up_at IS NOT NULL;
CREATE INDEX idx_conversations_lead ON conversations(lead_id);

-- Mensagens (histórico completo)
CREATE TABLE messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    direction message_direction NOT NULL,
    content TEXT NOT NULL,
    message_type VARCHAR(20) DEFAULT 'text', -- text, button, list
    whatsapp_message_id VARCHAR(100),
    status VARCHAR(20) DEFAULT 'pending', -- pending, sent, delivered, read, failed
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_messages_wa_id ON messages(whatsapp_message_id);

-- Handoffs (transferências para closer)
CREATE TABLE handoffs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    conversation_id UUID REFERENCES conversations(id),
    lead_id UUID REFERENCES leads(id),
    closer_phone VARCHAR(20) NOT NULL,
    status handoff_status DEFAULT 'pending',
    lead_summary TEXT,
    conversation_history TEXT,
    notified_at TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Blocklist (compliance LGPD)
CREATE TABLE blocklist (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    phone_number VARCHAR(20) NOT NULL UNIQUE,
    lead_id UUID REFERENCES leads(id),
    reason VARCHAR(100) DEFAULT 'user_request',
    blocked_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_blocklist_phone ON blocklist(phone_number);

-- =============================================
-- FUNÇÕES
-- =============================================

-- Resetar contadores diários dos chips (chamar via cron/scheduler)
CREATE OR REPLACE FUNCTION reset_daily_chip_counters()
RETURNS void
SET search_path = public AS $$
BEGIN
    UPDATE chips
    SET messages_sent_today = 0,
        last_reset_date = CURRENT_DATE,
        updated_at = NOW()
    WHERE last_reset_date IS NULL OR last_reset_date < CURRENT_DATE;
END;
$$ LANGUAGE plpgsql;

-- Atualizar warming_day automaticamente
CREATE OR REPLACE FUNCTION update_warming_day()
RETURNS void
SET search_path = public AS $$
BEGIN
    UPDATE chips
    SET warming_day = CURRENT_DATE - warming_start_date,
        daily_limit = CASE
            WHEN (CURRENT_DATE - warming_start_date) <= 3 THEN 5
            WHEN (CURRENT_DATE - warming_start_date) <= 7 THEN 10
            WHEN (CURRENT_DATE - warming_start_date) <= 14 THEN 15
            ELSE 20
        END,
        status = CASE
            WHEN (CURRENT_DATE - warming_start_date) >= 14 THEN 'active'::chip_status
            ELSE status
        END,
        updated_at = NOW()
    WHERE status = 'warming' AND warming_start_date IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

-- Incrementar contador de mensagens do chip
CREATE OR REPLACE FUNCTION increment_chip_message_count(p_chip_id UUID)
RETURNS void
SET search_path = public AS $$
BEGIN
    UPDATE chips
    SET messages_sent_today = messages_sent_today + 1,
        total_messages_sent = total_messages_sent + 1,
        last_message_at = NOW(),
        updated_at = NOW()
    WHERE id = p_chip_id;
END;
$$ LANGUAGE plpgsql;

-- Verificar se telefone está na blocklist
CREATE OR REPLACE FUNCTION is_blocked(p_phone VARCHAR)
RETURNS BOOLEAN
SET search_path = public AS $$
BEGIN
    RETURN EXISTS (SELECT 1 FROM blocklist WHERE phone_number = p_phone);
END;
$$ LANGUAGE plpgsql;

-- Atualizar métricas da campanha
CREATE OR REPLACE FUNCTION update_campaign_metrics(p_campaign_id UUID)
RETURNS void
SET search_path = public AS $$
BEGIN
    UPDATE campaigns SET
        leads_contacted = (SELECT COUNT(*) FROM conversations WHERE campaign_id = p_campaign_id AND status != 'pending'),
        leads_responded = (SELECT COUNT(*) FROM conversations WHERE campaign_id = p_campaign_id AND status IN ('responded', 'qualified', 'nurturing', 'not_interested', 'negotiating_elsewhere', 'handed_off')),
        leads_qualified = (SELECT COUNT(*) FROM conversations WHERE campaign_id = p_campaign_id AND status IN ('qualified', 'handed_off')),
        leads_blocked = (SELECT COUNT(*) FROM conversations WHERE campaign_id = p_campaign_id AND status = 'blocked'),
        updated_at = NOW()
    WHERE id = p_campaign_id;
END;
$$ LANGUAGE plpgsql;

-- Trigger para updated_at automático
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
SET search_path = public AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_leads_updated_at BEFORE UPDATE ON leads
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_chips_updated_at BEFORE UPDATE ON chips
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_campaigns_updated_at BEFORE UPDATE ON campaigns
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_conversations_updated_at BEFORE UPDATE ON conversations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_handoffs_updated_at BEFORE UPDATE ON handoffs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================
-- ROW LEVEL SECURITY (opcional, ativar se necessário)
-- =============================================
-- ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
