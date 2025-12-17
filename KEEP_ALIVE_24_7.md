# 🚀 Sistema Keep-Alive 24/7 - InvestPro

## ⚠️ IMPORTANTE: Por que você precisa disso?

### 🔍 Limitação Técnica do Replit

O Replit **detecta e ignora tráfego interno (localhost)** para fins de anti-hibernação.

**Como o Replit funciona:**
- ✅ **Tráfego Externo** (de IPs externos): Mantém servidor ativo
- ❌ **Tráfego Interno** (localhost/auto-requisições): Ignorado e detectado como "auto-tráfego"

Por isso, **pings internos NÃO impedem hibernação**, mesmo que sejam muito frequentes!

### 📊 Sem ping externo:
- ❌ Servidor hiberna quando você fecha o navegador/app
- ❌ Trading automático para de funcionar
- ❌ Sistema só funciona quando há alguém acessando
- ❌ Keep-alive interno é ignorado pelo Replit

### ✅ Com ping externo:
- ✅ Servidor SEMPRE ativo (24/7/365)
- ✅ Trading automático funcionando perpetuamente
- ✅ Sistema 100% independente
- ✅ Tráfego REAL de fora do Replit

---

## 🎯 Solução: Configurar Ping Externo (5 minutos)

### 🖥️ Interface Visual de Configuração (NOVO!)

Agora você pode configurar tudo através de uma **interface visual simples**:

1. **Acesse**: `/setup/keepalive` na sua aplicação
2. **Veja**: Todos os 6 endpoints disponíveis com URLs prontas
3. **Copie**: As URLs com um clique
4. **Configure**: Links diretos para todos os serviços gratuitos

**🚀 É a forma mais rápida e fácil de configurar!**

---

### Opção 1: UptimeRobot (RECOMENDADO - 100% Grátis)

#### Passo 1: Criar Conta
1. Acesse: https://uptimerobot.com
2. Clique em "Register"
3. Insira seu email e crie uma senha
4. Confirme seu email

#### Passo 2: Adicionar Monitor
1. Faça login no UptimeRobot
2. Clique no botão verde "+ Add New Monitor"
3. Preencha os campos:
   - **Monitor Type**: HTTP(s)
   - **Friendly Name**: InvestPro Trading System
   - **URL**: `https://SEU-REPL-URL.repl.co/api/ping`
     - ⚠️ **IMPORTANTE**: Substitua `SEU-REPL-URL` pela URL real do seu Replit!
     - Você pode encontrar sua URL no console do servidor ou na barra de endereços
   - **Monitoring Interval**: 5 minutes (plano gratuito)
   - **Monitor Timeout**: 30 seconds
   - **Alert Contacts**: Deixe marcado seu email para receber alertas

4. Clique em "Create Monitor"

#### Passo 3: Verificar que Está Funcionando
1. Aguarde 1-2 minutos
2. O monitor deve mostrar "Up" (verde) ✅
3. Pronto! Seu sistema agora roda 24/7!

---

### Opção 2: cron-job.org (Alternativa Grátis)

#### Passo 1: Criar Conta
1. Acesse: https://cron-job.org
2. Clique em "Sign up"
3. Crie sua conta gratuitamente

#### Passo 2: Criar Cron Job
1. Faça login
2. Clique em "Create cronjob"
3. Configurações:
   - **Title**: InvestPro Keep-Alive
   - **URL**: `https://SEU-REPL-URL.repl.co/api/ping`
   - **Schedule**: Every 5 minutes
   - **Method**: GET
   - **Enable job**: ✓ (marcado)

4. Salve o cron job
5. Verifique que está rodando (deve aparecer na lista)

---

### Opção 3: Outros Serviços (Alternativas)

