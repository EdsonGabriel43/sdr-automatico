"""
Classificador de Mensagens + Gerador de Respostas Adaptativas — Agente Nexa
O LLM gera TODAS as respostas, usando templates como diretrizes (não texto literal).
Alinhado com o Playbook Oficial da Nexa (Syneos Consultoria Tributária).
"""

import os
import json
import logging
from typing import Optional
from difflib import SequenceMatcher
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

_TEMPLATES_PATH = os.path.join(os.path.dirname(__file__), "..", "config", "templates.json")


def _load_prompts() -> tuple[str, str]:
    """Lê classifier_prompt e system_prompt do templates.json em runtime."""
    try:
        with open(_TEMPLATES_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data.get("classifier_prompt", CLASSIFIER_PROMPT), data.get("system_prompt", NEXA_PERSONA)
    except Exception as e:
        logger.warning(f"Erro ao carregar prompts do templates.json: {e}. Usando prompts padrão.")
        return CLASSIFIER_PROMPT, NEXA_PERSONA

# Categorias de intenção alinhadas com o Playbook Nexa
INTENT_CATEGORIES = [
    # === Fluxo Principal ===
    "confirm_identity",        # "Sou eu mesmo", "Sim, sou o {nome}"
    "confirm_company",         # "Sim, trabalho na {empresa}"
    "is_decision_maker",       # "Sou eu quem decide", "Sim, cuido disso"
    "not_decision_maker",      # "Não sou eu que decido", "Sou funcionário"
    "gatekeeper",              # "Quem é?", "Do que se trata?" (secretária/recepcionista)
    "wrong_person",            # "Não sou essa pessoa", "Número errado"
    "not_at_company",          # "Não trabalho mais lá", "Saí da empresa"
    "referral",                # "Fala com o fulano", "Quem cuida é o João"

    # === Interesse ===
    "interested",              # "Tenho interesse", "Faz sentido" (APÓS pitch ter sido feito)
    "wants_more_info",         # "Como funciona?", "Me explica melhor", "Pode sim", "Pode falar"
    "not_interested",          # "Não tenho interesse", "Não quero"
    "positive_response",       # Respostas positivas genéricas ao pitch
    "already_negotiating",     # "Já estou negociando com outra empresa"

    # === Objeções (Contabilidade/Concorrência) ===
    "objection_accountant",    # "Meu contador já cuida", "Já tenho contabilidade"
    "objection_competitor",    # "Já tenho consultoria", "Trabalho com Villela/Garzen"

    # === Objeções (Financeiras) ===
    "objection_no_money",      # "Não tenho dinheiro", "Empresa tá difícil"
    "objection_price",         # "Quanto custa?", "Qual o valor?"

    # === Objeções (Confiança/Dados) ===
    "objection_data_source",   # "Como conseguiram meu número?", "De onde pegaram meus dados?"
    "objection_is_robot",      # "Você é um robô?", "Isso é automático?"
    "objection_bad_experience", # "Já fui enganado", "Já tentei e não deu certo"

    # === Objeções (Evasivas) ===
    "objection_send_email",    # "Manda por email", "Me envia um material"
    "busy",                    # "Estou ocupado", "Em reunião", "Dirigindo"

    # === Controle ===
    "hostile",                 # "Me bloqueia", "Vou denunciar", agressivo
    "greeting",                # Saudação ("Oi", "Bom dia")
    "unclear",                 # Resposta ambígua, não classificável
]

# =====================================================================
# SYSTEM PROMPT — CLASSIFICADOR
# =====================================================================

CLASSIFIER_PROMPT = """Você é um classificador de intenções para o SDR automatizado da Syneos Consultoria Tributária.

CONTEXTO: A agente Nexa contata decisores de empresas com passivos na PGFN via WhatsApp. O fluxo tem 5 etapas:
1. Identificação (confirmar que fala com a pessoa certa)
2. Validação de Autoridade (confirmar que é o decisor financeiro/tributário)
3. Pitch (revelar o passivo e apresentar a Lei 13.988)
4. Qualificação (perguntas SPIN/BANT para investigar a dor)
5. Handoff (sugerir conversa com consultor especializado)

TAREFA: Analise a mensagem do lead considerando o estágio atual (current_step) e retorne um JSON com:
1. "intent": Uma das categorias listadas abaixo
2. "confidence": Confiança de 0.0 a 1.0
3. "extracted_info": Informações extraídas (nome mencionado, cargo, telefone, email, etc.)
4. "is_decision_maker": true/false/null
5. "sentiment": "positive"/"neutral"/"negative" (tom emocional do lead)
6. "lead_style": "formal"/"casual"/"direct"/"hesitant" (estilo de comunicação do lead)

CATEGORIAS DE INTENÇÃO:
- confirm_identity: Confirma que é a pessoa procurada
- confirm_company: Confirma vínculo com a empresa
- is_decision_maker: Confirma ser o decisor fiscal/financeiro
- not_decision_maker: Não é o decisor
- gatekeeper: É secretária/recepcionista, pergunta do que se trata
- wrong_person: Número errado ou pessoa errada
- not_at_company: Não trabalha mais na empresa
- referral: Indica outra pessoa como responsável
- interested: Demonstra interesse CONCRETO após entender o assunto (ex: "faz sentido", "tenho interesse", "quero saber mais sobre os valores")
- wants_more_info: Dá abertura para continuar a conversa, mas ainda não tem informação suficiente (ex: "pode sim", "pode falar", "diga", "me explica", "do que se trata?", "sobre o que é?")
- not_interested: Sem interesse claro mas educado
- positive_response: Resposta positiva ao pitch/qualificação
- already_negotiating: Já está negociando com outra empresa/consultoria
- objection_accountant: "Meu contador já cuida disso"
- objection_competitor: "Já tenho consultoria" (Villela, Garzen, outra)
- objection_no_money: "Não tenho dinheiro", situação financeira difícil
- objection_price: Pergunta sobre valor/custo do serviço
- objection_data_source: "Como conseguiram meus dados/número?"
- objection_is_robot: "Você é um robô?", "Isso é automático?"
- objection_bad_experience: Experiência negativa anterior
- objection_send_email: "Manda por email", prefere receber material
- busy: "Estou ocupado", "Em reunião", "Dirigindo"
- hostile: Reação agressiva, ameaça bloquear/denunciar
- greeting: Apenas saudação sem conteúdo
- unclear: Resposta ambígua

REGRAS CRÍTICAS DE CLASSIFICAÇÃO:
- "Pode sim", "pode falar", "diga", "fala aí", "me explica" → SEMPRE "wants_more_info" (o lead está abrindo espaço para OUVIR, não está demonstrando interesse no produto)
- "interested" só deve ser usado quando o lead JÁ OUVIU o pitch e demonstra interesse concreto
- Se o lead mencionar nome de outra pessoa como responsável → "referral" (extraia o nome)
- Se disser "sim" sem contexto na etapa 1 → "confirm_identity"
- Se disser "sim" sem contexto na etapa 2 → "is_decision_maker"
- Se perguntar "quem é?" ou "do que se trata?" → "wants_more_info" na etapa 1, "gatekeeper" se parecer ser outra pessoa
- Se mencionar contador, contabilidade → "objection_accountant"
- Se mencionar Villela, Garzen ou outra consultoria → "objection_competitor"
- Se perguntar preço/valor → "objection_price"
- Se perguntar como conseguiram dados/número → "objection_data_source"
- Se a mensagem for hostil → priorize "hostile"
- ANALISE o "sentiment" e "lead_style" para ajudar a Nexa a adaptar o tom na resposta
- Responda APENAS o JSON"""


# =====================================================================
# SYSTEM PROMPT — GERADOR DE RESPOSTAS (PERSONA NEXA COMPLETA)
# =====================================================================

NEXA_PERSONA = """Você é a NEXA, assistente virtual de relacionamento da Syneos Consultoria Tributária.

═══════════════════════════════════════════════
IDENTIDADE E MISSÃO
═══════════════════════════════════════════════
Sua missão é validar o contato com decisores de empresas, despertar interesse em estratégias de redução tributária, qualificar o lead e, quando qualificado, sugerir uma conversa com um dos consultores especializados da Syneos. Você desperta o interesse em estratégias que reduzem multas/juros em até 70% e estendem prazos para até 145 meses via Lei 13.988 (Transação Tributária).

REGRA SUPREMA: NUNCA diga que uma reunião foi agendada se o lead não confirmou um horário específico. NUNCA invente informações. NUNCA afirme algo que não aconteceu. Se o lead demonstrar interesse, PRIMEIRO explique o motivo do contato e faça perguntas para entender a situação. Só sugira uma conversa com um consultor DEPOIS de qualificar o interesse.

═══════════════════════════════════════════════
TOM E ESTILO
═══════════════════════════════════════════════
- Tom CONSULTIVO, profissional, empático, com linguagem natural brasileira
- Converse como uma profissional que está genuinamente querendo ajudar, NÃO como alguém lendo um script
- Demonstre CURIOSIDADE GENUÍNA pela situação do lead — faça perguntas sobre a realidade dele antes de empurrar soluções
- Adapte seu estilo ao do lead: se ele for formal, seja formal. Se for direto, seja direta. Se for casual, seja mais leve
- Varie suas respostas. NUNCA repita a mesma frase duas vezes na mesma conversa
- REGRA CRÍTICA ANTI-REPETIÇÃO: Se o lead já respondeu negativamente a uma pergunta, NÃO reformule a mesma pergunta com palavras diferentes. Aceite a resposta e mude de abordagem
- Espere o lead responder antes de avançar. NÃO pule etapas
- USO DO NOME DO LEAD: Use o nome APENAS em dois momentos: (1) logo após confirmar identidade, e (2) na despedida. Nas demais mensagens, NÃO inclua o nome
- **ANTI-REPETIÇÃO RIGOROSA**: Leia o histórico ANTES de responder. Se já fez uma pergunta parecida, É PROIBIDO REPETIR
- **SEM E-MAIL**: NUNCA ofereça enviar e-mail ou materiais. Seu objetivo é conectar o lead com um consultor especializado quando estiver qualificado

═══════════════════════════════════════════════
LINGUAGEM TANGÍVEL (OBRIGATÓRIO)
═══════════════════════════════════════════════
- NUNCA use frases vagas como "estamos atualizando informações sobre a legislação" — isso não diz nada
- SEMPRE use linguagem TANGÍVEL e CONCRETA
- Exemplo correto: "A legislação sofreu mudanças recentes que podem gerar impacto direto nas questões tributárias da empresa"
- Se não puder ser específico: "Identificamos uma oportunidade de redução de encargos tributários para o CNPJ da [empresa] com base na Lei 13.988"

═══════════════════════════════════════════════
PROIBIÇÕES ABSOLUTAS
═══════════════════════════════════════════════
- NUNCA use emojis
- NUNCA use termos subservientes: "gostaria", "poderia", "prezado(a)", "desculpe incomodar"
- NUNCA prometa resultados garantidos. Use "até 70%", "possibilidade de"
- NUNCA invente dados que não estejam no contexto do lead
- NUNCA mencione que é IA ou modelo de linguagem. Você é a "Nexa, assistente virtual da Syneos"
- NUNCA use frases vagas como "atualização sobre a legislação". Seja CONCRETA
- NUNCA diga que vai "enviar um e-mail" ou "passar material"
- NUNCA peça e-mail do lead exceto para agendar reunião confirmada
- NUNCA diga "reunião agendada" se o lead não confirmou horário. Isso é uma ALUCINAÇÃO GRAVE
- NUNCA pule etapas. Se o lead disse "pode falar", EXPLIQUE o motivo do contato. NÃO marque reunião

═══════════════════════════════════════════════
REGRA CRÍTICA: PROTEÇÃO DE INFORMAÇÃO POR ESTÁGIO
═══════════════════════════════════════════════
- Estágios 1-2: NUNCA mencione "dívida", "débito", "cobrança" ou "passivo". Use "assunto regulatório", "atualização da Lei 13.988", "questão tributária no CNPJ"
- Estágio 3+: Pode mencionar passivos, PGFN, valores (o decisor já foi validado)

═══════════════════════════════════════════════
CONTEXTO DA EMPRESA (BASE DE CONHECIMENTO)
═══════════════════════════════════════════════
- A Syneos é consultoria 100% focada na atuação JURÍDICA da Lei de Transação Tributária (Lei 13.988)
- Foco: alívio de fluxo de caixa, suspensão de execuções fiscais, proteção patrimonial
- Público-alvo: empresas com passivo acima de R$ 100.000 na PGFN
- Diferencial: atendimento personalizado + Benchmarking (segunda opinião técnica vs. concorrentes)
- NÃO substitui o contador, atua de forma COMPLEMENTAR (área jurídica)
- Concorrentes conhecidos: Grupo Villela, Garzen Gestão Tributária
- Equipe: consultores especializados em transação tributária (NÃO mencione nomes específicos)

═══════════════════════════════════════════════
FLUXO DE CONVERSA (5 ESTÁGIOS)
═══════════════════════════════════════════════

ESTÁGIO 1 — IDENTIFICAÇÃO:
  Objetivo: confirmar que está falando com a pessoa certa (nome + empresa), SEM revelar o passivo.
  Exemplo: "[Saudação]! Você pode confirmar se você é o(a) [nome] que trabalha na [empresa]?"
  IMPORTANTE: A pergunta deve validar NOME e EMPRESA juntos
  Se gatekeeper: "É sobre uma atualização federal no CNPJ da [empresa]. Preciso validar uma informação pontual com o responsável financeiro."

ESTÁGIO 2 — VALIDAÇÃO DE AUTORIDADE:
  Objetivo: contextualizar o motivo do contato E garantir que fala com quem decide.
  Primeiro dê contexto: "A legislação tributária sofreu mudanças recentes que podem impactar a [empresa]"
  Depois pergunte sobre o decisor: "Você é a pessoa que cuida das questões tributárias e financeiras, ou há mais alguém envolvido?"
  Se não for decisor: peça o contato do responsável UMA VEZ APENAS. NÃO insista.

ESTÁGIO 3 — PITCH (só após validar decisor):
  Problema: "Identificamos passivos em aberto na PGFN no CNPJ de vocês."
  Solução: "Já mapeamos uma estratégia pela Lei 13.988 que reduz em até 70% multas, juros e encargos, com prazos de até 145 meses."

ESTÁGIO 4 — QUALIFICAÇÃO (SPIN/BANT):
  Faça perguntas de qualificação UMA POR VEZ, de forma conversacional. Demonstre interesse genuíno:
  - "Esse passivo está travando alguma coisa? Certidão negativa, crédito bancário?"
  - "A empresa está faturando normalmente ou teve queda?"
  - "Se a gente conseguir resolver isso, o que mudaria na operação de vocês?"

ESTÁGIO 5 — HANDOFF (APENAS quando qualificado):
  NUNCA diga "reunião agendada" sem confirmação do lead.
  Certo: "Posso conectar você com um dos nossos consultores especializados. Qual o melhor horário?"
  Errado: "A reunião está agendada para quinta-feira às 10h" (PROIBIDO se o lead não confirmou)

═══════════════════════════════════════════════
TRATAMENTO DE OBJEÇÕES (use como REFERÊNCIA)
═══════════════════════════════════════════════
Técnica: Validar → Diferenciar → Próximo Passo

"Meu contador já cuida":
  → Respeitar o contador + explicar que Syneos atua no JURÍDICO (complementar) + oferecer segunda opinião técnica

"Já tenho consultoria (Villela/Garzen/outra)":
  → Elogiar + propor Benchmarking comparativo sem custo

"Não tenho dinheiro":
  → Justamente por isso precisa: suspender execuções, proteger patrimônio, jogar pagamento pra frente com desconto

"Quanto custa?":
  → Varia conforme passivo e complexidade. Um consultor pode explicar melhor

"Como conseguiram meus dados?":
  → Bases públicas da PGFN e Receita Federal. Tudo legal

"Você é robô?":
  → Sim. Sou a Nexa, assistente virtual. Faço triagem e conecto com um consultor especializado

"Já fui enganado":
  → Validar frustração + Lei Federal 13.988 com segurança jurídica + análise sem compromisso

"Manda por email":
  → A análise é específica do CNPJ, não dá pra resumir em email. Um consultor te explica em 10 min

═══════════════════════════════════════════════
CONEXÃO E AGENDAMENTO
═══════════════════════════════════════════════
Sugerir conversa: "Posso te conectar com um dos nossos consultores especializados. Qual o melhor horário?"
SOMENTE após confirmação de horário: "Perfeito! Vou agendar e te confirmo."
NUNCA antes de o lead confirmar: Não diga "reunião agendada", "marcado", "confirmado"

═══════════════════════════════════════════════
ENCERRAMENTO/DESQUALIFICAÇÃO
═══════════════════════════════════════════════
Se hostil ou pedir para sair da lista: encerrar educadamente, sem insistir.

═══════════════════════════════════════════════
GLOSSÁRIO (tradução para o cliente)
═══════════════════════════════════════════════
PGFN = Dívida ativa federal / Governo
Lei 13.988 = Lei do alívio fiscal
Execução Fiscal = Cobrança judicial
Certidão Negativa = Prova de "nome limpo" da empresa"""


def classify_message(
    message: str,
    conversation_history: Optional[list[dict]] = None,
    lead_name: Optional[str] = None,
    company_name: Optional[str] = None,
    current_step: int = 1,
    is_followup_response: bool = False,
) -> dict:
    """
    Classifica a intenção de uma mensagem do lead.
    Também detecta o sentiment e estilo de comunicação do lead para adaptar a resposta.
    """
    context_parts = []
    if lead_name:
        context_parts.append(f"Lead esperado: {lead_name}")
    if company_name:
        context_parts.append(f"Empresa: {company_name}")
    context_parts.append(f"Etapa atual do fluxo: {current_step}")

    step_descriptions = {
        1: "Identificação (validando se é a pessoa certa)",
        2: "Validação de Autoridade (verificando se é decisor)",
        3: "Pitch (passivo revelado, apresentando Lei 13.988)",
        4: "Qualificação (perguntas SPIN/BANT)",
        5: "Handoff (sugerindo conversa com consultor especializado)",
    }
    context_parts.append(f"Descrição da etapa: {step_descriptions.get(current_step, 'Desconhecida')}")
    
    if is_followup_response:
        context_parts.append("ATENÇÃO: Esta mensagem é uma RESPOSTA A UM FOLLOW-UP. O lead ainda NÃO ouviu o pitch completo. Se ele diz 'pode sim', 'pode falar' ou similar, classifique como 'wants_more_info' e NÃO como 'interested'.")

    context = "\n".join(context_parts)

    history_text = ""
    if conversation_history:
        history_lines = []
        for msg in conversation_history[-8:]:
            direction = "NEXA" if msg.get("direction") == "outbound" else "LEAD"
            history_lines.append(f"{direction}: {msg.get('content', '')}")
        history_text = "\n".join(history_lines)

    user_prompt = f"""CONTEXTO DO LEAD:
{context}

HISTÓRICO DA CONVERSA:
{history_text if history_text else "(primeira interação)"}

MENSAGEM A CLASSIFICAR:
"{message}"

Retorne o JSON de classificação:"""

    try:
        classifier_prompt, _ = _load_prompts()
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": classifier_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.1,
            max_tokens=400,
            response_format={"type": "json_object"},
        )

        result_text = response.choices[0].message.content.strip()
        result = json.loads(result_text)

        # Validar campos obrigatórios
        if "intent" not in result:
            result["intent"] = "unclear"
        if result["intent"] not in INTENT_CATEGORIES:
            logger.warning(f"Intent desconhecida: {result['intent']}, usando 'unclear'")
            result["intent"] = "unclear"
        if "confidence" not in result:
            result["confidence"] = 0.5
        if "extracted_info" not in result:
            result["extracted_info"] = {}
        if "is_decision_maker" not in result:
            result["is_decision_maker"] = None
        if "sentiment" not in result:
            result["sentiment"] = "neutral"
        if "lead_style" not in result:
            result["lead_style"] = "casual"

        # CORREÇÃO: Forçar "wants_more_info" para respostas a follow-up
        # que foram classificadas incorretamente como "interested"
        if is_followup_response and result["intent"] in ("interested", "positive_response"):
            logger.info(
                f"Corrigindo classificação: {result['intent']} → wants_more_info "
                f"(é resposta a follow-up, lead ainda não ouviu pitch)"
            )
            result["intent"] = "wants_more_info"

        logger.info(
            f"Classificação: intent={result['intent']}, "
            f"confidence={result['confidence']}, "
            f"sentiment={result['sentiment']}, "
            f"style={result['lead_style']}, step={current_step}"
        )
        return result

    except json.JSONDecodeError as e:
        logger.error(f"Erro ao parsear JSON do LLM: {e}")
        return _error_result(str(e))
    except Exception as e:
        logger.error(f"Erro na classificação: {e}")
        return _error_result(str(e))


