"""
Motor de Follow-ups — SDR WhatsApp
Monitora conversas sem resposta e dispara follow-ups automáticos.
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

from .chip_manager import (
    send_text_message,
    send_buttons_message,
    increment_chip_counter,
    get_available_chip,
)

load_dotenv()

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
MIN_DELAY = int(os.getenv("MIN_DELAY_SECONDS", "60"))
MAX_DELAY = int(os.getenv("MAX_DELAY_SECONDS", "180"))

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

        # Verificar se o chip ainda está disponível
        if not chip or chip.get("status") not in ("active", "warming"):
            chip_data = get_available_chip()
            if not chip_data:
                logger.warning("Nenhum chip disponível para follow-up")
                break
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


async def run_followup_loop(interval_minutes: int = 30):
    """
    Loop contínuo que verifica follow-ups pendentes.
    Roda a cada 'interval_minutes' minutos.
    """
    logger.info(
        f"Iniciando loop de follow-ups (intervalo: {interval_minutes}min)"
    )
    from datetime import timedelta
    while True:
        try:
            # Só processar em horário comercial (UTC-3 na VPS)
            now_utc = datetime.now()
            now = now_utc - timedelta(hours=3)
            
            biz_start = int(os.getenv("BUSINESS_HOURS_START", "8"))
            biz_end = int(os.getenv("BUSINESS_HOURS_END", "18"))

            if now.weekday() < 5 and biz_start <= now.hour < biz_end:
                await check_and_send_followups()
            else:
                logger.info("Fora do horário comercial, aguardando...")

        except Exception as e:
            logger.error(f"Erro no loop de follow-ups: {e}")

        await asyncio.sleep(interval_minutes * 60)
