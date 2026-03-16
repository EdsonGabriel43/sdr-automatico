import paramiko
import os
import time
import zipfile
from dotenv import load_dotenv

# Carregar variáveis de ambiente
load_dotenv()

# Configurações do VPS
HOST = os.getenv("VPS_HOST")
USER = os.getenv("VPS_USER")
PASS = os.getenv("VPS_PASS")
REMOTE_DIR = "/root/sdr-backend"


def create_zip():
    print("📦 Compactando arquivos...")
    zip_filename = "deploy_package.zip"
    with zipfile.ZipFile(zip_filename, 'w', zipfile.ZIP_DEFLATED) as zipf:
        # Arquivos na raiz
        for file in ["webhook_server.py", "requirements.txt", "Dockerfile.python", 
                     "docker-compose.prod.yml", ".env"]:
            if os.path.exists(file):
                zipf.write(file)
            else:
                print(f"⚠️ Aviso: {file} não encontrado!")
        
        # Diretórios recursivos
        for folder in ["wa-server", "execution", "config", "database"]:
            if os.path.exists(folder):
                for root, dirs, files in os.walk(folder):
                    # Ignorar node_modules, venv, __pycache__
                    if 'node_modules' in dirs: dirs.remove('node_modules')
                    if 'venv' in dirs: dirs.remove('venv')
                    if '__pycache__' in dirs: dirs.remove('__pycache__')
                    if '.wwebjs_auth' in dirs: dirs.remove('.wwebjs_auth')
                    if '.wwebjs_cache' in dirs: dirs.remove('.wwebjs_cache')
                    
                    for file in files:
                        if file.endswith('.zip') or file.endswith('.log'): continue
                        file_path = os.path.join(root, file)
                        zipf.write(file_path)
    
    print(f"✅ ZIP criado: {zip_filename}")
    return zip_filename

def deploy():
    # 1. Compactar
    zip_path = create_zip()
    
    # 2. Conectar SSH
    print(f"🔌 Conectando em {HOST}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    try:
        ssh.connect(HOST, username=USER, password=PASS)
        print("✅ Conectado ao VPS!")
        
        # 3. Setup Inicial (Docker)
        print("🛠️ Verificando/Instalando Docker...")
        stdin, stdout, stderr = ssh.exec_command("docker --version")
        if stdout.channel.recv_exit_status() != 0:
            print("   Docker não encontrado. Instalando...")
            commands = [
                "apt-get update",
                "apt-get install -y curl unzip",
                "curl -fsSL https://get.docker.com -o get-docker.sh",
                "sh get-docker.sh"
            ]
            for cmd in commands:
                print(f"   Executando: {cmd}...")
                ssh.exec_command(cmd)[1].read() # Esperar terminar
        else:
            print("   Docker já instalado.")
            # Garantir unzip
            ssh.exec_command("apt-get install -y unzip")[1].read()

        # 4. Upload Arquivos
        sftp = ssh.open_sftp()
        print(f"atk📤 Enviando {zip_path}...")
        sftp.put(zip_path, f"/root/{zip_path}")
        sftp.close()
        
        # 5. Descompactar e Rodar
        print("🚀 Executando Deploy...")
        commands = [
            f"mkdir -p {REMOTE_DIR}",
            f"unzip -o /root/{zip_path} -d {REMOTE_DIR}",
            f"rm /root/{zip_path}",
            f"cd {REMOTE_DIR} && docker compose -f docker-compose.prod.yml down --remove-orphans",
            f"cd {REMOTE_DIR} && docker compose -f docker-compose.prod.yml up -d --build"
        ]
        
        for cmd in commands:
            print(f"   Remote Exec: {cmd}")
            stdin, stdout, stderr = ssh.exec_command(cmd)
            # Ler saída em tempo real (ou esperar terminar)
            exit_status = stdout.channel.recv_exit_status()
            if exit_status != 0:
                print(f"❌ Erro ao executar: {cmd}")
                print(stderr.read().decode())
                return
            
        print("✅ Deploy Finalizado com Sucesso!")
        print("🌍 URLs do Serviço:")
        print(f"   Webhook Server: http://{HOST}:5000")
        print(f"   WhatsApp Server: http://{HOST}:3001")
        
        print("\n⏳ Aguardando serviços subirem (10s)...")
        time.sleep(10)
        print("📜 Logs Recentes (Verifique QR Code se necessário):")
        stdin, stdout, stderr = ssh.exec_command(f"cd {REMOTE_DIR} && docker compose logs --tail=20 wa-server")
        print(stdout.read().decode())
        
    except Exception as e:
        print(f"❌ Erro Crítico: {e}")
    finally:
        ssh.close()
        # Limpar zip local
        if os.path.exists(zip_path):
            os.remove(zip_path)

if __name__ == "__main__":
    deploy()