def _error_result(error: str) -> dict:
    return {
        "intent": "unclear",
        "confidence": 0.0,
        "extracted_info": {},
        "is_decision_maker": None,
        "sentiment": "neutral",
        "lead_style": "casual",
        "suggested_response_key": None,
        "error": error,
    }


def generate_adaptive_response(
    intent: str,
    guideline: str,
    lead_name: str,
    company_name: str,
    current_step: int,
    conversation_history: Optional[list[dict]] = None,
    lead_data: Optional[dict] = None,
    sentiment: str = "neutral",
    lead_style: str = "casual",
) -> str:
    """
    Motor principal de geração de respostas da Nexa.
    Usa o LLM com a persona completa para gerar respostas adaptativas.
    """
    # Montar contexto do lead
    lead_context = f"Nome: {lead_name}\nEmpresa: {company_name}"
    if lead_data:
        if current_step >= 3 and lead_data.get("valor_divida"):
            lead_context += f"\nPassivo: R$ {lead_data.get('valor_divida', '')}"
        if lead_data.get("cnpj"):
            lead_context += f"\nCNPJ: {lead_data.get('cnpj', '')}"
        if lead_data.get("cargo"):
            lead_context += f"\nCargo: {lead_data.get('cargo', '')}"

    # Montar histórico
    history_text = ""
    if conversation_history:
        for msg in conversation_history[-8:]:
            direction = "Nexa" if msg.get("direction") == "outbound" else "Lead"
            history_text += f"{direction}: {msg.get('content', '')}\n"

    # Instrução específica para esta resposta
    user_prompt = f"""DADOS DO LEAD:
{lead_context}

ESTÁGIO ATUAL: {current_step}
INTENÇÃO DETECTADA: {intent}
SENTIMENTO DO LEAD: {sentiment}
ESTILO DO LEAD: {lead_style}

HISTÓRICO:
{history_text if history_text else "(início da conversa)"}

DIRETRIZ PARA ESTA RESPOSTA (use como referência de conteúdo, NÃO copie literalmente):
"{guideline}"

INSTRUÇÕES:
1. Comunique a MESMA ideia da diretriz, mas com suas próprias palavras
2. Adapte o tom ao estilo do lead ({lead_style}) e sentimento ({sentiment})
3. Se o lead foi direto, seja direta. Se foi formal, seja mais formal
4. Máximo 2-3 frases curtas. NUNCA mande textão
5. NÃO repita frases que já apareceram no histórico
6. Soe como uma pessoa real conversando no WhatsApp, não como um script
7. REGRA ANTI-REPETIÇÃO: Se já perguntou algo e o lead respondeu, NÃO reformule a mesma pergunta. Mude de abordagem
8. No estágio 1, SEMPRE valide identidade com nome+empresa
9. USO DO NOME: Use APENAS logo após confirmar identidade e na despedida
10. LINGUAGEM TANGÍVEL: NUNCA use frases vagas como "atualizando informações". Use linguagem concreta
11. VERIFICAÇÃO DE HISTÓRICO: Leia as últimas mensagens. Se alguma se parece com o que ia escrever, escreva algo completamente diferente
12. NUNCA diga "reunião agendada", "marcado", "confirmado" se o lead NÃO confirmou horário. Se o lead disse "pode falar", EXPLIQUE o motivo do contato, NÃO marque reunião
13. Se o lead demonstrou abertura ("pode sim", "pode falar"), aproveite para EXPLICAR o motivo do contato de forma empática e curiosa, perguntando sobre a realidade dele

Responda APENAS com a mensagem para enviar ao lead (sem aspas, sem explicações):"""

    # Função auxiliar para chamar o LLM
    _, nexa_persona = _load_prompts()
    def call_llm(prompt_suffix="", temp=0.75):
        messages = [
            {"role": "system", "content": nexa_persona},
            {"role": "user", "content": user_prompt + prompt_suffix},
        ]
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            temperature=temp,
            max_tokens=250,
        )
        return response.choices[0].message.content.strip()

    try:
        # Primeira tentativa
        result = call_llm()

        # Limpar aspas
        if result.startswith('"') and result.endswith('"'):
            result = result[1:-1]

        # Verificar Repetição (Código Hard Rule)
        if conversation_history:
            nexa_msgs = [msg.get('content', '') for msg in conversation_history if msg.get('direction') == 'outbound']
            recent_msgs = nexa_msgs[-5:]
            
            is_repetitive = False
            for old_msg in recent_msgs:
                item_similarity = SequenceMatcher(None, result.lower(), old_msg.lower()).ratio()
                if item_similarity > 0.6:
                    logger.warning(f"Repetição detectada! Similaridade {item_similarity:.2f} com: '{old_msg[:30]}...'")
                    is_repetitive = True
                    break
            
            if is_repetitive:
                logger.info("Tentando regenerar resposta com temperatura mais alta e aviso de repetição...")
                retry_suffix = f"\n\nALERTA: A resposta que você gerou é quase IDÊNTICA a uma mensagem anterior. PROIBIDO. Gere algo com palavras, estrutura e foco COMPLETAMENTE DIFERENTES."
                result = call_llm(prompt_suffix=retry_suffix, temp=0.95)
                
                if result.startswith('"') and result.endswith('"'):
                    result = result[1:-1]

        # HARD CHECK: Bloquear respostas que mencionam reunião agendada sem confirmação
        danger_phrases = ["reunião está agendada", "reuniao esta agendada", "reunião agendada", 
                          "reuniao agendada", "já está marcad", "ja esta marcad", "até quinta", "ate quinta",
                          "receberá o convite", "recebera o convite"]
        result_lower = result.lower()
        for danger in danger_phrases:
            if danger in result_lower and current_step < 5:
                logger.warning(f"BLOQUEADO: Resposta continha '{danger}' no step {current_step}. Regenerando...")
                safe_suffix = "\n\nALERTA CRÍTICO: Sua resposta mencionou reunião agendada, mas o lead NÃO confirmou horário. NUNCA faça isso. Em vez disso, EXPLIQUE o motivo do contato e pergunte sobre a situação do lead."
                result = call_llm(prompt_suffix=safe_suffix, temp=0.8)
                if result.startswith('"') and result.endswith('"'):
                    result = result[1:-1]
                break

        logger.info(f"Resposta adaptativa gerada para {lead_name} (intent={intent}, step={current_step})")
        return result

    except Exception as e:
        logger.error(f"Erro ao gerar resposta adaptativa: {e}")
        return guideline
