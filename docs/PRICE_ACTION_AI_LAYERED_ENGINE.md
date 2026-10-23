# Invista Pro V10: estratégia em camadas e validação

## Invariantes
- A estratégia determinística gera o único candidato de entrada. Sem candidato aprovado, a resposta é HOLD.
- Revisores de IA podem aprovar/rejeitar e contextualizar, mas não criar direção de entrada, remover gates, alterar risco máximo ou afrouxar stops.
- Entradas exigem dados válidos H4, H1, M15 e M5 ou M1; alinhamento H4/H1; gatilho; volume; confirmação estrutural; RR mínimo 1:2 após custos; janela de notícias liberada; limites de risco liberados.
- Uma saída ou ajuste de stop sugerido por IA é subordinado aos limites determinísticos. Proteções no broker/terminal não podem depender de disponibilidade da IA.
- Melhorias novas ficam experimentais até validação temporal fora da amostra, custos/slippage, comparação com baseline e teste DEMO.
- Falha, dados ausentes/stale, consenso IA divergente ou ambiente não confirmado: HOLD.

## Observação de integração
O motor de política é isolado e testável. Para operar a estratégia cripto de forma integral, o EA deve transmitir candles separados por timeframe e o endpoint deve ligar a revisão de IA a esse candidato antes de responder BUY/SELL. Não declarar estratégia operacional completa nem habilitar produção até esses contratos estarem integrados e testados no MT5/DEMO.
