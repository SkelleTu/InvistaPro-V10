# Deploy InvestaPRO no Hetzner — Guia Rápido

## Passo 1 — Criar servidor no Hetzner

1. Acesse [hetzner.com/cloud](https://www.hetzner.com/cloud) e crie uma conta (aceita PayPal)
2. Crie um novo projeto → **Add Server**
3. Configurações:
   - **Location:** Nuremberg ou Falkenstein (mais próximo do Brasil)
   - **Image:** Ubuntu 22.04
   - **Type:** **CX22** (2 vCPU, 4GB RAM — R$19/mês) ← mínimo recomendado
   - **SSH Key:** gere ou adicione sua chave SSH
4. Clique em **Create & Buy** → anote o **IP do servidor**

---

## Passo 2 — Conectar ao servidor

Abra o terminal e conecte via SSH:

```bash
ssh root@SEU_IP_AQUI
```

---

## Passo 3 — Rodar o script de instalação

No servidor, execute:

```bash
curl -fsSL https://raw.githubusercontent.com/SEU_USUARIO/SEU_REPO/main/scripts/setup-hetzner.sh | bash
```

**OU** (se não tiver GitHub):

1. No seu computador, envie o script:
```bash
scp scripts/setup-hetzner.sh root@SEU_IP:/tmp/
```

2. No servidor, execute:
```bash
bash /tmp/setup-hetzner.sh
```

O script vai pedir:
- IP ou domínio do servidor
- Email do admin
- Suas chaves de API (DATABASE_URL, DERIV_APP_ID, etc.)

---

## Passo 4 — Enviar o código

O script vai pausar e pedir que você envie o código.  
**No seu computador** (outro terminal), execute:

```bash
bash scripts/update-hetzner.sh SEU_IP
```

Isso envia todos os arquivos automaticamente via rsync.

---

## Passo 5 — Pronto!

Após a instalação:

| Serviço | URL |
|---------|-----|
| **InvestaPRO** | `http://SEU_IP` |
| **Desktop MT5 (browser)** | `http://SEU_IP:6080/vnc.html` |

---

## Comandos úteis no servidor

```bash
pm2 status                    # ver status de todos os processos
pm2 logs investapro           # ver logs em tempo real
pm2 restart investapro        # reiniciar o app
pm2 restart investapro-desktop # reiniciar o desktop MT5
pm2 stop investapro           # parar o app
```

## Atualizar o código depois

Sempre que fizer mudanças no Replit, rode no seu computador:

```bash
bash scripts/update-hetzner.sh SEU_IP
```

---

## Variáveis de ambiente necessárias

O script vai pedir estas informações durante a instalação:

| Variável | Onde encontrar |
|----------|----------------|
| `DATABASE_URL` | Replit Secrets → DATABASE_URL |
| `TURSO_DATABASE_URL` | Replit Secrets → TURSO_DATABASE_URL |
| `TURSO_AUTH_TOKEN` | Replit Secrets → TURSO_AUTH_TOKEN |
| `DERIV_APP_ID` | Seu app na Deriv |
| `ENCRYPTION_KEY` | Replit Secrets → ENCRYPTION_KEY |
| `HUGGINGFACE_API_KEY` | huggingface.co |
