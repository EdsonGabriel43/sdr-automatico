"""
Teste E2E do SDR WhatsApp (Nexa) — whatsapp-web.js
Verifica conexão, cria lead de teste, e envia primeira mensagem.
"""
import asyncio
import os
import sys
import httpx
from dotenv import load_dotenv

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from execution.agent_nexa import send_first_contact
from supabase import create_client

load_dotenv()

WA_SERVER_URL = os.getenv("WA_SERVER_URL", "http://localhost:3001")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Erro: SUPABASE_URL ou SUPABASE_SERVICE_KEY não definidos no .env")
    sys.exit(1)

sb = create_client(SUPABASE_URL, SUPABASE_KEY)


async def check_whatsapp():
    """Verifica se o wa-server está rodando e conectado."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{WA_SERVER_URL}/status")
            data = resp.json()
            return data
    except httpx.ConnectError:
        return None


async def main():
    print("=" * 55)
    print("  TESTE SDR WHATSAPP (NEXA) — whatsapp-web.js")
    print("=" * 55)
    print(f"WA Server: {WA_SERVER_URL}")
    print()

    # 1. Verificar conexão
    print("--- ETAPA 1: VERIFICAR WHATSAPP ---")
    status = await check_whatsapp()

    if not status:
        print(f"❌ wa-server não está rodando em {WA_SERVER_URL}")
        print("Execute primeiro:")
        print("  cd wa-server && npm start")
        return

    print(f"Status: {status['status']}")

    if status['status'] == 'qr':
        print("⚠️  QR Code pendente! Escaneie no terminal do wa-server")
        print(f"   Ou acesse: {WA_SERVER_URL}/qr")
        print("\nAguardando conexão (30s)...")
        
        for i in range(6):
            await asyncio.sleep(5)
            status = await check_whatsapp()
            if status and status['status'] == 'connected':
                break
            print(f"  ...aguardando ({(i+1)*5}s)")
        
        if not status or status['status'] != 'connected':
            print("❌ WhatsApp não conectou em 30s. Escaneie o QR e tente novamente.")
            return

    if status['status'] != 'connected':
        print(f"❌ WhatsApp não está conectado. Status: {status['status']}")
        return

    print(f"✅ WhatsApp conectado!")
    print(f"   Número: {status.get('number', 'N/A')}")
    print(f"   Nome: {status.get('name', 'N/A')}")

    # 2. Criar Lead de Teste
    print("\n--- ETAPA 2: LEAD DE TESTE ---")
    phone = input("Digite seu número (55 + DDD + número, ex: 5511999999999): ").strip()

    # Remove caracteres não numéricos
    phone = "".join(filter(str.isdigit, phone))
    
    # Auto-fix: se tiver 10 ou 11 dígitos (DDD + número), assume que é BR e adiciona 55
    if len(phone) in [10, 11]:
        print(f"ℹ️ Adicionando DDI 55 ao número: {phone} -> 55{phone}")
        phone = f"55{phone}"

    if len(phone) < 12:
        print(f"❌ Número inválido: {phone}. Use formato DDD + Número (ex: 11999999999)")
        return

    lead_data = {
        "nome": "Tester",
        "empresa": "Empresa Teste Ltda",
        "cnpj": "00.000.000/0001-00",
        "telefone": phone,
        "valor_divida": 150000.00,
        "tipo_divida": "Previdenciaria",
        "cargo": "Socio",
    }

    print(f"Inserindo lead para {phone}...")
    
    # Check manual se existe (workaround para falta de unique constraint)
    existing = sb.table("leads").select("id").eq("telefone", phone).execute()
    
    if existing.data:
        lead_id = existing.data[0]["id"]
        print(f"🔄 Lead já existe (ID: {lead_id}). Atualizando...")
        sb.table("leads").update(lead_data).eq("id", lead_id).execute()
    else:
        print("🆕 Criando novo lead...")
        lead_res = sb.table("leads").insert(lead_data).execute()
        if not lead_res.data:
            print("Erro ao inserir lead.")
            return
        lead_id = lead_res.data[0]["id"]

    # 3. Registrar chip (wa-server)
    instance_name = "wa-server"
    chip_res = sb.table("chips").select("id").eq("instance_name", instance_name).execute()
    if not chip_res.data:
        chip_res = sb.table("chips").insert({
            "instance_name": instance_name,
            "phone_number": status.get('number', 'unknown'),
            "status": "active",
            "warming_day": 5,
            "daily_limit": 100,
        }).execute()
    chip_id = chip_res.data[0]["id"]

    # 4. Criar ou reutilizar conversa
    existing_conv = (
        sb.table("conversations")
        .select("id, status")
        .eq("lead_id", lead_id)
        .eq("chip_id", chip_id)
        .in_("status", ["pending", "contacted"])
        .limit(1)
        .execute()
    )
    
    if existing_conv.data:
        conversation_id = existing_conv.data[0]["id"]
        print(f"🔄 Conversa existente reutilizada: {conversation_id}")
        # Reset para re-teste
        sb.table("conversations").update({
            "status": "pending",
            "current_step": 1,
        }).eq("id", conversation_id).execute()
    else:
        conv_res = sb.table("conversations").insert({
            "lead_id": lead_id,
            "chip_id": chip_id,
            "status": "pending",
            "current_step": 1,
        }).execute()
        conversation_id = conv_res.data[0]["id"]
        print(f"🆕 Conversa criada: {conversation_id}")

    # 5. Disparar mensagem
    print("\n--- ETAPA 3: ENVIANDO MENSAGEM ---")
    success = await send_first_contact(conversation_id)

    if success:
        print(f"\n✅ MENSAGEM ENVIADA! Verifique seu WhatsApp ({phone}).")
    else:
        print("\n❌ Falha ao enviar mensagem.")


if __name__ == "__main__":
    asyncio.run(main())
