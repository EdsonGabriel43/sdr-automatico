"""
Motor de Follow-ups — SDR WhatsApp
Monitora conversas sem resposta e dispara follow-ups automáticos.
Inclui follow-ups para leads frios (contacted) e leads quentes (nurturing/responded).
"""

import os
import json
import asyncio
import random
import logging
from datetime import datetime, timedelta
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client, Client
from openai import OpenAI

from .chip_manager import (
    send_text_message,
    send_buttons_message,
    increment_chip_counter,
    get_available_chip,
    set_current_tenant,
)

load_dotenv()

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
MIN_DELAY = int(os.getenv("MIN_DELAY_SECONDS", "60"))
MAX_DELAY = int(os.getenv("MAX_DELAY_SECONDS", "180"))

# Intervalos de follow-up para leads quentes (em horas)
# Após o agente responder: 2h → 24h → 48h → 72h → encerra
NURTURING_INTERVALS_HOURS = [2, 24, 48, 72]
MAX_NURTURING_FOLLOWUPS = len(NURTURING_INTERVALS_HOURS)

# Carregar templates
TEMPLATES_PATH = Path(__file__).parent.parent / "config" / "templates.json"
with open(TEMPLATES_PATH, "r", encoding="utf-8") as f:
    TEMPLATES = json.load(f)

MAX_FOLLOWUPS = TEMPLATES.get("max_followups", 3)
FOLLOWUP_INTERVALS = TEMPLATES.get("followup_intervals_hours", [48, 72, 96])


def get_supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def format_template(template_key: str, variables: dict) -> str:
    """Substitui variáveis no template."""
    template = TEMPLATES["messages"].get(template_key, {})
    text = template.get("text", "")
    for key, value in variables.items():
        text = text.replace(f"{{{key}}}", str(value))
    return text


async def generate_nurturing_followup(
    lead: dict,
    conversation_history: list,
    follow_up_number: int,
    current_step: int,
) -> str:
    """
    Gera via GPT uma mensagem de retomada contextual para leads quentes que pararam de responder.
    Referencia a última mensagem do agente e retoma naturalmente a conversa.
    """
    last_bot_msg = ""
    for msg in reversed(conversation_history):
        if msg.get("direction") == "outbound":
            last_bot_msg = msg.get("content", "")[:300]
            break

    step_names = {
        1: "identificação do contato",
        2: "validação de autoridade",
        3: "apresentação do serviço",
        4: "qualificação do lead",
        5: "agendamento com consultor",
    }
    step_name = step_names.get(current_step, "conversa")

    encerramento = (
        " Este é o último contato. Se não houver resposta, encerre educadamente e ofereça retomar no futuro."
        if follow_up_number >= MAX_NURTURING_FOLLOWUPS
        else ""
    )

    prompt = f"""Você é a Nexa, SDR da Syneos Consultoria especializada em regularização tributária (Lei 13.988).
Está tentando retomar uma conversa com {lead.get('nome', '')} da {lead.get('empresa', '')}.

Etapa da conversa: {step_name} (etapa {current_step}/5)
Sua última mensagem não respondida: "{last_bot_msg}"
Esta é a {follow_up_number}ª tentativa de retomada de {MAX_NURTURING_FOLLOWUPS}.{encerramento}

Gere uma mensagem curta de WhatsApp (1-2 frases) que:
1. Mencione de forma natural que talvez não tenham visto a mensagem anterior
2. Retome exatamente o ponto ou pedido onde parou
3. Seja conversacional, humana, sem parecer automática
4. Não use emojis em excesso (máximo 1)
5. Mantenha tom profissional mas próximo

Responda APENAS com o texto da mensagem, sem aspas."""

    try:
        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=150,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        logger.error(f"Erro ao gerar follow-up nurturing via GPT: {e}")
        # Fallback genérico
        return f"{lead.get('nome', '')}, talvez você não tenha visto minha última mensagem — consegue dar uma olhadinha quando puder?"


