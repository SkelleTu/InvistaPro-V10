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


## Custos e confluência estrutural
- O gate estrutural exige BOS ou CHoCH direcional **e** pelo menos uma confirmação independente entre FVG, sweep de liquidez ou Order Block. Um único padrão isolado não libera entrada.
- O spread é automático: o servidor calcula `ask - bid` com os preços atuais enviados pelo MT5. Não configurar spread manualmente.
- Como comissão e slippage podem existir além do spread, configure `MT5_PRICE_ACTION_EXTRA_COST_SPREAD_MULTIPLIER` no servidor. É um multiplicador do spread vivo, não um preço fixo: custo total estimado = spread observado × (2 + multiplicador). O servidor envia o multiplicador junto com o sinal e o EA o reaplica ao spread vivo no momento da execução, para não subestimar custos se o spread mudar entre análise e ordem. Exemplo: `1` reserva duas vezes o spread para ida e volta mais uma vez o spread como margem adicional para comissão/slippage.
- Se a variável estiver ausente, inválida ou negativa, o custo total fica indisponível e a estratégia bloqueia novas entradas. O multiplicador é uma estimativa conservadora, não substitui a validação das condições e comissões reais do broker; configure-o de acordo com os instrumentos habilitados.
- A validação de execução deve ser feita em DEMO com os custos reais do broker antes de qualquer uso em conta REAL.
