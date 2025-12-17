# Sistema Keep-Alive Vercel ↔ Replit

Este projeto mantém o Replit ativo 24/7 através de pings automáticos a cada 4 minutos.

## 🚀 Deploy no Vercel

### Passo 1: Deploy

1. Acesse [vercel.com](https://vercel.com) e faça login
2. Clique em "Add New Project"
3. Importe este repositório ou faça upload da pasta `vercel-api`
4. Clique em "Deploy"

### Passo 2: Configurar Variável de Ambiente

1. No dashboard do Vercel, vá em "Settings" → "Environment Variables"
2. Adicione a variável:
   - **Key:** `REPLIT_URL`
   - **Value:** URL do seu Replit (ex: `https://seu-app.replit.app`)
3. Clique em "Save"
4. Faça um novo deploy (ou aguarde o próximo cron)

### Passo 3: Verificar Cron Job

O Vercel vai pingar o Replit automaticamente a cada 4 minutos.

Para verificar se está funcionando:
- Acesse: `https://seu-app-vercel.vercel.app/api/status`
- Verifique os logs em: Vercel Dashboard → seu projeto → "Logs"

## 📡 Endpoints

| Endpoint | Descrição |
|----------|-----------|
| `/api/ping` | Recebe/envia pings |
| `/api/status` | Status do sistema |
| `/api/cron-ping-replit` | Executado automaticamente a cada 4 min |

## 🔧 Como Funciona

```
┌──────────────┐        a cada 4 min        ┌──────────────┐
│    VERCEL    │ ──────────────────────────►│    REPLIT    │
│  (Cron Job)  │                            │  (Backend)   │
│              │◄─────────── ping back ─────│              │
└──────────────┘                            └──────────────┘
```

1. Vercel executa o cron job a cada 4 minutos
2. O cron faz uma requisição POST para `/api/ping` do Replit
3. Replit recebe o ping e responde
4. Replit permanece ativo por ter recebido tráfego externo

## ⚠️ IMPORTANTE - Plano Gratuito do Vercel

O plano **gratuito do Vercel** tem limitações sérias para cron jobs:
- Apenas **2 cron jobs**
- Execução máxima de **1x por dia**

Para cron a cada 4 minutos, você precisaria do **plano Pro ($20/mês)**.

---

## 🆓 SOLUÇÃO 100% GRATUITA (Recomendada)

Como queremos **custo zero**, use um destes serviços gratuitos para pingar o Replit:

### Opção 1: Cron-job.org (Recomendado)
1. Acesse [cron-job.org](https://cron-job.org)
2. Crie uma conta gratuita
3. Adicione um cron job com:
   - **URL:** `https://seu-app.replit.app/api/ping`
   - **Intervalo:** A cada 5 minutos
4. Ative o job

### Opção 2: UptimeRobot
1. Acesse [uptimerobot.com](https://uptimerobot.com)
2. Crie conta gratuita (50 monitors)
3. Adicione monitor HTTP para sua URL do Replit
4. Intervalo: 5 minutos (padrão gratuito)

### Opção 3: Freshping
1. Acesse [freshping.io](https://freshping.io)
2. Crie conta gratuita
3. Adicione check para sua URL do Replit
4. Intervalo: 1 minuto (gratuito!)

**Isso é 100% gratuito e funciona perfeitamente!**

---

## Quando usar este projeto Vercel?

Este projeto Vercel só é necessário se você quiser:
1. Ter um frontend separado no Vercel
2. Usar o cron do Vercel (precisa do plano Pro)

**Para apenas manter o Replit ativo 24/7, os serviços gratuitos acima são suficientes!**
