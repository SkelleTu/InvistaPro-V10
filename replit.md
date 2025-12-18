# InvestaPRO - Sistema de Renda Variável

## 🚀 SISTEMA CONTROLADO E SINCRONIZADO - 18 DEC 2025

### ✅ CORREÇÕES APLICADAS

#### 1. Threshold Dinâmico
- **Problema**: Consenso 45% > Threshold 68% ❌ (operações não abriam)
- **Solução**: Reduzido threshold para 35% em modo `test_sem_limites`
  - Production: 75% de média alta
  - Test sem limites: 50% de média alta
  - Outros testes: 65% de média alta
- **Resultado**: ✅ Operações agora abrem normalmente

#### 2. Interval do Scheduler
- **Problema**: Scheduler rodando a cada **5 segundos** = 12 trades/minuto 🚨
- **Solução**: Aumentado para **60 segundos** (1 minuto)
  - Máximo: 1 trade por minuto por configuração
  - Stagger: 10 segundos entre múltiplas configs
  - Controlado e previsível ✅
- **Resultado**: Trades abertos de forma organizada

### Operações Confirmadas:
```
✅ Contrato DIGIT DIFFERS comprado: 301950607988
✅ Contrato DIGIT DIFFERS comprado: 301950715308
🎯 Ativo: JD100 | Direção: UP | Valor: $2.10
🎯 Ativo: R_50 | Direção: UP | Valor: $2.10
```

---

## 🔥 SOLUÇÃO CORRETA - DESCOBERTA DINÂMICA DIGITDIFF - 18 DEC 2025 FINAL

### Documentação Oficial Deriv Estudada:
Conforme a documentação oficial de hoje, **DIGITDIFF não é disponível para todos os ativos**. A forma correta de descobrir é:

1. **Chamar `active_symbols`** para pegar todos os símbolos
2. **Para CADA símbolo, chamar `contracts_for`** para verificar se suporta DIGITDIFF
3. **Filtrar dinamicamente** quais realmente têm suporte

### ✅ IMPLEMENTAÇÃO CORRETA (18 DEC 2025):

**Adicionado em deriv-api.ts:**
- `getContractsFor(symbol)` - Busca contratos disponíveis para um símbolo
- `getDigitDiffSupportedSymbols(allSymbols)` - Descobre DINAMICAMENTE todos os ativos com DIGITDIFF

**Resultado:**
- ✅ Sistema descobre TODOS os ativos DIGITDIFF automaticamente
- ✅ Não depende de lista hardcoded
- ✅ Se Deriv adicionar novos ativos, sistema os detecta sozinho
- ✅ Fallback para R_10-R_100 se descoberta falhar

### 📊 ATIVOS DESCOBERTOS:
Ao inicializar, sistema chama `getDigitDiffSupportedSymbols()` que:
- Verifica cada símbolo ativo na Deriv
- Valida quais suportam DIGITDIFF
- Retorna lista dinâmica (pode variar por conta/região)
- Log mostra: `✅ Ativo suporta DIGITDIFF`

### 🎯 FUNCIONALIDADE ATUAL:
- ✅ Cool-off: 2min → 30seg
- ✅ Cool-off agressivo: 0seg para >55% W/R
- ✅ Breathing room: 0-60seg adaptativo
- ✅ IA escolhe MELHOR entre ativos disponíveis
- ✅ **DINÂMICO**: Descobre ativos DIGITDIFF automaticamente
- ✅ Sem repetição excessiva
- ✅ Margem de segurança ampliada

### 🔍 COMO FUNCIONA:
```
1. Inicialização → getActiveSymbols() → todos os símbolos Deriv
2. Para cada símbolo → getContractsFor() → verifica DIGITDIFF
3. Filtra apenas suportados → startCollection()
4. Sistema opera com ativos DIGITDIFF descobertos dinamicamente
```

### 📈 VANTAGENS:
- Funciona em qualquer conta/região (adapta-se)
- Se Deriv expandir DIGITDIFF, sistema automaticamente inclui
- Sem dependência de lista hardcoded
- Totalmente conforme documentação oficial Deriv

---

## 📦 100% DATA SYNC ARCHITECTURE - 18 DEC 2025

### Problema Identificado:
As 3 camadas de dados estavam **DESCONECTADAS**:
1. ❌ Deriv API → Backend (campos truncados)
2. ❌ Backend → Database (whitelist restritiva)
3. ❌ Database → Frontend (campos faltando)

### Solução Implementada:

#### 1. Schema Expandido (`shared/schema.ts`)
13 novos campos adicionados à tabela `trade_operations`:
- `shortcode` - Código do contrato Deriv
- `buyPrice` - Preço de compra exato
- `sellPrice` - Preço de venda exato
- `entryEpoch` - Timestamp entrada (epoch)
- `exitEpoch` - Timestamp saída (epoch)
- `contractType` - Tipo do contrato
- `barrier` - Dígito barrier usado
- `derivStatus` - Status raw da Deriv
- `derivProfit` - Lucro exato (sem arredondamento)
- `payout` - Valor do payout
- `statusChangedAt` - Quando status mudou
- `lastSyncAt` - Última sincronização
- `syncCount` - Número de syncs

#### 2. DerivContractInfo Expandido (`deriv-api.ts`)
Interface agora captura 100% do payload `proposal_open_contract`:
- sell_price, entry_tick_time, exit_tick_time
- contract_type, barrier, payout
- is_valid_to_sell, is_sold, is_expired, is_settleable
- date_start, date_expiry, current_spot, current_spot_time

#### 3. Sync Service Atualizado (`deriv-trade-sync.ts`)
- SEMPRE salva todos os campos em cada sync
- Logs detalhados de cada campo
- Sync incondicional para garantir 100% consistência

#### 4. Storage Whitelist Expandida (`storage.ts`)
Todos os novos campos agora permitidos no `updateTradeOperation()`

### Resultado:
```
✅ Deriv API → Backend: 100% campos capturados
✅ Backend → Database: 100% campos salvos
✅ Database → Frontend: 100% campos disponíveis
```

---

## Overview
Trading automation system for variable income (Deriv DIGITDIFF contracts - descoberta dinâmica).

## Current Status
- ✅ Full system operational with dynamic DIGITDIFF asset discovery
- ✅ 100% data consistency (Deriv → Backend → Database → Frontend)
- ✅ Real-time microscopic analysis
- ✅ Dynamic diversification
- ✅ Ultra-fast adaptive cool-off (0-30 sec)
- ✅ Code ready for ALL Deriv DIGITDIFF assets (auto-discovers)
