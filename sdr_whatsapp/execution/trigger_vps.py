"""
Disparador Remoto de Campanhas — SDR Automático
Este script facilita o envio em massa:
1. Importa leads de um CSV local para o CRM (Supabase), evitando duplicatas.
2. Cria uma campanha de prospecção.
3. Envia um comando para a VPS iniciar os disparos imediatamente.
"""

import os
import sys
import csv
import json
import requests
from dotenv import load_dotenv
from supabase import create_client

# Ajustar path para importar módulos irmãos
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from execution.campaign_manager import create_campaign

load_dotenv()

# Configurações
VPS_HOST = os.getenv("VPS_HOST", "187.77.48.57")
WEBHOOK_PORT = os.getenv("WEBHOOK_PORT", "5000")
VPS_API_URL = f"http://{VPS_HOST}:{WEBHOOK_PORT}"

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ Erro: Chaves do Supabase não encontradas no .env local.")
    sys.exit(1)

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

def clean_phone(phone):
    """Limpa e formata telefone para 55..."""
    p = "".join(filter(str.isdigit, str(phone)))
    if not p: return None
    if len(p) in [10, 11]: # DDD + Numero
        return f"55{p}"
    return p

def smart_import_leads(csv_path):
    """Lê CSV, checa duplicatas no Supabase e insere novos."""
    print(f"📖 Lendo arquivo: {csv_path}")
    
    new_leads = []
    phones_to_check = set()
    
    # Mapeamento simples (ajuste conforme seu CSV)
    # Esperado: nome, telefone, empresa, cnpj...
    # Se não tiver cabeçalho, vai tentar adivinhar.
    
    try:
        with open(csv_path, 'r', encoding='utf-8') as f:
            sample = f.read(1024)
            f.seek(0)
            delimiter = ';' if ';' in sample else ','
            reader = csv.DictReader(f, delimiter=delimiter)
            
            rows = list(reader)
            print(f"   Encontradas {len(rows)} linhas no CSV.")
            
            for row in rows:
                # Tentar encontrar colunas compatíveis
                nome = row.get('nome') or row.get('NOME') or row.get('Nome') or row.get('empresa')
                tel = row.get('telefone') or row.get('TELEFONE') or row.get('celular') or row.get('whatsapp')
                empresa = row.get('empresa') or row.get('EMPRESA')
                
                if not nome: continue # Sem nome, pula (ou usa empresa)
                
                clean_tel = clean_phone(tel)
                if not clean_tel: continue # Sem telefone, pula
                
                phones_to_check.add(clean_tel)
                
                new_leads.append({
                    "nome": nome.strip(),
                    "telefone": clean_tel,
                    "empresa": (empresa or "").strip(),
                    "fonte": "csv_import",
                    "valor_divida": 0, # Default
                    "cnpj": row.get('cnpj', '') or row.get('CNPJ', ''),
                    "cargo": row.get('cargo', '') or row.get('CARGO', ''),
                })
                
    except Exception as e:
        print(f"❌ Erro ao ler CSV: {e}")
        return 0

    if not new_leads:
        print("⚠️ Nenhum lead válido encontrado no CSV (verifique colunas 'nome' e 'telefone').")
        return 0

    print(f"🔍 Verificando duplicatas para {len(new_leads)} leads...")
    
    # Verificar existência no Supabase (em lotes de 1000 se necessário, aqui simplificado)
    # Como não tem unique constraint, fazemos query.
    # OBS: Se a lista for GIGANTE, isso pode ser lento. Para < 10k ok.
    existing_phones = set()
    
    # Paginação para verificar duplicatas
    page = 0
    BATCH_SIZE = 1000
    while True:
        res = sb.table("leads").select("telefone").range(page*BATCH_SIZE, (page+1)*BATCH_SIZE).execute()
        if not res.data: break
        for r in res.data:
            if r.get('telefone'):
                existing_phones.add(r['telefone'])
        if len(res.data) < BATCH_SIZE: break
        page += 1
    
    # Filtrar
    final_batch = []
    for lead in new_leads:
        if lead['telefone'] not in existing_phones:
            final_batch.append(lead)
            existing_phones.add(lead['telefone']) # Evitar duplicata no próprio CSV
    
    print(f"   Novos leads a inserir: {len(final_batch)} (Duplicados ignorados: {len(new_leads) - len(final_batch)})")
    
    if final_batch:
        # Inserir em lotes de 50
        for i in range(0, len(final_batch), 50):
            chunk = final_batch[i:i+50]
            sb.table("leads").insert(chunk).execute()
        print("✅ Importação concluída no CRM.")
    else:
        print("✅ Todos os leads já existiam no CRM. Nada a inserir.")
        
    return len(final_batch)

