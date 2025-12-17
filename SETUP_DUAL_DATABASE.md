# 🚀 Guia de Setup - Sistema Dual Database

## Passo a Passo para Ativar o Modo Dual Database

### 1️⃣ Criar Database PostgreSQL no Replit

1. Abra o painel **Tools** (barra lateral esquerda)
2. Clique em **PostgreSQL**
3. Clique em **"Create database"**
4. Aguarde 1-2 minutos até a criação estar completa
5. O Replit irá configurar automaticamente a variável `DATABASE_URL`

### 2️⃣ Executar Migração PostgreSQL

Após criar o database, execute a migração para criar as tabelas:

```bash
npx tsx server/migrate-postgres.ts
```

**Saída esperada:**
```
🚀 Iniciando migração PostgreSQL...
✅ Extensão pgcrypto ativada
✅ Tabelas PostgreSQL criadas com sucesso!
🔄 Sistema Dual Database pronto para uso
🎉 Migração concluída com sucesso!
```

### 3️⃣ Reiniciar Aplicação

Reinicie a aplicação para ativar o modo dual:

```bash
# O workflow reinicia automaticamente, mas você pode forçar:
# Ctrl+C no terminal e depois npm run dev
```

**Verificação nos logs:**
- ✅ Modo Dual: `🔄 Sistema Dual Database iniciado - SQLite + PostgreSQL em sincronização`
- ⚠️ Modo Single: `📀 Sistema Single Database - Usando apenas SQLite`

### 4️⃣ Restaurar Conta Admin (se necessário)

Se você perdeu acesso após remix, restaure sua conta:

```bash
curl -X POST http://localhost:5000/api/setup-admin \
  -H "Content-Type: application/json" \
  -d '{"email":"seu@email.com","password":"SuaSenha","nomeCompleto":"Seu Nome"}'
```

## 🎯 Verificação do Sistema

### Verificar Status

1. Acesse a aplicação
2. Faça login como admin
3. Vá para o dashboard
4. Verifique se seus dados estão presentes

### Logs de Sincronização

Durante o uso, você verá logs como:

```
✅ [DUAL-DB] Sincronização bem-sucedida: createUser
✅ [DUAL-DB] Sincronização bem-sucedida: updateMovimento
⚠️ [DUAL-DB] PostgreSQL falhou, usando SQLite para getUser
```

## 🔧 Solução de Problemas

### Problema: Migração falha com erro "pgcrypto"

**Solução:** O script já resolve isso automaticamente habilitando a extensão. Se o erro persistir:

```bash
# Verificar se DATABASE_URL existe
echo $DATABASE_URL

# Se vazio, criar database no Replit primeiro
```

### Problema: Sistema permanece em modo Single

**Possíveis causas:**
1. DATABASE_URL não configurado → Criar database no Replit
2. Migração não executada → Rodar `npx tsx server/migrate-postgres.ts`
3. Erro de conexão → Verificar logs de erro

### Problema: Dados inconsistentes após remix

**Solução:** Executar reconciliação manual:

```bash
# Via código (adicionar endpoint futuramente)
# Ou verificar logs automáticos de reconciliação
```

## 📊 Benefícios do Modo Dual

✅ **Zero perda de dados** - PostgreSQL persiste através de remixes  
✅ **Alta disponibilidade** - Failover automático entre bancos  
✅ **Performance otimizada** - PostgreSQL para queries, SQLite para backup  
✅ **Transparente** - Código não precisa saber qual banco está usando  

## 🎉 Pronto!

Seu sistema agora está protegido contra perda de dados. O PostgreSQL manterá seus dados seguros mesmo após remixes do Replit!

---

Para mais detalhes técnicos, consulte: **DUAL_DATABASE_SYSTEM.md**
