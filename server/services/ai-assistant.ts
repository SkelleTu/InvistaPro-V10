import fetch from 'node-fetch';
import { dualStorage as storage } from '../storage-dual.js';
import { autoTradingScheduler } from './auto-trading-scheduler';

const GROQ_API_KEY = process.env.GROQ_API_KEY;

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AssistantResponse {
  message: string;
  actionTaken?: string;
  data?: any;
}

async function callGroq(messages: ChatMessage[]): Promise<string> {
  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY not configured');
  }

  const models = [
    'llama-3.3-70b-versatile',
    'llama3-70b-8192',
    'llama3-8b-8192',
  ];

  for (const model of models) {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: 600,
          temperature: 0.7,
          top_p: 0.9,
        }),
        signal: AbortSignal.timeout(20000),
      });

      if (!response.ok) {
        const err = await response.text();
        console.warn(`[AI Assistant] Groq model ${model} error ${response.status}:`, err);
        continue;
      }

      const result = await response.json() as any;
      const text = result?.choices?.[0]?.message?.content?.trim();
      if (text && text.length > 3) return text;
    } catch (err) {
      console.warn(`[AI Assistant] Groq model ${model} failed:`, err);
      continue;
    }
  }

  throw new Error('Groq API unavailable');
}

async function buildPlatformContext(userId: string, canControlTrading: boolean): Promise<string> {
  try {
    const [user, tradingStats] = await Promise.allSettled([
      storage.getUser(userId),
      storage.getTradingStats(userId),
    ]);
    const u = user.status === 'fulfilled' ? user.value : null;
    const stats = tradingStats.status === 'fulfilled' ? tradingStats.value : null;
    const lines: string[] = [
      "=== DADOS INDIVIDUAIS DA CONTA INVISTAPRO ===",
      `- Nome: ${(u as any)?.nomeCompleto || 'N/A'}`,
      `- Saldo registrado: R$ ${Number((u as any)?.saldo ?? 0).toFixed(2)}`,
      `- Situação da conta: ${(u as any)?.contaAprovada ? 'Aprovada' : 'Pendente'}`,
    ];

    if (stats) {
      lines.push(
        `- Operações registradas: ${stats.totalTrades || 0}`,
        `- Operações vencedoras: ${stats.wonTrades || 0}`,
        `- Operações perdedoras: ${stats.lostTrades || 0}`,
        `- Taxa de acerto: ${typeof stats.winRate === 'number' ? stats.winRate.toFixed(1) : 0}%`,
        `- Resultado histórico registrado: R$ ${Number(stats.totalProfit || 0).toFixed(2)}`
      );
    }

    if (canControlTrading) {
      const [tradeConfig, recentTrades, dailyPnl, derivToken] = await Promise.allSettled([
        storage.getUserTradeConfig(userId),
        storage.getUserTradeOperations(userId, 20),
        storage.getDailyPnL(userId),
        storage.getUserDerivToken(userId),
      ]);
      const cfg = tradeConfig.status === 'fulfilled' ? tradeConfig.value : null;
      const trades = recentTrades.status === 'fulfilled' ? recentTrades.value : [];
      const pnl = dailyPnl.status === 'fulfilled' ? dailyPnl.value : null;
      const token = derivToken.status === 'fulfilled' ? derivToken.value : null;
      const schedulerStatus = autoTradingScheduler.getSchedulerStatus();
      const openTrades = trades.filter((t: any) => t.status === 'open' || t.status === 'pending');
      const closedTrades = trades.filter((t: any) => t.status === 'won' || t.status === 'lost');
      lines.push(
        "",
        "CONTROLES ADMINISTRATIVOS (somente perfil autorizado):",
        `- Modo operação: ${cfg?.mode || 'não configurado'}`,
        `- Stake: ${cfg?.stakeMode === 'fixed' ? `R$ ${cfg?.fixedStake}` : 'Automático (IA)'}`,
        `- Martingale: ${cfg?.enableMartingale ? 'Ativo' : 'Inativo'}`,
        `- Modo recovery: ${cfg?.enableRecoveryMode ? 'Ativo' : 'Inativo'}`,
        `- Status do agendador: ${schedulerStatus?.isRunning ? 'ATIVO' : 'PARADO'}`,
        `- Sessões ativas: ${schedulerStatus?.hasActiveSessions ? 'Sim' : 'Não'}`,
        `- Emergency stop: ${schedulerStatus?.emergencyStop ? 'Ativado' : 'Desativado'}`,
        `- Token Deriv configurado: ${token ? 'Sim' : 'Não'}`,
        `- Trades recentes em aberto: ${openTrades.length}`,
        `- Trades recentes encerrados: ${closedTrades.length}`
      );
      if (pnl) lines.push(`- P&L diário registrado: R$ ${Number(pnl.dailyPnL ?? 0).toFixed(2)}`);
    } else {
      lines.push("", "PERMISSÕES: perfil cliente somente leitura; não possui autorização para iniciar, parar, configurar ou controlar o motor central.");
    }

    return lines.join("\n");
  } catch (err) {
    console.error('[AI Assistant] Error building context:', err);
    return 'Dados da plataforma temporariamente indisponíveis.';
  }
}