async def check_nurturing_followups() -> dict:
    """
    Verifica leads quentes (nurturing/responded) que pararam de responder
    e envia follow-ups contextuais gerados pelo GPT.
    Intervalos: 2h → 24h → 48h → 72h → encerra como no_response.
    """
    sb = get_supabase()
    now = datetime.utcnow()
    metrics = {"followups_sent": 0, "followups_closed": 0, "errors": 0}

    conversations = (
        sb.table("conversations")
        .select("*, leads(*), chips(*)")
        .in_("status", ["nurturing", "responded", "qualified"])
        .lt("next_follow_up_at", now.isoformat())
        .not_.is_("next_follow_up_at", "null")
        .order("next_follow_up_at")
        .limit(30)
        .execute()
    )

    if not conversations.data:
        logger.info("Nenhum follow-up nurturing pendente")
        return metrics

    logger.info(f"Encontrados {len(conversations.data)} follow-ups nurturing pendentes")

    for conv in conversations.data:
        lead = conv.get("leads") or {}
        chip = conv.get("chips")
        follow_up_count = conv.get("follow_up_count", 0)

        # Set tenant context for message routing
        set_current_tenant(conv.get("tenant_id"))

        # Encerrar se excedeu o máximo
        if follow_up_count >= MAX_NURTURING_FOLLOWUPS:
            sb.table("conversations").update(
                {"status": "no_response", "next_follow_up_at": None}
            ).eq("id", conv["id"]).execute()
            metrics["followups_closed"] += 1
            logger.info(f"Lead {lead.get('nome', '?')}: máximo de follow-ups nurturing atingido")
            continue

        # Verificar blocklist
        if lead.get("telefone"):
            blocked = sb.rpc("is_blocked", {"p_phone": lead["telefone"]}).execute()
            if blocked.data:
                sb.table("conversations").update(
                    {"status": "blocked", "next_follow_up_at": None}
                ).eq("id", conv["id"]).execute()
                continue

        # Garantir chip disponível (filtrado por tenant)
        if not chip or chip.get("status") not in ("active", "warming"):
            chip_data = get_available_chip(conv.get("tenant_id"))
            if not chip_data:
                logger.warning(f"Nenhum chip disponível para follow-up nurturing (tenant={conv.get('tenant_id')})")
                continue
            chip = chip_data
            sb.table("conversations").update({"chip_id": chip["id"]}).eq("id", conv["id"]).execute()

        # Buscar histórico da conversa
        history = (
            sb.table("messages")
            .select("direction, content")
            .eq("conversation_id", conv["id"])
            .order("created_at")
            .execute()
        )
        conversation_history = history.data or []

        # Gerar mensagem contextual via GPT
        follow_up_number = follow_up_count + 1
        current_step = conv.get("current_step", 1)

        try:
            text = await generate_nurturing_followup(
                lead=lead,
                conversation_history=conversation_history,
                follow_up_number=follow_up_number,
                current_step=current_step,
            )
        except Exception as e:
            logger.error(f"Erro ao gerar texto de nurturing: {e}")
            metrics["errors"] += 1
            continue

        # Enviar mensagem
        try:
            result = await send_text_message(chip["instance_name"], lead["telefone"], text)
            wa_msg_id = result.get("key", {}).get("id", "")

            sb.table("messages").insert({
                "conversation_id": conv["id"],
                "direction": "outbound",
                "content": text,
                "message_type": "nurturing_followup",
                "whatsapp_message_id": wa_msg_id,
                "status": "sent",
                "sent_at": now.isoformat(),
            }).execute()

            # Agendar próximo follow-up ou encerrar
            new_count = follow_up_count + 1
            if new_count < MAX_NURTURING_FOLLOWUPS:
                next_interval = NURTURING_INTERVALS_HOURS[new_count]
                next_followup = (now + timedelta(hours=next_interval)).isoformat()
            else:
                next_followup = None

            sb.table("conversations").update({
                "follow_up_count": new_count,
                "next_follow_up_at": next_followup,
            }).eq("id", conv["id"]).execute()

            increment_chip_counter(chip["id"])
            metrics["followups_sent"] += 1
            logger.info(f"Nurturing follow-up {new_count}/{MAX_NURTURING_FOLLOWUPS} enviado para {lead.get('nome', '?')}")

            delay = random.randint(MIN_DELAY, MAX_DELAY)
            await asyncio.sleep(delay)

        except Exception as e:
            logger.error(f"Erro ao enviar nurturing follow-up para {lead.get('nome', '?')}: {e}")
            metrics["errors"] += 1

    return metrics


