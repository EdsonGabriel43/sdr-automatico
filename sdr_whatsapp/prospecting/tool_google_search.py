import os
import requests
import pandas as pd
import json
import time
import re
from datetime import datetime
from dotenv import load_dotenv

# Carrega variáveis de ambiente
load_dotenv()

SERPER_API_KEY = os.getenv("SERPER_API_KEY")

# --- Funções Auxiliares (Definidas no TOPO) ---

def load_database():
    """Carrega o histórico de leads para verificar duplicatas."""
    DB_FILE = "leads_database.csv"
    if not os.path.exists(DB_FILE):
        return set()
    
    try:
        # Lê apenas a coluna Profile_URL para memória
        df = pd.read_csv(DB_FILE, sep=";", usecols=["Profile_URL"])
        return set(df["Profile_URL"].astype(str).str.strip().values)
    except Exception as e:
        print(f"Aviso: Não foi possível ler o banco de dados ({e}). Criando novo.")
        return set()

def update_database(new_leads):
    """Adiciona novos leads ao arquivo mestre."""
    DB_FILE = "leads_database.csv"
    if not new_leads:
        return

    df_new = pd.DataFrame(new_leads)
    
    # Se o arquivo não existe, cria com cabeçalho
    if not os.path.exists(DB_FILE):
        df_new.to_csv(DB_FILE, index=False, encoding='utf-8-sig', sep=';')
    else:
        # Se existe, faz append sem cabeçalho
        df_new.to_csv(DB_FILE, mode='a', header=False, index=False, encoding='utf-8-sig', sep=';')

def extract_contacts(text):
    """
    Extrai emails e telefones de um texto usando Regex.
    """
    if not text:
        return {"email": None, "phone": None}

    contacts = {
        "email": None,
        "phone": None
    }
    
    # Regex para Email
    email_pattern = r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
    emails = re.findall(email_pattern, text)
    if emails:
        contacts["email"] = emails[0]
        
    # Regex para Telefone (APENAS CELULAR - Começando com 9)
    # Suporta: (11) 99999-9999, 11 99999 9999, +55...
    # Ajustado estritamente para celulares (9 + 8 digitos)
    phone_pattern = r'(?:\+55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\d{4}[-\s]?\d{4})'
    
    phones = re.findall(phone_pattern, text)
    if phones:
        # Valida se tem pelo menos 9 digitos uteis (excluindo DDD)
        # Um celular BR tem DDD (2) + 9 (1) + XXXX (4) + XXXX (4) = 11 digits
        # O regex pega o 9. Então esperamos pelo menos 10 digitos (DDD + 9 + 7 rest).
        valid_phones = [p for p in phones if len(re.sub(r'\D', '', p)) >= 10]
        
        if valid_phones:
             contacts["phone"] = valid_phones[0]
        
    return contacts

# --- DEEP SCRAPING (LITE) ---
from bs4 import BeautifulSoup

def deep_scrape_page(url):
    """
    Visita a URL para tentar extrair emails e telefones do HTML completo.
    Retorna um dicionário com os contatos encontrados.
    """
    if "linkedin.com" in url:
        # SEGURANÇA: Não acessar LinkedIn diretamente via requests local.
        # Risco de bloqueio de IP (Authwall/999). 
        # Para dados do LinkedIn, usamos o snippet do Google ou API (Apify).
        return {"email": None, "phone": None}

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    try:
        response = requests.get(url, headers=headers, timeout=5)
        if response.status_code == 200:
            soup = BeautifulSoup(response.text, 'lxml')
            for script in soup(["script", "style"]):
                script.decompose()
            text = soup.get_text(separator=" ")
            return extract_contacts(text)
    except Exception:
        pass
        
    return {"email": None, "phone": None}

def save_to_csv(leads, company_name, search_mode="company"):
    """
    Salva os leads em CSV na pasta .tmp com ordenação priorizada.
    """
    if not leads:
        return None
        
    os.makedirs(".tmp", exist_ok=True)
    
    safe_company = "".join([c for c in company_name if c.isalnum() or c in (' ', '_')]).strip().replace(" ", "_")
    date_str = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f".tmp/leads_{safe_company}_{date_str}.csv"
    
    df = pd.DataFrame(leads)
    
    # --- ORDENAÇÃO CUSTOMIZADA (Sistema de Pontuação) ---
    def is_mobile(phone):
        if not phone or phone == "N/A": return False
        digits = re.sub(r'\D', '', phone)
        return len(digits) >= 11 and digits[-9] == '9'

    def calculate_score(row):
        score = 0
        phone = row.get('Phone_Whatsapp', '')
        if is_mobile(phone): score += 1000
        if row.get('Source_Site') == 'instagram' or 'instagram.com' in str(row.get('Profile_URL', '')): score += 100
        if row.get('Personal_Email') and row.get('Personal_Email') != "N/A": score += 10
        return score

    if not df.empty:
        df['priority_score'] = df.apply(calculate_score, axis=1)
        df = df.sort_values(by=['priority_score', 'Name'], ascending=[False, True])
        
    cols = ["Name", "Personal_Email", "Phone_Whatsapp", "Role_Snippet", "Company_Input", "Profile_URL", "Source_Site", "Title_Full", "Source_Query", "Extracted_At"]
    cols = [c for c in cols if c in df.columns]
    df = df[cols] if not df.empty else df
    
    df.to_csv(filename, index=False, encoding='utf-8-sig', sep=';') 
    return filename

