# Script de Reset COMPLETO do Docker (Factory Reset)
# Use este script para apagar TUDO da Evolution API local e começar do zero.
# ATENÇÃO: Isso apaga o banco de dados local do Docker.

Write-Host "=== FACTORY RESET: EVOLUTION API ===" -ForegroundColor Red
Write-Host "Isso vai apagar todas as instâncias e dados locais do Docker."
Write-Host "Pressione Ctrl+C para cancelar ou aguarde 5 segundos..."
Start-Sleep -Seconds 5

# 1. Derrubar containers e remover volumes
Write-Host "`n1. Derrubando containers e apagando volumes..."
docker-compose down -v

if ($?) {
    Write-Host "✅ Volumes removidos com sucesso." -ForegroundColor Green
}
else {
    Write-Host "❌ Falha ao remover volumes. Verifique se o Docker Desktop está rodando." -ForegroundColor Red
    exit
}

# 2. Limpeza adicional (opcional, para garantir)
Write-Host "`n2. Garantindo limpeza de redes órfãs..."
docker network prune -f

# 3. Subir novamente do zero
Write-Host "`n3. Instalando Evolution API novamente (Factory Default)..."
docker-compose up -d

# 4. Verificação
if ($?) {
    Write-Host "`n✅ Instalação concluída!" -ForegroundColor Green
    Write-Host "---------------------------------------------------"
    Write-Host "Aguarde cerca de 30 SEGUNDOS para os serviços subirem."
    Write-Host "Depois:"
    Write-Host "1. Acesse http://localhost:8080/manager"
    Write-Host "2. Crie uma NOVA instância 'nexa_test'."
    Write-Host "3. O QR Code deve aparecer agora."
}
else {
    Write-Host "`n❌ Falha na instalação. Verifique o Docker Desktop." -ForegroundColor Red
}
