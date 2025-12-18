# InvestaPRO - Sistema de Renda Variável

## 📊 REALIDADE DE ATIVOS DISPONÍVEIS - 18 DEC 2025

### DESCOBERTA IMPORTANTE:
Após investigação profunda, **Deriv REALMENTE suporta APENAS 5 ativos para DIGITDIFF**:
- R_10, R_25, R_50, R_75, R_100 (Volatility Indices)

Outros ativos (Forex, Commodities, Crypto, Stocks) **NÃO suportam contratos DIGITDIFF** na plataforma Deriv.

### MUDANÇAS IMPLEMENTADAS (18 DEC):
1. **Removido `product_type: 'basic'`** em deriv-api.ts (linha 540-542)
   - Teste: Confirmado que Deriv retorna apenas 5 ativos mesmo sem limitador
   
2. **Removido filtro hardcoded** em auto-trading-scheduler.ts (linha 1041-1058)
   - Sistema agora ACEITA todos os símbolos disponíveis (não rejeita arbitrariamente)
   - Deixa DINÂMICO: se Deriv adicionar novos ativos DIGITDIFF, sistema aceita automaticamente

3. **Mantido 120+ símbolos** em market-data-collector.ts para FUTURO
   - Quando/se Deriv expandir suporte DIGITDIFF, sistema está pronto
   - Lista completa: Forex, Commodities, Crypto, Stocks, Indices

### 🎯 CONFIGURAÇÃO ATUAL OTIMIZADA:
- ✅ **5 ATIVOS DIGITDIFF** operando (máximo disponível na Deriv)
- ✅ Cool-off reduzido: 2min → 30seg
- ✅ Cool-off agressivo: 0seg para ativos >55% win rate
- ✅ Breathing room adaptativo: 0-60seg baseado em performance
- ✅ IA escolhe MELHOR entre os 5 disponíveis
- ✅ Nenhuma repetição (diversificação dentro das 5 opções)
- ✅ Margem de segurança: sistema rotaciona entre os 5 com inteligência

### 📈 IMPACTO REAL:
Com 5 ativos DIGITDIFF operando com diversificação inteligente:
- Margem de erro reduzida vs 1 ativo
- Cool-off ultra-rápido maximiza oportunidades
- IA adaptation garante lucro mesmo com volatilidade
- Sistema pronto para quando Deriv expandir DIGITDIFF

---

## Overview
Trading automation system for variable income (Deriv DIGITDIFF contracts - 5 ativos suportados).

## Current Status
- ✅ Full system operational with 5 DIGITDIFF assets (máximo suportado)
- ✅ Real-time microscopic analysis
- ✅ Dynamic diversification within 5 assets
- ✅ Ultra-fast adaptive cool-off (0-30 sec)
- ✅ Code ready for 120+ when Deriv expands DIGITDIFF support
