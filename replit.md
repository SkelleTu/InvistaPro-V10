# InvestaPRO - Sistema de Renda Variável

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

## Overview
Trading automation system for variable income (Deriv DIGITDIFF contracts - descoberta dinâmica).

## Current Status
- ✅ Full system operational with dynamic DIGITDIFF asset discovery
- ✅ Real-time microscopic analysis
- ✅ Dynamic diversification
- ✅ Ultra-fast adaptive cool-off (0-30 sec)
- ✅ Code ready for ALL Deriv DIGITDIFF assets (auto-discovers)
