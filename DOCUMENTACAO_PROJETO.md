# DOCUMENTAÇÃO TÉCNICA DO PROJETO: SDR AUTOMÁTICO & PGFN

**Data da Última Atualização:** 19/02/2026
**Status:** Em Desenvolvimento (Fase 1 Concluída)

## 🧠 OBJETIVO E CONTEXTO

Este projeto visa criar uma **máquina de vendas automatizada** que:
1.  **Ingere leads qualificados** a partir de dívidas tributárias (PGFN -> Receita Federal).
2.  **Enriquece os dados** identificando sócios (BrasilAPI) e contatos (Google/Speedio).
3.  **Prospecta ativamente** via WhatsApp (SDR Agent) usando IA para qualificar e agendar reuniões.

O core do sistema roda em contêineres Docker (SDR Hub + WhatsApp Server) e scripts Python locais (Ingestão/Enriquecimento).

---

## 🏗️ ARQUITETURA TÉCNICA

### 1. Ingestão de Dados (`pgfn_module/`)
*   **Fonte:** Dados Abertos PGFN (SIDA - Dívida Não Previdenciária).
*   **Script Principal:** `ingest_pgfn.py`
    *   Filtra CSVs gigantes por Estado (SP), Tipo (PJ), Origem (Receita Federal) e Valor (R$ 1MM-20MM).
    *   Gera: `alvos_prioritarios.csv`.
*   **Enriquecimento de Sócios:** `enrich_partners.py`
    *   API: BrasilAPI (CNPJ -> QSA).
    *   Extrai Sócio-Administrador.
*   **Busca de Contatos (Híbrida):**
    *   `contact_finder.py`: Gera padrões de email (`nome@empresa.com`). Validação SMTP.
    *   `whatsapp_finder.py`: Busca telefone na Receita + Google Maps. Valida WhatsApp via `wa.me`.

### 2. Agente SDR (`sdr_whatsapp/`)
*   **Core:** `wa-server` (Node.js + Baileys) para conexão WhatsApp Web.
*   **Cérebro:** `webhook_server.py` (Python + OpenAI/Gemini).
    *   Recebe mensagens, mantém contexto da conversa, decide resposta.
*   **Fila/Gestão:** `sdr-hub` (Next.js + Supabase).
    *   Dashboard Kanban de leads.

---

## 📜 HISTÓRICO DE DESENVOLVIMENTO

### Fase 1: Fundação e Ingestão (Concluída)
*   [x] **Configuração do Ambiente:** Repositório Git, Docker Compose para serviços.
*   [x] **Módulo PGFN:**
    *   Download manual dos CSVs SIDA (devido a links quebrados no site PGFN).
    *   Descoberta de inconsistências nos CSVs (colunas `UF_DEVEDOR` e `VALOR_CONSOLIDADO` precisavam de limpeza pesada).
    *   Implementação de filtros de "Baleias" (1MM-20MM) e "PMEs" (100k-2MM).
*   [x] **Enriquecimento:**
    *   Integração bem-sucedida com BrasilAPI para QSA.
    *   Tentativa de busca de celulares via OSINT gratuito (limitada a telefones fixos).
    *   Decisão estratégica: Usar API paga (Speedio/Infosimples) apenas para leads qualificados.

### Fase 2: Agente WhatsApp (Em Andamento)
*   [x] **Infraestrutura:** Docker rodando `wa-server`, `sdr-hub` e `db`.
*   [x] **Lógica de Conversa:** Prompt inicial do SDR definido em `directives/sdr_whatsapp.md`.
*   [ ] **Integração:** Conectar saída do `pgfn_module` (CSV) com o banco de dados do SDR.

---

## 🛠️ GUIA DE OPERAÇÃO (COMO RODAR)

### 1. Ingestão de Novos Devedores
Para atualizar a lista de alvos com novos CSVs da PGFN:

```bash
# 1. Coloque os novos CSVs 'arquivo_lai_SIDA_*.csv' na pasta /pgfn_module
# 2. Rode a ingestão (filtro SP, PJ, Receita, >100k)
python pgfn_module/ingest_pgfn.py

# 3. Enriqueça os sócios (BrasilAPI)
python pgfn_module/enrich_partners.py
```

### 2. Busca de Contatos (Amostragem)
Para buscar telefones e validar WhatsApp de um lote:

```bash
# 1. Edite 'pgfn_module/whatsapp_finder.py' para apontar o input correto
# 2. Rode o script
python pgfn_module/whatsapp_finder.py
```

### 3. Subir o Agente SDR (WhatsApp)

```bash
cd sdr_whatsapp
# Iniciar serviços (DB, API, Frontend)
docker-compose up -d

# Conectar QR Code
# Acesse http://localhost:3001/qr no navegador
```

---

## 🔧 GUIA DE MANUTENÇÃO

### Atualizar Dependências
*   Python: `pgfn_module/requirements.txt` e `sdr_whatsapp/requirements.txt`.
*   Node.js: `sdr_whatsapp/wa-server/package.json`.

### Pontos de Atenção (Gaps Conhecidos)
1.  **Captcha/Rate Limit:** A BrasilAPI tem limites. Para volumes >10k, implementar rotação de IP ou delay maior.
2.  **Celulares Pessoais:** O `whatsapp_finder.py` acha muitos fixos. Para produção em escala, **integrar com Speedio** é mandatório.
3.  **Sessão WhatsApp:** A biblioteca Baileys pode desconectar. Monitorar logs do container `wa-server`.

---

## 📍 ESTADO ATUAL (ONDE PAROU)
*   **Última Ação:** Validação da busca de telefones (Fixos encontrados, WhatsApps validados apenas em números empresariais).
*   **Próximo Passo Lógico:** Integrar API paga (Speedio) para obter celulares pessoais dos sócios filtrados e conectar esses leads ao `sdr-hub` para disparo.

---
**Repositório:** `https://github.com/USER/LINKEDIN-SCRAPER` (Verificar URL real)
**Branch Principal:** `master`