function detectAction(userMessage: string): string | null {
  const lower = userMessage.toLowerCase();
  const target = "(?:o\\s+)?(?:rob[oô]|bot|motor|agendador|trading)";
  const startVerb = "(?:inicie|iniciar|ligue|ligar|ative|ativar|comece|começar|start)";
  const stopVerb = "(?:pare|parar|pausar|pause|desligue|desligar|interrompa|interromper)";
  const startIntent =
    new RegExp("^(?:por favor[, ]*)?" + startVerb + "\\s+" + target + "\\b").test(lower) ||
    new RegExp("\\b(quero|pode|por favor)\\s+(?:que\\s+)?(?:você\\s+)?" + startVerb + "\\s+" + target + "\\b").test(lower);
  const stopIntent =
    new RegExp("^(?:por favor[, ]*)?" + stopVerb + "\\s+" + target + "\\b").test(lower) ||
    new RegExp("\\b(quero|pode|por favor)\\s+(?:que\\s+)?(?:você\\s+)?" + stopVerb + "\\s+" + target + "\\b").test(lower) ||
    new RegExp("^(?:por favor[, ]*)?stop\\s+" + target + "\\b").test(lower);

  if (startIntent) return 'START_BOT';
  if (stopIntent) return 'STOP_BOT';
  return null;
}

export async function processAiAssistantMessage(
  userId: string,
  userMessage: string,
  history: ChatMessage[],
  canControlTrading = false
): Promise<AssistantResponse> {
  const platformContext = await buildPlatformContext(userId, canControlTrading);
  const requestedAction = detectAction(userMessage);
  if (requestedAction && !canControlTrading) {
    return {
      message: "Seu perfil de cliente permite consultar seus próprios dados e resultados, mas não controla o motor central. Para segurança, iniciar, parar ou alterar a operação é uma função exclusiva da conta MASTER e dos administradores autorizados.",
    };
  }

  const action = canControlTrading ? requestedAction : null;
  let actionTaken: string | undefined;
  let actionData: any;

  if (action === 'START_BOT') {
    try {
      await autoTradingScheduler.startScheduler();
      actionTaken = 'Robô de trading iniciado com sucesso! 🚀';
      actionData = { botStarted: true };
    } catch (err: any) {
      actionTaken = `Não foi possível iniciar o robô: ${err.message}`;
    }
  } else if (action === 'STOP_BOT') {
    try {
      await autoTradingScheduler.stopScheduler();
      actionTaken = 'Robô de trading parado com sucesso! ⛔';
      actionData = { botStopped: true };
    } catch (err: any) {
      actionTaken = `Não foi possível parar o robô: ${err.message}`;
    }
  }

  const systemPrompt = `Você é a IA assistente da plataforma InvistaPRO. Responda somente com base nos dados individuais fornecidos. ${canControlTrading ? 'Este usuário é MASTER ou administrador autorizado e pode executar comandos de controle permitidos.' : 'Este usuário é cliente final: somente consulta. Nunca prometa, tente ou oriente execução de comandos de controle do motor central.'}

DADOS ATUAIS DA PLATAFORMA:
${platformContext}

${actionTaken ? `AÇÃO EXECUTADA AGORA: ${actionTaken}` : ''}

SUAS CAPACIDADES:
- Responder perguntas sobre os dados individuais disponibilizados
- Analisar o desempenho registrado sem inventar resultados
- Explicar o que está acontecendo no sistema
- ${canControlTrading ? 'Ajudar com configurações e executar controles autorizados do motor central' : 'Orientar sobre as áreas do portal; não acessar nem controlar configurações do motor central'}
- Dar explicações técnicas sem prometer rentabilidade

REGRAS:
- Use SEMPRE os dados reais fornecidos acima
- Fale em português do Brasil de forma clara, natural e amigável
- Seja conciso mas completo — responda diretamente o que foi perguntado
- Use emojis com moderação para facilitar a leitura
- Converse de forma natural como um assistente prestativo
- Se não souber algo, seja honesto`;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-8),
    { role: 'user', content: userMessage },
  ];

  let aiMessage: string;
  try {
    aiMessage = await callGroq(messages);
    if (!aiMessage || aiMessage.length < 3) throw new Error('Empty response');
    console.log('[AI Assistant] Groq response OK, length:', aiMessage.length);
  } catch (err) {
    console.warn('[AI Assistant] Groq failed, using fallback:', err);
    aiMessage = generateFallbackResponse(userMessage, platformContext, actionTaken, canControlTrading);
  }

  if (actionTaken) {
    aiMessage = `✅ **${actionTaken}**\n\n${aiMessage}`;
  }

  return {
    message: aiMessage,
    actionTaken,
    data: actionData,
  };
}

