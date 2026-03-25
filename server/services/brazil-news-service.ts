/**
 * BRAZIL NEWS SERVICE - INVESTAPRO
 * Monitoramento de noticiário brasileiro em tempo real (atualização a cada 60s)
 * Fontes: Google News RSS, InfoMoney, Valor Econômico, G1 Economia, BC do Brasil
 *
 * Integrado ao pipeline de sinais como "Camada de Sentimento de Mercado Brasileiro"
 * Influencia a decisão de entrada/saída junto ao Girassol e Fibonacci
 */

import fetch from 'node-fetch';

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface BrazilNewsItem {
  title: string;
  source: string;
  publishedAt: number;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  score: number; // -1 a +1
  keywords: string[];
}

export interface BrazilMarketSentiment {
  score: number;              // -1 (muito bearish) a +1 (muito bullish) — média ponderada
  direction: 'bullish' | 'bearish' | 'neutral';
  strength: number;           // 0-100% — força do sinal de sentimento
  headlines: BrazilNewsItem[];
  topHeadline: string;
  newsCount: number;
  updatedAt: number;
  categories: {
    cambio: number;           // USD/BRL, câmbio
    bolsa: number;            // IBOVESPA, B3
    juros: number;            // SELIC, BC, inflação
    economia: number;         // PIB, emprego, exportação
    politica: number;         // governo, congresso, impacto econômico
  };
  aiInfluence: {
    blocksBuy: boolean;       // sentimento bearish forte bloqueia compras
    blocksSell: boolean;      // sentimento bullish forte bloqueia vendas
    confidenceModifier: number; // multiplicador de confiança (-0.3 a +0.3)
    reason: string;
  };
}

// ── Palavras-chave de sentimento em português brasileiro ─────────────────────

const BULLISH_KEYWORDS_PT = [
  // Mercado / Economia
  'alta', 'subiu', 'subindo', 'valorização', 'valorizou', 'valoriza', 'cresce', 'crescimento',
  'recorde', 'máxima', 'lucro', 'ganho', 'positivo', 'recuperação', 'recuperou', 'melhora',
  'aprovação', 'aprovado', 'reforma', 'investimento', 'expansão', 'superávit', 'exportação',
  'emprego', 'contratação', 'otimismo', 'otimista', 'confiança', 'aquecimento',
  'corte de juros', 'corte da selic', 'queda do juros', 'redução da taxa',
  'ibovespa sobe', 'bolsa sobe', 'dólar cai', 'dólar recua', 'real valoriza',
  'inflação cai', 'inflação recua', 'desinflação', 'pib cresce', 'superávit primário',
  'aprovação reforma', 'acordo comercial', 'estabilidade', 'retomada',
  // Termos financeiros
  'buy', 'compra', 'long', 'bullish', 'suporte', 'fundo',
];

const BEARISH_KEYWORDS_PT = [
  // Mercado / Economia
  'queda', 'caiu', 'caindo', 'desvalorização', 'desvalorizou', 'recuo', 'recuou',
  'mínima', 'perda', 'negativo', 'recessão', 'crise', 'colapso', 'risco',
  'déficit', 'inflação sobe', 'inflação alta', 'juros sobem', 'selic sobe',
  'dólar sobe', 'dólar dispara', 'dólar máxima', 'real cai', 'real desvaloriza',
  'ibovespa cai', 'bolsa cai', 'bolsa despenca', 'venda', 'saída de capital',
  'crise fiscal', 'incerteza', 'instabilidade', 'preocupação', 'alerta',
  'intervenção', 'sanção', 'bloqueio', 'corte orçamentário', 'contingenciamento',
  'desemprego', 'demissão', 'falência', 'inadimplência', 'endividamento',
  'impeachment', 'denúncia', 'investigação', 'corrupção', 'fraude', 'escândalo',
  // Termos financeiros
  'sell', 'venda', 'short', 'bearish', 'resistência', 'topo',
];

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  cambio: ['dólar', 'câmbio', 'real', 'moeda', 'usd', 'brl', 'divisas', 'reservas', 'bc intervém'],
  bolsa: ['ibovespa', 'b3', 'ações', 'bolsa', 'pregão', 'índice', 'papéis', 'small caps'],
  juros: ['selic', 'copom', 'bc', 'banco central', 'inflação', 'ipca', 'igpm', 'juros', 'taxa básica'],
  economia: ['pib', 'economia', 'emprego', 'exportação', 'importação', 'balança', 'superávit', 'déficit'],
  politica: ['governo', 'congresso', 'lula', 'senado', 'câmara', 'ministério', 'reforma', 'orçamento'],
};

