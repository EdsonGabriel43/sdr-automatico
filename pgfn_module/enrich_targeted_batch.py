import pandas as pd
import requests
import time
import os

# Configurações de Filtro Adicional
MIN_VAL = 1000000.00  # R$ 1 Milhão
MAX_VAL = 5000000.00  # R$ 5 Milhões
LIMIT_ROWS = 100      # Apenas 100 alvos
INPUT_FILE = "alvos_prioritarios.csv"
OUTPUT_FILE = "lote_prospeccao_1mm_5mm.csv"
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
            return "; ".join(socios), email, "OK"
        elif response.status_code == 429:
            print(f"   ⚠️ Rate Limit (429). Pausando 10s... ", end="\r")
            time.sleep(10)
            return get_partners(cnpj)
        elif response.status_code == 404:
             return None, None, "CNPJ Não Encontrado"
        else:
            return None, None, f"Erro API: {response.status_code}"
            
    except Exception as e:
        return None, None, f"Erro Requisição: {e}"

def run_targeted_batch():
    base_dir = os.path.join(os.path.dirname(__file__))
    input_path = os.path.join(base_dir, INPUT_FILE)
    
    if not os.path.exists(input_path):
        print("❌ Arquivo de alvos não encontrado.")
        return

    print("⏳ Aplicando Filtro Fino (1MM a 5MM)...")
    df = pd.read_csv(input_path, sep=';', encoding='utf-8-sig')
    
    # Garantir numérico
    if df['VALOR_CONSOLIDADO'].dtype == object:
         df['VALOR_CONSOLIDADO'] = pd.to_numeric(df['VALOR_CONSOLIDADO'], errors='coerce')
    
    # FIltrar apenas 1MM a 5MM
    df_filtered = df[
        (df['VALOR_CONSOLIDADO'] >= MIN_VAL) & 
        (df['VALOR_CONSOLIDADO'] <= MAX_VAL)
    ].copy()
    
    print(f"📉 Total nesta faixa: {len(df_filtered)} empresas.")
    
    # Ordenar Decrescente (As 100 maiores desta faixa)
    df_top = df_filtered.nlargest(LIMIT_ROWS, 'VALOR_CONSOLIDADO').copy()
    
    print(f"🚀 Iniciando Enriquecimento dos Top {LIMIT_ROWS} alvos...")
    
    socios_list = []
    emails_list = []
    status_list = []

    count = 0
    total = len(df_top)

    for index, row in df_top.iterrows():
        count += 1
        print(f"[{count}/{total}] Processando: {row['NOME_DEVEDOR'][:30]}...", end="")
        
        socios, email, status = get_partners(row['CNPJ_CPF'])
        
        socios_list.append(socios)
        emails_list.append(email)
        status_list.append(status)
        
        time.sleep(1) # Respeitar API Free
        print("") # Nova linha

    df_top['SOCIOS'] = socios_list
    df_top['EMAIL_RECEITA'] = emails_list
    df_top['STATUS_ENRIQUECIMENTO'] = status_list
    
    # Salvar
    output_path = os.path.join(base_dir, OUTPUT_FILE)
    df_top.to_csv(output_path, index=False, sep=';', encoding='utf-8-sig')
    
    print(f"\n✅ Lote Gerado: {OUTPUT_FILE}")
    print(df_top[['NOME_DEVEDOR', 'VALOR_CONSOLIDADO', 'SOCIOS']].head(5).to_string())

if __name__ == "__main__":
    run_targeted_batch()
