import pandas as pd
import requests
import os
import time

INPUT_FILE = "alvos_prioritarios.csv"
OUTPUT_FILE = "alvos_com_socios.csv"
API_URL = "https://brasilapi.com.br/api/cnpj/v1/{}"

def get_partners(cnpj):
    try:
        # BrasilAPI aceita CNPJ com ou sem formatação, vamos limpar
        cnpj_clean = str(cnpj).replace('.', '').replace('/', '').replace('-', '').strip()
        # Se vier com .0 no final (pandas float), remove
        if cnpj_clean.endswith('.0'): cnpj_clean = cnpj_clean[:-2]
        
        # Padding com zeros à esquerda se necessário (14 dígitos)
        cnpj_clean = cnpj_clean.zfill(14)

        print(f"   🔎 Consultando CNPJ: {cnpj_clean}...")
        response = requests.get(API_URL.format(cnpj_clean), timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            qsa = data.get('qsa', [])
            email = data.get('email', '')
            
            socios = []
            for socio in qsa:
                # Priorizar Sócios-Administradores
                nome = socio.get('nome_socio')
                qual = socio.get('qualificacao_socio')
                socios.append(f"{nome} ({qual})")
            
            return "; ".join(socios), email
        elif response.status_code == 429:
            print("   ⚠️ Rate Limit atingido. Pausando 10s...")
            time.sleep(10)
            return get_partners(cnpj) # Tenta de novo
        else:
            print(f"   ⚠️ Erro API: {response.status_code}")
            return None, None
            
    except Exception as e:
        print(f"   ❌ Erro de requisição: {e}")
        return None, None

def main():
    input_path = os.path.join(os.path.dirname(__file__), INPUT_FILE)
    output_path = os.path.join(os.path.dirname(__file__), OUTPUT_FILE)

    if not os.path.exists(input_path):
        print(f"❌ Arquivo '{INPUT_FILE}' não encontrado.")
        print("Rode primeiro: python pgfn_module/ingest_pgfn.py")
        return

    df = pd.read_csv(input_path, sep=';', encoding='utf-8-sig')
    
    # Criar colunas novas
    if 'SOCIOS_QSA' not in df.columns:
        df['SOCIOS_QSA'] = None
    if 'EMAIL_RECEITA' not in df.columns:
        df['EMAIL_RECEITA'] = None

    print(f"🚀 Iniciando enriquecimento de {len(df)} empresas...")
    
    # Vamos processar linha a linha e salvar a cada X para não perder tudo
    for index, row in df.iterrows():
        # Se já tiver preenchido, pula (para permitir resume)
        if pd.notna(row['SOCIOS_QSA']) and row['SOCIOS_QSA'] != "":
            continue
            
        socios, email = get_partners(row['CNPJ_CPF'])
        
        df.at[index, 'SOCIOS_QSA'] = socios
        df.at[index, 'EMAIL_RECEITA'] = email
        
        # Salva parcial a cada 10 requisições
        if index % 10 == 0:
            df.to_csv(output_path, index=False, sep=';', encoding='utf-8-sig')
            
        # Respeitar rate limit da API pública (não abusar)
        time.sleep(0.5)

    # Salva final
    df.to_csv(output_path, index=False, sep=';', encoding='utf-8-sig')
    print(f"\n✅ Enriquecimento concluído! Arquivo salvo em: {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
