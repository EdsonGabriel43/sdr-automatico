# Diretiva: Prospecção Google X-Ray (LinkedIn)

## 1. Objetivo
Localizar URLs de perfis pessoais no LinkedIn de decisores (C-Level, Diretores, Gestores) utilizando busca externa (Google SERP) para evitar detecção e bloqueios na plataforma LinkedIn.

## 2. Modos de Busca
O sistema deve operar em dois modos distintos, escolhidos pelo usuário:

### Modo A: Busca por Empresa (Account Based)
*   **Foco:** Encontrar decisores de uma empresa específica.
*   **Inputs:** Nome da Empresa + Cargos.

### Modo B: Busca por Perfil (Persona Based)
*   **Foco:** Encontrar decisores em um mercado ou com características específicas, sem limitar a uma empresa.
*   **Inputs:** Palavras-chave do Perfil (ex: "SaaS", "Fintech", "Varejo") + Cargos + Localização.

## 3. Regras de Construção de Query (Google Dorking)

### Modo C: Busca por CNAE (Setorial Específico)
*   **Foco:** Encontrar empresas através de códigos de atividade econômica ou descrições técnicas de CNAE.
*   **Inputs:** Código ou Descrição CNAE (ex: "4771-7", "Comércio varejista de produtos farmacêuticos").

## 3. Regras de Construção de Query (Google Dorking)

### Estrutura Base Multi-Rede
A busca deve ser executada para **CADA REDE SOCIAL** solicitada (LinkedIn, Instagram, Facebook).

#### Redes Sociais Suportadas:
1.  **LinkedIn:** `site:linkedin.com/in`
2.  **Instagram:** `site:instagram.com` (Foco em bios/posts)
3.  **Facebook:** `site:facebook.com`

### Queries por Modo:

#### Modo A (Empresa):
`[site:REDE] ("Cargo") "Nome da Empresa" ...`

#### Modo B (Perfil):
`[site:REDE] ("Cargo") ("Keyword1" OR "Keyword2") "Localização" ...`

#### Modo C (CNAE):
`[site:REDE] ("Cargo") ("CNAE 4771" OR "Comércio varejista") "Localização" ...`

### Termos Globais (para todos):
Sempre incluir: `("email" OR "whatsapp" OR "contato")`

## 4. Regras de Processamento
1.  **Iterar Resultados:** A API do Google retorna 10 resultados por página. O sistema deve buscar páginas suficientes (ex: até 30-50 leads) ou até a relevância cair drasticamente.
2.  **Limpeza:** Remover resultados que não sejam perfis de pessoas (ex: posts, artigos).
3.  **Formato de Saída:**
    *   **Nome:** Extraído do título (Geralmente "Nome Sobrenome - Cargo - Empresa").
    *   **Cargo:** Extraído do snippet ou título.
    *   **URL:** Link limpo do perfil.
