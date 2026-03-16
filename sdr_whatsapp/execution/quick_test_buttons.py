"""
Teste rápido: Reseta TUDO (blocklist + conversa) e envia primeira mensagem.
Uso: python execution/quick_test_buttons.py
"""
import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv

load_dotenv()

from supabase import create_client
from execution.agent_nexa import send_first_contact

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
sb = create_client(SUPABASE_URL, SUPABASE_KEY)

PHONE = "5512997717152"


async def main():
    print(f"🔄 Preparando teste para {PHONE}...")

    # 1. Buscar lead
    lead = sb.table("leads").select("id, nome").eq("telefone", PHONE).execute()
    if not lead.data:
        print("❌ Lead não encontrado. Execute test_lead.py primeiro.")
        return
    lead_id = lead.data[0]["id"]
    lead_nome = lead.data[0]["nome"]
    print(f"✅ Lead: {lead_nome} ({lead_id})")

    # 2. Buscar chip
    chip = sb.table("chips").select("id").eq("instance_name", "wa-server").execute()
    if not chip.data:
        print("❌ Chip wa-server não encontrado.")
        return
    chip_id = chip.data[0]["id"]

    # 3. LIMPAR BLOCKLIST (caso o número tenha sido bloqueado em teste anterior)
    try:
        sb.table("blocklist").delete().eq("phone_number", PHONE).execute()
        print("🔓 Blocklist limpa")
    except Exception as e:
        print(f"⚠️ Blocklist: {e}")

    # 4. Marcar conversas antigas como encerradas
    sb.table("conversations").update(
        {"status": "no_response"}
    ).eq("lead_id", lead_id).execute()
    print("🗑️ Conversas anteriores encerradas")

    # 5. Criar conversa nova limpa
    conv = sb.table("conversations").insert({
        "lead_id": lead_id,
        "chip_id": chip_id,
        "status": "pending",
        "current_step": 1,
    }).execute()
    conv_id = conv.data[0]["id"]
    print(f"🆕 Nova conversa: {conv_id}")

    # 6. Disparar primeira mensagem
    print("\n📤 Enviando primeira mensagem...")
    success = await send_first_contact(conv_id)

    if success:
        print(f"\n✅ MENSAGEM ENVIADA! Verifique o WhatsApp de {PHONE}")
        print("   Opções:")
        print("   *1* - Sim, sou eu")
        print("   *2* - Não sou eu")
        print("   *3* - Bloquear contato")
    else:
        print("\n❌ Falha ao enviar mensagem.")


if __name__ == "__main__":
    asyncio.run(main())
