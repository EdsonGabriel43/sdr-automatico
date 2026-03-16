import requests
import json
import sys

# URL do servidor Local
URL = "http://localhost:8000/agent/search"

def test_agent():
    print("\n💡 --- TESTE DO AGENTE SDR INTELIGENTE --- 💡")
    print("O servidor está rodando. Digite o que você procura em linguagem natural.")
    print("Exemplo: 'Encontre diretores de marketing de empresas de varejo em SP'")
    print("Digite 'sair' para encerrar.\n")

    while True:
        try:
            user_input = input("🔎 O que você busca? > ")
            
            if user_input.lower() in ['sair', 'exit', 'quit']:
                break
                
            if not user_input.strip():
                continue

            print(f"\n🧠 Agente pensando (consultando GPT-4o)...")
            
            response = requests.post(URL, json={"query": user_input, "mode": "agentic"})
            
            if response.status_code == 200:
                data = response.json()
                print("\n✅ Resposta do Agente:")
                print(json.dumps(data, indent=2, ensure_ascii=False))
                print("\n" + "="*50 + "\n")
            else:
                print(f"❌ Erro na API: {response.status_code} - {response.text}")
                
        except KeyboardInterrupt:
            print("\nEncerrando teste.")
            break
        except Exception as e:
            print(f"❌ Erro de conexão: {e}")
            print("Certifique-se de que o servidor 'backend/main.py' está rodando.")
            break

if __name__ == "__main__":
    test_agent()
