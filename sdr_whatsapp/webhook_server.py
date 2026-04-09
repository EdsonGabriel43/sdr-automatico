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
from execution.follow_up_engine import run_followup_loop, check_and_send_followups, check_nurturing_followups
from execution.chip_manager import (
    set_webhook,
    get_all_chips,
    register_chip,
    update_chip_status,
    get_instance_status,
)

from supabase import create_client
from openai import OpenAI

import sys
import json

# Prospecting imports — loaded lazily to avoid crash if modules not present
_prospecting_imports_loaded = False
search_google = None
search_google_places = None
construct_query = None
parse_results = None
parse_places_results = None
extract_contacts = None
deep_scrape_page = None

def _load_prospecting_modules():
    global _prospecting_imports_loaded, search_google, search_google_places
    global construct_query, parse_results, parse_places_results, extract_contacts, deep_scrape_page
    if _prospecting_imports_loaded:
        return True
    try:
        from prospecting.tool_google_search import (
            search_google as _sg, search_places as _sp,
            construct_query as _cq, parse_results as _pr,
            parse_places_results as _ppr, extract_contacts as _ec,
            deep_scrape_page as _dsp
        )
        search_google = _sg
        search_google_places = _sp
        construct_query = _cq
        parse_results = _pr
        parse_places_results = _ppr
        extract_contacts = _ec
        deep_scrape_page = _dsp
        _prospecting_imports_loaded = True
        logger.info("Prospecting modules loaded successfully")
        return True
    except Exception as e:
        logger.warning(f"Prospecting modules not available: {e}")
        return False

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
    tenant_id: Optional[str] = None


class ImportLeadsRequest(BaseModel):
    # Removido em favor de envio Multipart FormData (UploadFile)
    pass


class AddPhoneRequest(BaseModel):
    lead_id: str
    phone: str


class StartCampaignRequest(BaseModel):
    campaign_id: str


class ProspectingSearchRequest(BaseModel):
    query: str
    mode: str = "natural_language"  # "natural_language" or "structured"
    platforms: list[str] = ["linkedin", "instagram", "google", "google_places"]
    location: Optional[str] = None
    enable_deep_scraping: bool = False

class ProspectingEnrichRequest(BaseModel):
    result_ids: list[str]

class ProspectingToCampaignRequest(BaseModel):
    search_id: str
    result_ids: list[str]
    campaign_name: str
    campaign_description: str = ""

class CnpjEnrichItem(BaseModel):
    cnpj: str
    decision_maker_name: Optional[str] = None

class CnpjBatchEnrichRequest(BaseModel):
    items: list[CnpjEnrichItem]
    search_platforms: list[str] = ["linkedin", "google"]

class SocialEnrichItem(BaseModel):
    url: str  # Instagram, TikTok, Facebook, or X URL
    platform: Optional[str] = None  # auto-detected if not provided

