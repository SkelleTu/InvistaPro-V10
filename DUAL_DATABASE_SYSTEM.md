# 🔄 Sistema Dual Database - InvistaPRO

## Visão Geral

O InvistaPRO agora possui um **Sistema Dual Database** que sincroniza automaticamente **SQLite** e **PostgreSQL** em tempo real, garantindo que seus dados nunca sejam perdidos durante remixes do Replit.

## 🎯 Como Funciona

### Modo de Operação

O sistema opera em dois modos:

1. **Modo Dual Database** (PostgreSQL + SQLite)
   - Ativo quando DATABASE_URL está configurado
   - Todas as operações são escritas em AMBOS os bancos simultaneamente
   - Se um banco falhar, o outro assume automaticamente
   - Sincronização bidirecional em tempo real

2. **Modo Single Database** (apenas SQLite)
   - Ativo quando DATABASE_URL não está configurado
   - Usa apenas SQLite local
   - Sistema continua funcionando normalmente

### Arquitetura

```
┌─────────────────────────────────────┐
│     Aplicação (routes.ts)           │
│                                     │
│  usa: dualStorage (ao invés de storage)
└──────────────┬──────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│        DualStorage Layer             │
│  (server/storage-dual.ts)            │
│                                      │
│  • dualWrite() - escreve em ambos   │
│  • dualRead() - lê com fallback     │
│  • reconcileData() - sincroniza     │
└─────────┬──────────────┬─────────────┘
          │              │
          ▼              ▼
    ┌─────────┐    ┌─────────────┐
    │ SQLite  │    │ PostgreSQL  │
    │ (local) │    │   (Neon)    │
    └─────────┘    └─────────────┘
```

## 🚀 Como Ativar o Modo Dual Database

### Passo 1: Criar DATABASE no Replit

1. Abra o painel "Tools" no Replit
2. Clique em "PostgreSQL"
3. Clique em "Create database"
4. Aguarde a criação (1-2 minutos)

### Passo 2: Executar Migração PostgreSQL

Após criar o database, execute o script de migração:

```bash
npm run migrate:postgres
```

Ou manualmente:

```bash
npx tsx server/migrate-postgres.ts
```

Isso criará todas as tabelas necessárias no PostgreSQL.

### Passo 3: Verificar Ativação

Reinicie a aplicação e verifique os logs:

- ✅ **Modo Dual**: `🔄 Sistema Dual Database iniciado - SQLite + PostgreSQL em sincronização`
- ⚠️ **Modo Single**: `📀 Sistema Single Database - Usando apenas SQLite`

## 🛡️ Sistema de Failover Automático

### Como Funciona

1. **Escrita Dual (dualWrite)**:
   - Tenta escrever em AMBOS os bancos simultaneamente
   - Se PostgreSQL falhar → usa SQLite
   - Se SQLite falhar → usa PostgreSQL
   - Se AMBOS falharem → lança erro

2. **Leitura com Fallback (dualRead)**:
   - Tenta ler do PostgreSQL (banco primário)
   - Se falhar → automaticamente lê do SQLite
   - Continua funcionando mesmo se um banco cair

### Exemplo de Logs

```
✅ [DUAL-DB] Sincronização bem-sucedida: createUser
⚠️ [DUAL-DB] PostgreSQL falhou, usando SQLite para updateUser
🔥 [DUAL-DB] AMBOS BANCOS FALHARAM em deleteUser
```

## 📊 Reconciliação de Dados

### Quando Usar

A reconciliação sincroniza dados entre os bancos quando há inconsistências.

### Como Usar

```javascript
// Via API (se endpoint implementado)
POST /api/admin/reconcile-data

// Ou diretamente no código
await dualStorage.reconcileData();
```

### O que Faz

1. Compara quantidade de dados em ambos os bancos
2. Identifica qual banco tem mais dados
3. Sincroniza do mais completo para o outro
4. Registra o processo nos logs

## 🔧 Arquivos do Sistema

### Principais Arquivos

| Arquivo | Descrição |
|---------|-----------|
| `server/storage-dual.ts` | Camada de abstração dual database |
| `server/db-postgres.ts` | Conexão PostgreSQL via Neon |
| `server/storage-postgres.ts` | Implementação PostgreSQL storage |
| `server/schemas/postgres-schema.ts` | Schema PostgreSQL Drizzle |
| `server/migrate-postgres.ts` | Script de migração |

### Schema Compartilhado

- `shared/schema.ts` - Schema base usado por ambos os bancos

## 🎯 Benefícios

### Prevenção de Perda de Dados

- ✅ **Remix do Replit**: PostgreSQL persiste, SQLite se perde → dados restaurados do PostgreSQL
- ✅ **Falha do PostgreSQL**: SQLite assume automaticamente
- ✅ **Falha do SQLite**: PostgreSQL assume automaticamente
- ✅ **Sincronização contínua**: Ambos sempre atualizados

### Performance

- 📈 **Leitura otimizada**: PostgreSQL como primário (mais rápido em queries complexas)
- 🔄 **Escrita duplicada**: Overhead mínimo com Promise.allSettled
- ⚡ **Fallback instantâneo**: Sem interrupção de serviço

## 📝 Logs e Debugging

### Como Identificar Problemas

1. **Modo Single quando deveria ser Dual**:
   ```
   ⚠️ DATABASE_URL não definida. Usando apenas SQLite
   ```
   → Criar database no Replit

2. **Erro de conexão PostgreSQL**:
   ```
   ❌ Erro ao conectar PostgreSQL: [erro]
   ⚠️ Continuando apenas com SQLite
   ```
   → Verificar DATABASE_URL e conexão

3. **Falha de sincronização**:
   ```
   ❌ [DUAL-DB] PostgreSQL falhou em createUser: [erro]
   ```
   → Sistema continua com SQLite automaticamente

## 🔐 Segurança

### Dados Sensíveis

- Senhas hasheadas em ambos os bancos
- Biometria criptografada com AES-256-GCM
- Tokens Deriv criptografados com ENCRYPTION_KEY

### Consistência

- Transações atômicas em cada banco
- Rollback automático em caso de falha parcial
- Logs detalhados para auditoria

## 🚨 Troubleshooting

### Problema: Sistema não inicia

**Solução**: Verificar logs de inicialização:

```bash
# Verificar se DATABASE_URL existe
echo $DATABASE_URL

# Se vazio, criar database no Replit
```

### Problema: Dados inconsistentes

**Solução**: Executar reconciliação:

```bash
# Fazer backup primeiro
cp database/investpro.db database/investpro.db.backup

# Executar reconciliação via API ou código
```

### Problema: Conta admin perdida após remix

**Solução**: Restaurar conta via endpoint:

```bash
curl -X POST http://localhost:5000/api/setup-admin \
  -H "Content-Type: application/json" \
  -d '{"email":"seu@email.com","password":"SuaSenha","nomeCompleto":"Seu Nome"}'
```

## 📚 Próximos Passos

### Implementações Futuras

- [ ] Dashboard de monitoramento dual database
- [ ] Sincronização scheduled (cron job)
- [ ] Backup automático PostgreSQL → SQLite
- [ ] Health check endpoint para ambos os bancos
- [ ] Métricas de performance e latência

## 🎉 Conclusão

O Sistema Dual Database garante:

- ✅ **Zero perda de dados** em remixes
- ✅ **Alta disponibilidade** com failover automático
- ✅ **Sincronização transparente** sem impacto no código
- ✅ **Fallback gracioso** quando PostgreSQL não disponível

Seus dados estão seguros! 🛡️
