# DIRETIVA: Prospecção Google X-Ray (LinkedIn)

## 1. Objetivo
Localizar URLs de perfis pessoais no LinkedIn de decisores (C-Level, Diretores, Gestores) utilizando busca externa (Google SERP) para evitar detecção e bloqueios na plataforma LinkedIn.

## 2. Entradas (Inputs)
O agente deve receber do usuário:
1.  **Nome da Empresa (Obrigatório):** Usado na string de busca.
2.  **CNPJ (Opcional):** Usado apenas para nomear o arquivo de saída e log.
3.  **Cargos Alvo:** Lista de títulos (ex: "CEO", "CTO", "Diretor de Vendas").
4.  **Localização (Opcional):** Ex: "São Paulo".

## 3. Regra de Construção de Query (Google Dorking)
A ferramenta de execução deve montar a query seguindo estritamente um destes padrões, dependendo da intenção:

### Padrão 1: Busca Abrangente (Volume)
`site:linkedin.com/in ("Cargo1" OR "Cargo2") "Nome da Empresa" "Localização" -intitle:vagas -inurl:jobs -recruiter`

### Padrão 2: Busca de Contato (Qualidade) - *PRIORITÁRIO*
`site:linkedin.com/in ("Cargo1" OR "Cargo2") "Nome da Empresa" ("email" OR "@gmail.com" OR "@hotmail.com" OR "whatsapp" OR "contato") -intitle:vagas`

### Padrão 3: Busca Multi-Redes (Instagram, TikTok, X)
Para buscar perfis em outras redes, o Agente deve substituir o `site:`:
-   **Instagram:** `site:instagram.com (bio:"Cargo" OR "PalavraChave") "Local"`
-   **TikTok:** `site:tiktok.com ("@gmail" OR "email") "PalavraChave"`
-   **X (Twitter):** `site:twitter.com ("bio: Cargo")`

*Nota: Se a localização for vazia, remova-a da string.*

## 4. Fluxo de Execução
1.  **Validação:** Verificar se a chave da API `SERPER_API_KEY` está presente no `.env`.
2.  **Busca:** Executar a busca via API Serper.dev (Endpoint `/search`).
3.  **Paginação:** Iterar até obter pelo menos 20 resultados ou até a relevância cair.
4.  **Filtragem:**
    * Manter apenas URLs que contenham `/in/`.
    * Descartar URLs de `/company/`, `/pulse/` ou posts.
5.  **Extração:**
    * `Nome`: Extrair do título do resultado (antes do " - ").
    * `Cargo`: Extrair do título ou snippet.
    * `URL`: Link direto do perfil.

## 5. Saída (Output)
Salvar os dados limpos em: `.tmp/leads_{NOME_EMPRESA}_{DATA}.csv`
Colunas: `Nome`, `Cargo (Estimado)`, `Empresa`, `Linkedin URL`, `Snippet (Resumo)`.