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

## Paridade servidor ↔ EA (v8.4)
- O percentual de risco por operação é autoritativo no servidor (`config.riskPercent`) e é enviado em cada sinal aprovado; o EA não mantém um segundo percentual configurável para dimensionar o lote.
- O EA recalcula o ATR como média aritmética dos últimos 14 true ranges de 15 candles fechados, igual ao servidor, e atualiza bid/ask depois da latência HTTP antes de validar spread, risco e R:R.
- Os limites de spread são fixos e iguais nos dois lados: ATR M1 × 20%, ATR M5 × 8% e teto de preço × 0,10%; vale sempre o menor limite. O EA não permite overrides locais desses três limites.
- O EA envia a quantidade total de posições abertas observada no terminal. O servidor usa esse valor reportado, quando válido, no limite de posições da conta, mantendo o heartbeat recente como requisito.
- A versão do EA no arquivo, no heartbeat e nos payloads de sinal deve ser 8.4; o endpoint de download bloqueia fontes que não contenham os marcadores de política atuais.