class SocialBatchEnrichRequest(BaseModel):
    items: list[SocialEnrichItem]
    use_apify: bool = False  # Use Apify for deep scraping


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

        # Resolver tenant_id a partir do instance_name
        tenant_id = None
        try:
            sb = get_supabase()
            inst = sb.table("whatsapp_instances").select("tenant_id").eq("instance_name", instance_name).single().execute()
            if inst.data:
                tenant_id = inst.data["tenant_id"]
        except Exception:
            try:
                chip = sb.table("chips").select("tenant_id").eq("instance_name", instance_name).single().execute()
                if chip.data:
                    tenant_id = chip.data.get("tenant_id")
            except Exception:
                pass

        if not tenant_id:
            logger.warning(f"Mensagem de {phone} ignorada: tenant_id não resolvido para instance={instance_name}")
            return {"status": "ignored", "reason": "tenant_not_found"}

        # Processar em background para não bloquear o webhook
        background_tasks.add_task(
            process_incoming_message,
            phone=phone,
            message_text=message_text,
            wa_message_id=wa_message_id,
            instance_name=instance_name,
            tenant_id=tenant_id,
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


@app.get("/chips/qr-data")
async def get_chip_qr_data():
    """Retorna QR code como JSON para o Hub renderizar."""
    wa_server_url = os.getenv("WA_SERVER_URL", "http://localhost:3001")
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{wa_server_url}/qr/json")
            return resp.json()
    except Exception as e:
        return {"status": "error", "qr": None, "number": None, "name": None, "error": str(e)}


@app.post("/chips/{chip_id}/disconnect")
async def disconnect_chip(chip_id: str, clear_auth: bool = False):
    """Desconecta um chip do WhatsApp."""
    wa_server_url = os.getenv("WA_SERVER_URL", "http://localhost:3001")
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(f"{wa_server_url}/disconnect", params={"clear_auth": str(clear_auth).lower()})
            if resp.status_code == 200:
                update_chip_status(chip_id, "disconnected")
                return {"success": True}
            return {"success": False, "error": resp.text}
    except Exception as e:
        update_chip_status(chip_id, "disconnected")
        return {"success": False, "error": str(e)}


@app.post("/chips/{chip_id}/reconnect")
async def reconnect_chip(chip_id: str):
    """Reconecta um chip (gera novo QR)."""
    wa_server_url = os.getenv("WA_SERVER_URL", "http://localhost:3001")
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(f"{wa_server_url}/reconnect")
            if resp.status_code == 200:
                update_chip_status(chip_id, "warming")
                return {"success": True}
            return {"success": False, "error": resp.text}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.post("/chips/{chip_id}/swap")
async def swap_chip(chip_id: str):
    """Troca o número do chip: desconecta com clear_auth + reconecta."""
    wa_server_url = os.getenv("WA_SERVER_URL", "http://localhost:3001")
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            # Disconnect with clear_auth to remove session
            await client.post(f"{wa_server_url}/disconnect", params={"clear_auth": "true"})
            await asyncio.sleep(2)
            # Reconnect — will generate fresh QR for new number
            resp = await client.post(f"{wa_server_url}/reconnect")

        # Reset chip in Supabase
        sb = get_supabase()
        sb.table("chips").update({
            "phone_number": None,
            "status": "warming",
            "warming_start_date": datetime.now().date().isoformat(),
            "warming_day": 0,
            "daily_limit": 5,
            "messages_sent_today": 0,
        }).eq("id", chip_id).execute()

        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


class UpdateChipStatusRequest(BaseModel):
    status: str  # "paused" | "active"


@app.patch("/chips/{chip_id}/status")
async def update_chip_status_endpoint(chip_id: str, req: UpdateChipStatusRequest):
    """Atualiza status de um chip (pausar/retomar)."""
    if req.status not in ["paused", "active", "warming"]:
        raise HTTPException(status_code=400, detail="Status inválido")
    update_chip_status(chip_id, req.status)
    return {"success": True}


# ===== CNPJ BATCH ENRICHMENT =====

@app.post("/prospecting/enrich-cnpj")
async def enrich_cnpj_batch(req: CnpjBatchEnrichRequest, background_tasks: BackgroundTasks):
    """Enriquece uma lista de CNPJs: consulta BrasilAPI, busca decisor, encontra contatos."""
    sb = get_supabase()

    # Create a search record
    search = sb.table("prospect_searches").insert({
        "query_text": f"Enriquecimento CNPJ ({len(req.items)} empresas)",
        "search_type": "cnpj_enrichment",
        "filters": {"cnpjs": [i.cnpj for i in req.items]},
        "status": "pending",
    }).execute()

    search_id = search.data[0]["id"]

    background_tasks.add_task(
        run_cnpj_enrichment,
        search_id=search_id,
        items=[{"cnpj": i.cnpj, "decision_maker_name": i.decision_maker_name} for i in req.items],
        platforms=req.search_platforms,
    )

    return {"search_id": search_id, "status": "pending"}


async def run_cnpj_enrichment(search_id: str, items: list[dict], platforms: list[str]):
    """Background: enriquece cada CNPJ via BrasilAPI + busca contatos do decisor."""
    import re
    import time

    sb = get_supabase()
    sb.table("prospect_searches").update({"status": "running"}).eq("id", search_id).execute()

    all_results = []

    for item in items:
        cnpj_raw = item["cnpj"]
        dm_name = item.get("decision_maker_name") or ""
        cnpj_clean = re.sub(r'\D', '', cnpj_raw).zfill(14)

        logger.info(f"CNPJ Enrich: {cnpj_clean} (decisor: {dm_name})")

        # 1. BrasilAPI lookup
        cnpj_data = None
        company_name = ""
        phone_from_cnpj = None
        domain = None

        try:
            resp = httpx.get(f"https://brasilapi.com.br/api/cnpj/v1/{cnpj_clean}", timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                cnpj_data = {
                    "razao_social": data.get("razao_social"),
                    "nome_fantasia": data.get("nome_fantasia"),
                    "cnae_fiscal": data.get("cnae_fiscal"),
                    "cnae_fiscal_descricao": data.get("cnae_fiscal_descricao"),
                    "qsa": data.get("qsa", []),
                    "logradouro": data.get("logradouro"),
                    "municipio": data.get("municipio"),
                    "uf": data.get("uf"),
                    "cep": data.get("cep"),
                    "capital_social": data.get("capital_social"),
                    "porte": data.get("porte"),
                    "situacao_cadastral": data.get("situacao_cadastral"),
                    "descricao_situacao_cadastral": data.get("descricao_situacao_cadastral"),
                }
                company_name = data.get("nome_fantasia") or data.get("razao_social") or ""

                # Extract phone
                ddd1 = str(data.get("ddd_telefone_1", ""))
                if ddd1:
                    digits = re.sub(r'\D', '', ddd1)
                    if len(digits) >= 10:
                        phone_from_cnpj = digits

                # If no decision maker name, use first QSA partner
                if not dm_name and data.get("qsa"):
                    for socio in data["qsa"]:
                        nome = socio.get("nome_socio", "")
                        if nome and nome not in ("", "N/A"):
                            dm_name = nome
                            break

            time.sleep(0.5)  # Rate limit
        except Exception as e:
            logger.warning(f"BrasilAPI error for {cnpj_clean}: {e}")

        # 2. Search for decision maker contacts via Google X-Ray
        found_email = None
        found_phone = phone_from_cnpj
        found_linkedin = None
        found_instagram = None
        snippets = []

        if dm_name and _load_prospecting_modules():
            search_name = dm_name.split(" ")[0] + " " + (dm_name.split(" ")[-1] if len(dm_name.split(" ")) > 1 else "")

            for platform in platforms:
                try:
                    if platform == "linkedin":
                        query = f'site:linkedin.com/in "{search_name}" "{company_name}"'
                    elif platform == "instagram":
                        query = f'site:instagram.com "{search_name}" "{company_name}"'
                    elif platform == "google":
                        query = f'"{search_name}" "{company_name}" ("email" OR "telefone" OR "contato" OR "@")'
                    else:
                        continue

                    raw = search_google(query, country_code="br", num_results=5)
                    if raw:
                        for r in (raw.get("organic", []) if isinstance(raw, dict) else raw):
                            link = r.get("link", "")
                            snippet = r.get("snippet", "")
                            title = r.get("title", "")
                            snippets.append(snippet)

                            if "linkedin.com/in" in link and not found_linkedin:
                                found_linkedin = link
                            if "instagram.com" in link and not found_instagram:
                                found_instagram = link

                            # Extract contacts from snippet
                            if extract_contacts:
                                contacts = extract_contacts(snippet + " " + title)
                                if contacts.get("email") and not found_email:
                                    found_email = contacts["email"]
                                if contacts.get("phone") and not found_phone:
                                    found_phone = contacts["phone"]

                    time.sleep(0.3)
                except Exception as e:
                    logger.warning(f"Search error [{platform}] for {dm_name}: {e}")

        # 3. Try to find email via domain pattern guessing
        if not found_email and dm_name and company_name:
            try:
                # Guess domain from company name
                clean_company = re.sub(r'(ltda|eireli|s\.?a\.?|me|epp|ss)\.?$', '', company_name.lower().strip(), flags=re.IGNORECASE).strip()
                clean_company = re.sub(r'[^a-z0-9]', '', clean_company)
                if clean_company:
                    possible_domains = [f"{clean_company}.com.br", f"{clean_company}.com"]
                    name_parts = dm_name.lower().split()
                    if len(name_parts) >= 2:
                        first = name_parts[0]
                        last = name_parts[-1]
                        patterns = [
                            f"{first}.{last}",
                            f"{first}{last}",
                            f"{first}",
                            f"{first[0]}{last}",
                        ]
                        # Just store as guesses — we don't SMTP verify here to keep it fast
                        found_email = f"{patterns[0]}@{possible_domains[0]}"
            except Exception:
                pass

        # 4. Build result
        score = 0
        if found_phone:
            digits = re.sub(r'\D', '', found_phone)
            if len(digits) >= 11 and digits[-9] == '9':
                score += 1000
            elif len(digits) >= 10:
                score += 500
        if found_email:
            score += 10
        if found_linkedin:
            score += 100

        result = {
            "search_id": search_id,
            "name": dm_name or company_name,
            "email": found_email,
            "phone": found_phone,
            "role_snippet": "; ".join(snippets[:3])[:500] if snippets else (cnpj_data.get("cnae_fiscal_descricao", "") if cnpj_data else ""),
            "company": company_name,
            "profile_url": found_linkedin or found_instagram,
            "source_platform": "cnpj_enrichment",
            "cnpj": cnpj_clean,
            "address": f"{cnpj_data.get('logradouro', '')}, {cnpj_data.get('municipio', '')} - {cnpj_data.get('uf', '')}" if cnpj_data else None,
            "cnpj_data": cnpj_data,
            "priority_score": score,
        }
        all_results.append(result)

    # Insert results
    if all_results:
        # Batch insert (50 at a time)
        for i in range(0, len(all_results), 50):
            batch = all_results[i:i + 50]
            sb.table("prospect_results").insert(batch).execute()

    sb.table("prospect_searches").update({
        "status": "completed",
        "total_results": len(all_results),
        "completed_at": datetime.now().isoformat(),
    }).eq("id", search_id).execute()

    logger.info(f"CNPJ Enrichment {search_id}: completed with {len(all_results)} results")


# ===== SOCIAL MEDIA ENRICHMENT =====

def _detect_platform(url: str) -> str:
    """Detect social platform from URL."""
    url_lower = url.lower()
    if "instagram.com" in url_lower: return "instagram"
    if "tiktok.com" in url_lower: return "tiktok"
    if "facebook.com" in url_lower or "fb.com" in url_lower: return "facebook"
    if "twitter.com" in url_lower or "x.com" in url_lower: return "twitter"
    return "unknown"

def _extract_username(url: str, platform: str) -> str:
    """Extract username from social URL."""
    import re
    url = url.strip().rstrip("/")
    if platform == "instagram":
        m = re.search(r'instagram\.com/([^/?#]+)', url)
        return m.group(1) if m else url
    if platform == "tiktok":
        m = re.search(r'tiktok\.com/@?([^/?#]+)', url)
        return m.group(1) if m else url
    if platform == "facebook":
        m = re.search(r'facebook\.com/(?:profile\.php\?id=)?([^/?#]+)', url)
        return m.group(1) if m else url
    if platform == "twitter":
        m = re.search(r'(?:twitter|x)\.com/([^/?#]+)', url)
        return m.group(1) if m else url
    return url


@app.post("/prospecting/enrich-social")
async def enrich_social_batch(req: SocialBatchEnrichRequest, background_tasks: BackgroundTasks):
    """Enriquece perfis de redes sociais: busca telefone, email, nome real."""
    sb = get_supabase()

    platforms_used = list(set(
        item.platform or _detect_platform(item.url) for item in req.items
    ))

    search = sb.table("prospect_searches").insert({
        "query_text": f"Enriquecimento Social ({len(req.items)} perfis)",
        "search_type": "social_enrichment",
        "filters": {"urls": [i.url for i in req.items], "platforms": platforms_used, "use_apify": req.use_apify},
        "status": "pending",
    }).execute()

    search_id = search.data[0]["id"]

    background_tasks.add_task(
        run_social_enrichment,
        search_id=search_id,
        items=[{"url": i.url, "platform": i.platform or _detect_platform(i.url)} for i in req.items],
        use_apify=req.use_apify,
    )

    return {"search_id": search_id, "status": "pending"}


async def run_social_enrichment(search_id: str, items: list[dict], use_apify: bool = False):
    """Background: enriches social profiles via Google X-Ray + optional Apify."""
    import re
    import time

    sb = get_supabase()
    sb.table("prospect_searches").update({"status": "running"}).eq("id", search_id).execute()

    all_results = []
    apify_token = os.getenv("APIFY_TOKEN", "")

    for item in items:
        url = item["url"]
        platform = item["platform"]
        username = _extract_username(url, platform)

        logger.info(f"Social Enrich: @{username} ({platform})")

        found_name = None
        found_email = None
        found_phone = None
        found_bio = ""
        snippets = []

        # --- Layer 1: Google X-Ray (free, fast) ---
        if _load_prospecting_modules():
            queries = []
            if platform == "instagram":
                queries.append(f'"{username}" ("whatsapp" OR "telefone" OR "contato" OR "@gmail" OR "@hotmail")')
                queries.append(f'site:linktr.ee OR site:bio.link "{username}"')
            elif platform == "tiktok":
                queries.append(f'"{username}" tiktok ("whatsapp" OR "telefone" OR "contato" OR "email")')
                queries.append(f'site:linktr.ee "{username}"')
            elif platform == "facebook":
                queries.append(f'site:facebook.com "{username}" ("telefone" OR "email" OR "contato")')
            elif platform == "twitter":
                queries.append(f'site:x.com OR site:twitter.com "{username}" ("email" OR "contato")')
                queries.append(f'"{username}" ("whatsapp" OR "telefone" OR "@gmail")')

            for query in queries:
                try:
                    raw = search_google(query, country_code="br", num_results=10)
                    for r in (raw.get("organic", []) if isinstance(raw, dict) else (raw or [])):
                        snippet = r.get("snippet", "")
                        title = r.get("title", "")
                        link = r.get("link", "")
                        snippets.append(snippet)

                        # Extract name from title
                        if not found_name and title and "@" not in title:
                            # Clean title: remove platform names
                            clean_title = re.sub(r'\s*[\|\-–—•]\s*(Instagram|TikTok|Facebook|Twitter|X).*', '', title).strip()
                            clean_title = re.sub(r'\(@?\w+\)', '', clean_title).strip()
                            if clean_title and len(clean_title) > 2 and len(clean_title) < 60:
                                found_name = clean_title

                        if extract_contacts:
                            contacts = extract_contacts(snippet + " " + title)
                            if contacts.get("email") and not found_email:
                                found_email = contacts["email"]
                            if contacts.get("phone") and not found_phone:
                                found_phone = contacts["phone"]

                    time.sleep(0.3)
                except Exception as e:
                    logger.warning(f"Google search error for @{username}: {e}")

        # --- Layer 2: Apify deep scrape (if enabled and token available) ---
        if use_apify and apify_token and (not found_phone or not found_email):
            try:
                actor_map = {
                    "instagram": "apify/instagram-profile-scraper",
                    "tiktok": "clockworks/tiktok-profile-scraper",
                    "facebook": "apify/facebook-pages-scraper",
                    "twitter": "apify/twitter-scraper",
                }
                actor_id = actor_map.get(platform)
                if actor_id:
                    # Build input based on platform
                    if platform == "instagram":
                        actor_input = {"usernames": [username]}
                    elif platform == "tiktok":
                        actor_input = {"profiles": [f"https://www.tiktok.com/@{username}"]}
                    elif platform == "facebook":
                        actor_input = {"startUrls": [{"url": url}]}
                    elif platform == "twitter":
                        actor_input = {"handles": [username], "tweetsDesired": 0}
                    else:
                        actor_input = {}

                    # Call Apify API
                    apify_url = f"https://api.apify.com/v2/acts/{actor_id.replace('/', '~')}/run-sync-get-dataset-items?token={apify_token}"
                    resp = httpx.post(apify_url, json=actor_input, timeout=120)

                    if resp.status_code == 200:
                        apify_data = resp.json()
                        if apify_data and len(apify_data) > 0:
                            profile = apify_data[0]

                            # Extract data based on platform
                            if platform == "instagram":
                                found_name = found_name or profile.get("fullName") or profile.get("name")
                                found_bio = profile.get("biography", "")
                                if not found_email:
                                    found_email = profile.get("businessEmail") or profile.get("email")
                                if not found_phone:
                                    found_phone = profile.get("businessPhoneNumber") or profile.get("phone")
                                # Check bio for contacts
                                if found_bio and extract_contacts:
                                    bio_contacts = extract_contacts(found_bio)
                                    if not found_email and bio_contacts.get("email"):
                                        found_email = bio_contacts["email"]
                                    if not found_phone and bio_contacts.get("phone"):
                                        found_phone = bio_contacts["phone"]

                            elif platform == "tiktok":
                                found_name = found_name or profile.get("nickname") or profile.get("name")
                                found_bio = profile.get("signature", "") or profile.get("bio", "")
                                if found_bio and extract_contacts:
                                    bio_contacts = extract_contacts(found_bio)
                                    if not found_email: found_email = bio_contacts.get("email")
                                    if not found_phone: found_phone = bio_contacts.get("phone")

                            elif platform == "facebook":
                                found_name = found_name or profile.get("name") or profile.get("title")
                                found_email = found_email or profile.get("email")
                                found_phone = found_phone or profile.get("phone")

                            elif platform == "twitter":
                                found_name = found_name or profile.get("name")
                                found_bio = profile.get("description", "")
                                if found_bio and extract_contacts:
                                    bio_contacts = extract_contacts(found_bio)
                                    if not found_email: found_email = bio_contacts.get("email")
                                    if not found_phone: found_phone = bio_contacts.get("phone")

                            logger.info(f"Apify [{platform}] @{username}: name={found_name}, email={found_email}, phone={found_phone}")

                time.sleep(1)  # Rate limit Apify
            except Exception as e:
                logger.warning(f"Apify error for @{username}: {e}")

        # --- Layer 3: WhatsApp check ---
        whatsapp_status = "unknown"
        if found_phone:
            try:
                from pgfn_module.whatsapp_finder import check_whatsapp
                wa_result = check_whatsapp(found_phone)
                if isinstance(wa_result, dict):
                    whatsapp_status = "confirmed" if wa_result.get("has_whatsapp") else "not_whatsapp"
                elif wa_result:
                    whatsapp_status = "confirmed"
                else:
                    whatsapp_status = "not_whatsapp"
            except Exception:
                pass

        # Score
        score = 0
        if found_phone:
            import re as _re
            digits = _re.sub(r'\D', '', found_phone)
            if len(digits) >= 11 and digits[-9] == '9': score += 1000
            elif len(digits) >= 10: score += 500
        if whatsapp_status == "confirmed": score += 500
        if found_email: score += 10
        if platform == "instagram": score += 50

        result = {
            "search_id": search_id,
            "name": found_name or f"@{username}",
            "email": found_email,
            "phone": found_phone,
            "role_snippet": (found_bio or "; ".join(snippets[:3]))[:500],
            "company": None,
            "profile_url": url,
            "source_platform": platform,
            "cnpj": None,
            "address": None,
            "whatsapp_status": whatsapp_status,
            "priority_score": score,
        }
        all_results.append(result)

    # Insert results
    if all_results:
        for i in range(0, len(all_results), 50):
            batch = all_results[i:i + 50]
            sb.table("prospect_results").insert(batch).execute()

    sb.table("prospect_searches").update({
        "status": "completed",
        "total_results": len(all_results),
        "completed_at": datetime.now().isoformat(),
    }).eq("id", search_id).execute()

    logger.info(f"Social Enrichment {search_id}: completed with {len(all_results)} results")


# ===== WHATSAPP INSTANCE MANAGEMENT =====

@app.get("/instances")
async def list_instances():
    """Lista todas as instâncias WhatsApp."""
    sb = get_supabase()
    result = sb.table("whatsapp_instances").select("*, tenants(name, slug)").execute()
    instances = result.data or []

    # Check live status of each instance using async client
    wa_host = os.getenv("WA_HOST", "host.docker.internal")
    async with httpx.AsyncClient(timeout=5) as client:
        for inst in instances:
            port = inst.get("port")
            if port:
                try:
                    resp = await client.get(f"http://{wa_host}:{port}/status")
                    if resp.status_code == 200:
                        live = resp.json()
                        inst["live_status"] = live.get("status", "unknown")
                        inst["live_number"] = live.get("number")
                        inst["live_name"] = live.get("name")
                    else:
                        inst["live_status"] = "unreachable"
                except Exception as e:
                    inst["live_status"] = "offline"
                    logger.warning(f"Instance {inst.get('instance_name')} health check failed: {e}")
            else:
                inst["live_status"] = "no_port"

    return {"instances": instances}


@app.get("/instances/{instance_name}/qr")
async def get_instance_qr(instance_name: str):
    """Retorna QR code da instância para conexão."""
    sb = get_supabase()
    inst = sb.table("whatsapp_instances").select("*").eq("instance_name", instance_name).single().execute()
    if not inst.data:
        raise HTTPException(404, "Instância não encontrada")

    port = inst.data.get("port")
    if not port:
        raise HTTPException(400, "Instância sem porta configurada")

    wa_host = os.getenv("WA_HOST", "host.docker.internal")
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"http://{wa_host}:{port}/qr/json")
            return resp.json()
    except Exception as e:
        raise HTTPException(503, f"Instância offline: {e}")


@app.post("/instances/{instance_name}/status")
async def update_instance_status(instance_name: str, request: Request):
    """Callback do wa-server quando conecta/desconecta."""
    sb = get_supabase()
    body = await request.json()

    update_data = {"status": body.get("status", "disconnected")}
    if body.get("phone_number"):
        update_data["phone_number"] = body["phone_number"]
    if body.get("status") == "connected":
        update_data["connected_at"] = datetime.now().isoformat()

    sb.table("whatsapp_instances").update(update_data).eq("instance_name", instance_name).execute()
    logger.info(f"Instance {instance_name} status → {body.get('status')}")
    return {"ok": True}


@app.post("/instances/{instance_name}/disconnect")
async def disconnect_instance(instance_name: str, clear_auth: bool = False):
    """Desconecta a instância WhatsApp."""
    sb = get_supabase()
    inst = sb.table("whatsapp_instances").select("*").eq("instance_name", instance_name).single().execute()
    if not inst.data:
        raise HTTPException(404, "Instância não encontrada")

    port = inst.data.get("port")
    if not port:
        raise HTTPException(400, "Instância sem porta configurada")

    wa_host = os.getenv("WA_HOST", "host.docker.internal")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(f"http://{wa_host}:{port}/disconnect?clear_auth={'true' if clear_auth else 'false'}")
        sb.table("whatsapp_instances").update({"status": "disconnected", "phone_number": None}).eq("instance_name", instance_name).execute()
        return resp.json()
    except Exception as e:
        raise HTTPException(503, f"Erro ao desconectar: {e}")


@app.post("/instances/{instance_name}/reconnect")
async def reconnect_instance(instance_name: str):
    """Reconecta a instância WhatsApp (gera novo QR)."""
    sb = get_supabase()
    inst = sb.table("whatsapp_instances").select("*").eq("instance_name", instance_name).single().execute()
    if not inst.data:
        raise HTTPException(404, "Instância não encontrada")

    port = inst.data.get("port")
    if not port:
        raise HTTPException(400, "Instância sem porta configurada")

    wa_host = os.getenv("WA_HOST", "host.docker.internal")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(f"http://{wa_host}:{port}/reconnect")
        sb.table("whatsapp_instances").update({"status": "qr_pending"}).eq("instance_name", instance_name).execute()
        return resp.json()
    except Exception as e:
        raise HTTPException(503, f"Erro ao reconectar: {e}")


@app.post("/instances/create")
async def create_instance(request: Request):
    """Cria nova instância WhatsApp para um tenant (registro apenas)."""
    sb = get_supabase()
    body = await request.json()
    tenant_id = body.get("tenant_id")
    if not tenant_id:
        raise HTTPException(400, "tenant_id obrigatório")

    existing = sb.table("whatsapp_instances").select("id").eq("tenant_id", tenant_id).execute()
    if existing.data:
        raise HTTPException(409, "Tenant já possui uma instância")

    tenant = sb.table("tenants").select("slug, name").eq("id", tenant_id).single().execute()
    if not tenant.data:
        raise HTTPException(404, "Tenant não encontrado")

    slug = tenant.data["slug"]
    instance_name = f"{slug}-wa"

    ports = sb.table("whatsapp_instances").select("port").order("port", desc=True).limit(1).execute()
    next_port = ((ports.data[0]["port"] or 3000) + 1) if ports.data else 3001

    inst = sb.table("whatsapp_instances").insert({
        "tenant_id": tenant_id,
        "instance_name": instance_name,
        "port": next_port,
        "status": "disconnected",
    }).select().single().execute()

    logger.info(f"Created instance {instance_name} for tenant {slug} on port {next_port}")
    return {"instance": inst.data}


@app.post("/instances/provision")
async def provision_instance(request: Request, background_tasks: BackgroundTasks):
    """
    Provisionamento completo: cria tenant + licença + instância Docker + envia chave por WhatsApp.
    Chamado pelo painel admin ao criar licença com provisioning.
    """
    import subprocess

    sb = get_supabase()
    body = await request.json()

    tenant_name = body.get("tenant_name", "")
    plan = body.get("plan", "pro")
    validity_months = body.get("validity_months", 1)
    client_phone = body.get("client_phone", "")
    hub_url = body.get("hub_url", "https://sdr-hub.vercel.app")

    if not tenant_name:
        raise HTTPException(400, "tenant_name obrigatório")

    # 1. Criar tenant
    slug = tenant_name.lower().replace(" ", "-").replace(".", "")
    slug = ''.join(c for c in slug if c.isalnum() or c == '-')

    existing_tenant = sb.table("tenants").select("id").eq("slug", slug).execute()
    if existing_tenant.data:
        raise HTTPException(409, f"Tenant '{slug}' já existe")

    tenant = sb.table("tenants").insert({"name": tenant_name, "slug": slug}).select().single().execute()
    tenant_id = tenant.data["id"]

    # 2. Gerar licença
    import secrets
    plan_prefixes = {"starter": "STR", "pro": "PRO", "enterprise": "ENT"}
    plan_max_users = {"starter": 2, "pro": 4, "enterprise": 10}
    prefix = plan_prefixes.get(plan, "PRO")
    key = f"SDR-{prefix}-{secrets.token_hex(4).upper()}"

    valid_until = datetime.now()
    for _ in range(validity_months):
        if valid_until.month == 12:
            valid_until = valid_until.replace(year=valid_until.year + 1, month=1)
        else:
            valid_until = valid_until.replace(month=valid_until.month + 1)

    sb.table("licenses").insert({
        "key": key,
        "tenant_id": tenant_id,
        "plan": plan,
        "max_users": plan_max_users.get(plan, 4),
        "valid_until": valid_until.isoformat(),
        "status": "active",
    }).execute()

    # 3. Criar instância WhatsApp
    instance_name = f"{slug}-wa"
    ports = sb.table("whatsapp_instances").select("port").order("port", desc=True).limit(1).execute()
    next_port = ((ports.data[0]["port"] or 3000) + 1) if ports.data else 3002

    sb.table("whatsapp_instances").insert({
        "tenant_id": tenant_id,
        "instance_name": instance_name,
        "port": next_port,
        "container_name": f"sdr-wa-{slug}",
        "status": "disconnected",
    }).execute()

    # 4. Criar container Docker (background)
    container_name = f"sdr-wa-{slug}"
    wa_image = "sdr-backend-wa-server"
    docker_network = body.get("docker_network", "")

    async def provision_docker():
        try:
            cmd = [
                "docker", "run", "-d",
                "--name", container_name,
                "--restart", "always",
                "-e", f"INSTANCE_ID={instance_name}",
                "-e", f"WA_PORT={next_port}",
                "-e", f"WEBHOOK_URL=http://sdr-webhook-server:5000/webhook",
                "-p", f"{next_port}:{next_port}",
                wa_image,
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            if result.returncode == 0:
                logger.info(f"Docker container {container_name} created on port {next_port}")
                sb.table("whatsapp_instances").update({"status": "disconnected"}).eq("instance_name", instance_name).execute()
            else:
                logger.error(f"Docker error: {result.stderr}")
        except Exception as e:
            logger.error(f"Failed to provision Docker container: {e}")

    background_tasks.add_task(provision_docker)

    # 5. Criar template padrão para o tenant
    sb.table("tenant_templates").insert({
        "tenant_id": tenant_id,
        "templates": {},
        "system_prompt": f"Você é um assistente de vendas da empresa {tenant_name}.",
        "classifier_prompt": "Classifique a intenção da mensagem do lead.",
    }).execute()

    # 6. Criar chip padrão para o tenant
    sb.table("chips").insert({
        "instance_name": instance_name,
        "tenant_id": tenant_id,
        "status": "warming",
        "warming_start_date": datetime.now().strftime("%Y-%m-%d"),
        "warming_day": 0,
        "daily_limit": 5,
        "messages_sent_today": 0,
    }).execute()

    # 7. Enviar chave por WhatsApp (se telefone fornecido)
    wa_sent = False
    if client_phone:
        phone = client_phone.strip().replace(" ", "").replace("-", "").replace("(", "").replace(")", "")
        if not phone.startswith("55"):
            phone = "55" + phone

        message = (
            f"🚀 *Sua licença SDR está ativa!*\n\n"
            f"Empresa: *{tenant_name}*\n"
            f"Plano: *{plan.capitalize()}*\n"
            f"Validade: *{validity_months} {'mês' if validity_months == 1 else 'meses'}*\n\n"
            f"🔑 Chave: `{key}`\n\n"
            f"📱 Acesse: {hub_url}/activate\n\n"
            f"*Como ativar:*\n"
            f"1. Acesse o link acima\n"
            f"2. Digite a chave\n"
            f"3. Preencha nome, email e crie uma senha\n"
            f"4. Pronto! Faça login e conecte seu WhatsApp\n\n"
            f"Dúvidas? Responda esta mensagem."
        )

        try:
            from .execution.chip_manager import send_text_message
            await send_text_message("antigravity-wa", phone, message, tenant_id=None)
            wa_sent = True
            logger.info(f"License key sent to {phone} for tenant {tenant_name}")
        except Exception as e:
            logger.warning(f"Failed to send WhatsApp to {phone}: {e}")
            # Try via direct HTTP to default wa-server
            try:
                resp = httpx.post(
                    f"http://localhost:3001/send/text",
                    json={"phone": phone, "text": message},
                    timeout=15,
                )
                if resp.status_code == 200:
                    wa_sent = True
            except Exception:
                pass

    logger.info(f"Provisioned tenant '{tenant_name}': key={key}, port={next_port}, wa_sent={wa_sent}")

    return {
        "success": True,
        "tenant_id": tenant_id,
        "tenant_name": tenant_name,
        "license_key": key,
        "instance_name": instance_name,
        "port": next_port,
        "container_name": container_name,
        "whatsapp_sent": wa_sent,
        "hub_url": f"{hub_url}/activate",
    }


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
    tenant_id = getattr(req, 'tenant_id', None)
    campaign = create_campaign(
        name=req.name,
        description=req.description,
        lead_ids=req.lead_ids,
        filters=req.filters,
        tenant_id=tenant_id,
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


@app.post("/conversations/{conversation_id}/send")
async def send_manual_message(conversation_id: str, body: dict):
    """Envia mensagem manual para um lead via Hub (intervenção humana)."""
    sb = get_supabase()
    message = (body.get("message") or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="message is required")

    conv = sb.table("conversations").select("id, leads(telefone), chip_id, chips(phone_number, instance_name)").eq("id", conversation_id).single().execute()
    if not conv.data:
        raise HTTPException(status_code=404, detail="Conversation not found")

    phone = conv.data.get("leads", {}).get("telefone")
    if not phone:
        raise HTTPException(status_code=400, detail="Lead has no phone number")

    chip_data = conv.data.get("chips") or {}
    instance_name = chip_data.get("instance_name")
    if not instance_name:
        chip_result = sb.table("chips").select("instance_name").in_("status", ["active", "warming"]).limit(1).execute()
        if not chip_result.data:
            raise HTTPException(status_code=503, detail="No active chip available")
        instance_name = chip_result.data[0]["instance_name"]

    try:
        import httpx
        async with httpx.AsyncClient(timeout=15) as client:
            wa_resp = await client.post("http://localhost:3001/send", json={"phone": phone, "message": message, "from": instance_name})
            wa_resp.raise_for_status()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"WhatsApp send failed: {str(e)}")

    sb.table("messages").insert({
        "conversation_id": conversation_id,
        "direction": "outbound",
        "content": message,
        "message_type": "manual",
        "status": "sent",
    }).execute()

    return {"success": True}


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


# ===== FOLLOW-UPS =====


@app.post("/followups/run")
async def run_followups_endpoint(background_tasks: BackgroundTasks):
    """Dispara verificação de follow-ups frios manualmente."""
    background_tasks.add_task(check_and_send_followups)
    return {"status": "started"}


@app.get("/followups/nurturing")
async def list_nurturing_leads():
    """
    Lista leads quentes (nurturing/responded/qualified) que estão sem resposta.
    Retorna ordenado pelo mais urgente (last_outbound mais antigo).
    """
    sb = get_supabase()

    convs = (
        sb.table("conversations")
        .select("id, status, current_step, follow_up_count, next_follow_up_at, updated_at, leads(id, nome, empresa, telefone, valor_divida)")
        .in_("status", ["nurturing", "responded", "qualified"])
        .order("updated_at", desc=False)
        .limit(100)
        .execute()
    )

    result = []
    for conv in (convs.data or []):
        # Buscar última mensagem outbound
        last_out = (
            sb.table("messages")
            .select("content, created_at")
            .eq("conversation_id", conv["id"])
            .eq("direction", "outbound")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        last_outbound = last_out.data[0] if last_out.data else {}
        result.append({
            **conv,
            "last_bot_message": last_outbound.get("content", "")[:150],
            "last_bot_at": last_outbound.get("created_at", ""),
        })

    return {"conversations": result}


class TriggerNurturingRequest(BaseModel):
    conversation_id: str


@app.post("/followups/nurturing/trigger")
async def trigger_nurturing_followup(req: TriggerNurturingRequest, background_tasks: BackgroundTasks):
    """Dispara imediatamente um follow-up nurturing para uma conversa específica."""
    sb = get_supabase()

    # Setar next_follow_up_at para agora para que o engine pegue imediatamente
    sb.table("conversations").update(
        {"next_follow_up_at": datetime.utcnow().isoformat()}
    ).eq("id", req.conversation_id).in_("status", ["nurturing", "responded", "qualified"]).execute()

    background_tasks.add_task(check_nurturing_followups)
    return {"status": "triggered", "conversation_id": req.conversation_id}


@app.post("/followups/nurturing/close/{conversation_id}")
async def close_nurturing_lead(conversation_id: str):
    """Encerra manualmente um lead nurturing sem resposta."""
    sb = get_supabase()
    sb.table("conversations").update(
        {"status": "no_response", "next_follow_up_at": None}
    ).eq("id", conversation_id).execute()
    return {"status": "closed", "conversation_id": conversation_id}


# ===== HEALTH =====


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "service": "SDR WhatsApp - Agente Nexa v1.0",
    }


# ===== PROSPECTING HELPERS =====


def generate_search_queries(query: str, platforms: list[str], location: str = None) -> list[dict]:
    """Uses GPT-4o to generate Google Dork queries from natural language."""
    platform_sites = {
        "linkedin": "site:linkedin.com/in",
        "instagram": "site:instagram.com",
        "facebook": "site:facebook.com",
        "twitter": "site:twitter.com",
        "tiktok": "site:tiktok.com",
    }

    platform_list = ", ".join(platforms)
    location_hint = f"\nLocalização: {location}" if location else ""

    prompt = f"""Você é um especialista em prospecção (SDR) e OSINT.
O usuário quer encontrar leads com o pedido: "{query}"
Plataformas desejadas: {platform_list}{location_hint}

Gere queries de busca Google Dorking otimizadas.

REGRAS:
1. Para LinkedIn: use "site:linkedin.com/in"
2. Para Instagram: use "site:instagram.com"
3. Para Facebook: use "site:facebook.com"
4. Para Google genérico: NÃO use site:, busque "email" OR "telefone" OR "contato"
5. Para Google Maps: gere uma query simples com o tipo de negócio + localização
6. Inclua termos de contato: ("email" OR "telefone" OR "celular" OR "contato")
7. Adicione -intitle:vagas -inurl:jobs
8. Se tem localização, inclua na query

Retorne APENAS JSON no formato:
{{"queries": [{{"query": "...", "platform": "linkedin"}}, {{"query": "...", "platform": "instagram"}}, ...]}}
"""

    try:
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "Generate search queries in JSON format."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
        )
        content = response.choices[0].message.content
        data = json.loads(content)
        return data.get("queries", [])
    except Exception as e:
        logger.error(f"Erro GPT query generation: {e}")
        return []


async def run_prospecting_search(search_id: str, query: str, mode: str, platforms: list[str], location: str = None, enable_deep_scraping: bool = False):
    """Background task: generates queries, searches, parses, stores in Supabase."""
    sb = get_supabase()

    try:
        if not _load_prospecting_modules():
            sb.table("prospect_searches").update({"status": "failed"}).eq("id", search_id).execute()
            logger.error(f"Prospecting {search_id}: modules not available")
            return

        sb.table("prospect_searches").update({"status": "running"}).eq("id", search_id).execute()

        all_results = []
        platforms_searched = []

        # Generate queries
        if mode == "natural_language":
            generated = generate_search_queries(query, platforms, location)
        else:
            # Structured mode: build queries manually
            generated = []
            roles = [query]  # Use query as keyword
            for platform in platforms:
                if platform == "google_places":
                    generated.append({"query": f"{query} {location or ''}", "platform": "google_places"})
                elif platform == "google":
                    generated.append({"query": construct_query(query, roles, location, "profile", "google"), "platform": "google"})
                else:
                    generated.append({"query": construct_query(query, roles, location, "profile", platform), "platform": platform})

        logger.info(f"Prospecting {search_id}: {len(generated)} queries to execute")

        for q_item in generated:
            q_text = q_item.get("query", "") if isinstance(q_item, dict) else str(q_item)
            q_platform = q_item.get("platform", "web") if isinstance(q_item, dict) else "web"

            if not q_text:
                continue

            logger.info(f"Prospecting query [{q_platform}]: {q_text[:100]}")

            try:
                if q_platform == "google_places":
                    raw = search_google_places(q_text, country_code="br")
                    leads = parse_places_results(raw, query, q_text, location_filter=location, enable_deep_scraping=enable_deep_scraping)
                else:
                    raw = search_google(q_text, country_code="br", num_results=20)
                    leads = parse_results(raw, query, q_text, q_platform, location_filter=location, enable_deep_scraping=enable_deep_scraping)

                if q_platform not in platforms_searched:
                    platforms_searched.append(q_platform)

                for lead in leads:
                    # Calculate priority score
                    score = 0
                    phone = lead.get("Phone_Whatsapp", "N/A")
                    if phone and phone != "N/A":
                        digits = ''.join(c for c in phone if c.isdigit())
                        if len(digits) >= 11 and digits[-9] == '9':
                            score += 1000
                    if q_platform == "instagram" or "instagram.com" in lead.get("Profile_URL", ""):
                        score += 100
                    email = lead.get("Personal_Email", "N/A")
                    if email and email != "N/A":
                        score += 10

                    all_results.append({
                        "search_id": search_id,
                        "name": lead.get("Name", ""),
                        "email": email if email != "N/A" else None,
                        "phone": phone if phone != "N/A" else None,
                        "role_snippet": lead.get("Role_Snippet", "")[:500],
                        "company": lead.get("Company_Input", ""),
                        "profile_url": lead.get("Profile_URL", ""),
                        "source_platform": q_platform,
                        "address": lead.get("Role_Snippet", "") if q_platform == "google_places" else None,
                        "priority_score": score,
                    })
            except Exception as e:
                logger.error(f"Erro na query [{q_platform}]: {e}")
                continue

        # Deduplicate by profile_url
        seen_urls = set()
        unique_results = []
        for r in all_results:
            url = r.get("profile_url", "")
            if url and url in seen_urls:
                continue
            if url:
                seen_urls.add(url)
            unique_results.append(r)

        # Insert into Supabase in batches
        batch_size = 50
        for i in range(0, len(unique_results), batch_size):
            batch = unique_results[i:i+batch_size]
            sb.table("prospect_results").insert(batch).execute()

        # Update search status
        sb.table("prospect_searches").update({
            "status": "completed",
            "total_results": len(unique_results),
            "platforms_searched": platforms_searched,
            "completed_at": datetime.utcnow().isoformat(),
        }).eq("id", search_id).execute()

        logger.info(f"Prospecting {search_id}: completed with {len(unique_results)} results")

    except Exception as e:
        logger.error(f"Prospecting {search_id} failed: {e}")
        sb.table("prospect_searches").update({
            "status": "failed",
        }).eq("id", search_id).execute()


# ===== PROSPECTING ENDPOINTS =====


@app.post("/prospecting/search")
async def start_prospecting_search_endpoint(req: ProspectingSearchRequest, background_tasks: BackgroundTasks):
    """Inicia uma busca de prospectos em múltiplas plataformas."""
    sb = get_supabase()

    search = sb.table("prospect_searches").insert({
        "query_text": req.query,
        "search_type": req.mode,
        "filters": {"platforms": req.platforms, "location": req.location},
        "status": "pending",
    }).execute()

    search_id = search.data[0]["id"]

    background_tasks.add_task(
        run_prospecting_search,
        search_id=search_id,
        query=req.query,
        mode=req.mode,
        platforms=req.platforms,
        location=req.location,
        enable_deep_scraping=req.enable_deep_scraping,
    )

    return {"search_id": search_id, "status": "pending"}


@app.get("/prospecting/search/{search_id}")
async def get_prospecting_results_endpoint(search_id: str):
    """Retorna status e resultados de uma busca de prospecção."""
    sb = get_supabase()

    search = sb.table("prospect_searches").select("*").eq("id", search_id).single().execute()
    if not search.data:
        raise HTTPException(status_code=404, detail="Search not found")

    results = sb.table("prospect_results").select("*").eq("search_id", search_id).order("priority_score", desc=True).execute()

    return {
        "search": search.data,
        "results": results.data or [],
    }


@app.post("/prospecting/enrich")
async def enrich_prospects_endpoint(req: ProspectingEnrichRequest, background_tasks: BackgroundTasks):
    """Enriquece prospectos selecionados com dados de WhatsApp e email."""
    sb = get_supabase()
    enriched = 0

    for result_id in req.result_ids:
        try:
            result = sb.table("prospect_results").select("*").eq("id", result_id).single().execute()
            if not result.data:
                continue

            prospect = result.data
            updates = {}

            # CNPJ Enrichment via BrasilAPI
            if prospect.get("cnpj"):
                try:
                    import re as _re
                    import time as _time
                    cnpj_clean = _re.sub(r'\D', '', prospect["cnpj"]).zfill(14)
                    import httpx as _httpx
                    resp = _httpx.get(f"https://brasilapi.com.br/api/cnpj/v1/{cnpj_clean}", timeout=10)
                    if resp.status_code == 200:
                        data = resp.json()
                        updates["cnpj_data"] = {
                            "razao_social": data.get("razao_social"),
                            "nome_fantasia": data.get("nome_fantasia"),
                            "cnae_fiscal": data.get("cnae_fiscal"),
                            "cnae_fiscal_descricao": data.get("cnae_fiscal_descricao"),
                            "qsa": data.get("qsa", []),
                            "logradouro": data.get("logradouro"),
                            "municipio": data.get("municipio"),
                            "uf": data.get("uf"),
                            "cep": data.get("cep"),
                            "capital_social": data.get("capital_social"),
                            "porte": data.get("porte"),
                            "situacao_cadastral": data.get("situacao_cadastral"),
                            "descricao_situacao_cadastral": data.get("descricao_situacao_cadastral"),
                        }
                        # Extract phone from CNPJ data if missing
                        if not prospect.get("phone"):
                            ddd1 = str(data.get("ddd_telefone_1", ""))
                            if ddd1:
                                digits = _re.sub(r'\D', '', ddd1)
                                if len(digits) >= 10:
                                    updates["phone"] = digits
                    _time.sleep(0.5)  # Rate limit BrasilAPI
                except Exception as e:
                    logger.warning(f"CNPJ enrichment failed for {prospect.get('cnpj')}: {e}")

            # Check WhatsApp status
            if prospect.get("phone") or updates.get("phone"):
                phone = updates.get("phone") or prospect["phone"]
                try:
                    from pgfn_module.whatsapp_finder import check_whatsapp
                    wa_result = check_whatsapp(phone)
                    if isinstance(wa_result, dict):
                        updates["whatsapp_status"] = "confirmed" if wa_result.get("has_whatsapp") else "not_whatsapp"
                    elif wa_result:
                        updates["whatsapp_status"] = "confirmed"
                    else:
                        updates["whatsapp_status"] = "not_whatsapp"
                except Exception:
                    updates["whatsapp_status"] = "unknown"

            if updates:
                # Recalculate priority score
                phone = updates.get("phone") or prospect.get("phone")
                score = prospect.get("priority_score", 0)
                if phone:
                    digits = ''.join(c for c in phone if c.isdigit())
                    if len(digits) >= 11:
                        score = max(score, 1000)
                if updates.get("whatsapp_status") == "confirmed":
                    score += 500
                updates["priority_score"] = score

                sb.table("prospect_results").update(updates).eq("id", result_id).execute()
                enriched += 1

        except Exception as e:
            logger.error(f"Erro enriching {result_id}: {e}")
            continue

    return {"enriched": enriched, "total": len(req.result_ids)}


@app.post("/prospecting/to-campaign")
async def prospects_to_campaign_endpoint(req: ProspectingToCampaignRequest, background_tasks: BackgroundTasks):
    """Converte prospectos selecionados em leads e cria uma campanha."""
    sb = get_supabase()

    # Fetch selected prospects
    results = sb.table("prospect_results").select("*").in_("id", req.result_ids).execute()
    if not results.data:
        raise HTTPException(status_code=400, detail="No prospects found")

    # Convert to leads
    lead_ids = []
    for prospect in results.data:
        lead_data = {
            "nome": prospect.get("name", ""),
            "empresa": prospect.get("company", ""),
            "telefone": prospect.get("phone"),
            "cargo": prospect.get("role_snippet", "")[:200],
            "linkedin": prospect.get("profile_url") if "linkedin" in (prospect.get("source_platform") or "") else None,
        }

        # Skip if no phone (can't send WhatsApp)
        if not lead_data["telefone"]:
            continue

        # Check if lead already exists by phone
        existing = sb.table("leads").select("id").eq("telefone", lead_data["telefone"]).execute()
        if existing.data:
            lead_ids.append(existing.data[0]["id"])
        else:
            new_lead = sb.table("leads").insert(lead_data).execute()
            if new_lead.data:
                lead_ids.append(new_lead.data[0]["id"])

    if not lead_ids:
        raise HTTPException(status_code=400, detail="No prospects with phone numbers found")

    # Create campaign
    campaign = create_campaign(
        name=req.campaign_name,
        description=req.campaign_description,
        lead_ids=lead_ids,
    )

    return {
        "status": "created",
        "campaign": campaign,
        "leads_imported": len(lead_ids),
    }


# ===== MAIN =====

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=WEBHOOK_PORT)
