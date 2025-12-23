# 🚀 InvestPRO - Setup Completo do Neon

## ✅ Passo a Passo para Conectar 100% ao Neon

### 1️⃣ **Copiar SQL Completo**
- Abra o arquivo: `neon-schema-complete.sql`
- Copie TODO o conteúdo (Ctrl+A → Ctrl+C)

### 2️⃣ **Acessar Editor SQL do Neon**
- Acesse: https://console.neon.tech
- Selecione seu projeto
- Vá até: **SQL Editor**
- Clique em **New query**

### 3️⃣ **Colar SQL Completo**
- Cole todo o conteúdo (Ctrl+V)
- Clique em **Execute** (botão verde)
- ✅ Aguarde conclusão

### 4️⃣ **Verificar Criação das Tabelas**
- Vá para **Tables** no painel esquerdo
- Você verá **23 tabelas** criadas:
  - `users` ✅
  - `movimentos` ✅
  - `documentos` ✅
  - `kyc_status` ✅
  - `deriv_tokens` ✅
  - `trade_configurations` ✅
  - `trade_operations` ✅
  - `daily_pnl` ✅
  - `ai_logs` ✅
  - `ai_recovery_strategies` ✅
  - `market_data` ✅
  - E mais 12 tabelas avançadas...

### 5️⃣ **Obter CONNECTION STRING**
- No painel Neon, vá para **Connection strings**
- Copie a **PostgreSQL connection string**
- Formato: `postgresql://user:password@host/database?sslmode=require`

### 6️⃣ **Configurar no Replit**
- Vá para **Secrets** (chave no painel lateral)
- Crie uma nova secret chamada: `DATABASE_URL`
- Cole a connection string
- Clique **Save**

### 7️⃣ **Testar Conexão**
- O aplicativo já está configurado para sincronizar automaticamente
- Verifique os logs: `npm run dev`
- Você verá: `✅ PostgreSQL conectado`

---

## 📊 Schema do Banco

### **Tabelas Principais:**
- **users** - Usuários com KYC, CPF, endereço, PIX
- **movimentos** - Depósitos, rendimentos, saques
- **documentos** - Upload de documentos para KYC
- **kyc_status** - Status de verificação KYC

### **Tabelas de Trading:**
- **deriv_tokens** - Tokens da API Deriv (criptografados)
- **trade_configurations** - Configurações de operações
- **trade_operations** - Histórico de todas as operações
- **daily_pnl** - P&L diário e histórico
- **ai_logs** - Logs das análises de IA
- **ai_recovery_strategies** - Estratégias de recuperação

### **Tabelas Avançadas:**
- **experiment_tracking** - Rastreamento de experimentos
- **dynamic_weights** - Pesos dinâmicos dos modelos
- **episodic_memory** - Memória de episódios
- **emergent_patterns** - Padrões emergentes detectados
- **strategy_evolution** - Evolução de estratégias
- **meta_learning** - Transfer learning entre símbolos
- **performance_analytics** - Análises de performance

---

## 🔑 Variáveis de Ambiente

```bash
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
```

⚠️ **Importante:** A variável já está sendo usada pela aplicação automaticamente!

---

## ✅ Verificação Final

Após executar o SQL:

```sql
-- Execute no Neon SQL Editor para verificar:
SELECT COUNT(*) as total_tables 
FROM information_schema.tables 
WHERE table_schema = 'public';
-- Deve retornar: 23
```

---

## 🎯 Próximos Passos

1. ✅ Executar SQL no Neon
2. ✅ Configurar `DATABASE_URL` em Secrets
3. ✅ Reiniciar aplicação: `npm run dev`
4. ✅ Sistema sincroniza automaticamente!

---

## 💡 Notas Importantes

- ✅ **Foreign keys** já estão implementadas
- ✅ **Índices** otimizados para performance
- ✅ **Timestamps** automáticos com `DEFAULT NOW()`
- ✅ **Criptografia**: Token Deriv criptografado no backend
- ✅ **Dual Database**: SQLite local + PostgreSQL (redundância)

---

## 🚨 Troubleshooting

### Erro: "Table already exists"
- Copie um script SQL e execute `DROP TABLE IF EXISTS` primeiro
- Ou delete o banco e crie um novo

### Erro: "Connection refused"
- Verifique se a `DATABASE_URL` está correta
- Certifique-se de copiar a versão com `?sslmode=require`

### Dados não sincronizam?
- Verifique os logs: `npm run dev`
- A sincronização é automática a cada operação
- Se houver erro, aparecerá nos logs

---

## 📞 Suporte

Qualquer dúvida, execute novamente o SQL completo do arquivo `neon-schema-complete.sql`

✅ **Sistema 100% pronto para produção!**
