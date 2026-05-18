#!/bin/bash
# ================================================================
# InvestaPRO — Script de Instalação Automática para Hetzner/VPS
# Ubuntu 22.04 LTS
# Uso: bash setup-hetzner.sh
# ================================================================

set -e
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }
step() { echo -e "\n${BLUE}==>${NC} $1"; }

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║          InvestaPRO — Instalação no Hetzner              ║"
echo "║     Node.js + PM2 + Wine + MT5 + noVNC + Nginx          ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

[[ $EUID -ne 0 ]] && err "Execute como root: sudo bash setup-hetzner.sh"
[[ ! -f /etc/os-release ]] && err "Sistema operacional não identificado"
. /etc/os-release
[[ "$ID" != "ubuntu" && "$ID" != "debian" ]] && err "Requer Ubuntu ou Debian"

APP_DIR="/opt/investapro"
APP_USER="investapro"
NODE_VERSION="20"

# ── Coletar configurações ────────────────────────────────────────
step "Configuração inicial"
echo ""
read -p "  Domínio ou IP do servidor (ex: 123.456.789.0 ou meusite.com): " SERVER_DOMAIN
read -p "  Email do admin: " ADMIN_EMAIL
read -p "  ENCRYPTION_KEY (deixe vazio para gerar automaticamente): " ENCRYPTION_KEY
[[ -z "$ENCRYPTION_KEY" ]] && ENCRYPTION_KEY=$(openssl rand -hex 32) && log "ENCRYPTION_KEY gerada: $ENCRYPTION_KEY"
read -p "  DATABASE_URL (PostgreSQL Neon — cole a URL completa): " DATABASE_URL
read -p "  TURSO_DATABASE_URL (Turso — ex: libsql://...): " TURSO_DATABASE_URL
read -p "  TURSO_AUTH_TOKEN: " TURSO_AUTH_TOKEN
read -p "  DERIV_APP_ID: " DERIV_APP_ID
read -p "  HUGGINGFACE_API_KEY (pode deixar vazio): " HF_KEY
SESSION_SECRET=$(openssl rand -hex 32)
echo ""
log "Configurações coletadas. Iniciando instalação..."

# ── Sistema ──────────────────────────────────────────────────────
step "Atualizando sistema"
apt-get update -qq && apt-get upgrade -y -qq
apt-get install -y -qq \
  curl wget git unzip build-essential \
  xvfb x11vnc openbox xauth xsetroot \
  python3 python3-pip \
  nginx certbot python3-certbot-nginx \
  ufw htop net-tools
log "Pacotes do sistema instalados"

# ── Node.js 20 ───────────────────────────────────────────────────
step "Instalando Node.js $NODE_VERSION"
curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - -qq
apt-get install -y -qq nodejs
log "Node.js $(node -v) instalado"

# ── PM2 ─────────────────────────────────────────────────────────
step "Instalando PM2 (gerenciador de processos 24/7)"
npm install -g pm2 -q
log "PM2 $(pm2 -v) instalado"

# ── Python + websockify ──────────────────────────────────────────
step "Instalando websockify (proxy VNC→WebSocket)"
pip3 install websockify -q
log "websockify instalado"

# ── Wine staging ─────────────────────────────────────────────────
step "Instalando Wine staging (para rodar MT5)"
dpkg --add-architecture i386
curl -fsSL https://dl.winehq.org/wine-builds/winehq.key | gpg --dearmor -o /etc/apt/keyrings/winehq-archive.key
wget -q -NP /etc/apt/sources.list.d/ \
  https://dl.winehq.org/wine-builds/ubuntu/dists/jammy/winehq-jammy.sources 2>/dev/null || \
  echo "deb [arch=amd64,i386 signed-by=/etc/apt/keyrings/winehq-archive.key] https://dl.winehq.org/wine-builds/ubuntu/ jammy main" \
  > /etc/apt/sources.list.d/winehq.list
apt-get update -qq
apt-get install -y -qq --install-recommends winehq-staging
log "Wine $(wine --version) instalado"

# ── noVNC ────────────────────────────────────────────────────────
step "Instalando noVNC (acesso desktop pelo browser)"
if [[ ! -d /opt/novnc ]]; then
  git clone -q https://github.com/novnc/noVNC.git /opt/novnc
  git clone -q https://github.com/novnc/websockify.git /opt/novnc/utils/websockify
