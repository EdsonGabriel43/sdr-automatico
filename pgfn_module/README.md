# Módulo PGFN: Lista de Devedores

Este módulo consome dados abertos da Procuradoria-Geral da Fazenda Nacional para identificar empresas com dívidas ativ## Passo 1: Download dos Dados (Caminho Seguro)
Como os links diretos da PGFN mudam constantemente, use este caminho oficial:

1. Acesse o portal: [https://www.gov.br/pgfn/pt-br](https://www.gov.br/pgfn/pt-br)
2. No menu superior, clique em **Assuntos** > **Dívida Ativa da União**.
3. No menu lateral ou na página, procure por **Dados Abertos**.
4. Entre em: **"Quanto à natureza da dívida"**.
5. Escolha **"Critérios de pesquisa para os arquivos da Dívida não previdenciária (Sistema SIDA)"**.
6. Selecione o Estado de **SP** e baixe o arquivo `.zip` ou `.csv` (ele conterá IRPF, IRPJ, etc.).
7. **Extraia** o arquivo para dentro desta pasta (`pgfn_module/`).
8. Renomeie o arquivo extraído para `devedores_sp.csv`.

## ⚙️ Passo 2: Filtragem de "Peixes Grandes"
Este script lê o arquivo gigante, filtra dívidas > R$ 100k e gera uma lista enxuta.

```bash
python pgfn_module/ingest_pgfn.py
```
**Resultado:** Gera o arquivo `alvos_prioritarios.csv`.

## 🧠 Passo 3: Cruzamento de Sócios (QSA)
Este script consulta a API pública (BrasilAPI) para descobrir quem manda na empresa.

```bash
python pgfn_module/enrich_partners.py
```
**Resultado:** Gera o arquivo `alvos_com_socios.csv` contendo Nomes e Qualificação dos Sócios.

---

### Próximo Passo (Fase Agente)
Com `alvos_com_socios.csv`, use o Agente SDR para encontrar os contatos pessoais desses sócios.
