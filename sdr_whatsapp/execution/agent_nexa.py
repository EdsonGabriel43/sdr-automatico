"""
Agente Nexa — Motor Principal de Decisão (Arquitetura Adaptativa)
O LLM gera TODAS as respostas usando templates como diretrizes.
Fluxo de 4 estágios + matriz de objeções completa.

Estágios:
  1 = Identificação (validar pessoa)
  2 = Validação de Autoridade (confirmar decisor)
  3 = Pitch (revelar passivo + Lei 13.988)
  4 = Qualificação (SPIN/BANT)
  5 = Handoff (conectar com consultor especializado)
"""

import os
import json
import logging
import traceback
from datetime import datetime, timedelta
from typing import Optional
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client, Client

from .message_classifier import classify_message, generate_adaptive_response
from .chip_manager import (
    send_text_message,
    send_buttons_message,
    send_poll_message,
    increment_chip_counter,
    set_current_tenant,
)

load_dotenv()

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

# Carregar templates como DIRETRIZES (não serão enviados literalmente)
TEMPLATES_PATH = Path(__file__).parent.parent / "config" / "templates.json"
TEMPLATES = {}
_TENANT_TEMPLATES_CACHE: dict[str, dict] = {}

def reload_templates():
    global TEMPLATES
    with open(TEMPLATES_PATH, "r", encoding="utf-8") as f:
        TEMPLATES = json.load(f)

# Load inicial
reload_templates()


def get_supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def _load_tenant_templates(tenant_id: str) -> dict:
    """Load templates for a specific tenant, with fallback to global."""
    if not tenant_id:
        return TEMPLATES
    if tenant_id in _TENANT_TEMPLATES_CACHE:
        return _TENANT_TEMPLATES_CACHE[tenant_id]
    try:
        sb = get_supabase()
        result = sb.table("tenant_templates").select("templates").eq("tenant_id", tenant_id).single().execute()
        if result.data and result.data.get("templates"):
            tenant_tmpl = result.data["templates"]
            # Merge: tenant overrides global
            merged = {**TEMPLATES}
            for section in tenant_tmpl:
                if section in merged and isinstance(merged[section], dict):
                    merged[section] = {**merged[section], **tenant_tmpl[section]}
                else:
                    merged[section] = tenant_tmpl[section]
            _TENANT_TEMPLATES_CACHE[tenant_id] = merged
            return merged
    except Exception as e:
        logger.warning(f"Error loading tenant templates for {tenant_id}: {e}")
    return TEMPLATES


def get_guideline(template_key: str, variables: dict, section: str = "responses", tenant_id: str = None) -> str:
    """
    Retorna o texto de referência (diretriz) do template,
    com variáveis substituídas. Este texto NÃO será enviado literalmente —
    será usado como guia para o LLM gerar a resposta adaptada.
    """
    templates = _load_tenant_templates(tenant_id) if tenant_id else TEMPLATES

    if section == "messages":
        template = templates.get("messages", {}).get(template_key, {})
        text = template.get("text", "")
    else:
        text = templates.get("responses", {}).get(template_key, "")

    for key, value in variables.items():
        text = text.replace(f"{{{key}}}", str(value))

    return text


def format_currency(value) -> str:
    """Formata valor em reais."""
    try:
        v = float(value)
        return f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    except (ValueError, TypeError):
        return str(value)


def get_greeting() -> str:
    """Retorna saudação baseada no horário atual."""
    hour = datetime.now().hour
    if hour < 12:
        return "Bom dia"
    elif hour < 18:
        return "Boa tarde"
    else:
        return "Boa noite"