// ── Fontes RSS gratuitas (sem API key) ───────────────────────────────────────

const RSS_FEEDS = [
  // Google News Brasil - Múltiplas queries focadas
  { url: 'https://news.google.com/rss/search?q=mercado+financeiro+brasil+hoje&hl=pt-BR&gl=BR&ceid=BR:pt-419', weight: 1.5 },
  { url: 'https://news.google.com/rss/search?q=ibovespa+bolsa+brasil&hl=pt-BR&gl=BR&ceid=BR:pt-419', weight: 2.0 },
  { url: 'https://news.google.com/rss/search?q=dólar+real+câmbio+brasil&hl=pt-BR&gl=BR&ceid=BR:pt-419', weight: 1.8 },
  { url: 'https://news.google.com/rss/search?q=selic+banco+central+inflação+brasil&hl=pt-BR&gl=BR&ceid=BR:pt-419', weight: 1.8 },
  { url: 'https://news.google.com/rss/search?q=economia+brasil+pib+emprego&hl=pt-BR&gl=BR&ceid=BR:pt-419', weight: 1.2 },
  { url: 'https://news.google.com/rss/search?q=governo+brasil+reforma+fiscal+2025&hl=pt-BR&gl=BR&ceid=BR:pt-419', weight: 1.0 },
];

// ── Parser XML ultra-leve (sem biblioteca externa) ───────────────────────────

function parseRSSXML(xml: string): Array<{ title: string; source: string; pubDate: string }> {
  const items: Array<{ title: string; source: string; pubDate: string }> = [];
  try {
    const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
    for (const item of itemMatches) {
      const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/);
      const sourceMatch = item.match(/<source[^>]*>(.*?)<\/source>/) || item.match(/<dc:creator[^>]*>(.*?)<\/dc:creator>/);
      const pubDateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/);
      if (titleMatch) {
        items.push({
          title: titleMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").trim(),
          source: sourceMatch ? sourceMatch[1].trim() : 'Google News',
          pubDate: pubDateMatch ? pubDateMatch[1] : '',
        });
      }
    }
  } catch (_) { /* ignore parse errors */ }
  return items;
}

// ── Análise de sentimento baseada em keywords (rápida, sem API) ──────────────

function analyzeHeadlineSentiment(title: string): { sentiment: 'bullish' | 'bearish' | 'neutral'; score: number; keywords: string[]; categories: string[] } {
  const lower = title.toLowerCase();
  const foundBullish: string[] = [];
  const foundBearish: string[] = [];
  const foundCategories: string[] = [];

  for (const kw of BULLISH_KEYWORDS_PT) {
    if (lower.includes(kw.toLowerCase())) foundBullish.push(kw);
  }
  for (const kw of BEARISH_KEYWORDS_PT) {
    if (lower.includes(kw.toLowerCase())) foundBearish.push(kw);
  }
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    if (kws.some(kw => lower.includes(kw.toLowerCase()))) foundCategories.push(cat);
  }

  const bullishWeight = foundBullish.length;
  const bearishWeight = foundBearish.length;
  const total = bullishWeight + bearishWeight;

  let score = 0;
  let sentiment: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (total > 0) {
    score = (bullishWeight - bearishWeight) / Math.max(total, 1);
    if (score > 0.15) sentiment = 'bullish';
    else if (score < -0.15) sentiment = 'bearish';
  }

  return { sentiment, score, keywords: [...foundBullish, ...foundBearish], categories: foundCategories };
}