async def check_and_send_followups() -> dict:
    """
    Verifica conversas que precisam de follow-up e envia.

    Returns:
        dict com métricas (followups_sent, followups_closed, errors)
    """
    sb = get_supabase()
    now = datetime.utcnow()

    metrics = {"followups_sent": 0, "followups_closed": 0, "errors": 0}

    # Buscar conversas que precisam de follow-up
    # (next_follow_up_at já passou E status é 'contacted')
    conversations = (
        sb.table("conversations")
        .select("*, leads(*), chips(*)")
        .eq("status", "contacted")
        .lt("next_follow_up_at", now.isoformat())
        .not_.is_("next_follow_up_at", "null")
        .order("next_follow_up_at")
        .limit(50)
        .execute()
    )

    if not conversations.data:
        logger.info("Nenhum follow-up pendente")
        return metrics

    logger.info(f"Encontrados {len(conversations.data)} follow-ups pendentes")

    for conv in conversations.data:
        lead = conv["leads"]
        chip = conv["chips"]
        follow_up_count = conv.get("follow_up_count", 0)

        # Set tenant context for message routing
        set_current_tenant(conv.get("tenant_id"))

        # Verificar se excedeu o máximo
        if follow_up_count >= MAX_FOLLOWUPS:
            sb.table("conversations").update(
                {"status": "no_response", "next_follow_up_at": None}
            ).eq("id", conv["id"]).execute()
            metrics["followups_closed"] += 1
            logger.info(f"Lead {lead['nome']}: máximo de follow-ups atingido")
            continue

        # Verificar blocklist
        if lead.get("telefone"):
            blocked = sb.rpc(
                "is_blocked", {"p_phone": lead["telefone"]}
            ).execute()
            if blocked.data:
                sb.table("conversations").update(
                    {"status": "blocked", "next_follow_up_at": None}
                ).eq("id", conv["id"]).execute()
                continue

        # Verificar se o chip ainda está disponível (filtrado por tenant)
        if not chip or chip.get("status") not in ("active", "warming"):
            chip_data = get_available_chip(conv.get("tenant_id"))
            if not chip_data:
                logger.warning(f"Nenhum chip disponível para follow-up (tenant={conv.get('tenant_id')})")
                continue
            chip = chip_data
            sb.table("conversations").update(
                {"chip_id": chip["id"]}
            ).eq("id", conv["id"]).execute()

        # Selecionar template do follow-up
        followup_key = f"followup_{follow_up_count + 1}"
        variables = {
            "nome": lead.get("nome", ""),
            "empresa": lead.get("empresa", ""),
        }
        text = format_template(followup_key, variables)

        if not text:
            logger.warning(f"Template '{followup_key}' não encontrado")
            continue

        # Enviar follow-up
        try:
            msg_config = TEMPLATES["messages"].get(followup_key, {})
            buttons = msg_config.get("buttons", [])

            if buttons:
                result = await send_buttons_message(
                    chip["instance_name"],
                    lead["telefone"],
                    text,
                    buttons,
                )
            else:
                result = await send_text_message(
                    chip["instance_name"], lead["telefone"], text
                )

            wa_msg_id = result.get("key", {}).get("id", "")

            # Registrar mensagem
            sb.table("messages").insert(
                {
                    "conversation_id": conv["id"],
                    "direction": "outbound",
                    "content": text,
                    "message_type": "button" if buttons else "text",
                    "whatsapp_message_id": wa_msg_id,
                    "status": "sent",
                    "sent_at": datetime.utcnow().isoformat(),
                }
            ).execute()

            # Atualizar conversa
            new_count = follow_up_count + 1
            next_followup = None

            if new_count < MAX_FOLLOWUPS and new_count < len(FOLLOWUP_INTERVALS):
                next_followup = (
                    datetime.utcnow()
                    + timedelta(hours=FOLLOWUP_INTERVALS[new_count])
                ).isoformat()

            sb.table("conversations").update(
                {
                    "follow_up_count": new_count,
                    "next_follow_up_at": next_followup,
                }
            ).eq("id", conv["id"]).execute()

            increment_chip_counter(chip["id"])
            metrics["followups_sent"] += 1

            logger.info(
                f"Follow-up {new_count} enviado para {lead['nome']}"
            )

            # Delay entre envios
            delay = random.randint(MIN_DELAY, MAX_DELAY)
            await asyncio.sleep(delay)

        except Exception as e:
            logger.error(f"Erro no follow-up para {lead['nome']}: {e}")
            metrics["errors"] += 1

    logger.info(
        f"Follow-ups: {metrics['followups_sent']} enviados, "
        f"{metrics['followups_closed']} encerrados, "
        f"{metrics['errors']} erros"
    )
    return metrics