**Serviços gratuitos que você pode usar:**
- Pingdom (https://pingdom.com) - 100 checks gratuitos
- Freshping (https://freshping.io) - Ilimitado grátis
- StatusCake (https://statuscake.com) - 10 monitores grátis
- Hetrix Tools (https://hetrixtools.com) - 15 monitores grátis

**Para todos:**
- URL: `https://SEU-REPL-URL.repl.co/api/ping`
- Intervalo: 5-10 minutos
- Método: GET ou HTTP(s)

---

## 📊 Como Saber se Está Funcionando?

### 1. Verificar Logs do Console
No console do Replit, você deve ver mensagens como:
```
💚 [KEEP-ALIVE] Sistema ATIVO | ⏱️  12h 34m | 📊 Trading: 3 sessões | 15:30:45
```

### 2. Verificar Endpoints de Status

Você pode acessar diretamente no navegador:

- **Ping simples**: `https://SEU-REPL.repl.co/api/ping`
  - Deve retornar: `OK`

- **Status completo**: `https://SEU-REPL.repl.co/api/health`
  - Deve retornar JSON com status do sistema

- **Keep-alive com info**: `https://SEU-REPL.repl.co/api/keepalive`
  - Deve retornar JSON com uptime e sessões ativas

### 3. Testar Fechando a Tela
1. Configure o ping externo
2. Feche o navegador/app
3. Aguarde 10-15 minutos
4. Abra novamente e verifique os logs
5. Deve mostrar que o sistema continuou funcionando! ✅

---

## 🔧 Arquitetura do Sistema Keep-Alive

### 🔍 Sistema de Debug Interno (Apenas Monitoramento)

O sistema possui um **ping interno leve** para debug:

- **Ping Debug**: A cada 60 segundos
  - Monitora uptime do sistema
  - Gera logs para diagnóstico
  - **NÃO IMPEDE HIBERNAÇÃO** (tráfego localhost é ignorado pelo Replit)

⚠️ **IMPORTANTE**: O sistema interno serve apenas para debug/logs. Ele **NÃO mantém** o servidor ativo no Replit.

### 📍 Múltiplos Endpoints Disponíveis para Ping Externo

O sistema possui **6 endpoints diferentes** que você pode usar em serviços de ping externos:

1. `/api/ping` - Ultra-leve (texto simples "OK") **← RECOMENDADO**
2. `/api/keepalive` - JSON com informações de uptime
3. `/api/status` - Status do sistema
4. `/api/alive` - Check de disponibilidade
5. `/api/heartbeat` - Heartbeat do servidor
6. `/api/health` - Health check completo

### 🌐 Ping Externo (OBRIGATÓRIO - Única Solução)

**Ping externo com serviços de terceiros**: A cada 5 minutos
- **CRÍTICO**: Esta é a ÚNICA forma de impedir hibernação no Replit!
- Use QUALQUER um dos 6 endpoints acima
- Configure em: `/setup/keepalive` (interface visual)
- Serviços recomendados: UptimeRobot, Freshping, Cron-Job.org

---

## ❓ Perguntas Frequentes

### P: Por que o ping interno não é suficiente?
**R**: O Replit **detecta o IP de origem** das requisições. Pings de localhost/127.0.0.1 são identificados como "auto-tráfego" e **completamente ignorados** para fins de anti-hibernação. Mesmo pings muito frequentes (a cada segundo) NÃO impedem hibernação. É necessário tráfego HTTP REAL de IPs externos.

### P: Qual serviço é o melhor?
**R**: UptimeRobot é o mais recomendado porque:
- 100% gratuito
- Interface simples
- Alertas por email
- 50 monitores grátis
- Intervalo de 5 minutos

### P: Posso usar mais de um serviço?
**R**: Sim! Quanto mais, melhor. Use 2-3 serviços diferentes para redundância máxima.

### P: Quantas vezes devo pingar?
**R**: Recomendado: 5-10 minutos. Não precisa ser mais frequente porque o sistema interno já pinga a cada 25-30 segundos.

### P: Tem custo?
**R**: NÃO! Todos os serviços recomendados têm plano gratuito suficiente.

### P: E se eu esquecer de configurar?
**R**: O sistema vai funcionar apenas quando houver alguém com o navegador/app aberto. Vai hibernar quando fechar.

---

## ✅ Checklist Final

- [ ] Escolhi um serviço de ping (UptimeRobot, cron-job.org, etc.)
- [ ] Criei conta no serviço escolhido
- [ ] Configurei monitor/cronjob com a URL `/api/ping`
- [ ] Verifiquei que o monitor está "Up" (verde/ativo)
- [ ] Testei fechando o navegador por 15 minutos
- [ ] Conferi os logs e vi que continuou funcionando
- [ ] Sistema 100% ativo 24/7! 🚀

---

## 🎯 Resumo Rápido

### Método 1: Interface Visual (MAIS FÁCIL) ⭐

1. **Acesse**: `/setup/keepalive` na sua aplicação
2. **Escolha** um serviço (UptimeRobot recomendado)
3. **Clique** em "Configurar" para criar conta
4. **Copie** a URL com um clique
5. **Configure** o monitor e pronto! ✅

**Tempo total**: 3 minutos  
**Custo**: R$ 0,00  
**Resultado**: Sistema funcionando 24/7/365 perpetuamente! 🚀

### Método 2: Manual

1. **Acesse**: https://uptimerobot.com
2. **Cadastre-se** (grátis)
3. **Adicione monitor** HTTP(s)
4. **URL**: `https://SEU-REPL.repl.co/api/ping` (ou qualquer outro endpoint)
5. **Intervalo**: 5 minutes
6. **Salve** e pronto! ✅

**Tempo total**: 5 minutos  
**Custo**: R$ 0,00

---

## 📞 Suporte

Se tiver problemas:
1. Verifique a URL do ping (deve terminar com `/api/ping`)
2. Teste a URL no navegador (deve retornar "OK")
3. Confira os logs do console no Replit
4. Verifique se o monitor está ativo no serviço de ping

---

**🔥 Com esta configuração, seu sistema de trading NUNCA vai parar! 🔥**
