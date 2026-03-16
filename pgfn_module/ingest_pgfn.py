import pandas as pd
import os
import sys

import glob

# Configurações de Filtro
MIN_DEBT_VALUE = 1000000.00  # R$ 1 Milhão
MAX_DEBT_VALUE = 20000000.00 # R$ 20 Milhões
TARGET_UF = "SP"
INPUT_PATTERN = "arquivo_lai_SIDA_*.csv"
OUTPUT_FILE = "alvos_prioritarios.csv"

def ingest_pgfn_data():
    base_dir = os.path.dirname(__file__)
    csv_files = glob.glob(os.path.join(base_dir, INPUT_PATTERN))
    
    if not csv_files:
        print(f"❌ Nenhum arquivo '{INPUT_PATTERN}' encontrado em {base_dir}.")
        return

    print(f"📂 Encontrados {len(csv_files)} arquivos para processar: {[os.path.basename(f) for f in csv_files]}")
    
    all_chunks = []
    
    for csv_path in csv_files:
        print(f"\n🔄 Processando: {os.path.basename(csv_path)}...")
        
        try:
            chunk_size = 50000
            for chunk in pd.read_csv(csv_path, sep=';', encoding='latin-1', chunksize=chunk_size, on_bad_lines='skip'):
                # Normalizar colunas
                chunk.columns = [c.upper().strip() for c in chunk.columns]
                
                # Filtrar Pessoa Jurídica (case insensitive)
                if 'TIPO_PESSOA' in chunk.columns:
                    chunk = chunk[chunk['TIPO_PESSOA'].astype(str).str.lower().str.contains('jurídica', na=False)]
                
                # Filtrar Origem: Apenas impostos da Receita Federal
                if 'RECEITA_PRINCIPAL' in chunk.columns:
                    # Filtra onde contém "Receita" (ex: Receita da dívida ativa - IRPJ)
                    # Exclui multas isoladas se necessário, mas "Receita da dívida ativa" geralmente é o principal
                    chunk = chunk[chunk['RECEITA_PRINCIPAL'].astype(str).str.contains('Receita', case=False, na=False)]

                # Filtrar UF
                if 'UF_DEVEDOR' in chunk.columns:
                     chunk['UF_DEVEDOR'] = chunk['UF_DEVEDOR'].astype(str).str.strip()
                     chunk = chunk[chunk['UF_DEVEDOR'] == TARGET_UF]
                
                # Filtrar Valor (1MM a 20MM)
                if 'VALOR_CONSOLIDADO' in chunk.columns:
                    if not pd.api.types.is_numeric_dtype(chunk['VALOR_CONSOLIDADO']):
                        chunk['VALOR_CONSOLIDADO'] = chunk['VALOR_CONSOLIDADO'].astype(str).str.replace('.', '', regex=False).str.replace(',', '.', regex=False)
                        chunk['VALOR_CONSOLIDADO'] = pd.to_numeric(chunk['VALOR_CONSOLIDADO'], errors='coerce')
                    
                    chunk = chunk[
                        (chunk['VALOR_CONSOLIDADO'] >= MIN_DEBT_VALUE) & 
                        (chunk['VALOR_CONSOLIDADO'] <= MAX_DEBT_VALUE)
                    ]
                
                if not chunk.empty:
                    all_chunks.append(chunk)
                    print(f"   -> +{len(chunk)} alvos qualificados (R$ 1MM-20MM).")
                    
        except Exception as e:
            print(f"❌ Erro ao ler {os.path.basename(csv_path)}: {e}")

    if not all_chunks:
        print("⚠️ Nenhum devedor encontrado com os filtros aplicados.")
        return

    print("\n📦 Consolidando resultados...")
    full_df = pd.concat(all_chunks)
    
    # Selecionar colunas úteis
    # Ajuste para colunas reais do arquivo SIDA
    cols_map = {
        'CPF_CNPJ': 'CNPJ_CPF',
        'NOME_DEVEDOR': 'NOME_DEVEDOR',
        'VALOR_CONSOLIDADO': 'VALOR_CONSOLIDADO',
        'RECEITA_PRINCIPAL': 'TIPO_DIVIDA',
        'SITUACAO_INSCRICAO': 'SITUACAO_DIVIDA',
        'UF_DEVEDOR': 'UF'
    }
    
    # Renomear para padronizar
    full_df = full_df.rename(columns=cols_map)
    
    # Manter apenas columnas de interesse final
    final_cols = ['CNPJ_CPF', 'NOME_DEVEDOR', 'VALOR_CONSOLIDADO', 'TIPO_DIVIDA', 'SITUACAO_DIVIDA', 'UF']
    # Garante que só seleciona o que existe
    existing_cols = [c for c in final_cols if c in full_df.columns]
    full_df = full_df[existing_cols]
    
    output_path = os.path.join(os.path.dirname(__file__), OUTPUT_FILE)
    full_df.to_csv(output_path, index=False, sep=';', encoding='utf-8-sig')
    
    print(f"\n✅ SUCESSO! Arquivo '{OUTPUT_FILE}' gerado com {len(full_df)} alvos.")
    print(f"💰 Total em Dívidas Mapeadas: R$ {full_df['VALOR_CONSOLIDADO'].sum():,.2f}")


if __name__ == "__main__":
    ingest_pgfn_data()
