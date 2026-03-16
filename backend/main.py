from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import os
import sys
import json
from dotenv import load_dotenv
from openai import OpenAI

# Adiciona diretório pai ao sys.path para importar o scraper
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from execution.tool_google_search import run_agent_queries

# Carrega variáveis de ambiente
load_dotenv()

# Configuração da OpenAI
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

app = FastAPI(title="SDR Agêntico API", version="1.0.0")

class SearchRequest(BaseModel):
    query: str
    mode: str = "agentic" # agentic, company, profile, cnae, specific_person
    location: str = None

@app.get("/")
def read_root():
    return {"status": "online", "message": "SDR Agêntico Backend is running"}

@app.post("/agent/search")
def agent_search(request: SearchRequest):
    """
    Endpoint principal para busca agêntica.
    Aqui entra a lógica de LLM para interpretar o pedido.
    """
    try:
        # Prompt para o LLM
        prompt = f"""
        Você é um especialista em prospecção (SDR) e Open Source Intelligence (OSINT).
        O usuário quer encontrar leads ou investigar uma pessoa com o pedido: "{request.query}"
        
        Sua missão é classificar a intenção e gerar as queries de busca perfeitas (Google Dorking).
        
        ANÁLISE DE INTENÇÃO:
        A. BUSCA DE LISTA (Ex: "Personal Trainers em SP", "Diretores de Marketing"):
           - Priorize LinkedIn para B2B.
           - Inclua Instagram/TikTok para B2C.
           - Use termos genéricos da profissão.
           
        B. BUSCA DE PESSOA ESPECÍFICA (Ex: "Edson Gabriel dos Santos", "Maria Silva da V4 Company"):
           - O objetivo é encontrar o "Digital Footprint" (Pegada Digital) desta pessoa exata.
           - GERE QUERIES PARA AS 4 PRINCIPAIS REDES (LinkedIn, Instagram, Facebook, TikTok).
           - NÃO adicione cargos se não foram citados. Use o NOME entre aspas.
        
        REGRAS DE FORMATAÇÃO:
        1. Use SEMPRE `site:` para cada rede:
           - LinkedIn: `site:linkedin.com/in`
           - Instagram: `site:instagram.com`
           - Facebook: `site:facebook.com`
           - TikTok: `site:tiktok.com`
           - Twitter/X: `site:twitter.com`
           
        2. Retorne APENAS JSON.
            
        Exemplo (Busca de Pessoa):
        Input: "Edson Gabriel dos Santos"
        {{
            "queries": [
                "site:linkedin.com/in \"Edson Gabriel dos Santos\"",
                "site:instagram.com \"Edson Gabriel dos Santos\"",
                "site:facebook.com \"Edson Gabriel dos Santos\"",
                "site:tiktok.com \"Edson Gabriel dos Santos\""
            ]
        }}
        
        Exemplo (Busca de Lista):
        Input: "Nutricionistas em Curitiba"
        {{
            "queries": [
                "site:instagram.com \"Nutricionista\" Curitiba",
                "site:linkedin.com/in \"Nutricionista\" Curitiba"
            ]
        }}
        """
        
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are a helpful assistant that generates boolean search queries in JSON."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"}
        )
        
        content = response.choices[0].message.content
        data = json.loads(content)
        queries = data.get("queries", [])
        
        csv_file_path = None
        if queries:
            # Integração Cérebro-Músculo: Executa o scraper com as queries geradas!
            # Para não bloquear o request se demorar muito, aqui fazemos sincrono, 
            # mas idealmente num SaaS real seria assíncrono (Websockets/BackgroundTasks)
            csv_file_path = run_agent_queries(request.query, queries)
        
        return {
            "message": "Intenção processada e leads gerados com sucesso!", 
            "data": data, 
            "csv_generated": csv_file_path,
            "original_request": request
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/agent/enrich")
def agent_enrich(request: SearchRequest):
    """
    Endpoint para busca de pessoa específica.
    """
    return {"message": "Endpoint de enriquecimento recebido", "data": request}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
