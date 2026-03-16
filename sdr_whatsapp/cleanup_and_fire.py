"""
Limpeza de campanhas sem chip + disparo da campanha teste.
"""
import os
import sys
import requests
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
sb = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_KEY"))
VPS = os.getenv("VPS_HOST", "187.77.48.57")

print("\n" + "="*55)
print("  LIMPEZA E DISPARO — Teste_Syneos_4_Contatos")
print("="*55)

# ── 1. ENCONTRAR CAMPANHAS SEM CHIP ──────────────────────
print("\n[1/4] Identificando campanhas com conversas sem chip...")

camps = sb.table("campaigns").select("id, name, status").ilike("name", "%Teste_Syneos%").execute().data
print(f"  Campanhas encontradas: {len(camps)}")

to_delete = []
to_keep = []

for c in camps:
    convs = sb.table("conversations").select("id, chip_id").eq("campaign_id", c["id"]).execute().data
    sem_chip = [cv for cv in convs if not cv.get("chip_id")]
    com_chip = [cv for cv in convs if cv.get("chip_id")]
    print(f"  [{c['status']}] {c['name'][:40]} | id={c['id'][:8]}... | sem_chip={len(sem_chip)} | com_chip={len(com_chip)}")

    if convs and all(not cv.get("chip_id") for cv in convs):
        to_delete.append(c)
    else:
        to_keep.append(c)

# ── 2. DELETAR CAMPANHAS SEM CHIP ────────────────────────
if to_delete:
    print(f"\n[2/4] Deletando {len(to_delete)} campanha(s) sem chip...")
    for c in to_delete:
        # Primeiro deleta conversas
        del_convs = sb.table("conversations").delete().eq("campaign_id", c["id"]).execute()
        # Depois deleta a campanha
        sb.table("campaigns").delete().eq("id", c["id"]).execute()
        print(f"  🗑️  Deletado: {c['name']} (id={c['id'][:8]}...)")
else:
    print("\n[2/4] Nenhuma campanha para deletar.")

# ── 3. MOSTRAR CAMPANHAS RESTANTES ───────────────────────
print(f"\n[3/4] Campanhas Teste_Syneos restantes ({len(to_keep)}):")
if not to_keep:
    print("  ❌ Nenhuma campanha restante! Execute teste_syneos.py para criar uma nova.")
    sys.exit(1)

# Pegar a mais recente com conversas pending
target_campaign = None
for c in to_keep:
    convs_pending = sb.table("conversations").select("id, chip_id, status, leads(nome, telefone)") \
        .eq("campaign_id", c["id"]).eq("status", "pending").execute().data
    print(f"  [{c['status']}] {c['name'][:40]} | id={c['id'][:8]}... | pending={len(convs_pending)}")
    for cv in convs_pending:
        lead = cv.get("leads", {})
        print(f"    - {lead.get('nome','?')} ({lead.get('telefone','?')})")
    if convs_pending and not target_campaign:
        target_campaign = c

# ── 4. DISPARAR NA VPS ───────────────────────────────────
if not target_campaign:
    print("\n[4/4] ⚠️  Nenhuma campanha com conversas pending encontrada.")
    print("  Possível causa: todas as conversas já foram processadas anteriormente.")
    print("  Solução: execute teste_syneos.py para criar campanha nova com os 5 contatos.")
    sys.exit(0)

print(f"\n[4/4] Disparando campanha: {target_campaign['name']} (id={target_campaign['id'][:8]}...)")
try:
    url = f"http://{VPS}:5000/campaigns/start"
    resp = requests.post(url, json={"campaign_id": target_campaign["id"]}, timeout=15)
    print(f"  HTTP {resp.status_code}: {resp.text[:300]}")
    if resp.status_code == 200:
        print("\n" + "="*55)
        print("  ✅ CAMPANHA DISPARADA COM SUCESSO!")
        print("="*55)
        print(f"  → Campaign ID: {target_campaign['id']}")
        print(f"  → Acompanhe: https://sdr-hub.vercel.app/campaigns")
    else:
        print(f"\n  ❌ VPS retornou erro {resp.status_code}")
except Exception as e:
    print(f"\n  ❌ Falha de conexão com VPS ({VPS}:5000): {e}")
