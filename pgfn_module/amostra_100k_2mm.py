"""Extrai 10 empresas com dívidas entre 100k-2MM, enriquecidas com CNAE."""
import pandas as pd
import requests
import time
import glob
import os

base = os.path.dirname(__file__)
files = glob.glob(os.path.join(base, 'arquivo_lai_SIDA_*.csv'))
found = []

print("⏳ Buscando empresas com dívidas entre R$ 100k e R$ 2MM...")

for f in files:
    print(f"  📂 Lendo {os.path.basename(f)}...")
    for chunk in pd.read_csv(f, sep=';', encoding='latin-1', chunksize=50000, on_bad_lines='skip'):
        chunk.columns = [c.upper().strip() for c in chunk.columns]
        
        if 'TIPO_PESSOA' in chunk.columns:
            chunk = chunk[chunk['TIPO_PESSOA'].astype(str).str.lower().str.contains('jur', na=False)]
        if 'UF_DEVEDOR' in chunk.columns:
            chunk['UF_DEVEDOR'] = chunk['UF_DEVEDOR'].astype(str).str.strip()
            chunk = chunk[chunk['UF_DEVEDOR'] == 'SP']
        if 'RECEITA_PRINCIPAL' in chunk.columns:
            chunk = chunk[chunk['RECEITA_PRINCIPAL'].astype(str).str.contains('Receita', case=False, na=False)]
        if 'VALOR_CONSOLIDADO' in chunk.columns:
            if not pd.api.types.is_numeric_dtype(chunk['VALOR_CONSOLIDADO']):
                chunk['VALOR_CONSOLIDADO'] = chunk['VALOR_CONSOLIDADO'].astype(str).str.replace('.', '', regex=False).str.replace(',', '.', regex=False)
                chunk['VALOR_CONSOLIDADO'] = pd.to_numeric(chunk['VALOR_CONSOLIDADO'], errors='coerce')
            chunk = chunk[(chunk['VALOR_CONSOLIDADO'] >= 100000) & (chunk['VALOR_CONSOLIDADO'] <= 2000000)]
        
        if not chunk.empty:
            found.append(chunk)
        
        if sum(len(c) for c in found) >= 500:
            break
    if sum(len(c) for c in found) >= 500:
        break

df = pd.concat(found).drop_duplicates(subset='CPF_CNPJ').nlargest(10, 'VALOR_CONSOLIDADO')

print(f"\n🎯 Top 10 Empresas (100k - 2MM):\n")
print(f"{'#':>2} | {'CNPJ':>20} | {'EMPRESA':40s} | {'DÍVIDA':>15} | {'SETOR (CNAE)':50s} | PORTE")
print("-" * 145)

for i, (idx, row) in enumerate(df.iterrows()):
    cnpj_raw = str(row['CPF_CNPJ'])
    cnpj_clean = cnpj_raw.replace('.', '').replace('/', '').replace('-', '').strip()
    if cnpj_clean.endswith('.0'):
        cnpj_clean = cnpj_clean[:-2]
    cnpj_clean = cnpj_clean.zfill(14)
    
    try:
        r = requests.get(f'https://brasilapi.com.br/api/cnpj/v1/{cnpj_clean}', timeout=10)
        if r.status_code == 200:
            d = r.json()
            cnae_desc = d.get('cnae_fiscal_descricao', 'N/A')
            porte = d.get('porte', 'N/A')
        else:
            cnae_desc = 'Erro API'
            porte = '-'
        time.sleep(1)
    except:
        cnae_desc = 'Erro'
        porte = '-'
    
    nome = str(row['NOME_DEVEDOR'])[:40]
    valor = row['VALOR_CONSOLIDADO']
    
    print(f"{i+1:>2} | {cnpj_raw:>20} | {nome:40s} | R$ {valor:>12,.2f} | {cnae_desc[:50]:50s} | {porte}")

print("\n✅ Pronto! Copie os CNPJs acima e teste no Speedio.")