fi
log "noVNC instalado em /opt/novnc"

# ── Usuário da aplicação ─────────────────────────────────────────
step "Criando usuário $APP_USER"
id "$APP_USER" &>/dev/null || useradd -m -s /bin/bash "$APP_USER"
usermod -aG sudo "$APP_USER" 2>/dev/null || true
log "Usuário $APP_USER pronto"

# ── Diretório da aplicação ───────────────────────────────────────
step "Preparando diretório $APP_DIR"
mkdir -p "$APP_DIR"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
log "Diretório pronto"

# ── Arquivo .env ─────────────────────────────────────────────────
step "Criando arquivo de configuração .env"
cat > "$APP_DIR/.env" << EOF
NODE_ENV=production
PORT=5000

ENCRYPTION_KEY=$ENCRYPTION_KEY
SESSION_SECRET=$SESSION_SECRET

ADMIN_EMAIL=$ADMIN_EMAIL
VITE_ADMIN_EMAIL=$ADMIN_EMAIL

DATABASE_URL=$DATABASE_URL
TURSO_DATABASE_URL=$TURSO_DATABASE_URL
TURSO_AUTH_TOKEN=$TURSO_AUTH_TOKEN

DERIV_APP_ID=$DERIV_APP_ID
HUGGINGFACE_API_KEY=$HF_KEY

SERVER_DOMAIN=$SERVER_DOMAIN
ISSUER_URL=https://replit.com/oidc
EOF
chmod 600 "$APP_DIR/.env"
chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
log ".env criado com segurança"

# ── Download do InvestaPRO ───────────────────────────────────────
step "Transferindo código InvestaPRO"
echo ""
warn "Agora você precisa enviar o código para o servidor."
warn "Em outro terminal, execute este comando no seu computador:"
echo ""
echo "  rsync -az --exclude='node_modules' --exclude='.git' \\"
echo "    --exclude='database-backups' --exclude='mt5-uploaded' \\"
echo "    ./ root@${SERVER_DOMAIN}:${APP_DIR}/"
echo ""
read -p "  Pressione ENTER após enviar o código... "

[[ ! -f "$APP_DIR/package.json" ]] && err "Código não encontrado em $APP_DIR. Envie os arquivos primeiro."
log "Código encontrado em $APP_DIR"

# ── Instalar dependências e build ────────────────────────────────
step "Instalando dependências npm"
cd "$APP_DIR"
sudo -u "$APP_USER" npm install --production 2>/dev/null || npm install
log "Dependências instaladas"

step "Compilando TypeScript (build de produção)"
sudo -u "$APP_USER" npm run build 2>/dev/null || warn "Build com aviso — verificar manualmente"
log "Build concluído"

chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# ── PM2 — processo Node.js 24/7 ─────────────────────────────────
step "Configurando PM2 para rodar 24/7"
cat > "$APP_DIR/ecosystem.config.js" << 'EOF'
module.exports = {
  apps: [{
    name: 'investapro',
    script: 'npm',
    args: 'start',
    cwd: '/opt/investapro',
    env_file: '/opt/investapro/.env',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    restart_delay: 5000,
    log_file: '/var/log/investapro/app.log',
    error_file: '/var/log/investapro/error.log',
    time: true
  }]
}
EOF

mkdir -p /var/log/investapro
chown -R "$APP_USER:$APP_USER" /var/log/investapro

sudo -u "$APP_USER" pm2 start "$APP_DIR/ecosystem.config.js"
sudo -u "$APP_USER" pm2 save
env PATH=$PATH:/usr/bin pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER" | tail -1 | bash
log "PM2 configurado — InvestaPRO inicia automaticamente no boot"

# ── PM2 — Desktop virtual (Xvfb + noVNC) ────────────────────────
step "Configurando desktop virtual MT5 (Xvfb + noVNC)"
cat > "$APP_DIR/desktop-start.sh" << 'DESKEOF'
#!/bin/bash
export DISPLAY=:99
export WINEPREFIX="$HOME/.wine-mt5"
export WINEARCH=win64
export WINEDEBUG=-all

pkill -f "Xvfb :99" 2>/dev/null; sleep 1
pkill -f x11vnc 2>/dev/null; sleep 1
pkill -f "websockify.*6080" 2>/dev/null; sleep 1

