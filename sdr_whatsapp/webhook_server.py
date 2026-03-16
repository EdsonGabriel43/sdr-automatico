"""
Webhook Server — SDR WhatsApp (Agente Nexa)
FastAPI server que recebe webhooks da Evolution API e expõe endpoints de gerenciamento.
"""

import os
import asyncio
import base64
import tempfile
import logging
from datetime import datetime
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, Request, HTTPException, BackgroundTasks, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

# Configurar logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("sdr_whatsapp.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger("sdr_webhook")

# Importações dos módulos de execução
from execution.agent_nexa import process_incoming_message, reload_templates, TEMPLATES_PATH
from execution.campaign_manager import (
    import_leads_from_csv,
    create_campaign,
    run_campaign,
    get_campaign_stats,
    add_phone_to_lead,
)
from execution.follow_up_engine import run_followup_loop, check_and_send_followups
from execution.chip_manager import (
    set_webhook,
    get_all_chips,
    register_chip,
    update_chip_status,
    get_instance_status,
)

from supabase import create_client
from openai import OpenAI

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "")
WEBHOOK_PORT = int(os.getenv("WEBHOOK_PORT", "3001"))

openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def get_supabase():
    return create_client(SUPABASE_URL, SUPABASE_KEY)


async def transcribe_audio(audio_base64: str, mimetype: str = "audio/ogg") -> str:
    """
    Transcreve áudio em base64 para texto usando OpenAI Whisper API.
    Suporta formatos: ogg, mp3, wav, m4a, webm, mp4, mpeg.
    """
    # Determinar extensão de arquivo a partir do mimetype
    ext_map = {
        "audio/ogg": ".ogg",
        "audio/ogg; codecs=opus": ".ogg",
        "audio/mpeg": ".mp3",
        "audio/mp4": ".m4a",
        "audio/wav": ".wav",
        "audio/webm": ".webm",
    }
    ext = ext_map.get(mimetype, ".ogg")

    # Decodificar base64 e salvar como arquivo temporário
    audio_bytes = base64.b64decode(audio_base64)
    
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        # Transcrever via Whisper API
        with open(tmp_path, "rb") as audio_file:
            transcript = openai_client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                language="pt",  # Forçar português brasileiro
                response_format="text",
            )
        
        text = transcript.strip() if isinstance(transcript, str) else str(transcript).strip()
        logger.info(f"🎤 Whisper transcrição OK: {len(text)} chars")
        return text
    
    except Exception as e:
        logger.error(f"🎤 Erro Whisper: {e}")
        return ""
    
    finally:
        # Limpar arquivo temporário
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


# ===== BACKGROUND TASKS =====

