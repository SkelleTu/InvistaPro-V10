import fetch from 'node-fetch';
import { dualStorage as storage } from '../storage-dual.js';
import { autoTradingScheduler } from './auto-trading-scheduler';

const HF_API_KEY = process.env.HUGGINGFACE_API_KEY;

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AssistantResponse {
  message: string;
  actionTaken?: string;
  data?: any;
}

async function callHuggingFace(messages: ChatMessage[]): Promise<string> {
  const models = [
    'mistralai/Mistral-7B-Instruct-v0.3',
    'HuggingFaceH4/zephyr-7b-beta',
    'tiiuae/falcon-7b-instruct',
  ];

  const systemMsg = messages.find(m => m.role === 'system')?.content || '';
  const conversation = messages.filter(m => m.role !== 'system');

  let prompt = `<s>[INST] <<SYS>>\n${systemMsg}\n<</SYS>>\n\n`;
  for (let i = 0; i < conversation.length; i++) {
    const m = conversation[i];
    if (m.role === 'user') {
      prompt += `${m.content} [/INST] `;
    } else {
      prompt += `${m.content} </s><s>[INST] `;
    }
  }

  for (const model of models) {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (HF_API_KEY) {
        headers['Authorization'] = `Bearer ${HF_API_KEY}`;
      }

      const response = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          inputs: prompt,
          parameters: {
            max_new_tokens: 400,
            temperature: 0.7,
            top_p: 0.9,
            do_sample: true,
            return_full_text: false,
          },
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) continue;

      const result = await response.json() as any;
      let text = '';
      if (Array.isArray(result) && result[0]?.generated_text) {
        text = result[0].generated_text.trim();
      } else if (result?.generated_text) {
        text = result.generated_text.trim();
      }

      if (text && text.length > 5) return text;
    } catch (err) {
      console.warn(`[AI Assistant] Model ${model} error:`, err);
      continue;
    }
  }

  throw new Error('All AI models unavailable');
}