async def respond_adaptive(
    intent: str,
    template_key: str,
    variables: dict,
    lead: dict,
    current_step: int,
    conversation_history: list,
    sentiment: str = "neutral",
    lead_style: str = "casual",
    section: str = "responses",
) -> str:
    """
    Gera resposta adaptativa via LLM usando o template como diretriz.
    É o wrapper central — toda resposta da Nexa passa por aqui.
    """
    guideline = get_guideline(template_key, variables, section=section)

    lead_data = {
        "cnpj": lead.get("cnpj", ""),
        "valor_divida": format_currency(lead.get("valor_divida", "")),
        "cargo": lead.get("cargo", ""),
        "tipo_divida": lead.get("tipo_divida", ""),
    }

    return generate_adaptive_response(
        intent=intent,
        guideline=guideline,
        lead_name=lead.get("nome", ""),
        company_name=lead.get("empresa", ""),
        current_step=current_step,
        conversation_history=conversation_history,
        lead_data=lead_data,
        sentiment=sentiment,
        lead_style=lead_style,
    )


async def send_first_contact(conversation_id: str) -> bool:
    """
    Envia a primeira mensagem de contato.
    Estágio 1: Apenas validação de identidade, SEM revelar passivo.
    A mensagem é gerada pelo LLM com base na diretriz do template.
    Usa BOTÕES (não opções numeradas) para a resposta do lead.
    """
    sb = get_supabase()

    conv = (
        sb.table("conversations")
        .select("*, leads(*), chips(*)")
        .eq("id", conversation_id)
        .single()
        .execute()
    )
    if not conv.data:
        logger.error(f"Conversa {conversation_id} não encontrada")
        return False

    conversation = conv.data
    lead = conversation["leads"]
    chip = conversation["chips"]

    if not lead.get("telefone"):
        logger.error(f"Lead {lead['id']} sem telefone")
        return False

    # Verificar blocklist
    blocked = sb.rpc("is_blocked", {"p_phone": lead["telefone"]}).execute()
    if blocked.data:
        logger.info(f"Telefone {lead['telefone']} está na blocklist, pulando")
        sb.table("conversations").update({"status": "blocked"}).eq(
            "id", conversation_id
        ).execute()
        return False

    # Preparar variáveis e diretriz
    variables = {
        "greeting": get_greeting(),
        "nome": lead.get("nome", ""),
        "empresa": lead.get("empresa", ""),
    }

    # Gerar mensagem adaptativa para primeiro contato
    text = await respond_adaptive(
        intent="first_contact",
        template_key="first_contact",
        variables=variables,
        lead=lead,
        current_step=1,
        conversation_history=[],
        section="messages",
    )

    # Enviar mensagem com BOTÕES (não opções numeradas)
    try:
        buttons = [
            {"id": "btn_continue", "text": "Sim, sou eu!"},
            {"id": "btn_block", "text": "Parar contato"},
        ]

        try:
            result = await send_buttons_message(
                chip["instance_name"], lead["telefone"], text, buttons
            )
        except Exception:
            # Fallback: enviar como texto simples se botões falharem
            logger.warning("Botões não suportados, enviando como texto simples")
            result = await send_text_message(
                chip["instance_name"], lead["telefone"], text
            )

        wa_msg_id = result.get("key", {}).get("id", "")
        sb.table("messages").insert(
            {
                "conversation_id": conversation_id,
                "direction": "outbound",
                "content": text,
                "message_type": "button",
                "whatsapp_message_id": wa_msg_id,
                "status": "sent",
                "sent_at": datetime.utcnow().isoformat(),
            }
        ).execute()

        next_followup = datetime.utcnow() + timedelta(
            hours=TEMPLATES["followup_intervals_hours"][0]
        )
        sb.table("conversations").update(
            {
                "status": "contacted",
                "current_step": 1,
                "next_follow_up_at": next_followup.isoformat(),
            }
        ).eq("id", conversation_id).execute()

        increment_chip_counter(chip["id"])

        logger.info(
            f"Primeira mensagem enviada para {lead['nome']} ({lead['telefone']})"
        )
        return True

    except Exception as e:
        logger.error(f"Erro ao enviar mensagem: {e}")
        return False


