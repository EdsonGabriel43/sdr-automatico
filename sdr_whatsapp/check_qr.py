import paramiko
import time

HOST = "187.77.48.57"
USER = "root"
PASS = "Senh@7179#Senh@"
REMOTE_DIR = "/root/sdr-backend"

def check_logs():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(HOST, username=USER, password=PASS)
        
        print("--- Docker Status ---")
        cmd = 'docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"'
        stdin, stdout, stderr = ssh.exec_command(cmd)
        print(stdout.read().decode())
        
        print("--- Logs WA Server (Via File) ---")
        # Redirecionar para arquivo para evitar problemas de buffer
        cmd_log = "docker logs sdr-wa-server > /tmp/walogs.txt 2>&1 && cat /tmp/walogs.txt"
        stdin, stdout, stderr = ssh.exec_command(cmd_log)
        print(stdout.read().decode())
    except Exception as e:
        print(f"Erro: {e}")
    finally:
        ssh.close()

if __name__ == "__main__":
    check_logs()