// ── Serviço principal ─────────────────────────────────────────────────────────

class BrazilNewsService {
  private cache: BrazilMarketSentiment | null = null;
  private cacheTimestamp = 0;
  private readonly CACHE_TTL_MS = 60_000; // 1 minuto
  private isUpdating = false;

  async getBrazilMarketSentiment(): Promise<BrazilMarketSentiment> {
    const now = Date.now();
    if (this.cache && (now - this.cacheTimestamp) < this.CACHE_TTL_MS) {
      return this.cache;
    }
    if (!this.isUpdating) {
      this.isUpdating = true;
      this.updateSentiment().finally(() => { this.isUpdating = false; });
    }
    return this.cache ?? this.buildNeutralSentiment();
  }

  private buildNeutralSentiment(): BrazilMarketSentiment {
    return {
      score: 0, direction: 'neutral', strength: 0, headlines: [],
      topHeadline: 'Aguardando coleta de notícias brasileiras...', newsCount: 0,
      updatedAt: 0,
      categories: { cambio: 0, bolsa: 0, juros: 0, economia: 0, politica: 0 },
      aiInfluence: { blocksBuy: false, blocksSell: false, confidenceModifier: 0, reason: 'Sentimento neutro — sem dados suficientes' },
    };
  }

  private async updateSentiment(): Promise<void> {
    try {
      const allItems: BrazilNewsItem[] = [];
      const weightedScores: number[] = [];
      const catScores: Record<string, number[]> = { cambio: [], bolsa: [], juros: [], economia: [], politica: [] };

      // Busca paralela de todos os feeds RSS
      const feedResults = await Promise.allSettled(
        RSS_FEEDS.map(feed => this.fetchRSSFeed(feed.url, feed.weight))
      );

      for (let i = 0; i < feedResults.length; i++) {
        const result = feedResults[i];
        if (result.status !== 'fulfilled') continue;
        const { items, weight } = result.value;
        for (const item of items) {
          const analysis = analyzeHeadlineSentiment(item.title);
          const newsItem: BrazilNewsItem = {
            title: item.title,
            source: item.source,
            publishedAt: item.pubDate ? new Date(item.pubDate).getTime() : Date.now(),
            sentiment: analysis.sentiment,
            score: analysis.score,
            keywords: analysis.keywords,
          };
          allItems.push(newsItem);
          if (analysis.score !== 0) {
            weightedScores.push(analysis.score * weight);
          }
          // Pontuação por categoria
          for (const cat of analysis.categories) {
            if (cat in catScores) catScores[cat].push(analysis.score);
          }
        }
      }

      // Desduplicar por título similar (remove notícias repetidas de fontes diferentes)
      const unique = this.deduplicateNews(allItems);

      // Ordena por mais recente
      unique.sort((a, b) => b.publishedAt - a.publishedAt);

      // Calcula score geral ponderado
      const score = weightedScores.length > 0
        ? Math.max(-1, Math.min(1, weightedScores.reduce((s, v) => s + v, 0) / weightedScores.length))
        : 0;

      // Calcula score por categoria
      const catAvg = (arr: number[]) => arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
      const categories = {
        cambio: catAvg(catScores.cambio),
        bolsa: catAvg(catScores.bolsa),
        juros: catAvg(catScores.juros),
        economia: catAvg(catScores.economia),
        politica: catAvg(catScores.politica),
      };

      const direction: 'bullish' | 'bearish' | 'neutral' = score > 0.15 ? 'bullish' : score < -0.15 ? 'bearish' : 'neutral';
      const strength = Math.round(Math.abs(score) * 100);
      const topHeadline = unique.find(n => n.sentiment !== 'neutral')?.title || unique[0]?.title || 'Sem notícias relevantes encontradas';

      // Determina influência nas decisões de trading
      const aiInfluence = this.calcAIInfluence(score, direction, strength, categories);

      this.cache = {
        score, direction, strength,
        headlines: unique.slice(0, 20),
        topHeadline, newsCount: unique.length, updatedAt: Date.now(),
        categories, aiInfluence,
      };
      this.cacheTimestamp = Date.now();

      console.log(`[BrazilNews] 🇧🇷 Sentimento atualizado: ${direction.toUpperCase()} (score=${score.toFixed(3)}, força=${strength}%) | ${unique.length} notícias | "${topHeadline.substring(0, 60)}..."`);
    } catch (err) {
      console.warn('[BrazilNews] ⚠️ Erro ao atualizar sentimento:', err instanceof Error ? err.message : err);
    }
  }