async def process_incoming_message(
    phone: str,
    message_text: str,
    wa_message_id: str,
    instance_name: str,
    tenant_id: str = None,
) -> Optional[str]:
    """
    Processa uma mensagem recebida de um lead.
    Identifica a conversa, classifica a intenção, e responde via LLM adaptativo.
    """
    try:
        return await _process_incoming_message_impl(
            phone, message_text, wa_message_id, instance_name, tenant_id=tenant_id
        )
    except Exception as e:
        logger.error(
            f"ERRO FATAL ao processar mensagem de {phone}: {e}\n"
            f"{traceback.format_exc()}"
        )
        return None


def _phone_variants(phone: str) -> list:
    """
    Retorna variantes do número para lidar com o 'nono dígito' brasileiro.
    WhatsApp às vezes entrega 554199XXXXXX (12d) em vez de 55419XXXXXXX (13d).
    """
    variants = [phone]
    digits = phone.lstrip("+")
    if digits.startswith("55") and len(digits) == 12:
        # 55 + DDD(2) + 8 dígitos → adicionar o 9
        variants.append("55" + digits[2:4] + "9" + digits[4:])
    elif digits.startswith("55") and len(digits) == 13:
        # 55 + DDD(2) + 9 + 8 dígitos → remover o 9
        if digits[4] == "9":
            variants.append("55" + digits[2:4] + digits[5:])
    return variants


