import requests
import json
import sys
import os

# Ajusta path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from execution.tool_google_search import search_google

API_URL = "http://localhost:8000/agent/search"
TARGET_PERSON = "Edson Gabriel dos Santos"

print(f"--- Teste de Investigação: '{TARGET_PERSON}' ---")

try:
    # 1. Obter Queries do Agente
    print("1. Consultando Agente...")
    response = requests.post(API_URL, json={"query": TARGET_PERSON})
    response.raise_for_status()
    data = response.json()
    
    queries = data.get("data", {}).get("queries", [])
    if not queries:
        print("❌ Nenhuma query gerada.")
        sys.exit(1)
        
    print(f"ℹ️ Queries Geradas:")
    with open("person_queries_debug.txt", "w", encoding="utf-8") as f:
        for q in queries:
            print(f"   - {q}")
            f.write(q + "\n")

    # 2. Testar Primeira Query no Google
    first_query = queries[0]
    print(f"\n2. Testando primeira query no Serper: {first_query}")
    
    # Executa busca REAL
    results = search_google(first_query, country_code="br", num_results=10)
    
    print(f"🔍 Encontrados: {len(results)}")
    for item in results[:5]:
        print(f"   - [{item.get('title')}] ({item.get('link')})")

except Exception as e:
    print(f"❌ Erro: {e}")