Xvfb :99 -screen 0 1280x800x24 -nolisten tcp &
sleep 3

openbox --display :99 &
sleep 1

x11vnc -display :99 -forever -nopw -shared -rfbport 5901 -bg -quiet
sleep 2

websockify --daemon --web=/opt/novnc 6080 localhost:5901
sleep 2

echo "Desktop virtual iniciado! Acesse: http://SEU_IP:6080/vnc.html"
DESKEOF
chmod +x "$APP_DIR/desktop-start.sh"
chown "$APP_USER:$APP_USER" "$APP_DIR/desktop-start.sh"

cat >> "$APP_DIR/ecosystem.config.js" << 'EOF2'
,{
    name: 'investapro-desktop',
    script: '/opt/investapro/desktop-start.sh',
    instances: 1,
    autorestart: true,
    watch: false,
    restart_delay: 10000,
    log_file: '/var/log/investapro/desktop.log',
    error_file: '/var/log/investapro/desktop-error.log',
    time: true
  }
EOF2

sudo -u "$APP_USER" pm2 start "$APP_DIR/ecosystem.config.js" --only investapro-desktop 2>/dev/null || true
sudo -u "$APP_USER" pm2 save
log "Desktop virtual configurado"

# ── Nginx reverse proxy ──────────────────────────────────────────
step "Configurando Nginx (proxy reverso)"
cat > /etc/nginx/sites-available/investapro << NGINXEOF
server {
    listen 80;
    server_name $SERVER_DOMAIN;

    client_max_body_size 500M;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
    }

    location /api/desktop/vnc-ws {
        proxy_pass http://localhost:6080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_read_timeout 86400;
    }
}
NGINXEOF

ln -sf /etc/nginx/sites-available/investapro /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
log "Nginx configurado"

# ── Firewall ─────────────────────────────────────────────────────
step "Configurando firewall (UFW)"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
log "Firewall ativo: portas 22 (SSH), 80 (HTTP), 443 (HTTPS)"

# ── SSL (opcional) ───────────────────────────────────────────────
if [[ "$SERVER_DOMAIN" =~ \. ]] && [[ ! "$SERVER_DOMAIN" =~ ^[0-9] ]]; then
  step "Configurando SSL/HTTPS gratuito (Let's Encrypt)"
  certbot --nginx -d "$SERVER_DOMAIN" --non-interactive --agree-tos -m "$ADMIN_EMAIL" 2>/dev/null \
    && log "SSL configurado — HTTPS ativo" \
    || warn "SSL não configurado — configure manualmente com: certbot --nginx -d $SERVER_DOMAIN"
fi

# ── MT5 download ─────────────────────────────────────────────────
step "Baixando e instalando MetaTrader 5"
MT5_DIR="$APP_DIR/mt5"
mkdir -p "$MT5_DIR"
chown "$APP_USER:$APP_USER" "$MT5_DIR"

sudo -u "$APP_USER" bash << WINEEOF
export DISPLAY=:99
export WINEPREFIX="$HOME/.wine-mt5"
export WINEARCH=win64
export WINEDEBUG=-all
wineboot --init 2>/dev/null
sleep 5
curl -L "https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe" \
  -o "/tmp/mt5setup.exe" 2>/dev/null
wine /tmp/mt5setup.exe /S 2>/dev/null &
sleep 30
echo "MT5 em instalação em background..."
WINEEOF
log "MT5 iniciando instalação (pode demorar 1-2 min)"

# ── Resumo final ─────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║              INSTALAÇÃO CONCLUÍDA! 🎉                   ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "  🌐 InvestaPRO:    http://$SERVER_DOMAIN"
echo "  🖥️  Desktop MT5:   http://$SERVER_DOMAIN:6080/vnc.html"
echo "  📋 Logs:          pm2 logs investapro"
echo "  🔄 Reiniciar:     pm2 restart investapro"
echo "  📊 Status:        pm2 status"
echo ""
echo "  ENCRYPTION_KEY=$ENCRYPTION_KEY"
echo "  (salve esta chave em local seguro!)"
echo ""
echo "  Para SSL: certbot --nginx -d $SERVER_DOMAIN"
echo ""
sudo -u "$APP_USER" pm2 status
