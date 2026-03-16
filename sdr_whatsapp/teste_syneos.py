"""
Teste de Campanha com 5 Contatos SYNEOS
----------------------------------------
Modo correto:
1. Cria OU reutiliza a campanha "Teste_SYNEOS_FINAL"
2. Garante que os 5 leads existem no banco
3. Vincula os leads à campanha (conversas pending)
4. Dispara /campaigns/start na VPS
"""
import os
import sys
import requests
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
sb = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_KEY"))
VPS = os.getenv("VPS_HOST", "187.77.48.57")
CAMPAIGN_NAME = "Teste_SYNEOS_FINAL"

CONTATOS = [
    {"nome": "Willian", "telefone": "5541999009528", "empresa": "Syneos Consultoria"},
    {"nome": "Alline",  "telefone": "5541995779399", "empresa": "Syneos Consultoria"},
    {"nome": "Leandro", "telefone": "5541998130244", "empresa": "Syneos Consultoria"},
    {"nome": "Andre",   "telefone": "5541999662030", "empresa": "Syneos Consultoria"},
    {"nome": "Edson",   "telefone": "5512997717152", "empresa": "Syneos Consultoria"},
]

print(f"\n{'='*55}\n  DISPARO DE TESTE - SYNEOS (5 contatos)\n{'='*55}")

# ── 1. CHIP ───────────────────────────────────────────────
print("\n[1/5] Verificando chip ativo...")
chip_res = sb.table("chips").select("id, phone_number, messages_sent_today, daily_limit, status").eq("status", "active").limit(1).execute()
if not chip_res.data:
    print("  ❌ ERRO: Nenhum chip com status 'active' encontrado.")
    print("  Vá no SDR Hub > Configurações e ative um chip.")
    sys.exit(1)
chip = chip_res.data[0]
restante = chip["daily_limit"] - chip["messages_sent_today"]
print(f"  ✅ Chip ativo: {chip['phone_number']} | Capacidade restante hoje: {restante}")
if restante < len(CONTATOS):
    print(f"  ⚠️  Chip tem capacidade para {restante} mensagens mas temos {len(CONTATOS)} contatos.")

# ── 2. LEADS ──────────────────────────────────────────────
print("\n[2/5] Verificando/inserindo leads no banco...")
lead_ids = []
for c in CONTATOS:
    res = sb.table("leads").select("id").eq("telefone", c["telefone"]).execute()
    if res.data:
        lead_id = res.data[0]["id"]
        sb.table("leads").update({"nome": c["nome"], "empresa": c["empresa"]}).eq("id", lead_id).execute()
        print(f"  ↺  Atualizado: {c['nome']} ({c['telefone']})")
    else:
        ins = sb.table("leads").insert({
            "nome": c["nome"], "telefone": c["telefone"],
            "empresa": c["empresa"], "fonte": "teste_direto", "valor_divida": 0
        }).execute()
        lead_id = ins.data[0]["id"]
        print(f"  +  Inserido: {c['nome']} ({c['telefone']})")
    lead_ids.append(lead_id)

# ── 3. CAMPANHA ───────────────────────────────────────────
print("\n[3/5] Criando campanha de teste...")
# Sempre cria nova campanha para ter conversas pendentes novas
camp_res = sb.table("campaigns").insert({
    "name": CAMPAIGN_NAME,
    "description": "Teste dos 5 decisores Syneos",
    "status": "draft",
    "chip_id": chip["id"]
}).execute()
campaign_id = camp_res.data[0]["id"]
print(f"  ✅ Campanha criada! ID: {campaign_id}")

# ── 4. CONVERSAS ──────────────────────────────────────────
print("\n[4/5] Vinculando os 5 leads à campanha...")
for lead_id in lead_ids:
    sb.table("conversations").insert({
        "lead_id": lead_id,
        "campaign_id": campaign_id,
        "chip_id": chip["id"],
        "status": "pending",
        "current_step": 1
    }).execute()
print(f"  ✅ {len(lead_ids)} conversas criadas no status 'pending'")

# ── 5. DISPARO ────────────────────────────────────────────
print(f"\n[5/5] Disparando campanha na VPS ({VPS})...")
try:
    url = f"http://{VPS}:5000/campaigns/start"
    resp = requests.post(url, json={"campaign_id": campaign_id}, timeout=15)
    print(f"  HTTP {resp.status_code}: {resp.text[:200]}")
    if resp.status_code == 200:
        print("\n" + "="*55)
        print("  ✅ CAMPANHA DISPARADA COM SUCESSO!")
        print("="*55)
        print(f"  → Campaign ID: {campaign_id}")
        print(f"  → Acompanhe: https://sdr-hub.vercel.app/campaigns")
    else:
        print(f"\n  ❌ VPS retornou erro {resp.status_code}")
except Exception as e:
    print(f"\n  ❌ Falha de conexão com a VPS: {e}")
