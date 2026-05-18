#!/bin/bash
# ================================================================
# InvestaPRO — Atualizar código no servidor Hetzner
# Execute este script no SEU COMPUTADOR (não no servidor)
# Uso: bash scripts/update-hetzner.sh IP_DO_SERVIDOR
# ================================================================

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

SERVER="${1:-}"
[[ -z "$SERVER" ]] && read -p "IP ou domínio do servidor Hetzner: " SERVER
[[ -z "$SERVER" ]] && err "Informe o IP do servidor"

APP_DIR="/opt/investapro"

echo ""
echo "📦 Enviando código para $SERVER..."
echo ""

rsync -az --progress \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='database-backups' \
  --exclude='mt5-uploaded' \
  --exclude='*.db' \
  --exclude='.env' \
  --exclude='logs/' \
  --exclude='whatsapp-session' \
  ./ "root@${SERVER}:${APP_DIR}/"

log "Código enviado!"

echo ""
echo "🔄 Reinstalando dependências e reiniciando..."
echo ""

ssh "root@${SERVER}" << REMOTE
  cd ${APP_DIR}
  npm install --production 2>/dev/null || npm install
  npm run build 2>/dev/null || true
  chown -R investapro:investapro ${APP_DIR}
  sudo -u investapro pm2 restart investapro
  sudo -u investapro pm2 status
REMOTE

log "InvestaPRO atualizado e reiniciado!"
echo ""
echo "  🌐 Acesse: http://$SERVER"
echo "  📋 Logs:  ssh root@$SERVER 'pm2 logs investapro'"