async function buildPlatformContext(userId: string): Promise<string> {
  try {
    const [user, tradeConfig, recentTrades, dailyPnl, derivToken, tradingStats] = await Promise.allSettled([
      storage.getUser(userId),
      storage.getUserTradeConfig(userId),
      storage.getUserTradeOperations(userId, 20),
      storage.getDailyPnL(userId),
      storage.getUserDerivToken(userId),
      storage.getTradingStats(userId),
    ]);

    const u = user.status === 'fulfilled' ? user.value : null;
    const cfg = tradeConfig.status === 'fulfilled' ? tradeConfig.value : null;
    const trades = recentTrades.status === 'fulfilled' ? recentTrades.value : [];
    const pnl = dailyPnl.status === 'fulfilled' ? dailyPnl.value : null;
    const token = derivToken.status === 'fulfilled' ? derivToken.value : null;
    const stats = tradingStats.status === 'fulfilled' ? tradingStats.value : null;

    const schedulerStatus = autoTradingScheduler.getSchedulerStatus();
    const openTrades = trades.filter((t: any) => t.status === 'open' || t.status === 'pending');
    const closedTrades = trades.filter((t: any) => t.status === 'won' || t.status === 'lost');
    const wins = closedTrades.filter((t: any) => t.status === 'won').length;
    const losses = closedTrades.filter((t: any) => t.status === 'lost').length;
    const totalProfit = closedTrades.reduce((sum: number, t: any) => sum + parseFloat(t.profit || '0'), 0);

    const lines: string[] = [
      `=== DADOS DA PLATAFORMA InvistaPRO ===`,
      ``,
      `USUÁRIO:`,
      `- Nome: ${(u as any)?.nomeCompleto || 'N/A'}`,
      `- Email: ${u?.email || 'N/A'}`,
      `- Saldo na plataforma: R$ ${((u as any)?.saldo ?? 0).toFixed(2)}`,
      `- Status: ${(u as any)?.contaAprovada ? 'Aprovado' : 'Pendente'}`,
      ``,
      `CONFIGURAÇÃO DE TRADING:`,
      `- Modo operação: ${cfg?.mode || 'não configurado'}`,
      `- Stake: ${cfg?.stakeMode === 'fixed' ? `R$ ${cfg?.fixedStake}` : 'Automático (IA)'}`,
      `- Martingale ativo: ${cfg?.enableMartingale ? 'Sim' : 'Não'}`,
      `- Modo recovery: ${cfg?.enableRecoveryMode ? 'Ativo' : 'Inativo'}`,
      `- Intervalo: ${cfg?.intervalValue || 'N/A'} ${cfg?.intervalType || ''}`,
      ``,
      `ROBÔ / SISTEMA:`,
      `- Status do robô: ${schedulerStatus?.isRunning ? 'ATIVO ✅' : 'PARADO ⛔'}`,
      `- Sessões ativas: ${schedulerStatus?.hasActiveSessions ? 'Sim' : 'Não'}`,
      `- Emergency stop: ${schedulerStatus?.emergencyStop ? 'Ativado' : 'Desativado'}`,
      ``,
      `CONTA DERIV:`,
      `- Token configurado: ${token ? 'Sim' : 'Não'}`,
      `- Tipo de conta: ${token?.accountType || 'N/A'}`,
      ``,
      `TRADES RECENTES (últimos 20):`,
      `- Trades abertos agora: ${openTrades.length}`,
      `- Wins (período): ${wins}`,
      `- Losses (período): ${losses}`,
      `- Win rate: ${closedTrades.length > 0 ? ((wins / closedTrades.length) * 100).toFixed(1) : 0}%`,
      `- Lucro/Prejuízo total: R$ ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)}`,
    ];

    if (pnl) {
      lines.push(
        ``,
        `P&L DE HOJE:`,
        `- Total trades hoje: ${pnl.totalTrades || 0}`,
        `- Wins hoje: ${pnl.wonTrades || 0}`,
        `- Losses hoje: ${pnl.lostTrades || 0}`,
        `- P&L hoje: R$ ${(pnl.dailyPnL ?? 0).toFixed(2)}`
      );
    }

    if (stats) {
      lines.push(
        ``,
        `ESTATÍSTICAS GERAIS:`,
        `- Total de operações: ${stats.totalTrades || 0}`,
        `- Win rate geral: ${typeof stats.winRate === 'number' ? stats.winRate.toFixed(1) : 0}%`,
        `- Lucro total histórico: R$ ${typeof stats.totalProfit === 'number' ? stats.totalProfit.toFixed(2) : '0.00'}`
      );
    }

    if (openTrades.length > 0) {
      lines.push(``, `TRADES ABERTOS ATUALMENTE:`);
      openTrades.slice(0, 5).forEach((t: any) => {
        lines.push(`- ${t.symbol} | Stake: R$${t.stake} | Direção: ${t.direction} | Status: ${t.status}`);
      });
    }

    if (closedTrades.length > 0) {
      lines.push(``, `ÚLTIMOS TRADES FECHADOS:`);
      closedTrades.slice(0, 5).forEach((t: any) => {
        const profit = parseFloat(t.profit || '0');
        lines.push(`- ${t.symbol} | ${t.direction?.toUpperCase()} | ${t.status?.toUpperCase()} | R$ ${profit >= 0 ? '+' : ''}${profit.toFixed(2)}`);
      });
    }

    return lines.join('\n');
  } catch (err) {
    console.error('[AI Assistant] Error building context:', err);
    return 'Dados da plataforma temporariamente indisponíveis.';
  }
}

function detectAction(userMessage: string): string | null {
  const lower = userMessage.toLowerCase();

  const isBotRelated = lower.includes('robô') || lower.includes('bot') || lower.includes('trading') || lower.includes('trade');
  const isStart = lower.includes('iniciar') || lower.includes('ligar') || lower.includes('ativar') || lower.includes('começar') || lower.includes('start');
  const isStop = lower.includes('parar') || lower.includes('pausar') || lower.includes('desligar') || lower.includes('pausa') || lower.includes('stop');

  if (isBotRelated && isStart) return 'START_BOT';
  if (isBotRelated && isStop) return 'STOP_BOT';

  return null;
}

