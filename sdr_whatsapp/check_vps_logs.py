"""Enviar mensagem de teste direto pelo wa-server na VPS."""
import os, requests
from dotenv import load_dotenv
from supabase import create_client
load_dotenv()

sb = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_KEY"))

# Template real: first_contact > text
# "{greeting}, {nome}! Aqui é a Nexa, da SYNEOS Consultoria..."
# Substituir as variáveis
import random
hour = 12  # agora sao 12h
greeting = "Bom dia" if hour < 12 else "Boa tarde" if hour < 18 else "Boa noite"

# Pegar o template real
r = requests.get("http://187.77.48.57:5000/settings/templates", timeout=10)
templates = r.json()
msg_template = templates.get("messages", {}).get("first_contact", {}).get("text", "")
print(f"Template bruto:\n{msg_template}\n")

# Substituir variáveis
msg = msg_template.replace("{greeting}", greeting).replace("{nome}", "Edson").replace("{empresa}", "CFA Performance")
print(f"Mensagem final:\n{msg}\n")

# Enviar via wa-server
print("=== ENVIANDO ===")
r2 = requests.post("http://187.77.48.57:3001/send/text", json={
    "phone": "5512997717152",
    "text": msg
}, timeout=15)
print(f"Status: {r2.status_code}")
print(f"Resposta: {r2.text}")

if r2.status_code == 200:
    conv_id = "dfea1a12-b44c-4a89-a624-21a2f25be215"
    sb.table("messages").insert({
        "conversation_id": conv_id,
        "direction": "outbound",
        "content": msg,
        "message_type": "first_contact",
        "status": "sent"
    }).execute()
    sb.table("conversations").update({"status": "contacted"}).eq("id", conv_id).execute()
    print("\nSUCESSO! Mensagem enviada e registrada!")