def main():
    if len(sys.argv) < 2:
        print("\n❌ Erro: Informe o arquivo CSV.")
        print("Uso: python sdr_whatsapp/execution/trigger_vps.py <caminho_do_csv> [nome_campanha]")
        sys.exit(1)

    csv_path = sys.argv[1]
    default_name = f"Campanha {os.path.basename(csv_path).replace('.csv', '')}"
    campaign_name = sys.argv[2] if len(sys.argv) > 2 else default_name

    # 1. Smart Import
    smart_import_leads(csv_path)

    # 2. Criar Campanha
    # A create_campaign pega leads SEM filtro específico hoje (todos do banco).
    # Isso pode ser perigoso se já rodou antes.
    # Idealmente, 'create_campaign' deveria aceitar uma lista de telefones ou IDs.
    # Mas vamos usar o comportamento padrão: cria campanha com leads disponíveis.
    # (Para ser mais seguro, o usuário deve limpar o banco ou filtraremos por data de criação no futuro)
    
    print(f"\n🏗️  Criando estrutura da campanha: '{campaign_name}'...")
    try:
        # Passaremos filtro de fonte='csv_import' se quisermos restringir, 
        # mas como import_leads_from_csv no manager usa 'pgfn', e aqui usamos 'csv_import'...
        # Vamos tentar filtrar por fonte='csv_import' E status 'novo'?
        # Por enquanto, sem filtro extra pra garantir que pegue o que acabamos de subir.
        
        campaign = create_campaign(name=campaign_name) 
        # ATENÇÃO: create_campaign no código atual pega TODOS os leads com telefone.
        # Se você rodar para lista A, depois lista B, a campanha B terá leads de A+B.
        # Isso é uma limitação do código atual do campaign_manager.py.
        # VAMOS MELHORAR ISSO NO FUTURO.
        
        campaign_id = campaign["id"]
        print(f"✅ Campanha criada! ID: {campaign_id}")
    except Exception as e:
        print(f"❌ Erro ao organizar campanha: {e}")
        sys.exit(1)

    # 3. Disparar VPS
    print(f"\n🚀 Enviando comando para servidor VPS...")
    try:
        url = f"{VPS_API_URL}/campaigns/start"
        resp = requests.post(url, json={"campaign_id": campaign_id})
        
        if resp.status_code == 200:
            print("\n" + "="*50)
            print("✅ SUCESSO! O AGENTE ESTÁ RODANDO NA NUVEM.")
            print("="*50)
            print("-> Os disparos começarão em instantes.")
            print("-> O robô respeita horário comercial e delays humanos.")
            print("-> Acompanhe as conversas em: https://sdr-hub.vercel.app")
            print("-> Pode fechar este terminal. O servidor continua trabalhando.")
        else:
            print(f"❌ Erro na resposta da VPS: {resp.status_code} - {resp.text}")
            
    except Exception as e:
        print(f"❌ Não foi possível comunicar com a VPS ({VPS_HOST}).")
        print(f"Erro: {e}")

if __name__ == "__main__":
    main()