export async function processAiAssistantMessage(
  userId: string,
  userMessage: string,
  history: ChatMessage[]
): Promise<AssistantResponse> {
  const platformContext = await buildPlatformContext(userId);

  const action = detectAction(userMessage);
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

  const systemPrompt = `Você é a IA assistente da plataforma InvistaPRO — uma plataforma avançada de trading automatizado integrada com a corretora Deriv. Você tem acesso completo e em tempo real a todos os dados da plataforma do usuário.

DADOS ATUAIS DA PLATAFORMA:
${platformContext}

${actionTaken ? `AÇÃO EXECUTADA AGORA: ${actionTaken}` : ''}

SUAS CAPACIDADES:
- Responder perguntas sobre trades, resultados, configurações, saldo e tudo da plataforma
- Analisar o desempenho das operações com dados reais
- Explicar o que está acontecendo no sistema
- Ajudar a entender configurações do robô de trading
- Iniciar ou parar o robô quando solicitado
- Dar conselhos sobre estratégias

REGRAS:
- Use SEMPRE os dados reais fornecidos acima
- Fale em português do Brasil de forma clara e objetiva
- Seja conciso mas completo
- Use emojis com moderação para facilitar a leitura
- Se não souber algo, seja honesto`;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-6),
    { role: 'user', content: userMessage },
  ];

  let aiMessage: string;
  try {
    aiMessage = await callHuggingFace(messages);
    if (!aiMessage || aiMessage.length < 5) throw new Error('Empty response');
  } catch (err) {
    aiMessage = generateFallbackResponse(userMessage, platformContext, actionTaken);
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

function generateFallbackResponse(userMessage: string, context: string, actionTaken?: string): string {
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
    const saldo = getVal('Saldo na plataforma');
    return `💰 Seu saldo atual na plataforma é de **${saldo}**.\n\nPara depositar ou sacar, acesse a seção de Dashboard.`;
  }

  if (lower.includes('trade') || lower.includes('operação') || lower.includes('resultado') || lower.includes('ganho') || lower.includes('perda')) {
    const wins = getVal('Wins (período)');
    const losses = getVal('Losses (período)');
    const winRate = getVal('Win rate');
    const lucro = getVal('Lucro/Prejuízo total');
    const hoje = getVal('P&L hoje: R$');
    return `📊 **Resumo das suas operações:**\n- ✅ Wins: ${wins}\n- ❌ Losses: ${losses}\n- 🎯 Win rate: ${winRate}\n- 💵 Resultado total: ${lucro}\n${hoje !== 'N/A' ? `- 📅 Resultado hoje: R$ ${hoje}` : ''}\n\nPara ver todos os detalhes, acesse a seção de Trading.`;
  }

  if (lower.includes('robô') || lower.includes('bot') || lower.includes('status') || lower.includes('ativo') || lower.includes('parado')) {
    const status = getVal('Status do robô');
    const sessoes = getVal('Sessões ativas');
    return `🤖 **Status do robô:** ${status}\n- Sessões ativas: ${sessoes}\n\nVocê pode controlar o robô me pedindo para iniciá-lo ou pará-lo, ou pelo painel de Trading.`;
  }

  if (lower.includes('config') || lower.includes('modo') || lower.includes('stake') || lower.includes('stop')) {
    const modo = getVal('Modo operação');
    const stake = getVal('Stake por trade');
    const sl = getVal('Stop loss');
    const sg = getVal('Stop gain');
    const martingale = getVal('Martingale ativo');
    return `⚙️ **Suas configurações atuais:**\n- Modo: ${modo}\n- Stake: ${stake}\n- Stop Loss: ${sl}\n- Stop Gain: ${sg}\n- Martingale: ${martingale}\n\nPara alterar, acesse as configurações no painel de Trading.`;
  }

  if (lower.includes('ajuda') || lower.includes('help') || lower.includes('o que') || lower.includes('como')) {
    return `👋 Olá! Sou a IA assistente da **InvistaPRO**.\n\nPosso te ajudar com:\n\n📊 **Trades e resultados** — "Qual meu resultado hoje?"\n💰 **Saldo** — "Qual meu saldo atual?"\n🤖 **Controle do robô** — "Inicia o robô" / "Para o robô"\n⚙️ **Configurações** — "Quais minhas configs?"\n📈 **Análise** — "Como está meu desempenho?"\n\nO que deseja saber?`;
  }

  const statusRobo = getVal('Status do robô');
  const saldo = getVal('Saldo na plataforma');
  const winRate = getVal('Win rate');
  return `Entendi! Aqui está um resumo rápido da sua plataforma:\n\n🤖 Robô: **${statusRobo}**\n💰 Saldo: **${saldo}**\n🎯 Win rate: **${winRate}**\n\nTenho acesso completo a todos os seus dados. Pode me perguntar qualquer coisa sobre suas operações, resultados, configurações ou pedir para eu controlar o robô!`;
}
