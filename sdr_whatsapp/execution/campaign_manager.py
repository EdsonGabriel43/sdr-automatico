"""
Gerenciador de Campanhas — SDR WhatsApp
Importa leads, cria campanhas, e schedula envios respeitando limites.
"""

import os
import csv
import asyncio
import random
import logging
from datetime import datetime, time
from typing import Optional
from dotenv import load_dotenv
from supabase import create_client, Client

from .chip_manager import get_available_chip, set_current_tenant
from .agent_nexa import send_first_contact

load_dotenv()

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
MIN_DELAY = int(os.getenv("MIN_DELAY_SECONDS", "60"))
MAX_DELAY = int(os.getenv("MAX_DELAY_SECONDS", "180"))
BIZ_START = int(os.getenv("BUSINESS_HOURS_START", "8"))
BIZ_END = int(os.getenv("BUSINESS_HOURS_END", "18"))


def get_supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def import_leads_from_csv(
    file_content: bytes,
    mapping: Optional[dict] = None,
) -> int:
    """
    Importa leads de um CSV em memória para o Supabase.
    
    O mapping padrão é para o formato do lote_prospeccao PGFN:
    CNPJ_CPF;NOME_DEVEDOR;VALOR_CONSOLIDADO;TIPO_DIVIDA;SITUACAO_DIVIDA;UF;SOCIOS;EMAIL_RECEITA

    Args:
        file_content: Bytes do arquivo CSV carregado
        mapping: Dicionário mapeando coluna CSV → campo do banco.
                 Se None, usa o mapeamento padrão PGFN.

    Returns:
        Número de leads importados
    """
    sb = get_supabase()

    default_mapping = {
        "CNPJ_CPF": "cnpj",
        "NOME_DEVEDOR": "empresa",
        "VALOR_CONSOLIDADO": "valor_divida",
        "TIPO_DIVIDA": "tipo_divida",
        "SITUACAO_DIVIDA": "situacao_divida",
        "UF": "uf",
        "SOCIOS": "socios",
        "EMAIL_RECEITA": "email",
    }

    field_mapping = mapping or default_mapping
    count = 0

    import io
    # Decodificar arquivo tentando múltiplos encodings (Excel BR usa cp1252/latin-1)
    content_str = None
    for enc in ('utf-8-sig', 'utf-8', 'cp1252', 'latin-1', 'iso-8859-1'):
        try:
            content_str = file_content.decode(enc)
            break
        except (UnicodeDecodeError, LookupError):
            continue
    if content_str is None:
        content_str = file_content.decode('latin-1', errors='replace')

    sample = content_str[:2048]
    delimiter = ";" if ";" in sample else ","

    # Criar um buffer legível
    f = io.StringIO(content_str)
    reader = csv.DictReader(f, delimiter=delimiter)

    batch = []
    for row in reader:
        lead_data = {"fonte": "pgfn"}

        for csv_col, db_field in field_mapping.items():
            value = row.get(csv_col, "").strip()
            if value and value != "N/A":
                if db_field == "valor_divida":
                    try:
                        lead_data[db_field] = float(
                            value.replace(".", "").replace(",", ".")
                            if "," in value
                            else value
                        )
                    except ValueError:
                        lead_data[db_field] = 0
                else:
                    lead_data[db_field] = value

        # Extrair nome do primeiro sócio-administrador como nome do lead
        socios = lead_data.get("socios", "")
        if socios:
            for socio_part in socios.split(";"):
                socio_part = socio_part.strip()
                if "Sócio-Administrador" in socio_part or "Presidente" in socio_part:
                    nome = socio_part.split("(")[0].strip()
                    lead_data["nome"] = nome
                    lead_data["cargo"] = (
                        socio_part.split("(")[1].replace(")", "").strip()
                        if "(" in socio_part
                        else ""
                    )
                    break

        if not lead_data.get("nome"):
            # Pegar o primeiro sócio pessoa física
            for socio_part in socios.split(";"):
                socio_part = socio_part.strip()
                if socio_part and "Pessoa Jurídica" not in socio_part:
                    nome = socio_part.split("(")[0].strip()
                    if nome:
                        lead_data["nome"] = nome
                        break

        if not lead_data.get("nome"):
            lead_data["nome"] = lead_data.get("empresa", "Não identificado")

        batch.append(lead_data)

        if len(batch) >= 50:
            sb.table("leads").insert(batch).execute()
            count += len(batch)
            batch = []

    if batch:
        sb.table("leads").insert(batch).execute()
        count += len(batch)

    logger.info(f"Importados {count} leads em memória via interface web")
    return count


def add_phone_to_lead(lead_id: str, phone: str) -> None:
    """Adiciona/atualiza telefone de um lead."""
    sb = get_supabase()
    # Formatar telefone (garantir DDI)
    phone = phone.strip().replace(" ", "").replace("-", "").replace("(", "").replace(")", "")
    if not phone.startswith("55"):
        phone = "55" + phone

    sb.table("leads").update({"telefone": phone}).eq("id", lead_id).execute()
    logger.info(f"Telefone {phone} adicionado ao lead {lead_id}")


