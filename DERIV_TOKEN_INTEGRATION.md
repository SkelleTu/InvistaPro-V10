# Integração Completa: Sistema de Token Deriv API

## Visão Geral
Implementação profissional e segura de armazenamento e gerenciamento de tokens Deriv API com:
- Criptografia AES-256-GCM (banco local)
- Sincronização dual com Supabase (PostgreSQL)
- Interface React intuitiva e responsiva
- Validação robusta e tratamento de erros
- Logging detalhado para debugging

## Componentes Implementados

### 1. Backend: Sistema de Armazenamento Seguro
**Arquivo:** `server/routes.ts` + `server/storage-dual.ts`

#### POST /api/trading/deriv-token
Salva token da Deriv com validação completa:
- ✅ Valida dados de entrada (Zod schema)
- ✅ Autentica usuário
- ✅ Testa conexão com Deriv API via WebSocket
- ✅ Verifica saldo da conta
- ✅ Criptografa token (AES-256-GCM)
- ✅ Salva em SQLite + PostgreSQL dual-mode
- ✅ Sincroniza com Supabase
- ✅ Logging detalhado de 7 passos

**Resposta Sucesso:**
```json
{
  "message": "Token Deriv configurado com sucesso",
  "accountType": "demo",
  "balance": 1000,
  "currency": "USD",
  "tokenConfigured": true,
  "operationId": "DERIV_TOKEN_CONFIG_...",
  "duration": "2500ms"
}
```

#### GET /api/trading/deriv-token
Busca status do token (MASKED por segurança):
```json
{
  "tokenConfigured": true,
  "token": "a1-abc123****",
  "accountType": "demo",
  "isActive": true,
  "createdAt": "2025-12-19T..."
}
```

#### DELETE /api/trading/deriv-token
Remove token Deriv:
- Desativa token no banco
- Sincroniza com Supabase
- Limpa configuração do usuário

### 2. Frontend: Componente React
**Arquivo:** `client/src/components/deriv-token-settings.tsx`

#### Features:
- ✅ Status visual (configurado/não configurado)
- ✅ Mostrar/ocultar token (toggle Eye icon)
- ✅ Seleção de conta (Demo/Real)
- ✅ Instruções passo-a-passo integradas
- ✅ Tratamento de erros com toast notifications
- ✅ Loading states com spinners
- ✅ Validação de entrada
- ✅ Botões para alterar ou remover token

#### Fluxo UX:
1. Exibe status atual (se configurado)
2. Fornece opção para alterar token
3. Mostra formulário de entrada de token
4. Valida e conecta à Deriv
5. Exibe resultado (sucesso/erro)
6. Permite remover token

### 3. Integração na Página de Trading
**Arquivo:** `client/src/pages/trading-system.tsx`

Adicionado componente `<DerivTokenSettings />` na aba "Configurações" do dashboard de trading:
- Primeiro item da seção de configurações
- Acesso fácil para usuários autorizados
- Integração com sistema dual database (SQLite + PostgreSQL)

## Segurança

### Criptografia
- **Algoritmo:** AES-256-GCM (simétrico, altamente seguro)
- **Chave:** 32 bytes (256 bits) hexadecimal
- **IV:** Aleatório para cada encriptação
- **Auth Tag:** Autenticação de integridade

### Gerenciamento de Tokens
- Nunca exibe token completo ao usuário (mascarado após 8 primeiros chars)
- Token descriptografado apenas internamente no servidor
- Ambiente: `ENCRYPTION_KEY` (obrigatório)

### Armazenamento Dual
- **SQLite:** Local (backup, fallback)
- **PostgreSQL/Supabase:** Produção (principal)
- **Sincronização:** Bidirecional em tempo real
- **Failover:** Automático se principal falhar

## Sincronização Supabase

### Tabelas Sincronizadas
```
- deriv_tokens: Tokens encriptados com metadata
- users: Timestamp de atualização
- trade_operations: Operações do sistema
- trade_configurations: Configurações de trading
```