followup_task = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Gerencia tarefas de background ao iniciar/parar o server."""
    global followup_task
    logger.info("🚀 SDR WhatsApp Server iniciando...")
    # Iniciar loop de follow-ups
    followup_task = asyncio.create_task(run_followup_loop(interval_minutes=30))
    logger.info("✅ Loop de follow-ups iniciado (intervalo: 30min)")
    yield
    # Cleanup
    if followup_task:
        followup_task.cancel()
    logger.info("🛑 SDR WhatsApp Server encerrado")


# ===== APP =====

app = FastAPI(
    title="SDR WhatsApp — Agente Nexa",
    description="API para o SDR Automático de prospecção PGFN via WhatsApp",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ===== MODELOS =====


class WebhookPayload(BaseModel):
    event: Optional[str] = None
    instance: Optional[str] = None
    data: Optional[dict] = None


class CreateChipRequest(BaseModel):
    instance_name: str
    phone_number: Optional[str] = None


class CreateCampaignRequest(BaseModel):
    name: str
    description: str = ""
    lead_ids: Optional[list[str]] = None
    filters: Optional[dict] = None


class ImportLeadsRequest(BaseModel):
    # Removido em favor de envio Multipart FormData (UploadFile)
    pass


class AddPhoneRequest(BaseModel):
    lead_id: str
    phone: str


class StartCampaignRequest(BaseModel):
    campaign_id: str


# ===== WEBHOOK ENDPOINT =====


@app.post("/webhook")
@app.post("/webhook/messages")
async def receive_webhook(request: Request, background_tasks: BackgroundTasks):
    """
    Recebe webhooks da Evolution API (ou wa-server).
    Processa mensagens recebidas de forma assíncrona.
    Suporta texto E áudio (transcrição via Whisper).
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="JSON inválido")

    event = body.get("event", "")
    instance = body.get("instance", "")
    data = body.get("data", {})

    logger.info(f"Webhook recebido: event={event}, instance={instance}")

    # Processar apenas mensagens recebidas
    if event == "messages.upsert":
        message = data.get("message", {})
        key = data.get("key", {})

        # Ignorar mensagens enviadas por nós
        if key.get("fromMe", False):
            return {"status": "ignored", "reason": "own_message"}

        # Extrair telefone — priorizar "phone" (wa-server já calcula limpo)
        phone = data.get("phone", "")
        if not phone:
            # Fallback: parsear remoteJid
            remote_jid = key.get("remoteJid", "")
            phone = (
                remote_jid
                .replace("@c.us", "")
                .replace("@s.whatsapp.net", "")
                .replace("@g.us", "")
            )

        wa_message_id = key.get("id", "")
        instance_name = data.get("instanceName", instance)
        message_type = data.get("messageType", "text")

        # Extrair texto da mensagem
        message_text = ""
        if "conversation" in message:
            message_text = message["conversation"]
        elif "extendedTextMessage" in message:
            message_text = message["extendedTextMessage"].get("text", "")
        elif "buttonsResponseMessage" in message:
            message_text = message["buttonsResponseMessage"].get(
                "selectedDisplayText", ""
            )
        elif "listResponseMessage" in message:
            message_text = message["listResponseMessage"].get("title", "")

        # ============================================================
        # ÁUDIO: Transcrever via Whisper se recebeu audio_base64
        # ============================================================
        audio_base64 = data.get("audio_base64", "")
        audio_mimetype = data.get("audio_mimetype", "audio/ogg")

        if audio_base64 and not message_text:
            logger.info(f"🎤 Áudio recebido de {phone}, transcrevendo via Whisper...")
            try:
                message_text = await transcribe_audio(audio_base64, audio_mimetype)
                if message_text:
                    logger.info(f"🎤 Transcrição de {phone}: \"{message_text[:100]}\"")
                    message_type = "audio_transcribed"
                else:
                    logger.warning(f"🎤 Transcrição vazia para áudio de {phone}")
                    message_text = ""
            except Exception as e:
                logger.error(f"🎤 Erro ao transcrever áudio de {phone}: {e}")
                message_text = ""

        if not message_text:
            logger.info(f"Mensagem sem texto de {phone}, ignorando (type={message_type})")
            return {"status": "ignored", "reason": "no_text"}

        logger.info(f"📩 Mensagem de {phone}: \"{message_text[:80]}\" (type={message_type})")

        # Processar em background para não bloquear o webhook
        background_tasks.add_task(
            process_incoming_message,
            phone=phone,
            message_text=message_text,
            wa_message_id=wa_message_id,
            instance_name=instance_name,
        )

        return {"status": "processing"}


    # Atualizações de status da mensagem
    elif event == "messages.update":
        logger.debug(f"Atualização de mensagem: {data}")
        return {"status": "ok"}

    # Atualizações de conexão
    elif event == "connection.update":
        state = data.get("state", "")
        logger.info(f"Conexão {instance}: {state}")

        if state == "close":
            sb = get_supabase()
            sb.table("chips").update({"status": "disconnected"}).eq(
                "instance_name", instance
            ).execute()

        return {"status": "ok"}

    return {"status": "ignored"}


# ===== CHIPS ENDPOINTS =====


