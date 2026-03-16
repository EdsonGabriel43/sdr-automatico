import sys
import os
import requests
import json

# Backend URL
API_URL = "http://localhost:8000/agent/search"

# Ajusta path para importar modules
try:
    from execution.tool_google_search import run_agent_queries
except ImportError:
    # Caso rode de dentro de execution, volta um nível
    sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
    from execution.tool_google_search import run_agent_queries

def main():
    print("=== SDR AUTOMÁTICO: MULTI-NETWORKS SCRAPER ===")
    print("Este robô utiliza IA para gerar buscas no Google, LinkedIn, Instagram, TikTok e Twitter.")
    
    while True:
        # 1. Obter input do usuário
        user_prompt = input("\n> O que você deseja prospectar? (Ou digite 'sair' para encerrar): ").strip()
        
        if not user_prompt:
            continue
            
        if user_prompt.lower() in ["sair", "exit", "quit"]:
            print("Encerrando... Até mais! 👋")
            break

        print(f"\n[1/3] 🧠 CÉREBRO: Consultando o Agente IA para criar estratégia...")
        
        try:
            # 2. Chamar Backend
            response = requests.post(API_URL, json={"query": user_prompt})
            response.raise_for_status()
            data = response.json()
            
            queries = data.get("data", {}).get("queries", [])
            if not queries:
                print("❌ Erro: O Agente não gerou nenhuma query. Tente ser mais específico.")
                continue
                
            print(f"✅ Estratégia Definida! {len(queries)} buscas geradas:")
            for q in queries:
                print(f"   - {q}")
                
            # 3. Executar Scraping
            print(f"\n[2/3] 🦾 CORPO: Iniciando varredura na web & Deep Scraping...")
            print("(Isso pode levar alguns segundos por query...)")
            
            filepath = run_agent_queries(user_prompt, queries, country="br")
            
            # 4. Resultado
            if filepath:
                print(f"\n[3/3] 🏁 CONCLUÍDO!")
                print(f"📁 Arquivo salvo em: {filepath}")
                print("\nVocê pode abrir este arquivo no Excel.")
            else:
                print("\n⚠️ Nenhum lead encontrado. Tente mudar os termos da busca.")
                
        except requests.exceptions.ConnectionError:
            print("\n❌ ERRO: Não foi possível conectar ao Backend (Cérebro).")
            print("Verifique se você rodou 'python backend/main.py' em outro terminal.")
            break
        except Exception as e:
            print(f"\n❌ ERRO FATAL: {e}")
            
        print("\n" + "="*50)

if __name__ == "__main__":
    main()
