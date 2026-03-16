import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from execution.tool_google_search import run_prospecting
import os

print("--- INICIANDO TESTE INTEGRO DA EXECUÇÃO (BODY) ---")

# Parâmetros de Teste
target = "Marketing Digital"
roles = ["Especialista"]
location = "São Paulo"
mode = "company" # Vai varrer todas as redes definidas em tool_google_search.py

#Executa
filepath = run_prospecting(target, roles, location, mode)

if filepath:
    print(f"✅ SUCESSO! Arquivo gerado: {filepath}")
    with open(filepath, "r", encoding="utf-8") as f:
        print("Preview do conteúdo:")
        print(f.read()[:500])
else:
    print("❌ FALHA: Nenhum arquivo gerado.")
