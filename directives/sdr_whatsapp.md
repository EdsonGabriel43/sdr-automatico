# SDR WhatsApp — Agente Nexa (Diretiva de Operação)

## Objetivo
Prospecção outbound automatizada via WhatsApp para pré-qualificar decisores de empresas devedoras da PGFN, encaminhando leads qualificados para closers da SYNEOS Consultoria.

## Inputs
- **Lista de leads**: CSV gerado pelo módulo PGFN (`lote_prospeccao_1mm_5mm.csv` ou `contatos_decisores.csv`)
- **Telefones de decisores**: Adicionados manualmente ou por enriquecimento de dados
- **Configurações**: `.env` com credenciais e parâmetros

## Ferramentas / Scripts

| Script | Função |
|--------|--------|
| `webhook_server.py` | Ponto de entrada — FastAPI server |
| `execution/chip_manager.py` | Gerenciar chips WhatsApp via Evolution API |
| `execution/agent_nexa.py` | Motor de decisão — árvore + LLM |
| `execution/message_classifier.py` | Classificar intenções via GPT-4o-mini |
| `execution/campaign_manager.py` | Criar e executar campanhas |
| `execution/follow_up_engine.py` | Enviar follow-ups automáticos |
| `config/templates.json` | Mensagens editáveis |

## Fluxo de Operação

### 1. Setup Inicial (uma vez)
```bash
# Subir Evolution API
cd sdr_whatsapp && docker-compose up -d

# Instalar dependências
pip install -r requirements.txt

# Configurar .env com credenciais reais
cp .env.example .env

# Executar schema no Supabase (via SQL Editor)
# Copiar conteúdo de database/supabase_schema.sql

# Iniciar webhook server
python webhook_server.py
```

### 2. Registrar Chip
```
POST /chips/create
{"instance_name": "chip_01", "phone_number": "5511999999999"}
→ Escanear QR Code retornado com WhatsApp do chip
→ Chip entra em aquecimento automático (14 dias)
```

### 3. Importar Leads
```
POST /leads/import
{"csv_path": "../pgfn_module/lote_prospeccao_1mm_5mm.csv"}
```

### 4. Adicionar Telefones
```
POST /leads/add-phone
{"lead_id": "uuid-do-lead", "phone": "5511999999999"}
```

### 5. Criar e Iniciar Campanha
```
POST /campaigns/create
{"name": "PGFN SP Lote 1", "filters": {"uf": "SP"}}

POST /campaigns/start
{"campaign_id": "uuid-da-campanha"}
```

## Limites e Segurança

| Parâmetro | Valor |
|-----------|-------|
| Msgs/dia (aquecimento D1-3) | 5 |
| Msgs/dia (aquecimento D4-7) | 10 |
| Msgs/dia (aquecimento D8-14) | 15 |
| Msgs/dia (após aquecimento) | 20 |
| Delay entre envios | 60-180s aleatório |
| Horário comercial | 8h-18h seg-sex |
| Follow-ups máximos | 3 (48h, 72h, 96h) |
| Opt-out | Botão em toda primeira msg |

## Edge Cases Documentados
- **Botões não suportados**: WhatsApp pode bloquear botões interativos. O sistema faz fallback para texto com "Responda X".
- **Chip banido**: Sistema detecta via webhook `connection.update` e marca como `banned`
- **Lead responde após último follow-up**: Mensagem é processada normalmente pela árvore de decisão
- **Número na blocklist**: Verificado antes de cada envio

## Métricas Esperadas
- Taxa de resposta: 5-15% (cold outreach B2B)
- Taxa de qualificação: 2-5% dos contatados
- Taxa de bloqueio: < 3% (com opt-out claro)
