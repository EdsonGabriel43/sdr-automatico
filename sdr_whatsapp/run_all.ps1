# Script de Inicialização Completa - SDR WhatsApp
# Executa: Docker -> Servidor Webhook -> Teste Interativo

Write-Host "=== INICIANDO SISTEMA SDR WHATSAPP ===" -ForegroundColor Cyan

# 1. Verificar/Subir Docker
Write-Host "`n1. Verificando Containers Docker..." -ForegroundColor Yellow
docker-compose up -d
if ($?) {
    Write-Host "✅ Docker containers iniciados." -ForegroundColor Green
} else {
    Write-Host "❌ Falha ao iniciar Docker. Verifique se o Docker Desktop está rodando." -ForegroundColor Red
    exit
}

# Aguardar containers subirem
Write-Host "Aguardando 10s para containers estarem prontos..."
Start-Sleep -Seconds 10

# 2. Iniciar Servidor Webhook (em nova janela)
Write-Host "`n2. Iniciando Servidor Webhook (janela separada)..." -ForegroundColor Yellow
$webhookProcess = Get-Process -Name "python" -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowTitle -like "*webhook_server.py*"}

if (-not $webhookProcess) {
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd 'C:\Users\USER\Desktop\ANTIGRAVITY\SDR AUTOMATICO\LINKEDIN SCRAPER\sdr_whatsapp'; venv\Scripts\python webhook_server.py"
    Write-Host "✅ Servidor iniciado em nova janela." -ForegroundColor Green
} else {
    Write-Host "⚠️ Servidor já parece estar rodando." -ForegroundColor Yellow
}

# Aguardar servidor
Write-Host "Aguardando 5s para servidor subir..."
Start-Sleep -Seconds 5

# 3. Rodar Teste Interativo
Write-Host "`n3. Iniciando Script de Teste Interativo..." -ForegroundColor Yellow
Write-Host "Siga as instruções abaixo para conectar o WhatsApp e testar." -ForegroundColor Cyan
Write-Host "-------------------------------------------------------"

venv\Scripts\python execution\test_lead.py