def create_campaign(
    name: str,
    description: str = "",
    lead_ids: Optional[list[str]] = None,
    filters: Optional[dict] = None,
    tenant_id: str = None,
) -> dict:
    """
    Cria uma nova campanha e associa leads.

    Args:
        name: Nome da campanha (ex: "PGFN SP 1MM-5MM Lote 1")
        description: Descrição da campanha
        lead_ids: Lista de IDs de leads a incluir (se None, usar filters)
        filters: Filtros para selecionar leads (ex: {"uf": "SP"})

    Returns:
        Dados da campanha criada
    """
    sb = get_supabase()

    # Criar campanha
    campaign_data = {
        "name": name,
        "description": description,
        "status": "draft",
    }
    if tenant_id:
        campaign_data["tenant_id"] = tenant_id

    campaign_result = (
        sb.table("campaigns")
        .insert(campaign_data)
        .execute()
    )
    campaign = campaign_result.data[0]
    campaign_id = campaign["id"]

    # Selecionar leads
    if lead_ids:
        leads_query = sb.table("leads").select("id").in_("id", lead_ids)
    elif filters:
        leads_query = sb.table("leads").select("id")
        for field, value in filters.items():
            leads_query = leads_query.eq(field, value)
        # Apenas leads com telefone
        leads_query = leads_query.not_.is_("telefone", "null")
    else:
        # Todos os leads com telefone
        leads_query = (
            sb.table("leads").select("id").not_.is_("telefone", "null")
        )

    leads_result = leads_query.execute()

    if not leads_result.data:
        logger.warning("Nenhum lead encontrado para a campanha!")
        return campaign

    # Criar conversas para cada lead
    conversations = []
    for lead in leads_result.data:
        conv_data = {
            "lead_id": lead["id"],
            "campaign_id": campaign_id,
            "status": "pending",
            "current_step": 0,
            "follow_up_count": 0,
        }
        if tenant_id:
            conv_data["tenant_id"] = tenant_id
        conversations.append(conv_data)

    # Inserir em lotes
    for i in range(0, len(conversations), 50):
        batch = conversations[i : i + 50]
        sb.table("conversations").insert(batch).execute()

    # Atualizar total de leads na campanha
    sb.table("campaigns").update({"total_leads": len(conversations)}).eq(
        "id", campaign_id
    ).execute()

    logger.info(
        f"Campanha '{name}' criada com {len(conversations)} leads"
    )
    return campaign


def is_business_hours() -> bool:
    """Verifica se estamos em horário comercial (seg-sex, 8h-18h)."""
    now = datetime.now()
    # Seg=0, Dom=6
    if now.weekday() >= 5:
        return False
    return BIZ_START <= now.hour < BIZ_END


async def run_campaign(campaign_id: str, tenant_id: str = None) -> dict:
    """
    Executa o envio de mensagens de uma campanha.
    Respeita limites de volume, horário comercial e delays.

    Returns:
        dict com métricas do envio (enviados, erros, limite_atingido)
    """
    sb = get_supabase()

    # Set tenant context for message routing
    if tenant_id:
        set_current_tenant(tenant_id)

    # Se não temos tenant_id, buscar da campanha
    if not tenant_id:
        camp = sb.table("campaigns").select("tenant_id").eq("id", campaign_id).single().execute()
        if camp.data and camp.data.get("tenant_id"):
            tenant_id = camp.data["tenant_id"]
            set_current_tenant(tenant_id)

    # Ativar campanha
    sb.table("campaigns").update({"status": "active"}).eq(
        "id", campaign_id
    ).execute()

    metrics = {"sent": 0, "errors": 0, "limit_reached": False}

    # Buscar conversas pendentes
    conversations = (
        sb.table("conversations")
        .select("id, lead_id")
        .eq("campaign_id", campaign_id)
        .eq("status", "pending")
        .order("created_at")
        .execute()
    )

    if not conversations.data:
        logger.info("Nenhuma conversa pendente nesta campanha")
        return metrics

    for conv in conversations.data:
        # Verificar horário comercial
        if not is_business_hours():
            logger.info("Fora do horário comercial, parando envios")
            break

        # Obter chip disponível (filtrado por tenant)
        chip = get_available_chip(tenant_id)
        if not chip:
            logger.warning("Nenhum chip disponível, parando envios")
            metrics["limit_reached"] = True
            break

        # Associar chip à conversa
        sb.table("conversations").update({"chip_id": chip["id"]}).eq(
            "id", conv["id"]
        ).execute()

        # Enviar mensagem
        try:
            success = await send_first_contact(conv["id"])
            if success:
                metrics["sent"] += 1
            else:
                metrics["errors"] += 1
        except Exception as e:
            logger.error(f"Erro enviando para conversa {conv['id']}: {e}")
            metrics["errors"] += 1

        # Delay humano entre envios
        delay = random.randint(MIN_DELAY, MAX_DELAY)
        logger.info(f"Aguardando {delay}s antes do próximo envio...")
        await asyncio.sleep(delay)

    # Atualizar métricas da campanha
    sb.rpc("update_campaign_metrics", {"p_campaign_id": campaign_id}).execute()

    logger.info(
        f"Execução da campanha: {metrics['sent']} enviados, "
        f"{metrics['errors']} erros"
    )
    return metrics


def get_campaign_stats(campaign_id: str) -> dict:
    """Retorna métricas atualizadas da campanha."""
    sb = get_supabase()

    # Atualizar métricas
    sb.rpc("update_campaign_metrics", {"p_campaign_id": campaign_id}).execute()

    result = sb.table("campaigns").select("*").eq("id", campaign_id).single().execute()
    return result.data or {}
