"""Diagnosticar e forçar envio com chip associado."""
import asyncio
import sys
sys.path.insert(0, '.')

from execution.agent_nexa import send_first_contact
from supabase import create_client
import os
from dotenv import load_dotenv
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
sb = create_client(SUPABASE_URL, SUPABASE_KEY)

# 1. Buscar TODOS os leads com esse telefone
print("=== TODOS OS LEADS COM TELEFONE 5512997717152 ===")
leads = sb.table("leads").select("*").eq("telefone", "5512997717152").execute()
for l in leads.data:
    print(f"  ID: {l['id']} | Nome: {l['nome']} | Empresa: {l['empresa']}")

# 2. Atualizar o lead mais recente para ter o nome correto
if leads.data:
    latest_lead = leads.data[-1]
    print(f"\nAtualizando lead {latest_lead['id']} para 'Edson Gabriel' / 'CFA Performance'...")
    sb.table("leads").update({
        "nome": "Edson Gabriel",
        "empresa": "CFA Performance"
    }).eq("id", latest_lead["id"]).execute()

# 3. Buscar chip ativo
print("\n=== CHIP ATIVO ===")
chip = sb.table("chips").select("id, instance_name, status").eq("status", "active").limit(1).execute()
if not chip.data:
    print("NENHUM CHIP ATIVO!")
    sys.exit(1)
chip_id = chip.data[0]["id"]
chip_name = chip.data[0]["instance_name"]
print(f"  Chip: {chip_name} | ID: {chip_id}")

# 4. Buscar conversa mais recente desse lead e associar chip
print("\n=== CONVERSA ===")
conv = (
    sb.table("conversations")
    .select("id, status, chip_id, campaign_id")
    .eq("lead_id", latest_lead["id"])
    .order("created_at", desc=True)
    .limit(1)
    .execute()
)

if not conv.data:
    print("Nenhuma conversa para esse lead!")
    sys.exit(1)

conv_id = conv.data[0]["id"]
print(f"  Conversa: {conv_id} | Status: {conv.data[0]['status']} | Chip atual: {conv.data[0].get('chip_id')}")

# Associar chip à conversa
print(f"  Associando chip {chip_name} à conversa...")
sb.table("conversations").update({"chip_id": chip_id}).eq("id", conv_id).execute()

# 5. Forçar envio
print("\n=== ENVIANDO MENSAGEM ===")
ok = asyncio.run(send_first_contact(conv_id))
print(f"\nResultado: {'SUCESSO! Mensagem enviada ao WhatsApp!' if ok else 'FALHA - Verifique os logs do webhook_server'}")
