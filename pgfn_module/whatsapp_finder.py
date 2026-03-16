"""
WhatsApp Finder - Encontra telefones de empresas devedoras e verifica WhatsApp.
Fontes:
  1. BrasilAPI (CNPJ → telefone cadastrado na Receita)
  2. Google Maps (busca pelo nome da empresa)
  3. Verificação WhatsApp (wa.me check)
"""
import pandas as pd
import requests
import re
import time
import os
import json
from urllib.parse import quote_plus

# ==== CONFIGURAÇÕES ====
INPUT_FILE = "lote_prospeccao_1mm_5mm.csv"
OUTPUT_FILE = "contatos_whatsapp.csv"
LIMIT = 20  # Processar primeiros N para teste

BRASILAPI_URL = "https://brasilapi.com.br/api/cnpj/v1/{}"

# Headers para simular navegador
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
}

# ==== UTILIDADES ====

def clean_cnpj(cnpj):
    """Limpa CNPJ para formato numérico."""
    cnpj_clean = str(cnpj).replace('.', '').replace('/', '').replace('-', '').strip()
    if cnpj_clean.endswith('.0'): cnpj_clean = cnpj_clean[:-2]
    return cnpj_clean.zfill(14)

def format_phone_br(ddd, number):
    """Formata telefone brasileiro para padrão internacional."""
    if not ddd or not number:
        return None
    ddd = re.sub(r'\D', '', str(ddd))
    number = re.sub(r'\D', '', str(number))
    if not ddd or not number:
        return None
    full = f"55{ddd}{number}"
    # Garantir que celular tem 9 dígitos (adicionar 9 se necessário)
    if len(number) == 8 and number[0] in '6789':
        full = f"55{ddd}9{number}"
    return full

def extract_phones_from_text(text):
    """Extrai números de telefone de um texto qualquer."""
    # Padrões brasileiros: (11) 99999-9999, 11 99999-9999, +55 11 99999-9999
    patterns = [
        r'\(?\d{2}\)?\s*9?\d{4}[\s.-]?\d{4}',  # (11) 99999-9999
        r'\+?55\s?\(?\d{2}\)?\s*9?\d{4}[\s.-]?\d{4}',  # +55 11 99999-9999
    ]
    phones = []
    for pattern in patterns:
        matches = re.findall(pattern, text)
        for m in matches:
            digits = re.sub(r'\D', '', m)
            # Remover prefixo 55 se presente
            if digits.startswith('55') and len(digits) > 11:
                digits = digits[2:]
            if 10 <= len(digits) <= 11:
                phones.append(digits)
    return list(set(phones))

def get_phones_from_brasilapi(cnpj):
    """Extrai telefones da empresa via BrasilAPI."""
    try:
        cnpj_clean = clean_cnpj(cnpj)
        resp = requests.get(BRASILAPI_URL.format(cnpj_clean), timeout=10)
        
        if resp.status_code == 200:
            data = resp.json()
            phones = []
            
            # Campos de telefone da BrasilAPI
            ddd1 = data.get('ddd_telefone_1', '')
            ddd2 = data.get('ddd_telefone_2', '')
            
            # BrasilAPI retorna DDD+Telefone junto em ddd_telefone_1
            for phone_raw in [ddd1, ddd2]:
                if phone_raw and str(phone_raw).strip():
                    digits = re.sub(r'\D', '', str(phone_raw))
                    if len(digits) >= 10:
                        phones.append(digits)
            
            # Nome fantasia e razão social (para busca Google)
            nome_fantasia = data.get('nome_fantasia', '')
            municipio = data.get('municipio', '')
            uf = data.get('uf', '')
            
            return phones, nome_fantasia, f"{municipio}-{uf}"
            
        elif resp.status_code == 429:
            time.sleep(5)
            return get_phones_from_brasilapi(cnpj)
        
        return [], '', ''
    except Exception as e:
        return [], '', ''

