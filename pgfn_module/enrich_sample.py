import pandas as pd
import requests
import time
import os
from datetime import datetime

# Configurações
INPUT_FILE = "alvos_prioritarios.csv"
OUTPUT_FILE = "amostra_socios_top10.csv"
API_URL = "https://brasilapi.com.br/api/cnpj/v1/{}"

def get_partners(cnpj):
    try:
        # Limpeza do CNPJ
        cnpj_clean = str(cnpj).replace('.', '').replace('/', '').replace('-', '').strip()
        if cnpj_clean.endswith('.0'): cnpj_clean = cnpj_clean[:-2]
        cnpj_clean = cnpj_clean.zfill(14)

        print(f"   🔎 Consultando CNPJ: {cnpj_clean}...", end="\r")
        response = requests.get(API_URL.format(cnpj_clean), timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            qsa = data.get('qsa', [])
            email = data.get('email', '')
            
            socios = []
            for socio in qsa:
                nome = socio.get('nome_socio')
                qual = socio.get('qualificacao_socio')
                socios.append(f"{nome} ({qual})")
            
            print(f"   ✅ Encontrado: {len(socios)} sócios. ", end="\r")
            return "; ".join(socios), email
        elif response.status_code == 429:
            print(f"   ⚠️ Rate Limit. Pausando 5s...       ")
            time.sleep(5)
            return get_partners(cnpj)
        elif response.status_code == 404:
             print(f"   ❌ CNPJ não encontrado na API.       ")
             return "CNPJ Não Encontrado", None
        else:
            print(f"   ⚠️ Erro API: {response.status_code}           ")
            return None, None
            
    except Exception as e:
        print(f"   ❌ Erro de requisição: {e}            ")
        return None, None

def enrich_sample():
    base_dir = os.path.join(os.path.dirname(__file__))
    input_path = os.path.join(base_dir, INPUT_FILE)
    
    if not os.path.exists(input_path):
        print("Arquivo de alvos não encontrado.")
        return

    print("⏳ Carregando Top 10 maiores devedores...")
    # Ler CSV, ordenar por valor decrescente e pegar top 10
    df = pd.read_csv(input_path, sep=';', encoding='utf-8-sig')
    
    # Garantir que VALOR é numérico para ordenar
    if df['VALOR_CONSOLIDADO'].dtype == object:
         df['VALOR_CONSOLIDADO'] = pd.to_numeric(df['VALOR_CONSOLIDADO'], errors='coerce')
    
    # Pegar as 10 maiores dívidas
    top_10 = df.nlargest(10, 'VALOR_CONSOLIDADO').copy()
    
    print(f"🚀 Iniciando enriquecimento de {len(top_10)} empresas...")
    
    socios_list = []
    emails_list = []

    for index, row in top_10.iterrows():
        socios, email = get_partners(row['CNPJ_CPF'])
        socios_list.append(socios)
        emails_list.append(email)
        # Respeitar rate limit da API Free
        time.sleep(1) 

    top_10['SOCIOS'] = socios_list
    top_10['EMAIL_RECEITA'] = emails_list
    
    output_path = os.path.join(base_dir, OUTPUT_FILE)
    top_10.to_csv(output_path, index=False, sep=';', encoding='utf-8-sig')
    
    print(f"\n\n🏁 Amostra gerada com sucesso: {OUTPUT_FILE}")
    print(top_10[['NOME_DEVEDOR', 'VALOR_CONSOLIDADO', 'SOCIOS']].to_string())

if __name__ == "__main__":
    enrich_sample()