function generateFallbackResponse(userMessage: string, context: string, actionTaken?: string, canControlTrading = false): string {
  if (actionTaken) {
    return `Ação realizada com sucesso! Posso te ajudar com mais alguma coisa? Estou aqui para responder sobre trades, saldo, configurações e tudo da plataforma.`;
  }

  const lower = userMessage.toLowerCase();
  const lines = context.split('\n');
  const getVal = (key: string) => {
    const line = lines.find(l => l.includes(key));
    return line ? line.split(':').slice(1).join(':').trim() : 'N/A';
  };

  if (lower.includes('saldo') || lower.includes('balance') || lower.includes('dinheiro') || lower.includes('quanto')) {
    const saldo = getVal('Saldo registrado');
    return `💰 Seu saldo registrado na plataforma é **${saldo}**.\n\n${canControlTrading ? 'Consulte os módulos administrativos para as demais operações.' : 'Depósitos e saques estão temporariamente desativados até a integração com o provedor de pagamentos.'}`;
  }

  if (lower.includes('trade') || lower.includes('operação') || lower.includes('resultado') || lower.includes('ganho') || lower.includes('perda')) {
    const wins = getVal('Operações vencedoras');
    const losses = getVal('Operações perdedoras');
    const winRate = getVal('Taxa de acerto');
    const lucro = getVal('Resultado histórico registrado');
    return `📊 **Resumo das suas operações:**\n- ✅ Wins: ${wins}\n- ❌ Losses: ${losses}\n- 🎯 Win rate: ${winRate}\n- 💵 Resultado total: ${lucro}\n\n${canControlTrading ? 'Consulte o módulo de Trading para detalhes operacionais.' : 'Abra a aba Histórico para consultar as operações registradas na sua conta.'}`;
  }

  if (lower.includes('robô') || lower.includes('bot') || lower.includes('status') || lower.includes('ativo') || lower.includes('parado')) {
    if (!canControlTrading) {
      return "O motor de execução é centralizado e seu perfil de cliente não tem acesso ao painel de controle nem ao status operacional global. Posso consultar os resultados e as movimentações registrados na sua própria conta.";
    }
    const status = getVal('Status do agendador');
    const sessoes = getVal('Sessões ativas');
    return `🤖 **Status do motor:** ${status}\n- Sessões ativas: ${sessoes}\n\nO controle permanece restrito a perfis autorizados.`;
  }

  if (lower.includes('config') || lower.includes('modo') || lower.includes('stake') || lower.includes('stop')) {
    if (!canControlTrading) return "As configurações e parâmetros do motor central são restritos à conta MASTER e aos administradores autorizados. Posso ajudar a consultar seu histórico e seus resultados individuais.";
    const modo = getVal('Modo operação');
    const stake = getVal('Stake');
    const martingale = getVal('Martingale ativo');
    return `⚙️ **Suas configurações atuais:**\n- Modo: ${modo}\n- Stake: ${stake}\n- Martingale: ${martingale}\n\nPara alterar, acesse as configurações no painel de Trading.`;
  }

  const accountStatus = getVal('Situação da conta');
  const saldo = getVal('Saldo registrado');
  const winRate = getVal('Taxa de acerto');
  return `Olá! Aqui está um resumo rápido da sua conta:\n\n👤 Situação: **${accountStatus}**\n💰 Saldo registrado: **${saldo}**\n🎯 Taxa de acerto: **${winRate}**\n\nPosso consultar as movimentações e os resultados registrados na sua conta.`;
}
