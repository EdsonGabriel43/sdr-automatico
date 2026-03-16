import requests
import json

url = "http://localhost:8000/agent/search"

payload = {
    "query": "Encontre CEOs e Diretores de Tecnologia de empresas de Fintech em São Paulo que estejam contratando ou expandindo",
    "mode": "agentic"
}

try:
    print(f"Enviando pedido para o Agente: {payload['query']}")
    response = requests.post(url, json=payload)
    
    if response.status_code == 200:
        print("\n✅ Sucesso! Resposta do Agente:")
        print(json.dumps(response.json(), indent=2, ensure_ascii=False))
    else:
        print(f"\n❌ Erro: {response.status_code}")
        print(response.text)
except Exception as e:
    print(f"\n❌ Falha na conexão: {e}")
