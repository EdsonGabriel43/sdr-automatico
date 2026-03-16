@echo off
echo ==========================================
echo INICIANDO SDR AUTOMATICO WHATSAPP
echo ==========================================

cd sdr_whatsapp

echo 1. Subindo Docker (Evolution API + Postgres + Redis)...
docker-compose up -d

echo.
echo 2. Criando ambiente virtual e instalando dependencias...
if not exist venv (
    echo Criando venv...
    python -m venv venv
)
venv\Scripts\pip install -r requirements.txt

echo.
echo 3. Iniciando Servidor do Agente Nexa...
echo O servidor ficara rodando nesta janela. Nao feche!
echo.
venv\Scripts\python webhook_server.py
pause
