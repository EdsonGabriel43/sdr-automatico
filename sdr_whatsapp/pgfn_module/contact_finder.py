"""
Camada 1: Gerador e Verificador de Emails de Decisores
Fluxo:
  1. Lê lote_prospeccao_1mm_5mm.csv (empresas + sócios)
  2. Pour chaque empresa: descobre domínio via BrasilAPI ou Google
  3. Gera padrões de email do sócio-administrador
  4. Verifica se o email existe via SMTP
  5. Exporta CSV final com contatos validados
"""
import pandas as pd
import requests
import re
import time
import os
import smtplib
import dns.resolver
from email.utils import parseaddr
from unidecode import unidecode

# ==== CONFIGURAÇÕES ====
INPUT_FILE = "lote_prospeccao_1mm_5mm.csv"
OUTPUT_FILE = "contatos_decisores.csv"
LIMIT = 20 # Processar apenas os primeiros N para teste rápido

# ==== UTILIDADES ====

def clean_name(full_name):
    """Remove qualificação e limpa o nome do sócio."""
    # Ex: "JOÃO CARLOS DA SILVA (Administrador)" -> "JOAO CARLOS DA SILVA"
    name = re.sub(r'\(.*?\)', '', str(full_name)).strip()
    name = unidecode(name).upper()
    return name

def name_to_email_patterns(full_name, domain):
    """Gera padrões comuns de email a partir do nome completo."""
    name = clean_name(full_name)
    parts = name.lower().split()
    
    if len(parts) < 2:
        return []
    
    first = parts[0]
    last = parts[-1]
    
    # Remover preposições comuns
    middle_skip = {'de', 'da', 'do', 'dos', 'das', 'e'}
    clean_parts = [p for p in parts if p not in middle_skip]
    
    if len(clean_parts) < 2:
        clean_parts = parts
    
    first_c = clean_parts[0]
    last_c = clean_parts[-1]
    
    patterns = [
        f"{first_c}.{last_c}@{domain}",       # joao.silva@empresa.com.br
        f"{first_c}@{domain}",                  # joao@empresa.com.br
        f"{first_c}{last_c}@{domain}",          # joaosilva@empresa.com.br
        f"{first_c[0]}{last_c}@{domain}",       # jsilva@empresa.com.br
        f"{first_c}_{last_c}@{domain}",         # joao_silva@empresa.com.br
        f"{last_c}.{first_c}@{domain}",         # silva.joao@empresa.com.br
        f"{first_c[0]}.{last_c}@{domain}",      # j.silva@empresa.com.br
    ]
    
    return patterns

def get_domain_from_brasilapi(cnpj):
    """Tenta extrair o domínio da empresa via email cadastrado na Receita."""
    try:
        cnpj_clean = str(cnpj).replace('.', '').replace('/', '').replace('-', '').strip()
        if cnpj_clean.endswith('.0'): cnpj_clean = cnpj_clean[:-2]
        cnpj_clean = cnpj_clean.zfill(14)
        
        resp = requests.get(f"https://brasilapi.com.br/api/cnpj/v1/{cnpj_clean}", timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            email = data.get('email', '')
            if email and '@' in email:
                domain = email.split('@')[1].lower().strip()
                # Descartar domínios genéricos
                generics = ['gmail.com', 'hotmail.com', 'yahoo.com.br', 'outlook.com', 
                           'yahoo.com', 'bol.com.br', 'uol.com.br', 'terra.com.br',
                           'ig.com.br', 'live.com', 'msn.com']
                if domain not in generics:
                    return domain, email
                else:
                    return None, email  # Email genérico, sem domínio corporativo
            return None, None
        elif resp.status_code == 429:
            time.sleep(5)
            return get_domain_from_brasilapi(cnpj)
        return None, None
    except:
        return None, None

def get_domain_from_company_name(company_name):
    """Tenta adivinhar o domínio com base no nome da empresa."""
    name = unidecode(company_name).lower()
    # Remove sufixos jurídicos
    for suffix in ['ltda', 'sa', 's.a.', 's/a', 'eireli', 'me', 'epp', 
                   'falido', 'em recuperacao judicial', 'incorporacao',
                   'industria', 'comercio', 'servicos', 'participacoes']:
        name = name.replace(suffix, '')
    
    # Pega a primeira palavra significativa (geralmente a marca)
    words = [w.strip() for w in name.split() if len(w.strip()) > 2]
    if words:
        brand = words[0]
        return f"{brand}.com.br"
    return None

def verify_email_smtp(email, timeout=10):
    """
    Verifica se um email existe via checagem SMTP (MX lookup + RCPT TO).
    Retorna: 'VÁLIDO', 'INVÁLIDO', 'INCONCLUSIVO'
    """
    try:
        domain = email.split('@')[1]
        
        # 1. Verificar se o domínio tem registros MX
        try:
            mx_records = dns.resolver.resolve(domain, 'MX')
            mx_host = str(mx_records[0].exchange).rstrip('.')
        except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN, dns.resolver.NoNameservers):
            return 'DOMÍNIO INVÁLIDO'
        except Exception:
            return 'INCONCLUSIVO'
        
        # 2. Conectar ao servidor SMTP e testar o email
        try:
            server = smtplib.SMTP(mx_host, 25, timeout=timeout)
            server.set_debuglevel(0)
            server.ehlo('verificador.local')
            
            # Alguns servidores exigem MAIL FROM
            server.mail('teste@verificador.local')
            code, message = server.rcpt(email)
            server.quit()
            
            if code == 250:
                return 'VÁLIDO'
            elif code == 550:
                return 'INVÁLIDO'
            else:
                return 'INCONCLUSIVO'
        except smtplib.SMTPServerDisconnected:
            return 'INCONCLUSIVO'
        except smtplib.SMTPConnectError:
            return 'INCONCLUSIVO'
        except Exception:
            return 'INCONCLUSIVO'
            
    except Exception:
        return 'ERRO'