@app.post("/chips/create")
async def create_chip_endpoint(req: CreateChipRequest):
    """Registra um chip no Supabase (wa-server gerencia a conexão)."""
    try:
        # Registrar no Supabase
        chip = register_chip(req.instance_name, req.phone_number)

        return {
            "status": "created",
            "chip": chip,
            "message": (
                "Chip registrado. Conecte via wa-server (npm start) "
                "e escaneie o QR Code no terminal."
            ),
        }
    except Exception as e:
        logger.error(f"Erro ao criar chip: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/chips/qrcode/{instance_name}")
async def get_chip_qrcode(instance_name: str):
    """Redireciona para a página de QR Code do wa-server."""
    wa_server_url = os.getenv("WA_SERVER_URL", "http://localhost:3001")
    return {"qr_url": f"{wa_server_url}/qr", "message": "Acesse a URL para ver o QR Code"}


@app.get("/chips")
async def list_chips():
    """Lista todos os chips registrados."""
    chips = get_all_chips()
    return {"chips": chips}


@app.get("/chips/{instance_name}/status")
async def chip_status(instance_name: str):
    """Verifica status de conexão do chip."""
    try:
        status = await get_instance_status(instance_name)
        return status
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ===== LEADS ENDPOINTS =====


@app.post("/leads/import")
async def import_leads_endpoint(
    file: UploadFile = File(...),
):
    """Importa leads de um arquivo CSV via FormData."""
    try:
        if not file.filename.endswith(".csv"):
            raise HTTPException(status_code=400, detail="Arquivo deve ser um .csv")
            
        content = await file.read()
        
        # O default mapping será utilizado. 
        count = import_leads_from_csv(content, mapping=None)
        
        return {"status": "ok", "imported": count}
    except Exception as e:
        logger.error(f"Erro importando lista: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/leads/add-phone")
async def add_phone_endpoint(req: AddPhoneRequest):
    """Adiciona telefone a um lead existente."""
    try:
        add_phone_to_lead(req.lead_id, req.phone)
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/leads")
async def list_leads(
    page: int = 1,
    per_page: int = 50,
    uf: Optional[str] = None,
    has_phone: Optional[bool] = None,
):
    """Lista leads com paginação e filtros."""
    sb = get_supabase()
    query = sb.table("leads").select("*", count="exact")

    if uf:
        query = query.eq("uf", uf)
    if has_phone is True:
        query = query.not_.is_("telefone", "null")
    elif has_phone is False:
        query = query.is_("telefone", "null")

    offset = (page - 1) * per_page
    query = query.range(offset, offset + per_page - 1).order("valor_divida", desc=True)
    result = query.execute()

    return {
        "leads": result.data or [],
        "total": result.count,
        "page": page,
        "per_page": per_page,
    }


# ===== CAMPAIGNS ENDPOINTS =====


@app.post("/campaigns/create")
async def create_campaign_endpoint(req: CreateCampaignRequest):
    """Cria uma nova campanha."""
    campaign = create_campaign(
        name=req.name,
        description=req.description,
        lead_ids=req.lead_ids,
        filters=req.filters,
    )
    return {"status": "created", "campaign": campaign}


@app.post("/campaigns/start")
async def start_campaign_endpoint(
    req: StartCampaignRequest, background_tasks: BackgroundTasks
):
    """Inicia o envio de mensagens de uma campanha."""
    background_tasks.add_task(run_campaign, req.campaign_id)
    return {"status": "started", "campaign_id": req.campaign_id}


@app.get("/campaigns/{campaign_id}/stats")
async def campaign_stats_endpoint(campaign_id: str):
    """Retorna métricas de uma campanha."""
    stats = get_campaign_stats(campaign_id)
    return {"campaign": stats}


@app.get("/campaigns")
async def list_campaigns():
    """Lista todas as campanhas."""
    sb = get_supabase()
    result = sb.table("campaigns").select("*").order("created_at", desc=True).execute()
    return {"campaigns": result.data or []}


# ===== CONVERSATIONS ENDPOINTS =====


