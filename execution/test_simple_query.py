import sys
import os

# Ajusta path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from execution.tool_google_search import search_google

# Queries Exatas do Debug
QUERIES = [
    'site:linkedin.com/in "Personal Trainer" São Paulo',
    'site:instagram.com "Personal Trainer" São Paulo',
    'site:tiktok.com "Personal Trainer" São Paulo'
]

print(f"--- Testando Queries em Lote (num=100) ---")

for q in QUERIES:
    print(f"\n>> Query: {q}")
    results = search_google(q, country_code="br", num_results=100)
    print(f"   Encontrados [RAW]: {len(results)}")
    if results:
        print(f"   Primeiro: {results[0].get('title', 'N/A')}")
