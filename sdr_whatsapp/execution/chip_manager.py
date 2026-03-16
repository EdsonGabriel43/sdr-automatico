"""
Gerenciador de Chips WhatsApp — wa-server (whatsapp-web.js)
Registra, monitora e rotaciona chips para envio de mensagens.
"""

import os
import json
import logging
import httpx
from datetime import datetime, date
from typing import Optional
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

logger = logging.getLogger(__name__)

# Servidor WhatsApp local (whatsapp-web.js)
WA_SERVER_URL = os.getenv("WA_SERVER_URL", "http://localhost:3001")

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")


def get_supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_KEY)


async def get_instance_status(instance_name: str = None) -> dict:
    """Verifica o status de conexão do WhatsApp."""
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(f"{WA_SERVER_URL}/status")
        response.raise_for_status()
        return response.json()


async def send_text_message(
    instance_name: str, phone: str, text: str
) -> dict:
    """Envia uma mensagem de texto simples."""
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            f"{WA_SERVER_URL}/send/text",
            json={
                "phone": phone,
                "text": text,
            },
        )
        response.raise_for_status()
        return response.json()


async def send_buttons_message(
    instance_name: str,
    phone: str,
    text: str,
    buttons: list[dict],
    footer: str = "",
) -> dict:
    """
    Envia mensagem com botões interativos.
    buttons: [{"id": "btn_1", "text": "Opção 1"}, ...]
    """
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            f"{WA_SERVER_URL}/send/buttons",
            json={
                "phone": phone,
                "text": text,
                "buttons": buttons,
                "footer": footer or "SYNEOS Consultoria",
            },
        )
        # Se botões falharem, envia como texto
        if response.status_code != 200:
            logger.warning(
                f"Botões falharam para {phone}, enviando como texto"
            )
            fallback_text = text
            for b in buttons:
                fallback_text += f"\n\n👉 Responda *{b['text']}*"
            return await send_text_message(instance_name, phone, fallback_text)
        return response.json()


async def send_poll_message(
    instance_name: str,
    phone: str,
    question: str,
    options: list[str],
) -> dict:
    """
    Envia uma enquete (poll) clicável no WhatsApp.
    options: ["Opção 1", "Opção 2", "Opção 3"]
    Fallback: envia como texto formatado com emojis.
    """
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            f"{WA_SERVER_URL}/send/poll",
            json={
                "phone": phone,
                "question": question,
                "options": options,
            },
        )
        if response.status_code == 200:
            logger.info(f"Enquete enviada para {phone}: {question}")
            return response.json()

        # Fallback: enviar como texto formatado
        logger.warning(
            f"Enquete falhou ({response.status_code}) para {phone}, enviando como texto"
        )
        fallback_text = f"{question}\n"
        for opt in options:
            fallback_text += f"\n👉 Responda *{opt}*"
        return await send_text_message(instance_name, phone, fallback_text)

async def set_webhook(instance_name: str, webhook_url: str) -> dict:
    """Webhook já é configurado no wa-server via env. Noop."""
    logger.info(f"Webhook configurado no wa-server: {webhook_url}")
    return {"status": "ok"}


def register_chip(
    instance_name: str, phone_number: Optional[str] = None
) -> dict:
    """Registra um novo chip no Supabase."""
    sb = get_supabase()
    data = {
        "instance_name": instance_name,
        "phone_number": phone_number,
        "status": "warming",
        "warming_start_date": str(date.today()),
        "warming_day": 0,
        "daily_limit": 5,
        "messages_sent_today": 0,
    }
    result = sb.table("chips").insert(data).execute()
    logger.info(f"Chip registrado: {instance_name}")
    return result.data[0] if result.data else {}


def get_available_chip() -> Optional[dict]:
    """
    Retorna o chip disponível com menor uso no dia (round-robin).
    Só retorna chips ativos ou em aquecimento que ainda têm capacidade.
    """
    sb = get_supabase()

    # Resetar contadores se necessário
    sb.rpc("reset_daily_chip_counters").execute()
    sb.rpc("update_warming_day").execute()

    result = (
        sb.table("chips")
        .select("*")
        .in_("status", ["active", "warming"])
        .order("messages_sent_today", desc=False)
        .limit(1)
        .execute()
    )

    if not result.data:
        logger.warning("Nenhum chip disponível!")
        return None

    chip = result.data[0]

    # Verificar se ainda tem capacidade
    if chip["messages_sent_today"] >= chip["daily_limit"]:
        logger.warning("Todos os chips atingiram o limite diário!")
        return None

    return chip


def increment_chip_counter(chip_id: str) -> None:
    """Incrementa contador de mensagens do chip."""
    sb = get_supabase()
    sb.rpc("increment_chip_message_count", {"p_chip_id": chip_id}).execute()


def get_all_chips() -> list:
    """Lista todos os chips registrados."""
    sb = get_supabase()
    result = sb.table("chips").select("*").order("created_at").execute()
    return result.data or []


def update_chip_status(chip_id: str, status: str) -> None:
    """Atualiza o status de um chip."""
    sb = get_supabase()
    sb.table("chips").update({"status": status}).eq("id", chip_id).execute()
    logger.info(f"Chip {chip_id} atualizado para {status}")