@app.get("/conversations")
async def list_conversations(
    campaign_id: Optional[str] = None,
    status: Optional[str] = None,
    page: int = 1,
    per_page: int = 50,
):
    """Lista conversas com filtros."""
    sb = get_supabase()
    query = sb.table("conversations").select("*, leads(nome, empresa, telefone, valor_divida)", count="exact")

    if campaign_id:
        query = query.eq("campaign_id", campaign_id)
    if status:
        query = query.eq("status", status)

    offset = (page - 1) * per_page
    query = query.range(offset, offset + per_page - 1).order("updated_at", desc=True)
    result = query.execute()

    return {
        "conversations": result.data or [],
        "total": result.count,
        "page": page,
    }


@app.get("/conversations/{conversation_id}/messages")
async def conversation_messages(conversation_id: str):
    """Retorna histórico de mensagens de uma conversa."""
    sb = get_supabase()
    result = (
        sb.table("messages")
        .select("*")
        .eq("conversation_id", conversation_id)
        .order("created_at")
        .execute()
    )
    return {"messages": result.data or []}


# ===== HANDOFFS ENDPOINTS =====


@app.get("/handoffs")
async def list_handoffs(status: Optional[str] = None):
    """Lista handoffs."""
    sb = get_supabase()
    query = sb.table("handoffs").select("*, leads(nome, empresa, valor_divida)")

    if status:
        query = query.eq("status", status)

    result = query.order("created_at", desc=True).execute()
    return {"handoffs": result.data or []}


# ===== DASHBOARD & SETTINGS =====


@app.get("/settings/templates")
async def get_templates():
    """Retorna os templates e configurações atuais do bot."""
    import json
    try:
        with open(TEMPLATES_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data
    except Exception as e:
        logger.error(f"Erro ao ler templates: {e}")
        raise HTTPException(status_code=500, detail="Erro interno ao carregar templates")


@app.post("/settings/templates")
async def update_templates(request: Request):
    """Atualiza o JSON de templates inteiramente e recarrega na memória."""
    import json
    try:
        new_data = await request.json()
        with open(TEMPLATES_PATH, "w", encoding="utf-8") as f:
            json.dump(new_data, f, indent=4, ensure_ascii=False)
        
        # Recarregar na memória do processo global
        reload_templates()
        return {"status": "ok", "message": "Templates atualizados e recarregados."}
    except Exception as e:
        logger.error(f"Erro ao salvar templates: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/dashboard/overview")
async def dashboard_overview():
    """Dados gerais para dashboard."""
    sb = get_supabase()

    # Métricas gerais
    total_leads = sb.table("leads").select("id", count="exact").execute()
    leads_with_phone = (
        sb.table("leads")
        .select("id", count="exact")
        .not_.is_("telefone", "null")
        .execute()
    )
    active_conversations = (
        sb.table("conversations")
        .select("id", count="exact")
        .in_("status", ["contacted", "responded", "nurturing"])
        .execute()
    )
    qualified = (
        sb.table("conversations")
        .select("id", count="exact")
        .in_("status", ["qualified", "handed_off"])
        .execute()
    )
    blocked = (
        sb.table("blocklist")
        .select("id", count="exact")
        .execute()
    )
    chips = get_all_chips()

    return {
        "total_leads": total_leads.count or 0,
        "leads_with_phone": leads_with_phone.count or 0,
        "active_conversations": active_conversations.count or 0,
        "qualified_leads": qualified.count or 0,
        "blocked_numbers": blocked.count or 0,
        "chips": [
            {
                "name": c["instance_name"],
                "status": c["status"],
                "sent_today": c["messages_sent_today"],
                "limit": c["daily_limit"],
                "warming_day": c.get("warming_day", 0),
            }
            for c in chips
        ],
    }


# ===== FOLLOW-UPS MANUAL =====


@app.post("/followups/run")
async def run_followups_endpoint(background_tasks: BackgroundTasks):
    """Dispara verificação de follow-ups manualmente."""
    background_tasks.add_task(check_and_send_followups)
    return {"status": "started"}


# ===== HEALTH =====


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "service": "SDR WhatsApp - Agente Nexa v1.0",
    }


# ===== MAIN =====

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=WEBHOOK_PORT)
