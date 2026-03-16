import asyncio
import os
import sys
import httpx
import webbrowser
import base64
from dotenv import load_dotenv

# Carrega variáveis
load_dotenv()
EVOLUTION_API_URL = "http://localhost:8080"
EVOLUTION_API_KEY = os.getenv("EVOLUTION_API_KEY", "")

headers = {
    "apikey": EVOLUTION_API_KEY,
    "Content-Type": "application/json"
}

INSTANCE_NAME = "nexa_final"

async def force_qr_generation():
    print(f"=== OPERAÇÃO FORÇAR QR CODE: {INSTANCE_NAME} ===")
    
    async with httpx.AsyncClient(timeout=60) as client:
        # 1. Tentar deletar se existir (Limpeza)
        print("1. Limpando instâncias antigas...")
        try:
            await client.delete(f"{EVOLUTION_API_URL}/instance/delete/{INSTANCE_NAME}", headers=headers)
        except:
            pass
        
        # 2. Criar Nova Instância
        print("2. Criando nova instância...")
        try:
            create_payload = {
                "instanceName": INSTANCE_NAME,
                "integration": "WHATSAPP-BAILEYS",
                "qrcode": True
            }
            resp = await client.post(f"{EVOLUTION_API_URL}/instance/create", json=create_payload, headers=headers)
            if resp.status_code == 201 or resp.status_code == 200:
                print("   ✅ Instância criada!")
            else:
                print(f"   ❌ Erro ao criar: {resp.text}")
                return
        except Exception as e:
            print(f"   ❌ Erro fatal ao criar: {e}")
            return

        # 3. Loop para buscar QR Code (tentar por 60 segundos)
        print("3. Buscando QR Code (pode levar até 60s)...")
        print("   Aguardando o motor do WhatsApp iniciar...")
        
        qr_base64 = None
        
        for i in range(20): # 20 tentativas de 3 segundos
            try:
                # Endpoint de connect retorna o QR
                resp = await client.get(f"{EVOLUTION_API_URL}/instance/connect/{INSTANCE_NAME}", headers=headers)
                data = resp.json()
                
                # Tentar extrair base64 de vários lugares possíveis (mudam conforme versão)
                kb64 = data.get("qrcode", {}).get("base64") # v2 padrão
                kcode = data.get("base64") # v1 ou variações
                
                if kb64:
                    qr_base64 = kb64
                    break
                
                if kcode:
                    qr_base64 = kcode
                    break
                
                # Se retornou count:0 ou vazio, espera
                sys.stdout.write(".")
                sys.stdout.flush()
                await asyncio.sleep(3)
                
            except Exception as e:
                print(f"E({i})", end=" ")
                await asyncio.sleep(2)
        
        if qr_base64:
            print("\n\n✅ QR CODE CAPTURADO COM SUCESSO!")
            
            # 4. Gerar HTML
            html_content = f"""
            <html>
            <head><title>Conexão WhatsApp NEXA</title></head>
            <body style="background-color: #111; color: white; text-align: center; font-family: sans-serif; padding-top: 50px;">
                <h1>Escaneie agora para conectar</h1>
                <p>Nexa SDR Automation</p>
                <div style="background: white; padding: 20px; display: inline-block;">
                    <img src="{qr_base64}" width="300" />
                </div>
                <p>Instância: {INSTANCE_NAME}</p>
            </body>
            </html>
            """
            
            with open("qrcode_final.html", "w", encoding="utf-8") as f:
                f.write(html_content)
                
            print("5. Abrindo arquivo no navegador...")
            try:
                webbrowser.open("file://" + os.path.realpath("qrcode_final.html"))
            except:
                print("   ⚠️ Não foi possível abrir automaticamente.")
                print("   👉 Abra o arquivo 'qrcode_final.html' na pasta manualmente.")
                
        else:
            print("\n❌ Não foi possível obter o QR Code após 60 segundos.")
            print("Diagnóstico:")
            print("1. Docker pode estar sem internet (DNS).")
            print("2. Evolution API pode estar travada no boot.")

if __name__ == "__main__":
    asyncio.run(force_qr_generation())