async def _process_incoming_message_impl(
    phone: str,
    message_text: str,
    wa_message_id: str,
    instance_name: str,
    tenant_id: str = None,
) -> Optional[str]:
    """Implementação interna do processamento de mensagens."""
    sb = get_supabase()

    # Set tenant context for message routing
    set_current_tenant(tenant_id)

    # 1. Encontrar lead pelo telefone (tenta todas as variantes do nono dígito)
    lead_result = None
    for phone_variant in _phone_variants(phone):
        logger.info(f"Buscando lead com telefone: {phone_variant}")
        query = (
            sb.table("leads")
            .select("id, nome, empresa, cnpj, valor_divida, cargo, tipo_divida, tenant_id")
            .eq("telefone", phone_variant)
        )
        if tenant_id:
            query = query.eq("tenant_id", tenant_id)
        result = query.execute()
        if result.data:
            lead_result = result
            phone = phone_variant  # usar o formato que bateu no banco
            # Se não tínhamos tenant_id, pegar do lead
            if not tenant_id and result.data[0].get("tenant_id"):
                tenant_id = result.data[0]["tenant_id"]
            break

    if not lead_result or not lead_result.data:
        logger.info(f"Mensagem de número desconhecido: {phone}")
        return None

    lead = lead_result.data[0]
    logger.info(f"Lead encontrado: {lead['nome']} ({lead['id']})")

    # 2. Encontrar conversa ativa
    conv_result = (
        sb.table("conversations")
        .select("*, chips(*)")
        .eq("lead_id", lead["id"])
        .neq("status", "blocked")
        .neq("status", "no_response")
        .neq("status", "handed_off")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    if not conv_result.data:
        logger.info(f"Sem conversa ativa para lead {lead['nome']}")
        return None

    conversation = conv_result.data[0]
    chip = conversation.get("chips")
    if not chip:
        logger.error(f"Conversa {conversation['id']} sem chip associado!")
        return None

    logger.info(
        f"Conversa encontrada: {conversation['id']}, "
        f"status={conversation['status']}, step={conversation.get('current_step', 1)}, "
        f"chip={chip.get('instance_name', 'N/A')}"
    )
    current_step = conversation.get("current_step", 1)

    # ============================================================
    # CORREÇÃO CRÍTICA: Se lead responde a follow-up (status=contacted),
    # resetar o step para 2 para retomar a conversa do começo.
    # Isso IMPEDE que o agente pule para handoff/reunião agendada.
    # ============================================================
    is_followup_response = conversation["status"] == "contacted" and current_step > 2
    if is_followup_response:
        logger.info(
            f"Lead {lead['nome']} respondeu a follow-up no step {current_step}. "
            f"RESETANDO para step 2 para retomar explicação."
        )
        current_step = 2
        sb.table("conversations").update(
            {"current_step": 2}
        ).eq("id", conversation["id"]).execute()

    # 3. Registrar mensagem recebida
    sb.table("messages").insert(
        {
            "conversation_id": conversation["id"],
            "direction": "inbound",
            "content": message_text,
            "whatsapp_message_id": wa_message_id,
            "status": "delivered",
        }
    ).execute()

    if conversation["status"] == "contacted":
        sb.table("conversations").update(
            {"status": "responded", "follow_up_count": 0}
        ).eq("id", conversation["id"]).execute()

    # 4. Buscar histórico
    history_result = (
        sb.table("messages")
        .select("direction, content")
        .eq("conversation_id", conversation["id"])
        .order("created_at")
        .execute()
    )
    conversation_history = history_result.data or []

    # 5. Detecção rápida de respostas de botão/opção
    button_intents = {
        "SIM, SOU EU": "confirm_identity",
        "SIM SOU EU": "confirm_identity",
        "SIM, SOU EU!": "confirm_identity",
        "NÃO SOU EU": "wrong_person",
        "NAO SOU EU": "wrong_person",
        "PARAR CONTATO": "hostile",
        "BLOQUEAR CONTATO": "hostile",
        "BLOQUEAR CONVERSA": "hostile",
        # Manter compatibilidade com opções numéricas legadas
        "1": "confirm_identity",
        "2": "wrong_person",
        "3": "hostile",
    }

    normalized_msg = message_text.strip().upper()
    if normalized_msg in button_intents:
        intent = button_intents[normalized_msg]
        confidence = 1.0
        extracted_info = {}
        sentiment = "neutral"
        lead_style = "casual"
        logger.info(
            f"Lead {lead['nome']}: RESPOSTA DE BOTÃO detectada → intent={intent}"
        )
    else:
        # Classificar via LLM normalmente
        classification = classify_message(
            message=message_text,
            conversation_history=conversation_history,
            lead_name=lead.get("nome"),
            company_name=lead.get("empresa"),
            current_step=current_step,
            is_followup_response=is_followup_response,
        )

        intent = classification["intent"]
        confidence = classification.get("confidence", 0.5)
        extracted_info = classification.get("extracted_info", {})
        sentiment = classification.get("sentiment", "neutral")
        lead_style = classification.get("lead_style", "casual")

    logger.info(
        f"Lead {lead['nome']}: intent={intent}, confidence={confidence}, "
        f"sentiment={sentiment}, style={lead_style}, step={current_step}"
    )

    # 6. Atualizar classificação
    sb.table("conversations").update(
        {
            "intent_classification": intent,
            "confidence_score": confidence,
            "extracted_info": json.dumps(extracted_info),
            "next_follow_up_at": None,
        }
    ).eq("id", conversation["id"]).execute()

    # 7. Árvore de decisão → resposta adaptativa
    response_text = await execute_decision_tree(
        intent=intent,
        confidence=confidence,
        message=message_text,
        lead=lead,
        conversation=conversation,
        conversation_history=conversation_history,
        extracted_info=extracted_info,
        chip=chip,
        current_step=current_step,
        sentiment=sentiment,
        lead_style=lead_style,
        is_followup_response=is_followup_response,
    )

    if response_text:
        try:
            result = await send_text_message(
                chip["instance_name"], phone, response_text
            )
            wa_id = result.get("key", {}).get("id", "")

            sb.table("messages").insert(
                {
                    "conversation_id": conversation["id"],
                    "direction": "outbound",
                    "content": response_text,
                    "whatsapp_message_id": wa_id,
                    "status": "sent",
                    "sent_at": datetime.utcnow().isoformat(),
                }
            ).execute()

            increment_chip_counter(chip["id"])
            logger.info(f"Resposta adaptativa enviada para {lead['nome']}")

            # Agendar follow-up de 2h para leads em conversa ativa (quentes)
            # Leads frios (contacted) são gerenciados pelo motor separado
            current_conv_status = (
                sb.table("conversations")
                .select("status")
                .eq("id", conversation["id"])
                .single()
                .execute()
            ).data or {}
            active_statuses = ("responded", "nurturing", "qualified")
            if current_conv_status.get("status") in active_statuses:
                next_followup = (datetime.utcnow() + timedelta(hours=2)).isoformat()
                sb.table("conversations").update(
                    {"next_follow_up_at": next_followup, "follow_up_count": 0}
                ).eq("id", conversation["id"]).execute()
                logger.info(f"Timer 2h agendado para {lead['nome']} (nurturing follow-up)")

        except Exception as e:
            logger.error(f"Erro ao enviar resposta: {e}")

    return response_text


async def execute_decision_tree(
    intent: str,
    confidence: float,
    message: str,
    lead: dict,
    conversation: dict,
    conversation_history: list,
    extracted_info: dict,
    chip: dict,
    current_step: int = 1,
    sentiment: str = "neutral",
    lead_style: str = "casual",
    is_followup_response: bool = False,
) -> Optional[str]:
    """
    Árvore de decisão principal com fluxo de 4 estágios.
    TODAS as respostas são geradas pelo LLM via respond_adaptive().
    
    REGRA CRÍTICA: O agente NUNCA deve dizer que uma reunião foi agendada
    a menos que tenha de fato confirmado horário com o lead.
    """
    sb = get_supabase()
    conv_id = conversation["id"]
    lead_id = lead["id"]

    variables = {
        "nome": lead.get("nome", ""),
        "empresa": lead.get("empresa", ""),
        "valor_divida": format_currency(lead.get("valor_divida", "")),
        "cnpj": lead.get("cnpj", ""),
        "cargo": lead.get("cargo", ""),
        "tipo_divida": lead.get("tipo_divida", ""),
        "greeting": get_greeting(),
    }

    # Helper para gerar resposta adaptativa com todos os params
    async def respond(template_key: str, section: str = "responses") -> str:
        return await respond_adaptive(
            intent=intent,
            template_key=template_key,
            variables=variables,
            lead=lead,
            current_step=current_step,
            conversation_history=conversation_history,
            sentiment=sentiment,
            lead_style=lead_style,
            section=section,
        )

    # ===================================================================
    # CASO ESPECIAL: Lead respondendo a follow-up positivamente
    # O agente DEVE retomar a explicação, NÃO pular para handoff.
    # ===================================================================
    if is_followup_response and intent in ("interested", "positive_response", "wants_more_info", "confirm_identity", "greeting"):
        logger.info(f"Lead {lead['nome']} respondeu follow-up positivamente → retomando pitch contextualizado")
        sb.table("conversations").update(
            {"current_step": 2, "status": "responded"}
        ).eq("id", conv_id).execute()
        return await respond("followup_positive")

    # ===================================================================
    # TRATAMENTOS GLOBAIS (funcionam em qualquer estágio)
    # ===================================================================

    # --- HOSTIL / ENCERRAMENTO ---
    if intent == "hostile":
        sb.table("conversations").update({"status": "blocked"}).eq(
            "id", conv_id
        ).execute()
        phone = (
            sb.table("leads")
            .select("telefone")
            .eq("id", lead_id)
            .single()
            .execute()
        )
        if phone.data and phone.data.get("telefone"):
            sb.table("blocklist").upsert(
                {
                    "phone_number": phone.data["telefone"],
                    "lead_id": lead_id,
                    "reason": "user_request",
                },
                on_conflict="phone_number",
            ).execute()
        return await respond("hostile")

    # --- PESSOA ERRADA ---
    if intent == "wrong_person":
        sb.table("conversations").update({"status": "wrong_person"}).eq(
            "id", conv_id
        ).execute()
        return await respond("wrong_person")

    # --- NÃO TRABALHA MAIS LÁ ---
    if intent == "not_at_company":
        sb.table("conversations").update({"status": "wrong_person"}).eq(
            "id", conv_id
        ).execute()
        return await respond("not_at_company")

    # --- OCUPADO ---
    if intent == "busy":
        return await respond("busy")

    # --- REFERRAL (indica outra pessoa) ---
    if intent == "referral":
        referral_name = extracted_info.get("referral_name", "essa pessoa")
        variables["referral_name"] = referral_name
        sb.table("conversations").update(
            {
                "status": "nurturing",
                "summary": f"Indicou {referral_name} como possivel decisor",
            }
        ).eq("id", conv_id).execute()
        return await respond("got_referral")

    # ===================================================================
    # OBJEÇÕES (funcionam em qualquer estágio)
    # ===================================================================

    objection_map = {
        "objection_accountant": "objection_accountant",
        "objection_competitor": "objection_competitor",
        "objection_no_money": "objection_no_money",
        "objection_price": "objection_price",
        "objection_data_source": "objection_data_source",
        "objection_is_robot": "objection_is_robot",
        "objection_bad_experience": "objection_bad_experience",
        "objection_send_email": "objection_send_email",
    }

    if intent in objection_map:
        return await respond(objection_map[intent])

    # ===================================================================
    # FLUXO POR ESTÁGIO
    # ===================================================================

    # --- ESTÁGIO 1: IDENTIFICAÇÃO ---
    if current_step == 1:
        if intent == "gatekeeper":
            return await respond("gatekeeper")

        if intent in ("confirm_identity", "greeting", "interested"):
            sb.table("conversations").update(
                {"current_step": 2, "status": "responded"}
            ).eq("id", conv_id).execute()
            return await respond("confirm_identity")

        if intent == "not_interested":
            sb.table("conversations").update({"status": "not_interested"}).eq(
                "id", conv_id
            ).execute()
            return await respond("not_interested")

    # --- ESTÁGIO 2: VALIDAÇÃO DE AUTORIDADE ---
    if current_step == 2:
        if intent == "gatekeeper":
            return await respond("gatekeeper")

        if intent in ("confirm_company", "confirm_identity", "wants_more_info"):
            return await respond("validate_authority")

        if intent in ("is_decision_maker", "interested", "positive_response"):
            sb.table("conversations").update(
                {"current_step": 3, "status": "qualified"}
            ).eq("id", conv_id).execute()
            return await respond("is_decision_maker")

        if intent == "not_decision_maker":
            sb.table("conversations").update(
                {"status": "nurturing", "current_step": 2}
            ).eq("id", conv_id).execute()
            return await respond("not_decision_maker")

        if intent == "not_interested":
            sb.table("conversations").update({"status": "not_interested"}).eq(
                "id", conv_id
            ).execute()
            return await respond("not_interested")

    # --- ESTÁGIO 3: PITCH ---
    if current_step == 3:
        if intent in ("interested", "positive_response", "wants_more_info", "confirm_identity"):
            sb.table("conversations").update(
                {"current_step": 4}
            ).eq("id", conv_id).execute()
            return await respond("pitch_solution")

        if intent == "not_interested":
            sb.table("conversations").update({"status": "not_interested"}).eq(
                "id", conv_id
            ).execute()
            return await respond("not_interested")

        if intent == "already_negotiating":
            sb.table("conversations").update(
                {"status": "negotiating_elsewhere"}
            ).eq("id", conv_id).execute()
            return await respond("already_negotiating")

    # --- ESTÁGIO 4: QUALIFICAÇÃO (SPIN/BANT) ---
    # CORREÇÃO: Não pular direto para handoff.
    # Fazer pelo menos uma pergunta de qualificação antes.
    if current_step == 4:
        if intent in ("interested", "positive_response", "wants_more_info"):
            # Fazer pergunta de qualificação, NÃO handoff imediato
            qualification_count = conversation.get("qualification_count", 0)
            
            if qualification_count >= 2:
                # Já fez qualificação suficiente → agora sim, sugerir consultor
                sb.table("conversations").update(
                    {"current_step": 5, "status": "qualified"}
                ).eq("id", conv_id).execute()
                return await respond("handoff_warm")
            else:
                # Fazer pergunta de qualificação
                q_key = f"qualification_q{qualification_count + 1}"
                sb.table("conversations").update(
                    {"qualification_count": qualification_count + 1}
                ).eq("id", conv_id).execute()
                return await respond(q_key)

        if intent == "not_interested":
            sb.table("conversations").update({"status": "not_interested"}).eq(
                "id", conv_id
            ).execute()
            return await respond("not_interested")

        if intent == "already_negotiating":
            sb.table("conversations").update(
                {"status": "negotiating_elsewhere"}
            ).eq("id", conv_id).execute()
            return await respond("already_negotiating")

    # --- ESTÁGIO 5: HANDOFF ---
    if current_step == 5:
        if intent == "not_interested":
            sb.table("conversations").update({"status": "not_interested"}).eq("id", conv_id).execute()
            return await respond("not_interested")

        if intent == "busy":
            return await respond("handoff_schedule")

        # Qualquer resposta positiva no step 5 → disparar handoff imediatamente
        if intent in ("interested", "positive_response", "confirm_identity", "wants_more_info", "confirm_company", "is_decision_maker"):
            await trigger_handoff(conv_id, lead, conversation_history, variables)
            return await respond("handoff_confirm")

    # ===================================================================
    # FALLBACK — LLM gera resposta livre (sem template de referência)
    # ===================================================================

    fallback_guideline = (
        "Responda de forma natural e conduza a conversa de volta ao fluxo. "
        "Seja empática e tente entender o que o lead quer. "
        "NUNCA diga que uma reunião foi agendada se o lead não confirmou horário. "
        "NUNCA pule etapas da conversa. Se o lead disse 'pode falar', explique o motivo do contato."
    )

    return generate_adaptive_response(
        intent=intent,
        guideline=fallback_guideline,
        lead_name=lead.get("nome", ""),
        company_name=lead.get("empresa", ""),
        current_step=current_step,
        conversation_history=conversation_history,
        lead_data={
            "cnpj": lead.get("cnpj", ""),
            "valor_divida": format_currency(lead.get("valor_divida", "")),
            "cargo": lead.get("cargo", ""),
        },
        sentiment=sentiment,
        lead_style=lead_style,
    )


async def trigger_handoff(
    conversation_id: str,
    lead: dict,
    conversation_history: list,
    variables: dict,
) -> None:
    """Dispara handoff para consultor especializado quando lead é qualificado."""
    sb = get_supabase()

    closer_phone = os.getenv("CLOSER_PHONE", "")
    if not closer_phone:
        logger.error("CLOSER_PHONE não configurado!")
        return

    summary_lines = []
    for msg in conversation_history[-10:]:
        direction = "Nexa" if msg.get("direction") == "outbound" else "Lead"
        summary_lines.append(f"{direction}: {msg.get('content', '')[:100]}")
    summary = "\n".join(summary_lines)

    variables["summary"] = summary

    # Registrar handoff
    sb.table("handoffs").insert(
        {
            "conversation_id": conversation_id,
            "lead_id": lead["id"],
            "closer_phone": closer_phone,
            "status": "pending",
            "lead_summary": (
                f"Empresa: {lead.get('empresa', '')}\n"
                f"CNPJ: {lead.get('cnpj', '')}\n"
                f"Passivo: R$ {format_currency(lead.get('valor_divida', ''))}\n"
                f"Decisor: {lead.get('nome', '')}"
            ),
            "conversation_history": summary,
            "notified_at": datetime.utcnow().isoformat(),
        }
    ).execute()

    sb.table("conversations").update({"status": "handed_off"}).eq(
        "id", conversation_id
    ).execute()

    # Notificar consultor especializado
    chip_result = (
        sb.table("chips")
        .select("instance_name")
        .in_("status", ["active", "warming"])
        .limit(1)
        .execute()
    )

    if chip_result.data:
        notification = get_guideline("handoff_notification", variables)
        try:
            await send_text_message(
                chip_result.data[0]["instance_name"],
                closer_phone,
                notification,
            )
            logger.info(
                f"Handoff disparado para consultor: {lead.get('nome', '')}"
            )
        except Exception as e:
            logger.error(f"Erro ao notificar consultor: {e}")
    else:
        logger.error("Nenhum chip disponivel para notificar consultor!")