async def recover_stuck_handoffs() -> dict:
    """
    Detecta leads em status 'qualified' sem handoff registrado e dispara automaticamente.
    Evita que leads travados no step 5 precisem de intervenção manual.
    """
    from .agent_nexa import trigger_handoff

    sb = get_supabase()
    metrics = {"recovered": 0, "errors": 0}

    # Buscar conversas qualified sem handoff registrado
    convs = (
        sb.table("conversations")
        .select("*, leads(*), chips(*)")
        .eq("status", "qualified")
        .gte("current_step", 5)
        .execute()
    )

    if not convs.data:
        return metrics

    # IDs que já têm handoff
    existing = sb.table("handoffs").select("conversation_id").execute()
    handoff_conv_ids = {h["conversation_id"] for h in (existing.data or [])}

    for conv in convs.data:
        if conv["id"] in handoff_conv_ids:
            continue

        lead = conv.get("leads") or {}
        try:
            msgs = (
                sb.table("messages")
                .select("direction, content, created_at")
                .eq("conversation_id", conv["id"])
                .order("created_at")
                .execute()
            )
            history = msgs.data or []

            variables = {
                "nome": lead.get("nome", ""),
                "empresa": lead.get("empresa", ""),
                "cnpj": lead.get("cnpj", ""),
                "cargo": lead.get("cargo", ""),
                "valor_divida": lead.get("valor_divida", ""),
                "tipo_divida": lead.get("tipo_divida", ""),
            }

            await trigger_handoff(conv["id"], lead, history, variables)
            metrics["recovered"] += 1
            logger.info(f"Handoff recuperado automaticamente: {lead.get('nome')} ({lead.get('empresa')})")

        except Exception as e:
            metrics["errors"] += 1
            logger.error(f"Erro ao recuperar handoff para conversa {conv['id']}: {e}")

    return metrics


async def run_followup_loop(interval_minutes: int = 30):
    """
    Loop contínuo que verifica follow-ups pendentes (frios e quentes).
    Roda a cada 'interval_minutes' minutos.
    """
    logger.info(f"Iniciando loop de follow-ups (intervalo: {interval_minutes}min)")
    while True:
        try:
            now_utc = datetime.now()
            now_br = now_utc - timedelta(hours=3)
            biz_start = int(os.getenv("BUSINESS_HOURS_START", "8"))
            biz_end = int(os.getenv("BUSINESS_HOURS_END", "18"))

            if now_br.weekday() < 5 and biz_start <= now_br.hour < biz_end:
                # Follow-ups de leads frios (contacted)
                cold_metrics = await check_and_send_followups()
                # Follow-ups de leads quentes (nurturing/responded)
                warm_metrics = await check_nurturing_followups()
                # Recovery automático de leads qualificados sem handoff
                handoff_metrics = await recover_stuck_handoffs()
                logger.info(
                    f"Ciclo concluído — frios: {cold_metrics['followups_sent']} enviados | "
                    f"quentes: {warm_metrics['followups_sent']} enviados | "
                    f"handoffs recuperados: {handoff_metrics['recovered']}"
                )
            else:
                logger.info("Fora do horário comercial, aguardando...")

        except Exception as e:
            logger.error(f"Erro no loop de follow-ups: {e}")

        await asyncio.sleep(interval_minutes * 60)