def parse_results(results, company_input, query_used, site_source, location_filter=None, enable_deep_scraping=True):
    """
    Limpa e estrutura os dados brutos da API (Organic).
    Opção enable_deep_scraping=True ativa a visitação (Lenta mas Profunda).
    """
    clean_leads = []
    
    print(f"   > Processando {len(results)} resultados... (Deep Scraping: {'ATIVO' if enable_deep_scraping else 'OFF'})")
    
    for item in results:
        link = item.get("link", "")
        title = item.get("title", "")
        snippet = item.get("snippet", "")
        
        if "linkedin.com" in link and "/in/" not in link: continue
        
        if location_filter:
            texto_completo = (title + " " + snippet).lower()
            if location_filter.lower() not in texto_completo: continue
            
        name_part = title.split(" - ")[0] if " - " in title else title
        
        # 1. Extração Rasa
        extracted = extract_contacts(snippet + " " + title)
        
        # 2. Deep Scraping (Visitação) - Se não achou contatos
        if enable_deep_scraping and (not extracted["email"] and not extracted["phone"]):
            time.sleep(1) 
            deep_extracted = deep_scrape_page(link)
            if deep_extracted["email"]: extracted["email"] = deep_extracted["email"]
            if deep_extracted["phone"]: extracted["phone"] = deep_extracted["phone"]
        
        lead = {
            "Name": name_part,
            "Personal_Email": extracted["email"] if extracted["email"] else "N/A",
            "Phone_Whatsapp": extracted["phone"] if extracted["phone"] else "N/A",
            "Role_Snippet": snippet, 
            "Company_Input": company_input,
            "Profile_URL": link,
            "Source_Site": site_source,
            "Title_Full": title,
            "Source_Query": query_used,
            "Extracted_At": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
        clean_leads.append(lead)
        
    return clean_leads

def construct_query(target_input, roles, location=None, mode="company", site="linkedin"):
    """
    Constrói a query booleana para o Google X-Ray.
    """
    roles_str = " OR ".join([f'"{role.strip()}"' for role in roles])
    
    # Define o operador 'site:'
    site_operator = ""
    if site == "linkedin":
        site_operator = "site:linkedin.com/in"
    elif site == "instagram":
        site_operator = "site:instagram.com"
    elif site == "facebook":
        site_operator = "site:facebook.com"
    elif site == "twitter":
        site_operator = "site:twitter.com"
    elif site == "tiktok":
        site_operator = "site:tiktok.com"
    elif site == "google":
        site_operator = "" # Busca aberta na web
    
    # Termos de contato (Modificado: Foco em TELEFONE/CELULAR)
    contact_terms = '("email" OR "telefone" OR "celular" OR "contato")'
    
    base_query = ""
    
    # Se site_operator for vazio, não adiciona espaço extra no início
    prefix = f"{site_operator} " if site_operator else ""
    
    if mode == "company":
        # Busca estrita: "Nome da Empresa"
        base_query = f'{prefix}({roles_str}) "{target_input}" {contact_terms}'
        
    elif mode == "profile":
        # Busca por perfil/keywords: ("Keyword1" OR "Keyword2")
        keywords = [k.strip() for k in target_input.split(",")]
        keywords_str = " OR ".join([f'"{k}"' for k in keywords])
        base_query = f'{prefix}({roles_str}) ({keywords_str}) {contact_terms}'
        
    elif mode == "cnae":
        # Busca por CNAE
        terms = [t.strip() for t in target_input.split(",")]
        terms_str = " OR ".join([f'"{t}"' for t in terms])
        base_query = f'{prefix}({roles_str}) ({terms_str}) {contact_terms}'
    
    if location:
        base_query += f' "{location}"'
        
    # Filtros negativos
    base_query += ' -intitle:vagas -inurl:jobs -recruiter'
    
    return base_query.strip()

def search_google(query, country_code="br", num_results=100):
    """
    Executa a busca na API do Serper.dev (Organic Search).
    Padrão num_results=10 (API free tier limit often defaults to 10 or 20).
    """
    if not SERPER_API_KEY:
        raise ValueError("SERPER_API_KEY não encontrada no arquivo .env")
    
    url = "https://google.serper.dev/search"
    
    # Ajuste forçado para evitar erro 400
    if num_results > 20: 
        num_results = 20
        
    payload = json.dumps({
        "q": query,
        "num": num_results,
        "gl": country_code,
        "hl": country_code 
    })
    
    headers = {
        'X-API-KEY': SERPER_API_KEY,
        'Content-Type': 'application/json'
    }

    try:
        response = requests.request("POST", url, headers=headers, data=payload)
        response.raise_for_status()
        data = response.json()
        
        if "organic" in data:
            return data["organic"]
        else:
            return []
            
    except requests.exceptions.HTTPError as e:
        print(f"Erro HTTP na API: {e}")
        try:
            print(f"Detalhes do erro: {response.text}")
        except:
            pass
        return []
    except Exception as e:
        print(f"Erro genérico: {e}")
        return []

def search_places(query, country_code="br", num_results=20):
    """
    Executa a busca na API Serper.dev (Endpoint Places/Maps).
    """
    if not SERPER_API_KEY:
        raise ValueError("SERPER_API_KEY não encontrada no arquivo .env")
    
    url = "https://google.serper.dev/places"
    
    payload = json.dumps({
        "q": query,
        "gl": country_code,
        "hl": country_code
    })
    
    headers = {
        'X-API-KEY': SERPER_API_KEY,
        'Content-Type': 'application/json'
    }

    try:
        response = requests.request("POST", url, headers=headers, data=payload)
        response.raise_for_status()
        data = response.json()
        
        if "places" in data:
            return data["places"]
        else:
            return []
            
    except Exception as e:
        print(f"Erro na API Places: {e}")
        return []


def parse_places_results(results, company_input, query_used, location_filter=None, enable_deep_scraping=True):
    """
    Processa resultados específicos do Google Maps/Places.
    """
    clean_leads = []
    
    print(f"   > Processando {len(results)} locais... (Deep Scraping no Site: {'ATIVO' if enable_deep_scraping else 'OFF'})")
    
    for item in results:
        title = item.get("title", "N/A")
        address = item.get("address", "N/A")
        phone = item.get("phoneNumber", "N/A")
        website = item.get("website", "N/A")
        category = item.get("category", "N/A")
        
        # Filtro de Localização Estrito para Places
        if location_filter:
            if location_filter.lower() not in address.lower():
                continue

        # Só adiciona se tiver pelo menos telefone ou site
        if phone == "N/A" and website == "N/A":
            continue
            
        # --- Deep Scraping no Site da Empresa ---
        extracted_email = "N/A"
        
        if enable_deep_scraping and website != "N/A":
            # Se não tem email (Places quase nunca tem), tenta entrar no site
            print(f"     -> Visitando site: {website}...")
            deep_extracted = deep_scrape_page(website)
            if deep_extracted["email"]: 
                extracted_email = deep_extracted["email"]
            # Se achou celular no site e o do maps for fixo, poderiamos guardar ambos, 
            # mas por simplicidade vamos manter o do Maps se existir, ou o do site se o Maps for N/A.
            if phone == "N/A" and deep_extracted["phone"]:
                phone = deep_extracted["phone"]

        lead = {
            "Name": title,
            "Personal_Email": extracted_email,
            "Phone_Whatsapp": phone,
            "Role_Snippet": f"Google Maps: {category} | {address}", 
            "Company_Input": company_input,
            "Profile_URL": website, 
            "Source_Site": "google_places",
            "Title_Full": f"{title} - {category}",
            "Source_Query": query_used,
            "Extracted_At": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
        clean_leads.append(lead)
        
    return clean_leads

# --- Função Principal ---

def run_prospecting(target_input, roles, location=None, mode="company", country="br"):
    """
    Função principal orquestradora da ferramenta.
    """
    label_tipo = mode.upper()
    print(f"--- Iniciando X-Ray Multi-Canal. Tipo: {label_tipo} | Alvo: {target_input} | País: {country} ---")
    if location:
        print(f"📍 Filtro de Localização Ativo: Apenas resultados contendo '{location}' serão aceitos.")
    
    # 0. Carregar Histórico
    existing_urls = load_database()
    print(f"Leads no histórico: {len(existing_urls)}")
    
    all_new_leads = []
    
    # Lista de redes para varrer
    sites_to_scan = ["linkedin", "instagram", "facebook", "twitter", "tiktok", "google", "google_places"]
    
    for site in sites_to_scan:
        site_name = "GOOGLE MAPS (MEU NEGÓCIO)" if site == "google_places" else site.upper()
        if site == "google":
             site_name = "GOOGLE (Busca Geral)"
             
        print(f"\n>> Buscando em: {site_name}...")
        
        # --- Lógica Especial: Google Places ---
        if site == "google_places":
            clean_input = target_input
            
            # Limpeza específica para mode CNAE se houver vírgula
            if mode == "cnae":
                 if "," in target_input:
                     parts = target_input.split(",")
                     if len(parts) > 1:
                         clean_input = parts[1].strip()
            
            clean_input = clean_input.replace('"', '').strip()
            
            places_query = f"{clean_input}"
            if location:
                places_query += f" {location}"
            
            print(f"Query Places: {places_query}")
            raw_results = search_places(places_query, country_code=country)
            
            count_total_raw = len(raw_results)
            print(f"Encontrados (Maps) [RAW]: {count_total_raw}")
            
            leads = parse_places_results(raw_results, target_input, places_query, location_filter=location)
        
        # --- Lógica Padrão: Google Organic (X-Ray) ---
        else:
            query = construct_query(target_input, roles, location, mode, site)
            print(f"Query: {query}")
            
            # Força 100 resultados para maximizar chance
            raw_results = search_google(query, country_code=country, num_results=100)
            
            count_total_raw = len(raw_results)
            print(f"Encontrados [RAW]: {count_total_raw}")
            
            leads = parse_results(raw_results, target_input, query, site, location_filter=location)
        
        # 4. Filtrar Duplicatas
        count_added = 0
        count_dupes = 0
        count_phones_this_run = 0
        
        for lead in leads:
            unique_key = lead["Profile_URL"]
            # Fallback para places que podem não ter site
            if not unique_key or unique_key == "N/A":
                unique_key = lead["Name"] + lead["Phone_Whatsapp"]
                
            if unique_key not in existing_urls:
                all_new_leads.append(lead)
                existing_urls.add(unique_key)
                count_added += 1
                if lead["Phone_Whatsapp"] != "N/A":
                     count_phones_this_run += 1
            else:
                count_dupes += 1
        
        print(f"   > Novos: {count_added} | Duplicados (já no histórico): {count_dupes}")
        print(f"   > Com Celular (nesta leva): {count_phones_this_run}")

        if location and len(leads) < len(raw_results):
            excluded = len(raw_results) - len(leads)
            print(f"   (Filtrados {excluded} leads sem '{location}' confirmado)")

    print(f"\n--- Resumo Final ---")
    print(f"Total de Novos Leads Qualificados (todas as fontes): {len(all_new_leads)}")
    
    # Debug Profundo na saída
    total_celulares = len([l for l in all_new_leads if l.get("Phone_Whatsapp") != "N/A"])
    print(f"[DEBUG] Total de Celulares encontrados e salvos agora: {total_celulares}")
    
    # 5. Salvar
    if all_new_leads:
        filepath = save_to_csv(all_new_leads, target_input, search_mode=mode)
        update_database(all_new_leads)
        print(f"Sucesso! Arquivo gerado: {filepath}")
        print(f"Banco de dados atualizado.")
        return filepath
    else:
        print("Nenhum lead novo encontrado (tudo duplicado ou vazio).")
        return None

def run_agent_queries(user_prompt, queries_list, country="br"):
    """
    Executa queries prontas geradas pelo Agente.
    """
    print(f"--- Iniciando Execução Agêntica ---\nPrompt Original: {user_prompt}")
    
    existing_urls = load_database()
    all_new_leads = []
    
    for query in queries_list:
        print(f"\n>> Executando Query do Agente: {query}")
        
        # Tenta identificar o site para classificação
        site_source = "web"
        if "site:linkedin.com" in query: site_source = "linkedin"
        elif "site:instagram.com" in query: site_source = "instagram"
        elif "site:facebook.com" in query: site_source = "facebook"
        
        raw_results = search_google(query, country_code=country, num_results=100)
        print(f"Encontrados [RAW]: {len(raw_results)}")
        
        # Parse
        leads = parse_results(raw_results, f"Agent: {user_prompt}", query, site_source)
        
        # Dedup
        for lead in leads:
            unique_key = lead["Profile_URL"]
            if not unique_key or unique_key == "N/A":
                unique_key = lead["Name"] + lead["Phone_Whatsapp"]
                
            if unique_key not in existing_urls:
                all_new_leads.append(lead)
                existing_urls.add(unique_key)
    
    print(f"\nTotal Leads Agente: {len(all_new_leads)}")
    
    if all_new_leads:
        safe_prompt = "".join([c for c in user_prompt[:20] if c.isalnum()])
        filepath = save_to_csv(all_new_leads, safe_prompt, search_mode="agent")
        update_database(all_new_leads)
        print(f"Arquivo gerado: {filepath}")
        return filepath
    return None

if __name__ == "__main__":
    # Teste rápido se rodar o script diretamente
    print("Script de execução X-ray carregado.")
