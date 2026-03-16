# Script de Reset Completo da Evolution API
# Use este script se a interface do WhatsApp QR Code estiver travada ou não carregar.

Write-Host "=== RESETANDO EVOLUTION API E CONTAINERS ===" -ForegroundColor Yellow

# 1. Derrubar containers atuais
Write-Host "Derrubando containers (isso pode demorar um pouco)..."
docker-compose down

# 2. Subir novamente
Write-Host "Iniciando containers novamente..."
docker-compose up -d

# 3. Verificação
if ($?) {
    Write-Host "`n✅ Containers reiniciados com sucesso!" -ForegroundColor Green
    Write-Host "Aguarde cerca de 30 SEGUNDOS para os serviços subirem completamente."
    Write-Host "Depois, acesse novamente: http://localhost:8080/manager"
    Write-Host "Apague a instância antiga (se houver) e crie uma nova 'nexa_test'."
}
else {
    Write-Host "`n❌ Falha ao reiniciar. Verifique se o Docker Desktop está rodando." -ForegroundColor Red
}
