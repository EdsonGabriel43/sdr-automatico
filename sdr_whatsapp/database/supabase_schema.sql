-- =============================================
-- SDR Automático — Schema Supabase (Multi-Tenant)
-- Atualizado: Abril 2026
-- =============================================

-- ===== ENUMS =====
CREATE TYPE conversation_status AS ENUM (
    'pending', 'contacted', 'responded', 'qualified',
    'nurturing', 'not_interested', 'wrong_person', 'blocked',
    'handed_off', 'negotiating_elsewhere', 'no_response',
    'meeting_scheduled', 'meeting_no_show'
);
CREATE TYPE chip_status AS ENUM ('warming', 'active', 'paused', 'banned', 'disconnected');
CREATE TYPE message_direction AS ENUM ('outbound', 'inbound');
CREATE TYPE handoff_status AS ENUM ('pending', 'accepted', 'completed', 'lost');

-- ===== MULTI-TENANT =====

CREATE TABLE tenants (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE licenses (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    plan TEXT NOT NULL DEFAULT 'standard',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
    max_users INT NOT NULL DEFAULT 4,
    valid_until TIMESTAMPTZ NOT NULL,
    activated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin', 'operator', 'closer')),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE whatsapp_instances (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID REFERENCES tenants(id) NOT NULL UNIQUE,
    instance_name TEXT UNIQUE NOT NULL,
    phone_number TEXT,
    status TEXT DEFAULT 'disconnected' CHECK (status IN ('connected', 'qr_pending', 'disconnected')),
    port INT,
    container_name TEXT,
    qr_code TEXT,
    connected_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE tenant_templates (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID REFERENCES tenants(id) NOT NULL UNIQUE,
    templates JSONB NOT NULL DEFAULT '{}',
    system_prompt TEXT,
    classifier_prompt TEXT,
    business_hours JSONB DEFAULT '{"start": 8, "end": 20, "timezone": "America/Sao_Paulo", "days": [1,2,3,4,5]}',
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ===== TABELAS DE NEGÓCIO =====

CREATE TABLE leads (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID REFERENCES tenants(id),
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

CREATE TABLE chips (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID REFERENCES tenants(id),
    instance_name VARCHAR(100) NOT NULL,
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

CREATE TABLE campaigns (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID REFERENCES tenants(id),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(20) DEFAULT 'draft',
    chip_id UUID REFERENCES chips(id),
    total_leads INTEGER DEFAULT 0,
    leads_contacted INTEGER DEFAULT 0,
    leads_responded INTEGER DEFAULT 0,
    leads_qualified INTEGER DEFAULT 0,
    leads_blocked INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE conversations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID REFERENCES tenants(id),
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

CREATE TABLE messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID REFERENCES tenants(id),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    direction message_direction NOT NULL,
    content TEXT NOT NULL,
    message_type VARCHAR(20) DEFAULT 'text',
    whatsapp_message_id VARCHAR(100),
    status VARCHAR(20) DEFAULT 'pending',
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE handoffs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID REFERENCES tenants(id),
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

CREATE TABLE blocklist (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID REFERENCES tenants(id),
    phone_number VARCHAR(20) NOT NULL,
    lead_id UUID REFERENCES leads(id),
    reason VARCHAR(100) DEFAULT 'user_request',
    blocked_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE prospect_searches (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID REFERENCES tenants(id),
    query_text TEXT,
    search_type TEXT,
    filters JSONB DEFAULT '{}',
    status TEXT DEFAULT 'pending',
    total_results INT DEFAULT 0,
    platforms_searched TEXT[],
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE prospect_results (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID REFERENCES tenants(id),
    search_id UUID REFERENCES prospect_searches(id) ON DELETE CASCADE,
    name TEXT,
    email TEXT,
    phone TEXT,
    role_snippet TEXT,
    company TEXT,
    profile_url TEXT,
    source_platform TEXT,
    cnpj TEXT,
    address TEXT,
    whatsapp_status TEXT DEFAULT 'unknown',
    priority_score INT DEFAULT 0,
    selected BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== INDEXES =====

CREATE INDEX idx_leads_tenant ON leads(tenant_id);
CREATE INDEX idx_leads_tenant_telefone ON leads(tenant_id, telefone);
CREATE INDEX idx_campaigns_tenant ON campaigns(tenant_id);
CREATE INDEX idx_conversations_tenant ON conversations(tenant_id);
CREATE INDEX idx_conversations_tenant_status ON conversations(tenant_id, status);
CREATE INDEX idx_conversations_tenant_followup ON conversations(tenant_id, next_follow_up_at) WHERE next_follow_up_at IS NOT NULL;
CREATE INDEX idx_messages_tenant ON messages(tenant_id);
CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_chips_tenant ON chips(tenant_id);
CREATE INDEX idx_handoffs_tenant ON handoffs(tenant_id);
CREATE INDEX idx_blocklist_tenant_phone ON blocklist(tenant_id, phone_number);
CREATE INDEX idx_prospect_searches_tenant ON prospect_searches(tenant_id);
CREATE INDEX idx_prospect_results_tenant ON prospect_results(tenant_id);
CREATE INDEX idx_licenses_key ON licenses(key);
CREATE INDEX idx_user_profiles_tenant ON user_profiles(tenant_id);

-- ===== RLS =====

CREATE OR REPLACE FUNCTION get_user_tenant_id() RETURNS UUID AS $$
    SELECT tenant_id FROM user_profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chips ENABLE ROW LEVEL SECURITY;
ALTER TABLE handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON leads FOR ALL USING (tenant_id = get_user_tenant_id());
CREATE POLICY tenant_isolation ON campaigns FOR ALL USING (tenant_id = get_user_tenant_id());
CREATE POLICY tenant_isolation ON conversations FOR ALL USING (tenant_id = get_user_tenant_id());
CREATE POLICY tenant_isolation ON messages FOR ALL USING (tenant_id = get_user_tenant_id());
CREATE POLICY tenant_isolation ON chips FOR ALL USING (tenant_id = get_user_tenant_id());
CREATE POLICY tenant_isolation ON handoffs FOR ALL USING (tenant_id = get_user_tenant_id());
CREATE POLICY tenant_isolation ON blocklist FOR ALL USING (tenant_id = get_user_tenant_id());
CREATE POLICY tenant_isolation ON prospect_searches FOR ALL USING (tenant_id = get_user_tenant_id());
CREATE POLICY tenant_isolation ON prospect_results FOR ALL USING (tenant_id = get_user_tenant_id());
CREATE POLICY tenant_isolation ON whatsapp_instances FOR ALL USING (tenant_id = get_user_tenant_id());
CREATE POLICY tenant_isolation ON tenant_templates FOR ALL USING (tenant_id = get_user_tenant_id());
CREATE POLICY user_own_tenant ON tenants FOR SELECT USING (id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY user_own_profile ON user_profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY same_tenant_profiles ON user_profiles FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY tenant_licenses ON licenses FOR SELECT USING (tenant_id = get_user_tenant_id());

-- ===== FUNCTIONS =====

CREATE OR REPLACE FUNCTION reset_daily_chip_counters() RETURNS void AS $$
BEGIN
    UPDATE chips SET messages_sent_today = 0, last_reset_date = CURRENT_DATE, updated_at = NOW()
    WHERE last_reset_date IS NULL OR last_reset_date < CURRENT_DATE;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_warming_day() RETURNS void AS $$
BEGIN
    UPDATE chips SET
        warming_day = CURRENT_DATE - warming_start_date,
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

CREATE OR REPLACE FUNCTION increment_chip_message_count(p_chip_id UUID) RETURNS void AS $$
BEGIN
    UPDATE chips SET messages_sent_today = messages_sent_today + 1, total_messages_sent = total_messages_sent + 1, last_message_at = NOW(), updated_at = NOW()
    WHERE id = p_chip_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION is_blocked(p_phone VARCHAR) RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (SELECT 1 FROM blocklist WHERE phone_number = p_phone);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_campaign_metrics(p_campaign_id UUID) RETURNS void AS $$
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

-- ===== TRIGGERS =====

CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_leads_updated BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_chips_updated BEFORE UPDATE ON chips FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_campaigns_updated BEFORE UPDATE ON campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_conversations_updated BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_handoffs_updated BEFORE UPDATE ON handoffs FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_wa_instances_updated BEFORE UPDATE ON whatsapp_instances FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_tenant_templates_updated BEFORE UPDATE ON tenant_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at();