def search_google_maps_phone(empresa, cidade="SP"):
    """Busca telefone da empresa no Google via scraping simples."""
    try:
        query = quote_plus(f"{empresa} {cidade} telefone contato")
        url = f"https://www.google.com/search?q={query}&hl=pt-BR"
        
        resp = requests.get(url, headers=HEADERS, timeout=10)
        
        if resp.status_code == 200:
            phones = extract_phones_from_text(resp.text)
            return phones
        
        return []
    except:
        return []

def check_whatsapp(phone_number):
    """
    Verifica se um número tem WhatsApp.
    Usa a API pública wa.me para checagem.
    Retorna: True, False, ou None (inconclusivo)
    """
    try:
        # Formatar para internacional (com 55)
        digits = re.sub(r'\D', '', str(phone_number))
        if not digits.startswith('55'):
            digits = f"55{digits}"
        
        # Método 1: Checar via API do WhatsApp
        url = f"https://api.whatsapp.com/send?phone={digits}"
        resp = requests.get(url, headers=HEADERS, timeout=10, allow_redirects=True)
        
        if resp.status_code == 200:
            # Se a página contém o chat interface, o número existe
            if 'send a message' in resp.text.lower() or 'enviar mensagem' in resp.text.lower():
                return True, digits
            # Se redireciona para download ou erro, o número não tem WhatsApp
            if 'get whatsapp' in resp.text.lower() or 'download' in resp.text.lower():
                return False, digits
        
        # Método 2: wa.me check
        url2 = f"https://wa.me/{digits}"
        resp2 = requests.head(url2, headers=HEADERS, timeout=5, allow_redirects=False)
        
        if resp2.status_code == 302:
            location = resp2.headers.get('Location', '')
            if 'send' in location:
                return True, digits
        
        return None, digits  # Inconclusivo
        
    except:
        return None, digits

def extract_main_partner(socios_str):
    """Extrai o primeiro sócio-administrador."""
    if pd.isna(socios_str) or not socios_str:
        return None
    
    priority = ['Administrador', 'Sócio-Administrador', 'Presidente', 'Diretor']
    parts = str(socios_str).split(';')
    
    for keyword in priority:
        for part in parts:
            if keyword.lower() in part.lower():
                name = re.sub(r'\(.*?\)', '', part).strip()
                return name
    
    if parts:
        return re.sub(r'\(.*?\)', '', parts[0]).strip()
    return None

# ==== MAIN ====

