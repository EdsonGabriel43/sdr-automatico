import requests
import json
import sys
import os

# Ajusta path para importar modules do pai
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from execution.tool_google_search import run_agent_queries

API_URL = "http://localhost:8000/agent/search"
USER_PROMPT = "Encontre personal trainers em São Paulo"

print(f"--- 1. CÉREBRO: Enviando pedido ao Agente: '{USER_PROMPT}' ---")

try:
    response = requests.post(API_URL, json={"query": USER_PROMPT})
    response.raise_for_status()
    data = response.json()
    
    print("   > Resposta do Agente recebida!")
    queries_data = data.get("data", {})
    queries = queries_data.get("queries", [])
    
    if not queries:
        print("[X] ERRO: Nenhuma query retornada pelo Agente.")
        print(json.dumps(data, indent=2))
        sys.exit(1)
        
    print(f"   > Queries Geradas ({len(queries)}):")
    with open("queries_debug.txt", "w", encoding="utf-8") as f_debug:
        for q in queries:
            print(f"     - {q}")
            f_debug.write(q + "\n")
        
    print("\n--- 2. CORPO: Executando Scraping ---")
    filepath = run_agent_queries(USER_PROMPT, queries, country="br")
    
    if filepath:
        print(f"\n[OK] SUCESSO TOTAL! Arquivo final: {filepath}")
        with open(filepath, "r", encoding="utf-8") as f:
            print("Preview:")
            print(f.read()[:500])
    else:
        print("\n[!] AVISO: Nenhum lead salvo (mas o fluxo rodou).")

except Exception as e:
    print(f"[X] ERRO FATAL: {e}")
    if 'response' in locals():
        print(response.text)
