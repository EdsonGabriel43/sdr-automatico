from execution.tool_google_search import run_prospecting
import sys
import requests
import time

def main():
    print("=============================================")
    print("      SDR AUTOMÁTICO (Agente Inteligente)    ")
    print("=============================================")
    
    print("\n💡 Digite o que você procura em linguagem natural.")
    print("Ex: 'Encontre diretores de marketing de empresas de tecnologia no Brasil'")
    print("Ex: 'Personal trainers em São Paulo'")
    
    while True:
        try:
            agent_query = input("\n🔎 O que você busca? (ou 'sair'): ").strip()
            
            if agent_query.lower() in ['sair', 'exit', 'q']:
                print("Encerrando...")
                break
                
            if not agent_query:
                continue
            
            print("\n🧠 O Agente está analisando seu pedido e criando a estratégia de busca...")
            
            # Chama o Backend Agêntico
            try:
                response = requests.post("http://localhost:8000/agent/search", json={"query": agent_query})
                
                if response.status_code == 200:
                    data = response.json()
                    queries = data.get("data", {}).get("queries", [])
                    
                    if queries:
                        print(f"\n🤖 Estratégia definida: {len(queries)} buscas serão executadas no Google.")
                        for i, q in enumerate(queries):
                            print(f"   {i+1}. {q}")
                        
                        confirm = input("\nAutoriza a execução? (S/n): ").strip().lower()
                        if confirm not in ['n', 'nao', 'no']:
                            # Executa a busca com as queries do agente
                            # Importação tardia para evitar erro circular se houver
                            from execution.tool_google_search import run_agent_queries
                            filepath = run_agent_queries(agent_query, queries, country="br")
                            
                            if filepath:
                                    print("\n" + "="*40 + f"\n✅ SUCESSO! Leads salvos em: {filepath}\n" + "="*40 + "\n")
                            else:
                                print("\n⚠️ Nenhum lead novo encontrado nesta busca.")
                        else:
                            print("\nBusca cancelada.")
                    else:
                        print("\n⚠️ A IA não conseguiu gerar queries para esse pedido. Tente ser mais específico.")
                else:
                    print(f"\n❌ Erro no servidor do agente (Status {response.status_code}): {response.text}")
                    print("Certifique-se de que o backend está rodando em outro terminal: 'python backend/main.py'")
                    
            except requests.exceptions.ConnectionError:
                print("\n❌ Erro: Não foi possível conectar ao céruro do agente.")
                print("DICA: O servidor backend parece estar desligado.")
                print("Por favor, abra outro terminal e rode: python backend/main.py")
            except Exception as e:
                print(f"\n❌ Erro inesperado: {e}")

        except KeyboardInterrupt:
            print("\nOperação cancelada.")
            break

if __name__ == "__main__":
    main()
