# Como Usar o Scraper de Leads (Guia para Iniciantes)

Este é um guia passo a passo detalhado para você usar a ferramenta de prospecção de leads no LinkedIn. Siga cada etapa com calma.

---

## Passo 1: Preparar o Ambiente

Primeiro, precisamos garantir que o seu computador tenha as ferramentas necessárias instaladas.

1.  **Abra o Terminal (Prompt de Comando):**
    *   No Windows, você pode clicar no botão "Start" (Iniciar), escrever `cmd` ou `PowerShell` e abrir.
    *   Certifique-se de navegar até a pasta onde estão os arquivos deste projeto. Se você não souber onde está, pode digitar `cd` seguido do caminho da pasta:
        `cd Desktop\ANTIGRAVITY\SDR AUTOMATICO\LINKEDIN SCRAPER`
    *   (Se der erro, verifique se o caminho está correto).

2.  **Instale as Dependências:**
    *   Copie e cole este comando no terminal e aperte **Enter**:
        ```bash
        pip install -r requirements.txt
        ```
    *   Você verá várias mensagens de instalação. Espere terminar e voltar para a linha de comando.

---

## Passo 2: Executar a Ferramenta

Agora vamos rodar o programa.

1.  **Inicie o Script:**
    *   No terminal, digite este comando e aperte **Enter**:
        ```bash
        python main.py
        ```

2.  **Preencha as Informações:**
    O programa vai te fazer algumas perguntas. Responda e aperte **Enter** após cada uma.

    *   **Nome da Empresa Alvo:** Digite o nome da empresa que você quer prospectar.
        *   *Exemplo:* `Nubank`
    
    *   **CNPJ:** Pode deixar em branco se não tiver ou não quiser usar, apenas aperte **Enter**.
    
    *   **Cargos Desejados:** Digite os cargos que você procura, separados por vírgula.
        *   *Exemplo:* `CEO, CTO, Gerente de Vendas`
    
    *   **Localização:** Digite a cidade/estado ou deixe em branco se for global.
        *   *Exemplo:* `São Paulo`

---

## Passo 3: Ver o Resultado

1.  O programa vai mostrar na tela o progresso da busca.
2.  Quando terminar, ele vai dizer onde salvou o arquivo com os leads.
3.  **Onde encontrar o arquivo:**
    *   Vá até a pasta do projeto no seu computador.
    *   Procure por uma pasta chamada `.tmp`.
    *   Dentro dela, haverá um arquivo `.csv` com o nome da empresa e a data.
    *   Exemplo: `leads_Nubank_20231026_143000.csv`.

4.  **Abrir no Excel:**
    *   Você pode abrir esse arquivo direto no Excel ou Google Sheets para ver os nomes, cargos e links dos perfis.

---

**Dica:** Se der algum erro estranho, verifique se você salvou sua chave de API corretamente no arquivo `.env` (sem aspas e sem espaços extras).