def run_whatsapp_finder():
    base_dir = os.path.dirname(__file__)
    input_path = os.path.join(base_dir, INPUT_FILE)
    
    if not os.path.exists(input_path):
        print("❌ Arquivo de lote não encontrado.")
        return
    
    print("="*60)
    print("📱 WHATSAPP FINDER - Busca de Telefones")
    print("="*60)
    
    df = pd.read_csv(input_path, sep=';', encoding='utf-8-sig')
    df = df.head(LIMIT).copy()
    
    print(f"📋 Processando {len(df)} empresas...\n")
    
    results = []
    phones_found = 0
    whatsapp_found = 0
    
    for idx, row in df.iterrows():
        empresa = row['NOME_DEVEDOR']
        cnpj = row['CNPJ_CPF']
        socios = row.get('SOCIOS', '')
        valor = row.get('VALOR_CONSOLIDADO', 0)
        decisor = extract_main_partner(socios)
        
        print(f"\n{'─'*50}")
        print(f"[{idx+1}/{len(df)}] {empresa}")
        print(f"  👤 Decisor: {decisor or 'N/A'}")
        print(f"  💰 Dívida: R$ {valor:,.2f}")
        
        # ── ETAPA 1: Telefone via BrasilAPI ──
        print(f"  📞 Buscando telefone na Receita Federal...", end="")
        api_phones, nome_fantasia, cidade = get_phones_from_brasilapi(cnpj)
        time.sleep(0.5)
        
        if api_phones:
            print(f" ✅ {len(api_phones)} encontrado(s): {api_phones}")
        else:
            print(f" ❌ Nenhum.")
        
        # ── ETAPA 2: Telefone via Google ──
        all_phones = list(api_phones)
        
        search_name = nome_fantasia if nome_fantasia and nome_fantasia != '********' else empresa
        print(f"  🔍 Buscando no Google: '{search_name}'...", end="")
        google_phones = search_google_maps_phone(search_name, cidade or "SP")
        time.sleep(1) # Rate limit Google
        
        if google_phones:
            print(f" ✅ +{len(google_phones)} do Google: {google_phones}")
            # Adicionar apenas novos
            for gp in google_phones:
                if gp not in all_phones:
                    all_phones.append(gp)
        else:
            print(f" ❌ Nenhum.")
        
        if not all_phones:
            print(f"  ⚠️ Nenhum telefone encontrado para esta empresa.")
            results.append({
                'EMPRESA': empresa, 'CNPJ': cnpj, 'DIVIDA': valor,
                'DECISOR': decisor, 'TELEFONE_1': None, 'TELEFONE_2': None,
                'WHATSAPP': None, 'WHATSAPP_LINK': None,
                'STATUS': 'SEM TELEFONE', 'SOCIOS': socios
            })
            continue
        
        phones_found += 1
        
        # ── ETAPA 3: Verificar WhatsApp ──
        print(f"  📱 Verificando WhatsApp para {len(all_phones)} número(s)...")
        
        best_whatsapp = None
        best_whatsapp_link = None
        whatsapp_status = 'NÃO VERIFICADO'
        
        for phone in all_phones[:3]:  # Testar no máximo 3 números
            has_wa, formatted = check_whatsapp(phone)
            
            if has_wa is True:
                print(f"     ✅ {formatted} → TEM WhatsApp!")
                best_whatsapp = formatted
                best_whatsapp_link = f"https://wa.me/{formatted}"
                whatsapp_status = 'CONFIRMADO'
                whatsapp_found += 1
                break
            elif has_wa is None:
                print(f"     🟡 {formatted} → Inconclusivo")
                if not best_whatsapp:
                    best_whatsapp = formatted
                    best_whatsapp_link = f"https://wa.me/{formatted}"
                    whatsapp_status = 'PROVÁVEL'
            else:
                print(f"     ❌ {formatted} → Sem WhatsApp")
            
            time.sleep(0.5)
        
        tel1 = all_phones[0] if len(all_phones) > 0 else None
        tel2 = all_phones[1] if len(all_phones) > 1 else None
        
        results.append({
            'EMPRESA': empresa, 'CNPJ': cnpj, 'DIVIDA': valor,
            'DECISOR': decisor, 
            'TELEFONE_1': tel1, 'TELEFONE_2': tel2,
            'WHATSAPP': best_whatsapp, 'WHATSAPP_LINK': best_whatsapp_link,
            'STATUS': whatsapp_status, 'SOCIOS': socios
        })
    
    # ── SALVAR ──
    result_df = pd.DataFrame(results)
    output_path = os.path.join(base_dir, OUTPUT_FILE)
    result_df.to_csv(output_path, index=False, sep=';', encoding='utf-8-sig')
    
    # ── RELATÓRIO ──
    print("\n" + "="*60)
    print("📊 RELATÓRIO FINAL")
    print("="*60)
    print(f"  📋 Empresas processadas:    {len(df)}")
    print(f"  📞 Com telefone encontrado: {phones_found}")
    print(f"  📱 Com WhatsApp confirmado: {whatsapp_found}")
    confirmed = len([r for r in results if r['STATUS'] == 'CONFIRMADO'])
    probable = len([r for r in results if r['STATUS'] == 'PROVÁVEL'])
    no_phone = len([r for r in results if r['STATUS'] == 'SEM TELEFONE'])
    print(f"  ✅ WhatsApp Confirmado:     {confirmed}")
    print(f"  🟡 WhatsApp Provável:       {probable}")
    print(f"  ❌ Sem Telefone:            {no_phone}")
    print(f"\n  📁 Arquivo Salvo: {OUTPUT_FILE}")
    print(f"  💡 Abra o CSV e use os links da coluna WHATSAPP_LINK para contato direto!")

if __name__ == "__main__":
    run_whatsapp_finder()
