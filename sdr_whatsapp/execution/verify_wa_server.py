import requests
import time
import json

WA_SERVER_URL = "http://localhost:3001"
TARGET_NUMBER = "5512997717152" # Sem @c.us, o server trata
MESSAGE = "Olá! Teste de verificação do SDR Hub + Realtime. Responda algo para testar o retorno."

def check_status():
    try:
        print(f"Checando status em {WA_SERVER_URL}/status...")
        response = requests.get(f"{WA_SERVER_URL}/status", timeout=5)
        print(f"Status Code: {response.status_code}")
        print(f"Response: {response.text}")
        return response.status_code == 200
    except Exception as e:
        print(f"Erro ao conectar no WA Server: {e}")
        return False

def send_message():
    try:
        print(f"Enviando mensagem para {TARGET_NUMBER}...")
        payload = {
            "phone": TARGET_NUMBER,
            "text": MESSAGE
        }
        headers = {'Content-Type': 'application/json'}
        response = requests.post(f"{WA_SERVER_URL}/send/text", json=payload, headers=headers, timeout=10)
        print(f"Envio Status Code: {response.status_code}")
        print(f"Envio Response: {response.text}")
    except Exception as e:
        print(f"Erro ao enviar mensagem: {e}")

if __name__ == "__main__":
    if check_status():
        time.sleep(1)
        send_message()
    else:
        print("WA Server não parece estar rodando ou autenticado na porta 3001.")