def extract_main_partner(socios_str):
    """Extrai o primeiro sócio-administrador da lista de sócios."""
    if pd.isna(socios_str) or not socios_str:
        return None
    
    # Priorizar Administrador / Sócio-Administrador / Presidente / Diretor
    priority_keywords = ['Administrador', 'Sócio-Administrador', 'Presidente', 'Diretor']
    
    parts = str(socios_str).split(';')
    
    # Primeiro busca por cargo prioritário
    for keyword in priority_keywords:
        for part in parts:
            if keyword.lower() in part.lower():
                return part.strip()
    
    # Se não encontrou, retorna o primeiro
    if parts:
        return parts[0].strip()
    
    return None

# ==== MAIN ====

def run_contact_finder():
    base_dir = os.path.dirname(__file__)
    input_path = os.path.join(base_dir, INPUT_FILE)
    
    if not os.path.exists(input_path):
        print("❌ Arquivo de lote não encontrado.")
        return
    
    print("="*60)
    print("🕵️ CAMADA 1: CONTACT FINDER")
    print("="*60)
    
    df = pd.read_csv(input_path, sep=';', encoding='utf-8-sig')
    
    # Limitar para teste
    df = df.head(LIMIT).copy()
    
    print(f"📋 Processando {len(df)} empresas...\n")
    
    results = []
    
    for idx, row in df.iterrows():
        empresa = row['NOME_DEVEDOR']
        cnpj = row['CNPJ_CPF']
        socios = row.get('SOCIOS', '')
        valor = row.get('VALOR_CONSOLIDADO', 0)
        
        print(f"\n{'='*50}")
        print(f"[{idx+1}/{len(df)}] {empresa}")
        print(f"  💰 Dívida: R$ {valor:,.2f}")
        
        # 1. Extrair decisor principal
        main_partner = extract_main_partner(socios)
        if not main_partner:
            print(f"  ⚠️ Sem sócios identificados. Pulando...")
            results.append({
                'EMPRESA': empresa, 'CNPJ': cnpj, 'DIVIDA': valor,
                'DECISOR': None, 'DOMINIO': None, 'EMAIL_GERADO': None,
                'VERIFICACAO': 'SEM SÓCIO', 'TODOS_SOCIOS': socios
            })
            continue
        
        partner_name = clean_name(main_partner)
        print(f"  👤 Decisor: {partner_name}")
        
        # 2. Encontrar domínio da empresa
        domain, email_receita = get_domain_from_brasilapi(cnpj)
        time.sleep(0.5) # Rate limiting
        
        if domain:
            print(f"  🌐 Domínio encontrado (Receita): {domain}")
        else:
            # Tentar adivinhar pelo nome
            domain = get_domain_from_company_name(empresa)
            if domain:
                print(f"  🔮 Domínio estimado: {domain}")
            else:
                print(f"  ❌ Domínio não encontrado.")
                results.append({
                    'EMPRESA': empresa, 'CNPJ': cnpj, 'DIVIDA': valor,
                    'DECISOR': partner_name, 'DOMINIO': None,
                    'EMAIL_GERADO': email_receita or None,
                    'VERIFICACAO': 'SEM DOMÍNIO', 'TODOS_SOCIOS': socios
                })
                continue
        
        # 3. Gerar padrões de email
        patterns = name_to_email_patterns(main_partner, domain)
        print(f"  📧 Testando {len(patterns)} padrões de email...")
        
        best_email = None
        best_status = 'NENHUM VÁLIDO'
        
        for pattern in patterns:
            status = verify_email_smtp(pattern)
            print(f"     {pattern} -> {status}")
            
            if status == 'VÁLIDO':
                best_email = pattern
                best_status = 'VÁLIDO'
                break
            elif status == 'INCONCLUSIVO' and not best_email:
                best_email = pattern
                best_status = 'INCONCLUSIVO'
        
        # Se não achou válido, guardar o mais provável (primeiro padrão)
        if not best_email and patterns:
            best_email = patterns[0]
            best_status = 'NÃO VERIFICADO'
        
        print(f"  📬 Melhor Email: {best_email} ({best_status})")
        
        results.append({
            'EMPRESA': empresa, 'CNPJ': cnpj, 'DIVIDA': valor,
            'DECISOR': partner_name, 'DOMINIO': domain,
            'EMAIL_GERADO': best_email, 'VERIFICACAO': best_status,
            'EMAIL_RECEITA': email_receita, 'TODOS_SOCIOS': socios
        })
    
    # Salvar resultado
    result_df = pd.DataFrame(results)
    output_path = os.path.join(base_dir, OUTPUT_FILE)
    result_df.to_csv(output_path, index=False, sep=';', encoding='utf-8-sig')
    
    # Relatório
    print("\n" + "="*60)
    print("📊 RELATÓRIO FINAL")
    print("="*60)
    valid = len([r for r in results if r['VERIFICACAO'] == 'VÁLIDO'])
    inconc = len([r for r in results if r['VERIFICACAO'] == 'INCONCLUSIVO'])
    no_domain = len([r for r in results if r['VERIFICACAO'] == 'SEM DOMÍNIO'])
    print(f"  ✅ Emails Válidos:      {valid}")
    print(f"  🟡 Inconclusivos:       {inconc}")
    print(f"  ❌ Sem Domínio:         {no_domain}")
    print(f"  📁 Arquivo Salvo:       {OUTPUT_FILE}")

if __name__ == "__main__":
    run_contact_finder()