### Fluxo de Sincronização
1. Salva em SQLite (transação)
2. Salva em PostgreSQL (dual-write)
3. Sincroniza com Supabase (async queue)
4. Se falhar: retry automático, não bloqueia usuário

## Logging & Debugging

### Console Output (7 Passos)
```
🔧🔧... (banner)
🚀 INÍCIO: Configuração Token Deriv - ID: DERIV_TOKEN_CONFIG_...
📝 PASSO 1: Validando dados...
🔐 PASSO 2: Verificando autenticação...
🌐 PASSO 3: Testando conexão com Deriv...
💰 PASSO 4: Verificando saldo...
💾 PASSO 5: Salvando no banco...
🔄 PASSO 7: Sincronizando Supabase...
🎉🎉... (sucesso)
```

### Error Tracking
- Cada erro capturado com Error ID único
- Contexto completo: usuário, operação, stack trace
- Rastreamento no `errorTracker` do sistema

## Variáveis de Ambiente

**Obrigatório:**
```
ENCRYPTION_KEY=<64-char-hex>    # Chave de criptografia AES-256
```

**Deriv API:**
```
DERIV_APP_ID=1089               # ID da aplicação (padrão)
```

**Supabase:**
```
SUPABASE_URL=https://...
SUPABASE_ANON_KEY=...
```

## Testes

### Teste Manual - POST (Criar Token)
```bash
curl -X POST http://localhost:5000/api/trading/deriv-token \
  -H "Content-Type: application/json" \
  -d '{
    "token": "a1-abc123...",
    "accountType": "demo"
  }'
```

### Teste Manual - GET (Verificar Token)
```bash
curl http://localhost:5000/api/trading/deriv-token
```

### Teste Manual - DELETE (Remover Token)
```bash
curl -X DELETE http://localhost:5000/api/trading/deriv-token
```

## Fluxo Completo de Usuário

1. **Usuário acessa** Dashboard → Renda Variável → Configurações
2. **Clica em** "Salvar e Conectar" (ou "Alterar Token")
3. **Preenche** token Deriv (obtida em api.deriv.com/dashboard)
4. **Seleciona** tipo de conta (Demo ou Real)
5. **Sistema valida:**
   - Token format correto
   - Conexão com Deriv API
   - Saldo disponível
6. **Sistema salva:**
   - Criptografa token
   - Armazena em SQLite
   - Sincroniza com Supabase
7. **Usuário vê:** ✅ "Token configurado com sucesso"
8. **Sistema exibe:** Saldo, tipo de conta, last updated
9. **Usuário pode:** Alterar token ou Remover token

## Troubleshooting

### "ENCRYPTION_KEY environment variable is required"
- Configure `ENCRYPTION_KEY` no arquivo `.env`
- Gere com: `openssl rand -hex 32`

### "Token inválido ou erro de conexão"
- Verifique token em https://api.deriv.com/dashboard/
- Token pode estar expirada
- Crie uma nova token

### "Não foi possível verificar a conta Deriv"
- Conta pode estar sem fundos
- Token pode não ter escopo "Read" ou "Admin"
- Tente reconectar

### Sincronização Supabase falha (não bloqueante)
- Sistema continua funcionando com SQLite
- Sincronização retry automático
- Verifique logs para detalhes

## Próximas Melhorias

- [ ] Refresh automático de token antes de expiração
- [ ] Histórico de tentativas de conexão
- [ ] Validação de escopo de token
- [ ] 2FA para mudanças de token
- [ ] Notificações de expiração próxima
- [ ] Rate limiting para proteção

## Documentação Adicional

### Referência Rápida de Chamadas da API
Veja `DERIV_API_QUICK_REFERENCE.md` para:
- Todas as chamadas WebSocket suportadas
- Estrutura de requisição/resposta completa
- Exemplos de cada operação
- Símbolos disponíveis para Digit Differs
- Configuração de tokens e escopos
- Rate limits e timeouts

---

**Data:** 19 de dezembro de 2025
**Versão:** 1.0.0
**Status:** ✅ Produção Pronto
**Compatível com:** Deriv API v3 (WebSocket)