  private async fetchRSSFeed(url: string, weight: number): Promise<{ items: Array<{ title: string; source: string; pubDate: string }>; weight: number }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 InvistaPRO/1.0 (News Aggregator)', 'Accept': 'application/rss+xml, application/xml, text/xml' },
        signal: controller.signal as any,
      });
      if (!res.ok) return { items: [], weight };
      const xml = await res.text();
      return { items: parseRSSXML(xml), weight };
    } catch (_) {
      return { items: [], weight };
    } finally {
      clearTimeout(timeout);
    }
  }

  private deduplicateNews(items: BrazilNewsItem[]): BrazilNewsItem[] {
    const seen = new Set<string>();
    return items.filter(item => {
      const key = item.title.toLowerCase().substring(0, 40);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private calcAIInfluence(score: number, direction: 'bullish' | 'bearish' | 'neutral', strength: number, categories: BrazilMarketSentiment['categories']): BrazilMarketSentiment['aiInfluence'] {
    // Sentimento muito forte (>60%) bloqueia operações na direção contrária
    const blocksBuy  = direction === 'bearish' && strength >= 60;
    const blocksSell = direction === 'bullish' && strength >= 60;

    // Modificador de confiança: score * 0.3 (no máximo ±30%)
    const confidenceModifier = Math.max(-0.30, Math.min(0.30, score * 0.30));

    let reason = '';
    if (blocksBuy) {
      reason = `🇧🇷 Noticiário BR BEARISH forte (${strength}%) — BUY suspenso por risco macroeconômico`;
    } else if (blocksSell) {
      reason = `🇧🇷 Noticiário BR BULLISH forte (${strength}%) — SELL suspenso por ambiente positivo`;
    } else if (Math.abs(score) > 0.15) {
      reason = `🇧🇷 Noticiário BR ${direction.toUpperCase()} (score=${score.toFixed(2)}) → ajuste de confiança ${confidenceModifier > 0 ? '+' : ''}${(confidenceModifier * 100).toFixed(0)}%`;
    } else {
      reason = `🇧🇷 Noticiário BR NEUTRO — sem influência direcional nas operações`;
    }

    return { blocksBuy, blocksSell, confidenceModifier, reason };
  }

  // Inicia atualização periódica automática (a cada 60 segundos)
  startAutoUpdate(): void {
    // Primeira coleta imediata
    this.updateSentiment().catch(() => {});
    // Intervalo regular
    setInterval(() => {
      this.updateSentiment().catch(() => {});
    }, this.CACHE_TTL_MS);
    console.log('🇧🇷 [BrazilNews] Monitoramento de noticiário brasileiro ATIVO (atualização a cada 60s)');
    console.log('📰 [BrazilNews] Fontes: Google News BR | Câmbio | Bolsa | SELIC | Economia | Política');
  }

  // Resumo formatado para log
  getSummary(): string {
    if (!this.cache) return '🇧🇷 [BrazilNews] Aguardando primeira coleta...';
    const { direction, strength, newsCount, topHeadline, updatedAt } = this.cache;
    const ageMin = Math.floor((Date.now() - updatedAt) / 60000);
    return `🇧🇷 [BrazilNews] ${direction.toUpperCase()} ${strength}% | ${newsCount} notícias | ${ageMin}min atrás | "${topHeadline.substring(0, 50)}..."`;
  }
}

export const brazilNewsService = new BrazilNewsService();
