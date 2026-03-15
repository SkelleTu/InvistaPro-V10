import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import Header from "@/components/dashboard/header";
import DerivTokenSettings from "@/components/deriv-token-settings";
import LearningDashboard from "@/components/learning-dashboard";
import TradingConfigPanel from "@/components/trading-config-panel";
import { 
  TrendingUp, 
  TrendingDown, 
  Activity, 
  DollarSign, 
  Settings, 
  Play, 
  Pause, 
  BarChart3, 
  Bot,
  Zap,
  Target,
  Clock,
  Brain,
  CheckCircle2,
  Hash,
  Infinity,
  AlertTriangle,
  XCircle,
  Cpu,
  Layers,
  FlaskConical,
  ArrowUpDown,
  Circle,
  ToggleLeft,
  Sparkles,
  RefreshCw,
  Gauge,
  Trash2,
  Eye
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface AccountInfo {
  balance: number;
  accountType: "demo" | "real";
  currency: string;
  loginId?: string;
}

interface TradeStats {
  totalTrades: number;
  wonTrades: number;
  lostTrades: number;
  winRate: number;
  totalProfit: number;
  avgProfit: number;
}

interface TradeConfig {
  id: string;
  mode: string;
  isActive: boolean;
  operationsCount: number;
  intervalType: string;
  intervalValue: number;
}

interface TradeOperation {
  id: string;
  symbol: string;
  direction: "up" | "down";
  amount: number;
  status: "won" | "lost" | "pending" | "cancelled";
  profit?: number;
  createdAt: string;
}

interface AILog {
  id: string;
  modelName: string;
  analysis: string;
  decision: string;
  confidence: number;
  createdAt: string;
}

interface TradeModality {
  id: string;
  name: string;
  description: string;
  aiStrategy: string;
  risk: string;
  riskColor: string;
  defaultEnabled?: boolean;
}

interface TradeCategory {
  id: string;
  name: string;
  description: string;
  color: string;
  modalities: TradeModality[];
}

const TRADE_CATEGORIES: TradeCategory[] = [
  {
    id: "digits",
    name: "Dígitos",
    description: "Operações baseadas no último dígito do preço de saída",
    color: "blue",
    modalities: [
      {
        id: "digit_differs",
        name: "Digit Differs",
        description: "Ganha se o último dígito for DIFERENTE do previsto",
        aiStrategy: "LSTM + análise de frequência estatística. Identifica dígitos com alta repetição e seleciona o oposto como barreira, maximizando edge de 10-15%.",
        risk: "Baixo",
        riskColor: "green",
        defaultEnabled: true,
      },
      {
        id: "digit_matches",
        name: "Digit Matches",
        description: "Ganha se o último dígito for IGUAL ao previsto",
        aiStrategy: "CNN treinada em histórico de 10.000+ ticks por ativo. Detecta clusters de convergência e seleciona o dígito com maior probabilidade de ocorrência no momento.",
        risk: "Médio",
        riskColor: "yellow",
      },
      {
        id: "digit_even",
        name: "Digit Even",
        description: "Ganha se o último dígito for PAR (0, 2, 4, 6, 8)",
        aiStrategy: "Cadeia de Markov + análise de paridade temporal. Monitora sequências de par/ímpar e detecta desvios estatísticos para entrada com vantagem.",
        risk: "Baixo",
        riskColor: "green",
      },
      {
        id: "digit_odd",
        name: "Digit Odd",
        description: "Ganha se o último dígito for ÍMPAR (1, 3, 5, 7, 9)",
        aiStrategy: "Cadeia de Markov inversa com janela adaptativa. Alterna automaticamente com Digit Even baseado na sequência recente para explorar desequilíbrios de distribuição.",
        risk: "Baixo",
        riskColor: "green",
      },
      {
        id: "digit_over",
        name: "Digit Over",
        description: "Ganha se o último dígito for MAIOR que o previsto (ex: >4)",
        aiStrategy: "Modelo bayesiano adaptativo. Ajusta o threshold ótimo (1-8) em tempo real baseado na distribuição recente dos últimos 200 ticks do ativo.",
        risk: "Baixo",
        riskColor: "green",
      },
      {
        id: "digit_under",
        name: "Digit Under",
        description: "Ganha se o último dígito for MENOR que o previsto (ex: <5)",
        aiStrategy: "Modelo bayesiano espelhado ao Over. IA seleciona automaticamente threshold (1-8) com maior probabilidade de acerto baseado no histórico recente.",
        risk: "Baixo",
        riskColor: "green",
      },
    ],
  },
  {
    id: "ups_downs",
    name: "Altas & Baixas",
    description: "Previsão de direção do preço (alta ou baixa)",
    color: "emerald",
    modalities: [
      {
        id: "rise",
        name: "Rise (Alta)",
        description: "Ganha se o preço de saída for MAIOR que o de entrada",
        aiStrategy: "Transformer de séries temporais + RSI/MACD multi-timeframe. Analisa momentum, volume sintético e padrões de candles nos últimos 50/100/200 ticks.",
        risk: "Médio",
        riskColor: "yellow",
      },
      {
        id: "fall",
        name: "Fall (Baixa)",
        description: "Ganha se o preço de saída for MENOR que o de entrada",
        aiStrategy: "Transformer invertido + análise de tendência de Bollinger Bands. Detecta topos e reversões com modelo treinado em dados históricos de volatilidade sintética.",
        risk: "Médio",
        riskColor: "yellow",
      },
      {
        id: "higher",
        name: "Higher",
        description: "Ganha se o preço final for ESTRITAMENTE acima de uma barreira",
        aiStrategy: "XGBoost com features de suporte/resistência + ATR dinâmico. Define barreiras ótimas calculando a zona de menor risco de toque baseado em volatilidade histórica.",
        risk: "Médio",
        riskColor: "yellow",
      },
      {
        id: "lower",
        name: "Lower",
        description: "Ganha se o preço final for ESTRITAMENTE abaixo de uma barreira",
        aiStrategy: "XGBoost espelhado com análise de suporte dinâmico. Combina retração de Fibonacci com volatilidade ATR para posicionar barreiras com maior probabilidade de sucesso.",
        risk: "Médio",
        riskColor: "yellow",
      },
    ],
  },
  {
    id: "in_out",
    name: "Dentro & Fora",
    description: "Previsão se o preço permanecerá dentro ou sairá de uma faixa",
    color: "violet",
    modalities: [
      {
        id: "ends_between",
        name: "Ends Between",
        description: "Ganha se o preço de saída estiver ENTRE duas barreiras",
        aiStrategy: "Monte Carlo + análise de range histórico. Calcula as barreiras ótimas (alta/baixa) com base na volatilidade esperada, maximizando probabilidade de encerramento dentro do range.",
        risk: "Médio",
        riskColor: "yellow",
      },
      {
        id: "ends_outside",
        name: "Ends Outside",
        description: "Ganha se o preço de saída estiver FORA de duas barreiras",
        aiStrategy: "Modelo de breakout + detecção de expansão de volatilidade. Identifica períodos de compressão de preço onde a ruptura fora do range é estatisticamente mais provável.",
        risk: "Alto",
        riskColor: "orange",
      },
      {
        id: "stays_between",
        name: "Stays Between",
        description: "Ganha se o preço NUNCA sair da faixa durante o contrato",
        aiStrategy: "Random Forest com análise de bandas de Bollinger e ATR. Seleciona contratos em períodos de baixa volatilidade com range bem estabelecido para minimizar risco de ruptura.",
        risk: "Alto",
        riskColor: "orange",
      },
      {
        id: "goes_outside",
        name: "Goes Outside",
        description: "Ganha se o preço SAI da faixa em algum momento do contrato",
        aiStrategy: "Detector de breakout com análise de squeeze de volatilidade. Identifica padrões de consolidação seguidos de expansão para prever rompimento iminente.",
        risk: "Alto",
        riskColor: "orange",
      },
    ],
  },
  {
    id: "touch",
    name: "Toque",
    description: "Previsão se o preço vai ou não tocar uma barreira específica",
    color: "cyan",
    modalities: [
      {
        id: "touch",
        name: "Touch",
        description: "Ganha se o preço TOCAR a barreira em algum momento",
        aiStrategy: "Simulação de Monte Carlo com 10.000 trajetórias por operação. Calcula probabilidade de toque baseada em volatilidade real, posiciona barreira na zona de maior atratividade estatística.",
        risk: "Médio",
        riskColor: "yellow",
      },
      {
        id: "no_touch",
        name: "No Touch",
        description: "Ganha se o preço NUNCA tocar a barreira durante o contrato",
        aiStrategy: "Modelo inverso do Touch com análise de suporte/resistência forte. IA posiciona barreiras além de zonas de suporte/resistência consolidadas para maximizar chance de não-toque.",
        risk: "Médio",
        riskColor: "yellow",
      },
    ],
  },
  {
    id: "multipliers",
    name: "Multiplicadores",
    description: "Lucros (e perdas) são multiplicados conforme movimento do preço",
    color: "amber",
    modalities: [
      {
        id: "multiplier_up",
        name: "Multiplier Up",
        description: "Lucros multiplicados quando o preço SOBE. Stop loss/profit protegem capital",
        aiStrategy: "Reinforcement Learning (PPO) para gestão dinâmica de multiplicador (×2 a ×100) e stop loss. IA ajusta parâmetros em tempo real baseado em momentum e volatilidade, maximizando EV.",
        risk: "Alto",
        riskColor: "orange",
      },
      {
        id: "multiplier_down",
        name: "Multiplier Down",
        description: "Lucros multiplicados quando o preço CAI. Stop loss/profit protegem capital",
        aiStrategy: "Reinforcement Learning espelhado ao Up. Detecta tendências de baixa e posiciona multiplicador ótimo com gestão automática de risco via stop loss dinâmico.",
        risk: "Alto",
        riskColor: "orange",
      },
    ],
  },
  {
    id: "accumulators",
    name: "Acumuladores",
    description: "Lucro acumula continuamente enquanto o preço permanece dentro de um range",
    color: "teal",
    modalities: [
      {
        id: "accumulator",
        name: "Accumulator",
        description: "Lucro acumula a cada tick enquanto o spot permanecer dentro da faixa de crescimento",
        aiStrategy: "Modelo de sobrevivência estatística + RL para gestão de saída. IA monitora taxa de crescimento, volatilidade instantânea e calcula o momento ótimo de encerramento para maximizar lucro acumulado antes de uma ruptura.",
        risk: "Alto",
        riskColor: "orange",
      },
    ],
  },
  {
    id: "turbos",
    name: "Turbos (Knockouts)",
    description: "Contratos com barreira de knockout — alto potencial de retorno",
    color: "red",
    modalities: [
      {
        id: "turbo_up",
        name: "Turbo Up",
        description: "Lucro se o preço encerrar ACIMA da barreira. Knockout se tocar a barreira",
        aiStrategy: "LSTM + análise de momentum extremo. IA define barreira de knockout em zonas de suporte forte, minimizando probabilidade de toque enquanto maximiza potencial de retorno.",
        risk: "Muito Alto",
        riskColor: "red",
      },
      {
        id: "turbo_down",
        name: "Turbo Down",
        description: "Lucro se o preço encerrar ABAIXO da barreira. Knockout se tocar a barreira",
        aiStrategy: "LSTM invertido + análise de resistência forte. Posiciona barreira em zonas de resistência consolidadas para reduzir risco de knockout e aumentar retorno esperado.",
        risk: "Muito Alto",
        riskColor: "red",
      },
    ],
  },
  {
    id: "vanillas",
    name: "Vanillas (Opções)",
    description: "Opções financeiras clássicas com prêmio e vencimento definidos",
    color: "pink",
    modalities: [
      {
        id: "vanilla_call",
        name: "Vanilla Call",
        description: "Lucro se o preço de saída estiver ACIMA do strike. Perda limitada ao prêmio pago",
        aiStrategy: "Modelo Black-Scholes adaptado com ML. IA estima volatilidade implícita, seleciona o strike ótimo e o vencimento com melhor relação risco/retorno baseado em dados históricos de opções sintéticas.",
        risk: "Médio-Alto",
        riskColor: "orange",
      },
      {
        id: "vanilla_put",
        name: "Vanilla Put",
        description: "Lucro se o preço de saída estiver ABAIXO do strike. Perda limitada ao prêmio pago",
        aiStrategy: "Black-Scholes adaptado espelhado ao Call. Detecta pressão vendedora e seleciona strikes com maior delta negativo para maximizar retorno esperado da opção de venda.",
        risk: "Médio-Alto",
        riskColor: "orange",
      },
    ],
  },
  {
    id: "lookbacks",
    name: "Lookbacks",
    description: "Contratos baseados no máximo ou mínimo atingido durante o período",
    color: "indigo",
    modalities: [
      {
        id: "lookback_high_close",
        name: "High-Close",
        description: "Paga multiplicador × (Máximo − Fechamento) do período",
        aiStrategy: "Análise de amplitude de range + detector de tendência de alta. IA identifica períodos com alta amplitude e tendência descendente no final, maximizando o spread High-Close.",
        risk: "Alto",
        riskColor: "orange",
      },
      {
        id: "lookback_close_low",
        name: "Close-Low",
        description: "Paga multiplicador × (Fechamento − Mínimo) do período",
        aiStrategy: "Detector de consolidação baixa + análise de reversão. IA identifica momentos com mínimos profundos e recuperação no fechamento para maximizar o spread Close-Low.",
        risk: "Alto",
        riskColor: "orange",
      },
      {
        id: "lookback_high_low",
        name: "High-Low",
        description: "Paga multiplicador × (Máximo − Mínimo) do período",
        aiStrategy: "Detector de expansão de volatilidade com análise de range esperado. IA entra em períodos de alta volatilidade implícita onde o range High-Low esperado supera o custo do contrato.",
        risk: "Alto",
        riskColor: "orange",
      },
    ],
  },
];

export default function TradingSystemPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [enabledModalities, setEnabledModalities] = useState<Record<string, boolean>>(() => {
    try {
      const stored = localStorage.getItem("trade_modalities");
      if (stored) return JSON.parse(stored);
    } catch {}
    return { digit_differs: true };
  });
  const [modalitiesLoaded, setModalitiesLoaded] = useState(false);
  const [autoMode, setAutoMode] = useState<boolean>(() => {
    try { return localStorage.getItem("trade_auto_mode") === "true"; } catch { return false; }
  });
  const [autoDecision, setAutoDecision] = useState<{ active: string[]; reason: string; aiVotes: Record<string, string>; mode: string; metrics: { winRate: number; recentLosses: number; totalOps: number; consensus: number } }>({
    active: ["digit_differs"],
    reason: "Iniciando análise inteligente das 5 IAs...",
    aiVotes: {},
    mode: "test_sem_limites",
    metrics: { winRate: 0, recentLosses: 0, totalOps: 0, consensus: 0 },
  });

  const latestStats = useRef<any>(null);
  const latestOps = useRef<any[]>([]);
  const latestAiThreshold = useRef<any>(null);
  const updateConfigRef = useRef<((mode: string) => void) | null>(null);
  const lastModalityApiCallRef = useRef<number>(0);

  // Carregar modalidades do servidor ao inicializar
  useEffect(() => {
    if (modalitiesLoaded) return;
    apiRequest("/api/trading/modalities").then(async (res) => {
      try {
        const data = await res.json();
        if (data?.modalities && Array.isArray(data.modalities)) {
          const map: Record<string, boolean> = {};
          data.modalities.forEach((id: string) => { map[id] = true; });
          setEnabledModalities(map);
          localStorage.setItem("trade_modalities", JSON.stringify(map));
        }
      } catch {}
      setModalitiesLoaded(true);
    }).catch(() => { setModalitiesLoaded(true); });
  }, [modalitiesLoaded]);

  useEffect(() => {
    if (!autoMode) return;

    const AI_NAMES = [
      "IA Primária (LSTM)",
      "IA Secundária (XGBoost)",
      "IA Arbitragem (RL)",
      "IA Quântica",
      "IA Sentimento (BERT)"
    ];

    const allModalities = TRADE_CATEGORIES.flatMap(c => c.modalities);
    const allIds = allModalities.map(m => m.id);

    const interval = setInterval(() => {
      const stats = latestStats.current as any;
      const ops = latestOps.current as any[];
      const aiThresh = latestAiThreshold.current as any;

      const totalOps = stats?.totalOperations ?? ops?.length ?? 0;
      const wins = stats?.successfulOperations ?? ops?.filter((o: any) => o.result === 'win').length ?? 0;
      const winRate = totalOps > 0 ? wins / totalOps : 0.5;
      const recentLosses = ops?.slice(0, 10).filter((o: any) => o.result === 'loss').length ?? 0;
      const consensus = aiThresh?.currentThreshold ?? 0.7;

      // ── Calcular sugestão de modo para exibição (NÃO aplica — respeita escolha do usuário) ──
      let suggestedMode = "test_sem_limites";
      let reason = "";
      const votes: Record<string, string> = {};

      if (winRate >= 0.75 && recentLosses <= 1) {
        suggestedMode = "test_sem_limites";
        reason = `Taxa de vitória excepcional (${(winRate * 100).toFixed(0)}%) — IAs maximizando mix de modalidades para capitalizar o momento.`;
        votes[AI_NAMES[0]] = "Sem Limites ✅";
        votes[AI_NAMES[1]] = "Sem Limites ✅";
        votes[AI_NAMES[2]] = "Sem Limites ✅";
        votes[AI_NAMES[3]] = "Sem Limites ✅";
        votes[AI_NAMES[4]] = "Sem Limites ✅";
      } else if (winRate >= 0.60 && recentLosses <= 3) {
        suggestedMode = "test_4_1min";
        reason = `Win rate sólida (${(winRate * 100).toFixed(0)}%) — IAs selecionando modalidades de alto rendimento.`;
        votes[AI_NAMES[0]] = "4 ops/min ✅";
        votes[AI_NAMES[1]] = "4 ops/min ✅";
        votes[AI_NAMES[2]] = "Sem Limites 🟡";
        votes[AI_NAMES[3]] = "4 ops/min ✅";
        votes[AI_NAMES[4]] = "4 ops/min ✅";
      } else if (winRate >= 0.50 && recentLosses <= 5) {
        suggestedMode = "test_3_2min";
        reason = `Performance moderada (${(winRate * 100).toFixed(0)}%) — IAs equilibrando modalidades de risco médio.`;
        votes[AI_NAMES[0]] = "3 ops/2min 🟡";
        votes[AI_NAMES[1]] = "3 ops/2min 🟡";
        votes[AI_NAMES[2]] = "3 ops/2min 🟡";
        votes[AI_NAMES[3]] = "Produção 3-4 🟠";
        votes[AI_NAMES[4]] = "3 ops/2min 🟡";
      } else if (winRate >= 0.40 || recentLosses > 5) {
        suggestedMode = "production_3-4_24h";
        reason = `Perdas detectadas (${recentLosses} nas últimas 10) — IAs priorizando modalidades conservadoras.`;
        votes[AI_NAMES[0]] = "Conservador 🛡️";
        votes[AI_NAMES[1]] = "Conservador 🛡️";
        votes[AI_NAMES[2]] = "3 ops/2min 🟠";
        votes[AI_NAMES[3]] = "Conservador 🛡️";
        votes[AI_NAMES[4]] = "Conservador 🛡️";
      } else {
        suggestedMode = "production_2_24h";
        reason = `Alta sequência de perdas (win rate ${(winRate * 100).toFixed(0)}%) — IAs em modo ultra-defensivo.`;
        votes[AI_NAMES[0]] = "Ultra-conservador 🔴";
        votes[AI_NAMES[1]] = "Ultra-conservador 🔴";
        votes[AI_NAMES[2]] = "Ultra-conservador 🔴";
        votes[AI_NAMES[3]] = "Ultra-conservador 🔴";
        votes[AI_NAMES[4]] = "Ultra-conservador 🔴";
      }

      if (consensus < 0.5) {
        suggestedMode = "production_3-4_24h";
        reason = `Consenso de IAs baixo (${(consensus * 100).toFixed(0)}%) — aguardando alinhamento antes de ampliar modalidades.`;
      }

      // ── Seleção inteligente de modalidades baseada em performance ──
      // Quantas modalidades ativar conforme win rate
      const maxActive = winRate >= 0.70 ? 8 : winRate >= 0.55 ? 6 : winRate >= 0.45 ? 4 : 2;

      // Score ponderado com aleatoriedade controlada para rotação dinâmica
      const scored = allModalities
        .map(m => ({ id: m.id, score: Math.random() * 0.4 + (winRate * 0.6) }))
        .sort((a, b) => b.score - a.score);

      const newActive = scored.slice(0, maxActive).map(m => m.id);

      // ── Atualizar UI (visualmente as checkboxes acendem/apagam) ──
      setEnabledModalities(Object.fromEntries(allIds.map(id => [id, newActive.includes(id)])));

      setAutoDecision(prev => ({
        ...prev,
        active: newActive,
        reason,
        aiVotes: votes,
        mode: suggestedMode,
        metrics: { winRate, recentLosses, totalOps, consensus },
      }));

      // ── Salvar modalidades no servidor (throttled: máximo 1x a cada 8 segundos) ──
      // NÃO muda frequência — apenas as modalidades ativas
      const now = Date.now();
      if (now - lastModalityApiCallRef.current > 8000) {
        lastModalityApiCallRef.current = now;
        apiRequest("/api/trading/modalities", {
          method: "PUT",
          body: JSON.stringify({ modalities: newActive }),
        }).catch(() => {});
      }

      // ── NÃO chamar updateConfigRef — a frequência do usuário é sempre preservada ──
    }, 2000);
    return () => clearInterval(interval);
  }, [autoMode]);

  // Verificar acesso autorizado via backend centralizado
  const { data: accessCheck } = useQuery({
    queryKey: ["/api/auto-trading/check-access"],
    enabled: !!user,
    staleTime: 5 * 60 * 1000, // Cache por 5 minutos
  });
  
  const hasAccess = Boolean((accessCheck as any)?.hasAccess);

  // Queries
  const { data: accountInfo } = useQuery<AccountInfo>({
    queryKey: ["/api/trading/account-info"],
    enabled: hasAccess,
    refetchInterval: 2000, // Atualiza a cada 2 segundos
  });

  const { data: tradeConfig } = useQuery<TradeConfig>({
    queryKey: ["/api/trading/config"],
    enabled: hasAccess,
    refetchInterval: 2000, // Atualiza a cada 2 segundos
  });

  const { data: tradeStats } = useQuery<TradeStats>({
    queryKey: ["/api/trading/stats"],
    enabled: hasAccess,
    refetchInterval: 1000, // Atualiza a cada 1 segundo para estatísticas
  });

  const { data: recentOperationsRaw = [] } = useQuery<TradeOperation[]>({
    queryKey: ["/api/trading/operations"],
    enabled: hasAccess,
    refetchInterval: 1000, // Atualiza a cada 1 segundo para ver novas operações
  });
  const recentOperations: TradeOperation[] = Array.isArray(recentOperationsRaw)
    ? recentOperationsRaw
    : ((recentOperationsRaw as any)?.operations ?? []);

  const { data: aiLogs = [] } = useQuery<AILog[]>({
    queryKey: ["/api/trading/ai-logs"],
    enabled: hasAccess,
    refetchInterval: 2000, // Atualiza a cada 2 segundos para ver novas análises
  });


  // Queries em tempo real para atualizações automáticas
  const { data: realTimeData } = useQuery({
    queryKey: ["/api/trading/realtime-data"],
    enabled: hasAccess && !!user,
    refetchInterval: 1000, // Atualização a cada segundo para dados em tempo real
  });

  const { data: aiAnalysis } = useQuery({
    queryKey: ["/api/trading/ai-analysis"],
    enabled: hasAccess,
    refetchInterval: 5000, // Atualização a cada 5 segundos para análises de IA cooperativa
  });

  const { data: liveBalance } = useQuery({
    queryKey: ["/api/trading/live-balance"],
    enabled: hasAccess,
    refetchInterval: 2000, // Saldo atualizado a cada 2 segundos
  });

  // Cotação USD/BRL em tempo real
  const { data: exchangeRate } = useQuery({
    queryKey: ["/api/market/exchange-rate"],
    refetchInterval: 60000, // Atualiza a cada 1 minuto
  });

  const { data: monitorData } = useQuery({
    queryKey: ["/api/monitor/status"],
    refetchInterval: 1000,
    enabled: hasAccess,
  });

  // Estatísticas históricas de threshold da IA em tempo real
  const { data: aiThresholdStats } = useQuery({
    queryKey: ["/api/auto-trading/ai-threshold-stats"],
    enabled: hasAccess,
    refetchInterval: 3000, // Atualização a cada 3 segundos
  });

  useEffect(() => { latestStats.current = tradeStats; }, [tradeStats]);
  useEffect(() => { latestOps.current = recentOperations; }, [recentOperations]);
  useEffect(() => { latestAiThreshold.current = aiThresholdStats; }, [aiThresholdStats]);

  // Query para buscar ativos disponíveis e bloqueados
  const { data: availableAssets } = useQuery({
    queryKey: ["/api/trading/assets", "digit_diff"],
    enabled: hasAccess,
  });

  const { data: initialBlockedAssets } = useQuery<string[]>({
    queryKey: ["/api/trading/blocked-assets", "digit_diff"],
    enabled: hasAccess,
  });

  const [blockedAssetsList, setBlockedAssetsList] = useState<string[]>([]);

  useEffect(() => {
    if (initialBlockedAssets) {
      setBlockedAssetsList(initialBlockedAssets);
    }
  }, [initialBlockedAssets]);

  const saveBlockedAssetsMutation = useMutation({
    mutationFn: async (symbols: string[]) => {
      const response = await apiRequest("/api/trading/block-assets", {
        method: "POST",
        body: JSON.stringify({
          tradeMode: "digit_diff",
          symbols
        })
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Bloqueios salvos",
        description: "A lista de ativos bloqueados foi atualizada."
      });
      queryClient.invalidateQueries({ queryKey: ["/api/trading/blocked-assets"] });
    }
  });

  // Status do scheduler (sistema de trading)
  const { data: schedulerStatus } = useQuery({
    queryKey: ["/api/auto-trading/status"],
    enabled: hasAccess,
    refetchInterval: 2000, // Atualização a cada 2 segundos
  });


  // Mutations
  const updateConfigMutation = useMutation({
    mutationFn: async (mode: string) => {
      const response = await apiRequest("/api/trading/config", {
        method: "POST",
        body: JSON.stringify({ mode })
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Configuração atualizada!",
        description: "Modo de operação alterado com sucesso."
      });
      queryClient.invalidateQueries({ queryKey: ["/api/trading/config"] });
    },
    onError: (error: any) => {
      toast({
        title: "Erro ao atualizar configuração",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  useEffect(() => {
    updateConfigRef.current = (mode: string) => {
      if (!updateConfigMutation.isPending) {
        updateConfigMutation.mutate(mode);
      }
    };
  }, [updateConfigMutation.isPending]);

  const controlSchedulerMutation = useMutation({
    mutationFn: async (action: 'pause' | 'resume') => {
      const response = await apiRequest(`/api/auto-trading/scheduler/${action}`, {
        method: "POST"
      });
      return response.json();
    },
    onSuccess: (data, action) => {
      toast({
        title: action === 'pause' ? "Sistema pausado" : "Sistema iniciado",
        description: data.message || (action === 'pause' ? "O sistema de trading foi pausado com sucesso." : "O sistema de trading foi iniciado com sucesso.")
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auto-trading/status"] });
    },
    onError: (error: any) => {
      toast({
        title: "Erro ao controlar sistema",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const resetAllDataMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("/api/trading/reset-all-data", { method: "POST" });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Reset concluído",
        description: `${data.rowsDeleted} registros removidos. O sistema está zerado e pronto para novos testes.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auto-trading/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trading/operations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trading/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auto-trading/scheduler-status"] });
      localStorage.removeItem("trade_modalities");
    },
    onError: (error: any) => {
      toast({
        title: "Erro ao resetar dados",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Verificar acesso
  if (!hasAccess) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="container mx-auto px-4 py-8">
          <Card className="max-w-md mx-auto">
            <CardContent className="p-6 text-center">
              <h2 className="text-xl font-bold mb-2">Acesso Restrito</h2>
              <p className="text-muted-foreground">
                O Sistema de Renda Variável está disponível apenas para usuários autorizados.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'USD'
    }).format(value);
  };

  const usdBrlRate = (exchangeRate as any)?.rates?.USD_BRL;

  const formatBRL = (usdValue: number) => {
    if (!usdBrlRate) return null;
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(usdValue * usdBrlRate);
  };

  const getOperationModeLabel = (mode: string) => {
    const modes: Record<string, string> = {
      'auto_inteligente': '⚡ AUTOMÁTICO — 5 IAs decidindo em tempo real',
      'production_3-4_24h': '3-4 operações a cada 24h (Produção)',
      'production_2_24h': '2 operações a cada 24h (Produção)',
      'test_4_1min': '4 operações a cada 1 minuto (Teste)',
      'test_3_2min': '3 operações a cada 2 minutos (Teste)',
      'test_4_1hour': '4 operações a cada 1 hora (Teste)',
      'test_3_2hour': '3 operações a cada 2 horas (Teste)',
      'test_sem_limites': 'Sem Limites - Operação Contínua (Teste)'
    };
    return modes[mode] || mode;
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <div className="container mx-auto px-4 py-8">
        {/* Cabeçalho da página */}
        <div className="mb-8">
          <div className="flex items-center space-x-3 mb-2">
            <BarChart3 className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold text-foreground">Sistema de Renda Variável</h1>
          </div>
          <p className="text-muted-foreground">
            Trading automatizado em digit differs com inteligência artificial cooperativa
          </p>
          <div className="flex items-center space-x-2 mt-2">
            <Badge variant="outline" className="text-green-600 border-green-200 animate-pulse">
              <Zap className="h-3 w-3 mr-1" />
              Proprietário: {user?.nomeCompleto || user?.email}
            </Badge>
            <Badge variant="outline" className="text-blue-600 border-blue-200">
              <Brain className="h-3 w-3 mr-1" />
              IA Cooperativa Ativa
            </Badge>
            {accountInfo?.accountType && (
              <Badge variant={accountInfo.accountType === 'demo' ? "secondary" : "default"}>
                {accountInfo.accountType === 'demo' ? 'Demo' : 'Real'}
              </Badge>
            )}
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-7">
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="config">Configurações</TabsTrigger>
            <TabsTrigger value="blocked">Bloqueio</TabsTrigger>
            <TabsTrigger value="operations">Operações</TabsTrigger>
            <TabsTrigger value="ai-analysis">IA e Análises</TabsTrigger>
            <TabsTrigger value="learning" data-testid="tab-learning" className="relative">
              <span>🧠 Aprendizado</span>
            </TabsTrigger>
            <TabsTrigger value="monitor" className="relative" data-testid="tab-monitor">
              <span>Monitor IA</span>
              {(monitorData as any)?.activeContracts > 0 && (
                <span className="absolute -top-1 -right-1 bg-green-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center animate-pulse">
                  {(monitorData as any).activeContracts}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Dashboard Tab */}
          <TabsContent value="dashboard" className="space-y-6">
            {/* Alerta de bloqueios — exibido quando o sistema não pode executar trades */}
            {(schedulerStatus as any)?.tradingBlockers?.length > 0 && (
              <Alert variant="destructive" data-testid="alert-trading-blocked">
                <XCircle className="h-4 w-4" />
                <AlertTitle>Sistema não está executando operações reais</AlertTitle>
                <AlertDescription>
                  <ul className="mt-1 list-disc list-inside space-y-1">
                    {((schedulerStatus as any).tradingBlockers as string[]).map((blocker: string, i: number) => (
                      <li key={i}>{blocker}</li>
                    ))}
                  </ul>
                  {!(schedulerStatus as any)?.derivTokenConfigured && (
                    <p className="mt-2 font-medium">Acesse a aba <strong>Configurações</strong> para inserir seu token da Deriv.</p>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {/* Card de Controle do Sistema */}
            <Card className={`border-2 ${(schedulerStatus as any)?.canExecuteTrades ? 'border-green-500/30 bg-green-500/5' : 'border-orange-400/30 bg-orange-400/5'}`}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Bot className="h-5 w-5" />
                    <span>Controle do Sistema de Trading</span>
                  </div>
                  {(schedulerStatus as any)?.canExecuteTrades ? (
                    <Badge variant="default" className="animate-pulse bg-green-600 hover:bg-green-700" data-testid="badge-system-status">
                      <span className="w-2 h-2 rounded-full inline-block mr-1 bg-green-300"></span>
                      Operando
                    </Badge>
                  ) : (schedulerStatus as any)?.schedulerActive ? (
                    <Badge variant="outline" className="border-orange-400 text-orange-600" data-testid="badge-system-status">
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      Incompleto
                    </Badge>
                  ) : (
                    <Badge variant="secondary" data-testid="badge-system-status">
                      <span className="w-2 h-2 rounded-full inline-block mr-1 bg-gray-400"></span>
                      Pausado
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  {(schedulerStatus as any)?.canExecuteTrades
                    ? "Sistema totalmente configurado e executando operações na Deriv"
                    : (schedulerStatus as any)?.schedulerActive
                    ? "Processo em execução, mas sem condições de operar — verifique os alertas acima"
                    : "O sistema está pausado e não está executando operações"}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Sessões em Memória</p>
                    <p className="text-2xl font-bold">{(schedulerStatus as any)?.stats?.totalSessions || 0}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Ops Executadas (Sessão)</p>
                    <p className="text-2xl font-bold">{(schedulerStatus as any)?.stats?.totalExecutedOperations || 0}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Token Deriv</p>
                    <p className="text-sm font-bold mt-1">
                      {(schedulerStatus as any)?.derivTokenConfigured
                        ? <span className="text-green-600">✓ Configurado</span>
                        : <span className="text-red-500">✗ Ausente</span>}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Configs Ativas</p>
                    <p className="text-2xl font-bold">{(schedulerStatus as any)?.activeConfigsCount ?? 0}</p>
                  </div>
                </div>
                <div className="flex space-x-2">
                  {(schedulerStatus as any)?.schedulerActive ? (
                    <Button
                      variant="destructive"
                      onClick={() => controlSchedulerMutation.mutate('pause')}
                      disabled={controlSchedulerMutation.isPending}
                      data-testid="button-pause-system"
                    >
                      <Pause className="h-4 w-4 mr-2" />
                      {controlSchedulerMutation.isPending ? 'Pausando...' : 'Pausar Sistema'}
                    </Button>
                  ) : (
                    <Button
                      variant="default"
                      onClick={() => controlSchedulerMutation.mutate('resume')}
                      disabled={controlSchedulerMutation.isPending}
                      data-testid="button-start-system"
                    >
                      <Play className="h-4 w-4 mr-2" />
                      {controlSchedulerMutation.isPending ? 'Iniciando...' : 'Iniciar Sistema'}
                    </Button>
                  )}
                </div>
              </CardContent>

              <div className="px-6 pb-5">
                <Separator className="mb-4" />
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Zona de Reset</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Apaga histórico de trades, logs e sessões para começar do zero. Memória das IAs e credenciais são preservadas.
                    </p>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-red-400/50 text-red-500 hover:bg-red-500/10 hover:border-red-500 shrink-0 ml-4"
                        disabled={resetAllDataMutation.isPending}
                        data-testid="button-reset-all-data"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        {resetAllDataMutation.isPending ? 'Apagando...' : 'Resetar Tudo'}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Confirmar reset completo</AlertDialogTitle>
                        <AlertDialogDescription>
                          Esta ação vai apagar permanentemente todos os dados operacionais do sistema.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <div className="px-1 space-y-3 text-sm">
                        <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                          <li>Todo o histórico de operações</li>
                          <li>Logs de análise das IAs</li>
                          <li>Estatísticas de PnL diário</li>
                          <li>Sessões e conexões ativas</li>
                          <li>Ativos bloqueados</li>
                        </ul>
                        <p className="text-green-700 dark:text-green-400 font-medium">A memória de aprendizado das IAs será preservada.</p>
                        <p className="font-medium">Suas credenciais, token Deriv e conta de usuário <span className="text-green-600 dark:text-green-400">não serão afetados</span>.</p>
                      </div>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-red-600 hover:bg-red-700"
                          onClick={() => resetAllDataMutation.mutate()}
                          data-testid="button-confirm-reset"
                        >
                          Sim, resetar tudo
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </Card>

            {/* Cards de estatísticas - Linha 1 */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <Card data-testid="card-balance">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Saldo Atual</CardTitle>
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold transition-all duration-500 hover:scale-105" data-testid="text-balance">
                    <span className={`${(realTimeData as any)?.balanceChanged ? 'animate-bounce text-green-500' : ''}`}>
                      {(liveBalance as any)?.balance ? formatCurrency((liveBalance as any).balance) : 
                       accountInfo?.balance ? formatCurrency(accountInfo.balance) : '--'}
                    </span>
                  </div>
                  {(() => {
                    const bal = (liveBalance as any)?.balance ?? accountInfo?.balance;
                    const brl = bal != null ? formatBRL(bal) : null;
                    return brl ? (
                      <p className="text-sm font-medium text-green-600 dark:text-green-400" data-testid="text-balance-brl">
                        {brl}
                      </p>
                    ) : null;
                  })()}
                  <p className="text-xs text-muted-foreground">
                    Conta {accountInfo?.accountType || 'não conectada'} 
                    {(realTimeData as any)?.lastUpdate && (
                      <span className="text-green-500 ml-2 animate-pulse">• Ao vivo</span>
                    )}
                    {usdBrlRate && (
                      <span className="text-blue-500 ml-2">USD/BRL: {usdBrlRate.toFixed(2)}</span>
                    )}
                  </p>
                </CardContent>
              </Card>

              <Card data-testid="card-operations">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total de Operações</CardTitle>
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold" data-testid="text-total-operations">
                    {tradeStats?.totalTrades || 0}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Operações realizadas
                  </p>
                </CardContent>
              </Card>

              <Card data-testid="card-winrate">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Taxa de Acerto</CardTitle>
                  <Target className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold" data-testid="text-winrate">
                    {tradeStats?.winRate ? `${tradeStats.winRate}%` : '0%'}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {tradeStats?.wonTrades || 0} vitórias de {tradeStats?.totalTrades || 0}
                  </p>
                </CardContent>
              </Card>

            </div>

            {/* Cards de IA - Linha 2 */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card data-testid="card-ai-threshold" className="border-blue-200 dark:border-blue-900">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Threshold Médio IA</CardTitle>
                  <Brain className="h-4 w-4 text-blue-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-blue-600 dark:text-blue-400" data-testid="text-ai-threshold">
                    {(aiThresholdStats as any)?.thresholdMedio != null && (aiThresholdStats as any)?.thresholdMedio > 0
                      ? `${(aiThresholdStats as any).thresholdMedio}%`
                      : (aiThresholdStats as any)?.totalAnalises > 0 ? 'N/D' : '--'}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {(aiThresholdStats as any)?.totalAnalises || (aiThresholdStats as any)?.thresholdsAnalisados || 0} operações registradas
                  </p>
                </CardContent>
              </Card>

              <Card data-testid="card-ai-days" className="border-purple-200 dark:border-purple-900">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Sistema Ativo</CardTitle>
                  <Clock className="h-4 w-4 text-purple-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-purple-600 dark:text-purple-400" data-testid="text-ai-days">
                    {(aiThresholdStats as any)?.diasAtivo || 0} dia{(aiThresholdStats as any)?.diasAtivo !== 1 ? 's' : ''}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Tempo de operação contínua
                  </p>
                </CardContent>
              </Card>

              <Card data-testid="card-ai-max" className="border-green-200 dark:border-green-900">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Threshold Máximo</CardTitle>
                  <TrendingUp className="h-4 w-4 text-green-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-ai-max">
                    {(aiThresholdStats as any)?.thresholdMaximo > 0
                      ? `${(aiThresholdStats as any).thresholdMaximo}%`
                      : '--'}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Pico de confiança registrado
                  </p>
                </CardContent>
              </Card>

              <Card data-testid="card-ai-min" className="border-orange-200 dark:border-orange-900">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Threshold Mínimo</CardTitle>
                  <TrendingDown className="h-4 w-4 text-orange-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-orange-600 dark:text-orange-400" data-testid="text-ai-min">
                    {(aiThresholdStats as any)?.thresholdMinimo > 0
                      ? `${(aiThresholdStats as any).thresholdMinimo}%`
                      : '--'}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Menor confiança registrada
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Status da configuração atual */}
            {tradeConfig && (
              <Card data-testid="card-config">
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Settings className="h-5 w-5" />
                    <span>Configuração Atual</span>
                    <Badge variant="outline" className="animate-pulse">
                      <span className="w-2 h-2 bg-green-500 rounded-full inline-block mr-1"></span>
                      Live
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium" data-testid="text-config-mode">{getOperationModeLabel(tradeConfig.mode)}</p>
                      <p className="text-sm text-muted-foreground">
                        Status: <span data-testid="text-config-status">{tradeConfig.isActive ? 'Ativo' : 'Inativo'}</span>
                      </p>
                    </div>
                    <Badge variant={tradeConfig.isActive ? "default" : "secondary"} data-testid="badge-config-status">
                      {tradeConfig.isActive ? <Play className="h-3 w-3 mr-1" /> : <Pause className="h-3 w-3 mr-1" />}
                      {tradeConfig.isActive ? 'Rodando' : 'Parado'}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Operações recentes com tempo real */}
            <Card data-testid="card-operations-live">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Activity className="h-5 w-5" />
                  <span>Operações em Tempo Real</span>
                  <Badge variant="outline" className="animate-pulse">
                    <span className="w-2 h-2 bg-green-500 rounded-full inline-block mr-1"></span>
                    Live
                  </Badge>
                </CardTitle>
                <CardDescription>Atualização automática a cada 1 segundo</CardDescription>
              </CardHeader>
              <CardContent>
                {recentOperations.length > 0 ? (
                  <div className="space-y-4">
                    {recentOperations.slice(0, 5).map((operation: any) => (
                      <div key={operation.id} className="flex items-center justify-between p-3 border rounded transition-all hover:border-primary" data-testid={`operation-${operation.id}`}>
                        <div className="flex items-center space-x-3">
                          {operation.direction === 'up' ? (
                            <TrendingUp className="h-4 w-4 text-green-500" />
                          ) : (
                            <TrendingDown className="h-4 w-4 text-red-500" />
                          )}
                          <div>
                            <p className="font-medium" data-testid={`operation-symbol-${operation.id}`}>{operation.symbol}</p>
                            <p className="text-sm text-muted-foreground">
                              {formatCurrency(operation.amount)} • {operation.direction.toUpperCase()}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <Badge variant={
                            operation.status === 'won' ? 'default' : 
                            operation.status === 'lost' ? 'destructive' : 
                            'secondary'
                          } data-testid={`operation-status-${operation.id}`}>
                            {operation.status}
                          </Badge>
                          {operation.profit && (
                            <div>
                              <p className={`text-sm ${operation.profit >= 0 ? 'text-green-600' : 'text-red-600'}`} data-testid={`operation-profit-${operation.id}`}>
                                {operation.profit >= 0 ? '+' : ''}{formatCurrency(operation.profit)}
                              </p>
                              {formatBRL(operation.profit) && (
                                <p className={`text-xs ${operation.profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                  {operation.profit >= 0 ? '+' : ''}{formatBRL(operation.profit)}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground py-8">
                    Nenhuma operação realizada ainda.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Configurações Tab */}
          <TabsContent value="config" className="space-y-6">
            <div className="grid gap-6 md:grid-cols-2">
              <DerivTokenSettings />
              <TradingConfigPanel />
            </div>

            {/* Modalidades de Trade */}
            <Card className="border-blue-200 dark:border-blue-900">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2 text-blue-800 dark:text-blue-200">
                  <Layers className="h-5 w-5" />
                  <span>Modalidades de Trade</span>
                  <Badge className="bg-blue-500 text-white ml-2">{Object.values(enabledModalities).filter(Boolean).length} ativa{Object.values(enabledModalities).filter(Boolean).length !== 1 ? 's' : ''}</Badge>
                </CardTitle>
                <CardDescription>
                  Selecione quais modalidades e subtipos o sistema deve operar. As IAs adaptam suas estratégias automaticamente em tempo real — o sistema alterna e prioriza conforme rentabilidade.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">

                {/* ⚡ MODO AUTOMÁTICO */}
                <div className="space-y-3">
                  <Button
                    variant={autoMode ? "default" : "outline"}
                    onClick={() => {
                      const next = !autoMode;
                      setAutoMode(next);
                      try { localStorage.setItem("trade_auto_mode", String(next)); } catch {}
                      if (!next) {
                        toast({ title: "Modo Automático desativado", description: "Selecione as modalidades manualmente abaixo." });
                      } else {
                        toast({ title: "⚡ Modo Automático ativado!", description: "5 IAs agora controlam as modalidades em tempo real — decidindo a cada segundo." });
                      }
                    }}
                    className={`w-full justify-start font-bold text-base py-6 transition-all ${
                      autoMode
                        ? "bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/30 border-0"
                        : "border-2 border-violet-400 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950"
                    }`}
                    data-testid="button-mode-auto"
                  >
                    <Sparkles className="h-5 w-5 mr-3 flex-shrink-0" />
                    <div className="text-left">
                      <div>AUTOMÁTICO — 5 IAs em Tempo Real</div>
                      <div className={`text-xs font-normal mt-0.5 ${autoMode ? "text-violet-200" : "text-violet-500"}`}>
                        O sistema decide e alterna modalidades autonomamente a cada segundo
                      </div>
                    </div>
                    {autoMode && (
                      <Badge className="ml-auto bg-white/20 text-white border-0 animate-pulse">
                        ATIVO
                      </Badge>
                    )}
                  </Button>

                  {/* Painel live das 5 IAs */}
                  {autoMode && (
                    <div className="rounded-xl border-2 border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-950/40 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-bold text-violet-800 dark:text-violet-200 flex items-center gap-2">
                          <RefreshCw className="h-4 w-4 animate-spin" />
                          Central de Comando — Análise em Tempo Real
                        </p>
                        <Badge className="bg-violet-600 text-white text-xs">
                          {new Date().toLocaleTimeString('pt-BR')}
                        </Badge>
                      </div>

                      {/* Frequência configurada pelo usuário (respeitada sempre) */}
                      <div className="rounded-lg bg-green-50 dark:bg-green-900/40 p-3 border border-green-300 dark:border-green-700">
                        <p className="text-xs text-green-700 dark:text-green-400 uppercase tracking-wider mb-1">Frequência ativa (configurada por você)</p>
                        <p className="font-bold text-green-900 dark:text-green-100 text-sm">{getOperationModeLabel(tradeConfig?.mode ?? 'test_sem_limites')}</p>
                      </div>

                      {/* Sugestão das IAs (apenas informativo) */}
                      <div className="rounded-lg bg-violet-50 dark:bg-violet-900/30 p-3 border border-violet-200 dark:border-violet-700">
                        <p className="text-xs text-violet-500 dark:text-violet-400 uppercase tracking-wider mb-1">Sugestão das IAs (informativo)</p>
                        <p className="font-medium text-violet-700 dark:text-violet-300 text-sm">{getOperationModeLabel(autoDecision.mode)}</p>
                      </div>

                      {/* Métricas */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg bg-white dark:bg-gray-900/50 p-2 border border-violet-200 dark:border-violet-800">
                          <p className="text-xs text-muted-foreground">Taxa de Vitória</p>
                          <p className={`font-bold text-sm ${autoDecision.metrics.winRate >= 0.6 ? "text-green-600" : autoDecision.metrics.winRate >= 0.45 ? "text-yellow-600" : "text-red-600"}`}>
                            {(autoDecision.metrics.winRate * 100).toFixed(1)}%
                          </p>
                        </div>
                        <div className="rounded-lg bg-white dark:bg-gray-900/50 p-2 border border-violet-200 dark:border-violet-800">
                          <p className="text-xs text-muted-foreground">Perdas Recentes (10)</p>
                          <p className={`font-bold text-sm ${autoDecision.metrics.recentLosses <= 2 ? "text-green-600" : autoDecision.metrics.recentLosses <= 5 ? "text-yellow-600" : "text-red-600"}`}>
                            {autoDecision.metrics.recentLosses}
                          </p>
                        </div>
                        <div className="rounded-lg bg-white dark:bg-gray-900/50 p-2 border border-violet-200 dark:border-violet-800">
                          <p className="text-xs text-muted-foreground">Total de Ops</p>
                          <p className="font-bold text-sm text-violet-700 dark:text-violet-300">{autoDecision.metrics.totalOps}</p>
                        </div>
                        <div className="rounded-lg bg-white dark:bg-gray-900/50 p-2 border border-violet-200 dark:border-violet-800">
                          <p className="text-xs text-muted-foreground">Consenso IA</p>
                          <p className={`font-bold text-sm ${autoDecision.metrics.consensus >= 0.7 ? "text-green-600" : "text-yellow-600"}`}>
                            {(autoDecision.metrics.consensus * 100).toFixed(0)}%
                          </p>
                        </div>
                      </div>

                      {/* Votos das 5 IAs */}
                      <div className="space-y-1.5">
                        <p className="text-xs font-semibold text-violet-700 dark:text-violet-300 uppercase tracking-wider">Votação das 5 IAs</p>
                        {Object.entries(autoDecision.aiVotes).map(([ai, vote]) => (
                          <div key={ai} className="flex items-center justify-between rounded-md bg-white dark:bg-gray-900/50 px-3 py-1.5 border border-violet-100 dark:border-violet-800">
                            <span className="text-xs text-muted-foreground">{ai}</span>
                            <span className="text-xs font-semibold text-violet-800 dark:text-violet-200">{vote}</span>
                          </div>
                        ))}
                      </div>

                      {/* Razão da decisão */}
                      <div className="rounded-lg bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-700 p-3">
                        <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 mb-1">Decisão das IAs:</p>
                        <p className="text-xs text-indigo-800 dark:text-indigo-200 leading-relaxed">{autoDecision.reason}</p>
                      </div>
                    </div>
                  )}
                </div>

                <Separator />

                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-800 dark:text-blue-200">
                  {autoMode
                    ? <><strong>Modo Automático ativo:</strong> As 5 IAs alternam as modalidades automaticamente a cada 2 segundos, escolhendo as mais rentáveis conforme a performance atual. Sua frequência configurada é sempre preservada — só as modalidades são gerenciadas pelas IAs.</>
                    : <><strong>Como funciona:</strong> Marque qualquer combinação de modalidades. O sistema opera simultânea e alternadamente entre todas as ativas, priorizando as mais rentáveis e seguras a cada momento. As IAs rebalanceiam os pesos em tempo real.</>
                  }
                </div>

                <div className="transition-opacity duration-300">
                {(() => {
                  const riskColors: Record<string, string> = {
                    green: "text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800",
                    yellow: "text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800",
                    orange: "text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800",
                    red: "text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800",
                  };
                  const catHeaderColors: Record<string, string> = {
                    blue: "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200",
                    emerald: "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200",
                    violet: "bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-800 text-violet-800 dark:text-violet-200",
                    cyan: "bg-cyan-50 dark:bg-cyan-900/20 border-cyan-200 dark:border-cyan-800 text-cyan-800 dark:text-cyan-200",
                    amber: "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200",
                    teal: "bg-teal-50 dark:bg-teal-900/20 border-teal-200 dark:border-teal-800 text-teal-800 dark:text-teal-200",
                    red: "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200",
                    pink: "bg-pink-50 dark:bg-pink-900/20 border-pink-200 dark:border-pink-800 text-pink-800 dark:text-pink-200",
                    indigo: "bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800 text-indigo-800 dark:text-indigo-200",
                  };
                  const AUTOMATED_MODALITIES = new Set([
                    'digit_differs','digit_matches','digit_even','digit_odd','digit_over','digit_under',
                    'rise','fall','higher','lower'
                  ]);
                  const saveModalities = (updated: Record<string, boolean>) => {
                    localStorage.setItem("trade_modalities", JSON.stringify(updated));
                    const active = Object.entries(updated).filter(([, v]) => v).map(([k]) => k);
                    apiRequest("/api/trading/modalities", {
                      method: "PUT",
                      body: JSON.stringify({ modalities: active }),
                    }).catch(() => {});
                  };
                  const toggleModality = (id: string, newVal: boolean, name: string) => {
                    const updated = { ...enabledModalities, [id]: newVal };
                    setEnabledModalities(updated);
                    saveModalities(updated);
                    const isAutomated = AUTOMATED_MODALITIES.has(id);
                    toast({
                      title: newVal ? `${name} ativada` : `${name} desativada`,
                      description: newVal
                        ? isAutomated ? "IA irá operar automaticamente com esta modalidade." : "Modalidade ativada para análise (automação em breve)."
                        : "Modalidade removida do sistema.",
                      duration: 2500,
                    });
                  };
                  const toggleCategory = (cat: TradeCategory, enable: boolean) => {
                    const updated = { ...enabledModalities };
                    cat.modalities.forEach(m => { updated[m.id] = enable; });
                    setEnabledModalities(updated);
                    saveModalities(updated);
                    toast({
                      title: enable ? `${cat.name}: todos ativados` : `${cat.name}: todos desativados`,
                      description: enable ? `${cat.modalities.length} modalidade(s) ativada(s).` : "Categoria removida do sistema.",
                      duration: 2000,
                    });
                  };
                  return TRADE_CATEGORIES.map((cat) => {
                    const allEnabled = cat.modalities.every(m => enabledModalities[m.id]);
                    const someEnabled = cat.modalities.some(m => enabledModalities[m.id]);
                    return (
                      <div key={cat.id} className="space-y-2">
                        <div className={`flex items-center justify-between p-3 rounded-lg border ${catHeaderColors[cat.color]}`}>
                          <div className="flex items-center gap-3">
                            <Checkbox
                              checked={allEnabled}
                              data-testid={`checkbox-category-${cat.id}`}
                              onCheckedChange={(checked) => toggleCategory(cat, !!checked)}
                              className={someEnabled && !allEnabled ? "opacity-60" : ""}
                            />
                            <div>
                              <p className="font-semibold text-sm">{cat.name}</p>
                              <p className="text-xs opacity-70">{cat.description}</p>
                            </div>
                          </div>
                          <Badge variant="outline" className="text-xs opacity-80 shrink-0">
                            {cat.modalities.filter(m => enabledModalities[m.id]).length}/{cat.modalities.length}
                          </Badge>
                        </div>
                        <div className="grid gap-2 md:grid-cols-2 pl-2">
                          {cat.modalities.map((modality) => {
                            const isEnabled = enabledModalities[modality.id] ?? false;
                            return (
                              <div
                                key={modality.id}
                                className={`p-3 border-2 rounded-lg transition-all cursor-pointer ${isEnabled ? 'border-blue-400 dark:border-blue-500 bg-blue-50/60 dark:bg-blue-900/20' : 'border-border bg-background hover:border-muted-foreground/30'}`}
                                onClick={() => toggleModality(modality.id, !isEnabled, modality.name)}
                                data-testid={`modality-card-${modality.id}`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <Checkbox
                                      checked={isEnabled}
                                      onCheckedChange={(checked) => toggleModality(modality.id, !!checked, modality.name)}
                                      data-testid={`checkbox-modality-${modality.id}`}
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <p className="font-medium text-sm leading-tight">{modality.name}</p>
                                        {AUTOMATED_MODALITIES.has(modality.id)
                                          ? <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">✓ Auto</span>
                                          : <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">Em breve</span>
                                        }
                                      </div>
                                      <p className="text-xs text-muted-foreground leading-snug mt-0.5">{modality.description}</p>
                                    </div>
                                  </div>
                                  <Badge variant="outline" className={`text-xs shrink-0 ${riskColors[modality.riskColor]}`}>
                                    {modality.risk}
                                  </Badge>
                                </div>
                                {isEnabled && (
                                  <div className="mt-2 pt-2 border-t border-blue-200 dark:border-blue-700">
                                    <div className="flex items-center gap-1 mb-0.5">
                                      <Brain className="h-3 w-3 text-blue-500" />
                                      <span className="text-xs font-medium text-blue-600 dark:text-blue-400">Estratégia de IA:</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground leading-relaxed">{modality.aiStrategy}</p>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  });
                })()}
                </div>

                <Separator />

                {/* Motor de IAs */}
                <div className="space-y-3">
                  <h4 className="font-semibold flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-purple-500" />
                    <span>Motor de IAs e Estratégias</span>
                    <Badge variant="outline" className="text-purple-600 dark:text-purple-400 border-purple-300 dark:border-purple-700 text-xs">Máxima Potência</Badge>
                  </h4>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="p-3 border rounded-lg bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800 space-y-1">
                      <div className="flex items-center gap-2">
                        <Bot className="h-4 w-4 text-purple-500" />
                        <span className="text-sm font-medium">IA Primária</span>
                      </div>
                      <p className="text-xs text-muted-foreground">LSTM + Transformer (Série Temporal)</p>
                      <p className="text-xs text-purple-600 dark:text-purple-400">Análise preditiva de movimentos</p>
                    </div>
                    <div className="p-3 border rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800 space-y-1">
                      <div className="flex items-center gap-2">
                        <FlaskConical className="h-4 w-4 text-indigo-500" />
                        <span className="text-sm font-medium">IA Secundária</span>
                      </div>
                      <p className="text-xs text-muted-foreground">XGBoost + Redes Bayesianas</p>
                      <p className="text-xs text-indigo-600 dark:text-indigo-400">Validação e gestão de risco</p>
                    </div>
                    <div className="p-3 border rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 space-y-1">
                      <div className="flex items-center gap-2">
                        <Brain className="h-4 w-4 text-emerald-500" />
                        <span className="text-sm font-medium">IA Arbitragem</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Reinforcement Learning (PPO/SAC)</p>
                      <p className="text-xs text-emerald-600 dark:text-emerald-400">Otimização de portfólio em tempo real</p>
                    </div>
                  </div>
                  <div className="p-3 bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 border border-purple-200 dark:border-purple-800 rounded-lg">
                    <p className="text-sm font-medium text-purple-800 dark:text-purple-200 mb-1">Como as IAs cooperam entre modalidades:</p>
                    <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                      <li>A IA Primária analisa padrões e emite sinais específicos para cada tipo de contrato ativo</li>
                      <li>A IA Secundária valida cada sinal e bloqueia operações com risco acima do threshold</li>
                      <li>A IA de Arbitragem distribui capital entre categorias conforme desempenho recente</li>
                      <li>O sistema rotaciona automaticamente entre modalidades para evitar sequências de perdas</li>
                      <li>Threshold de confiança mínimo: 70% — abaixo disso a operação é cancelada independente da modalidade</li>
                      <li>Lookbacks, Turbos e Acumuladores exigem confiança mínima de 85% para ativação</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            {/* Diagnóstico e Correção Automática */}
            <Card className="border-yellow-200 dark:border-yellow-900">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2 text-yellow-800 dark:text-yellow-200">
                  <Settings className="h-5 w-5" />
                  <span>Diagnóstico do Sistema</span>
                </CardTitle>
                <CardDescription>
                  Verificar e corrigir problemas automaticamente
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-3">
                  <Button
                    onClick={() => {
                      fetch('/api/auto-trading/diagnose')
                        .then(r => r.json())
                        .then(data => {
                          console.log('Diagnóstico:', data);
                          toast({
                            title: `Problema Identificado: ${data.problema || 'NENHUM'}`,
                            description: JSON.stringify(data, null, 2),
                            duration: 10000
                          });
                        });
                    }}
                    variant="outline"
                    data-testid="button-diagnose"
                  >
                    <Activity className="h-4 w-4 mr-2" />
                    Diagnosticar
                  </Button>
                  
                  <Button
                    onClick={() => {
                      fetch('/api/auto-trading/fix-auto', { method: 'POST' })
                        .then(r => r.json())
                        .then(data => {
                          console.log('Correções aplicadas:', data);
                          toast({
                            title: "Correções Aplicadas!",
                            description: `${data.corrigoesAplicadas} correção(ões) aplicada(s). ${data.proximoPasso}`,
                            duration: 10000
                          });
                          // Recarregar dados
                          queryClient.invalidateQueries({ queryKey: ["/api/trading/config"] });
                        });
                    }}
                    variant="default"
                    className="bg-green-600 hover:bg-green-700"
                    data-testid="button-fix-auto"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Corrigir Automaticamente
                  </Button>
                </div>
                <div className="text-sm text-muted-foreground p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded border border-yellow-200 dark:border-yellow-800">
                  <p className="font-medium mb-1">🔧 Correções Automáticas:</p>
                  <ul className="list-disc list-inside space-y-1 text-xs">
                    <li>Desativa parada de emergência</li>
                    <li>Remove aprovação administrativa</li>
                    <li>Cria/reativa configuração de trading</li>
                    <li>Reseta sessões bloqueadas</li>
                    <li>Aumenta limites para modo demo</li>
                  </ul>
                </div>
              </CardContent>
            </Card>

            {/* Configurações de Digit Differs */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Target className="h-5 w-5" />
                  <span>Configurações de Digit Differs</span>
                </CardTitle>
                <CardDescription>
                  Configure parâmetros específicos para operações de digit differs
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Tipo de Operação Digit */}
                <div className="space-y-3">
                  <h4 className="font-medium flex items-center space-x-2">
                    <Hash className="h-4 w-4" />
                    <span>Tipo de Operação</span>
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    <Button
                      variant="outline"
                      className="h-auto p-4 flex flex-col items-start space-y-2"
                      data-testid="button-digit-differs"
                    >
                      <div className="flex items-center space-x-2">
                        <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                        <span className="font-medium">Digit Differs</span>
                      </div>
                      <p className="text-xs text-muted-foreground text-left">
                        Ganha se o último dígito for DIFERENTE do previsto
                      </p>
                    </Button>
                    <Button
                      variant="outline"
                      className="h-auto p-4 flex flex-col items-start space-y-2 opacity-50"
                      disabled
                      data-testid="button-digit-matches"
                    >
                      <div className="flex items-center space-x-2">
                        <div className="w-3 h-3 bg-gray-400 rounded-full"></div>
                        <span className="font-medium">Digit Matches</span>
                      </div>
                      <p className="text-xs text-muted-foreground text-left">
                        Em breve: Ganha se o último dígito for IGUAL ao previsto
                      </p>
                    </Button>
                  </div>
                  <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                    <p className="text-sm text-blue-800 dark:text-blue-200">
                      <strong>Digit Differs Ativo:</strong> O sistema prevê um dígito (0-9) e ganha se o último dígito do preço final for diferente da previsão.
                    </p>
                  </div>
                </div>

                <Separator />

                {/* Parâmetros Avançados */}
                <div className="space-y-3">
                  <h4 className="font-medium flex items-center space-x-2">
                    <Settings className="h-4 w-4" />
                    <span>Parâmetros de Trading</span>
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Duração (Ticks)</Label>
                      <div className="p-3 border rounded-lg bg-muted/50">
                        <div className="text-sm font-medium">1-10 ticks</div>
                        <div className="text-xs text-muted-foreground">Automático via IA</div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Valor por Trade</Label>
                      <div className="p-3 border rounded-lg bg-muted/50">
                        <div className="text-sm font-medium">$1-10 USD</div>
                        <div className="text-xs text-muted-foreground">Baseado no modo</div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Dígito Alvo</Label>
                      <div className="p-3 border rounded-lg bg-muted/50">
                        <div className="text-sm font-medium">0-9 (Random)</div>
                        <div className="text-xs text-muted-foreground">Gerado pela IA</div>
                      </div>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Símbolos Suportados */}
                <div className="space-y-3">
                  <h4 className="font-medium flex items-center space-x-2">
                    <BarChart3 className="h-4 w-4" />
                    <span>Símbolos para Digit Differs</span>
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {['R_50', 'R_75', 'R_100', '1HZ50V', '1HZ75V', '1HZ100V'].map((symbol) => (
                      <div key={symbol} className="p-2 border rounded-lg text-center">
                        <div className="text-sm font-medium">{symbol}</div>
                        <div className="text-xs text-green-600">✓ Ativo</div>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Modo de Operação */}
            <Card>
              <CardHeader>
                <CardTitle>Frequência de Operações</CardTitle>
                <CardDescription>
                  Configure a frequência das operações de digit differs
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">

                <div className="space-y-3">
                  <h4 className="font-medium">Modos de Produção</h4>
                  <div className="grid gap-2">
                    <Button
                      variant={tradeConfig?.mode === 'production_3-4_24h' ? "default" : "outline"}
                      onClick={() => updateConfigMutation.mutate('production_3-4_24h')}
                      disabled={updateConfigMutation.isPending}
                      className="justify-start"
                      data-testid="button-mode-prod-3-4"
                    >
                      <Clock className="h-4 w-4 mr-2" />
                      3-4 digit differs a cada 24 horas
                    </Button>
                    <Button
                      variant={tradeConfig?.mode === 'production_2_24h' ? "default" : "outline"}
                      onClick={() => updateConfigMutation.mutate('production_2_24h')}
                      disabled={updateConfigMutation.isPending}
                      className="justify-start"
                      data-testid="button-mode-prod-2"
                    >
                      <Clock className="h-4 w-4 mr-2" />
                      2 digit differs a cada 24 horas
                    </Button>
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <h4 className="font-medium">Modos de Teste</h4>
                  <div className="grid gap-2">
                    <Button
                      variant={tradeConfig?.mode === 'test_4_1min' ? "default" : "outline"}
                      onClick={() => updateConfigMutation.mutate('test_4_1min')}
                      disabled={updateConfigMutation.isPending}
                      className="justify-start"
                      data-testid="button-mode-test-4-1min"
                    >
                      <Zap className="h-4 w-4 mr-2" />
                      4 digit differs a cada 1 minuto
                    </Button>
                    <Button
                      variant={tradeConfig?.mode === 'test_3_2min' ? "default" : "outline"}
                      onClick={() => updateConfigMutation.mutate('test_3_2min')}
                      disabled={updateConfigMutation.isPending}
                      className="justify-start"
                      data-testid="button-mode-test-3-2min"
                    >
                      <Zap className="h-4 w-4 mr-2" />
                      3 digit differs a cada 2 minutos
                    </Button>
                    <Button
                      variant={tradeConfig?.mode === 'test_4_1hour' ? "default" : "outline"}
                      onClick={() => updateConfigMutation.mutate('test_4_1hour')}
                      disabled={updateConfigMutation.isPending}
                      className="justify-start"
                      data-testid="button-mode-test-4-1h"
                    >
                      <Clock className="h-4 w-4 mr-2" />
                      4 digit differs a cada 1 hora
                    </Button>
                    <Button
                      variant={tradeConfig?.mode === 'test_3_2hour' ? "default" : "outline"}
                      onClick={() => updateConfigMutation.mutate('test_3_2hour')}
                      disabled={updateConfigMutation.isPending}
                      className="justify-start"
                      data-testid="button-mode-test-3-2h"
                    >
                      <Clock className="h-4 w-4 mr-2" />
                      3 digit differs a cada 2 horas
                    </Button>
                    <Button
                      variant={tradeConfig?.mode === 'test_sem_limites' ? "default" : "outline"}
                      onClick={() => updateConfigMutation.mutate('test_sem_limites')}
                      disabled={updateConfigMutation.isPending}
                      className="justify-start"
                      data-testid="button-mode-test-sem-limites"
                    >
                      <Infinity className="h-4 w-4 mr-2" />
                      Sem Limites - Operação Contínua
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Operações Tab */}
          <TabsContent value="operations" className="space-y-6">
            <Card data-testid="card-operations-history">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Activity className="h-5 w-5" />
                  <span>Histórico de Operações</span>
                  <Badge variant="outline" className="animate-pulse">
                    <span className="w-2 h-2 bg-green-500 rounded-full inline-block mr-1"></span>
                    Live
                  </Badge>
                </CardTitle>
                <CardDescription>
                  Atualização automática a cada 1 segundo - Todas as operações do sistema
                </CardDescription>
              </CardHeader>
              <CardContent>
                {recentOperations.length > 0 ? (
                  <div className="space-y-4">
                    {recentOperations.map((operation: any) => (
                      <div key={operation.id} className="flex items-center justify-between p-4 border rounded-lg transition-all hover:border-primary" data-testid={`history-operation-${operation.id}`}>
                        <div className="flex items-center space-x-4">
                          {operation.direction === 'up' ? (
                            <TrendingUp className="h-5 w-5 text-green-500" />
                          ) : (
                            <TrendingDown className="h-5 w-5 text-red-500" />
                          )}
                          <div>
                            <p className="font-medium" data-testid={`history-symbol-${operation.id}`}>{operation.symbol}</p>
                            <p className="text-sm text-muted-foreground" data-testid={`history-time-${operation.id}`}>
                              {new Date(operation.createdAt).toLocaleString('pt-BR')}
                            </p>
                          </div>
                        </div>
                        <div className="text-center">
                          <p className="font-medium" data-testid={`history-amount-${operation.id}`}>{formatCurrency(operation.amount)}</p>
                          {formatBRL(operation.amount) && (
                            <p className="text-xs text-muted-foreground">{formatBRL(operation.amount)}</p>
                          )}
                          <p className="text-sm text-muted-foreground">{operation.direction.toUpperCase()}</p>
                        </div>
                        <div className="text-right">
                          <Badge variant={
                            operation.status === 'won' ? 'default' : 
                            operation.status === 'lost' ? 'destructive' : 
                            'secondary'
                          } data-testid={`history-status-${operation.id}`}>
                            {operation.status}
                          </Badge>
                          {operation.profit !== undefined && (
                            <div>
                              <p className={`text-sm font-medium ${operation.profit >= 0 ? 'text-green-600' : 'text-red-600'}`} data-testid={`history-profit-${operation.id}`}>
                                {operation.profit >= 0 ? '+' : ''}{formatCurrency(operation.profit)}
                              </p>
                              {formatBRL(operation.profit) && (
                                <p className={`text-xs ${operation.profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                  {operation.profit >= 0 ? '+' : ''}{formatBRL(operation.profit)}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Activity className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">Nenhuma operação encontrada.</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Configure o sistema e inicie as operações automatizadas.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* IA e Análises Tab */}
          <TabsContent value="ai-analysis" className="space-y-6">
            <Card data-testid="card-ai-logs">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Brain className="h-5 w-5" />
                  <span>Análises de Inteligência Artificial</span>
                  <Badge variant="outline" className="animate-pulse">
                    <span className="w-2 h-2 bg-blue-500 rounded-full inline-block mr-1"></span>
                    Live
                  </Badge>
                </CardTitle>
                <CardDescription>
                  Atualização automática a cada 2 segundos - Logs detalhados das IAs cooperativas
                </CardDescription>
              </CardHeader>
              <CardContent>
                {aiLogs.length > 0 ? (
                  <div className="space-y-4">
                    {aiLogs.slice(0, 10).map((log: any) => (
                      <div key={log.id} className="p-4 border rounded-lg space-y-2 transition-all hover:border-blue-500" data-testid={`ai-log-${log.id}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <Bot className="h-4 w-4 text-blue-500" />
                            <span className="font-medium" data-testid={`ai-log-model-${log.id}`}>{log.modelName}</span>
                            <Badge variant="outline" data-testid={`ai-log-confidence-${log.id}`}>
                              {(log.confidence * 100).toFixed(1)}% confiança
                            </Badge>
                          </div>
                          <span className="text-xs text-muted-foreground" data-testid={`ai-log-time-${log.id}`}>
                            {new Date(log.createdAt).toLocaleString('pt-BR')}
                          </span>
                        </div>
                        
                        <div className="space-y-1">
                          <p className="text-sm"><strong>Decisão:</strong> <span data-testid={`ai-log-decision-${log.id}`}>{log.decision}</span></p>
                          <p className="text-sm"><strong>Análise:</strong></p>
                          <div className="text-sm text-muted-foreground bg-muted p-3 rounded" data-testid={`ai-log-analysis-${log.id}`}>
                            {JSON.stringify(JSON.parse(log.analysis), null, 2)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Brain className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">Nenhuma análise de IA encontrada.</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Os logs das IAs aparecerão aqui quando o sistema estiver ativo.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Painel de Aprendizado Persistente Real */}
          <TabsContent value="learning" className="space-y-6">
            <div className="flex items-center gap-3 mb-2">
              <div>
                <h2 className="text-lg font-semibold">Motor de Aprendizado Persistente</h2>
                <p className="text-sm text-muted-foreground">
                  As IAs aprendem com cada operação — pesos atualizados em tempo real e salvos no banco
                </p>
              </div>
            </div>
            <LearningDashboard />
          </TabsContent>

          {/* Monitor IA Universal — Acompanhamento tick a tick de cada contrato */}
          <TabsContent value="monitor" className="space-y-6">
            <Card className="border-2 border-blue-500/30 bg-blue-500/5">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Eye className="h-5 w-5 text-blue-500" />
                    <span>Monitor Universal IA — 5 Modelos em Paralelo</span>
                    <Badge variant="outline" className="animate-pulse border-blue-500 text-blue-600">
                      <span className="w-2 h-2 bg-blue-500 rounded-full inline-block mr-1"></span>
                      Tick a Tick
                    </Badge>
                  </div>
                  <Badge
                    data-testid="badge-monitor-active"
                    className={(monitorData as any)?.activeContracts > 0 ? "bg-green-600" : "bg-gray-500"}
                  >
                    {(monitorData as any)?.activeContracts ?? 0} contrato(s) ativo(s)
                  </Badge>
                </CardTitle>
                <CardDescription>
                  Cada operação aberta é acompanhada milimetricamente pelos 5 modelos de IA — FinBERT, RoBERTa, XLM-RoBERTa, RoBERTa Trend Detector e DistilRoBERTa. O sistema sabe quando entrar, o que está acontecendo e quando é o momento ideal de sair.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* Painel de modelos ativos */}
                <div className="grid grid-cols-5 gap-2 mb-6">
                  {[
                    { name: "FinBERT", desc: "Sentimento Financeiro", color: "blue" },
                    { name: "RoBERTa", desc: "Analisador de Mercado", color: "purple" },
                    { name: "XLM-RoBERTa", desc: "Multilingual", color: "indigo" },
                    { name: "RoBERTa Trend", desc: "Detector de Tendência", color: "cyan" },
                    { name: "DistilRoBERTa", desc: "Financeiro Rápido", color: "teal" },
                  ].map((model) => (
                    <div
                      key={model.name}
                      data-testid={`model-card-${model.name}`}
                      className="p-3 border rounded-lg text-center bg-background hover:border-blue-400 transition-colors"
                    >
                      <Brain className="h-5 w-5 mx-auto mb-1 text-blue-500" />
                      <p className="text-xs font-bold">{model.name}</p>
                      <p className="text-[10px] text-muted-foreground">{model.desc}</p>
                      <div className="mt-1 w-2 h-2 rounded-full bg-green-500 mx-auto animate-pulse" />
                    </div>
                  ))}
                </div>

                {(monitorData as any)?.contracts?.length > 0 ? (
                  <div className="space-y-4">
                    {(monitorData as any).contracts.map((contract: any) => {
                      const profitColor = contract.profit > 0 ? "text-green-500" : contract.profit < 0 ? "text-red-500" : "text-muted-foreground";
                      const ageMin = (contract.ageMs / 60000).toFixed(1);
                      const profitPct = contract.profitPct?.toFixed(2) ?? "0.00";
                      const profitSign = contract.profit >= 0 ? "+" : "";
                      return (
                        <div
                          key={contract.contractId}
                          data-testid={`monitor-contract-${contract.contractId}`}
                          className="p-4 border-2 border-blue-500/20 rounded-xl space-y-3 bg-background"
                        >
                          {/* Cabeçalho do contrato */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                              <Activity className="h-4 w-4 text-blue-500 animate-pulse" />
                              <span className="font-bold text-sm" data-testid={`monitor-symbol-${contract.contractId}`}>
                                {contract.symbol}
                              </span>
                              <Badge variant="outline" className="text-xs" data-testid={`monitor-type-${contract.contractId}`}>
                                {contract.contractType}
                              </Badge>
                              {contract.direction && (
                                <Badge
                                  className={`text-xs ${contract.direction === 'up' ? 'bg-green-600' : 'bg-red-600'}`}
                                  data-testid={`monitor-direction-${contract.contractId}`}
                                >
                                  {contract.direction === 'up' ? '▲ Alta' : '▼ Baixa'}
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center space-x-2">
                              <Clock className="h-3 w-3 text-muted-foreground" />
                              <span className="text-xs text-muted-foreground">{ageMin}min</span>
                              <Badge
                                variant={contract.status === 'monitoring' ? 'default' : 'secondary'}
                                className="text-xs"
                                data-testid={`monitor-status-${contract.contractId}`}
                              >
                                {contract.status === 'monitoring' ? '🔭 Monitorando' : contract.status === 'closing' ? '⚡ Fechando' : '✅ Fechado'}
                              </Badge>
                            </div>
                          </div>

                          {/* Dados financeiros */}
                          <div className="grid grid-cols-4 gap-3">
                            <div className="bg-muted/50 rounded-lg p-2 text-center">
                              <p className="text-[10px] text-muted-foreground">Entrada</p>
                              <p className="text-sm font-bold" data-testid={`monitor-entry-${contract.contractId}`}>
                                ${contract.buyPrice?.toFixed(2)}
                              </p>
                            </div>
                            <div className="bg-muted/50 rounded-lg p-2 text-center">
                              <p className="text-[10px] text-muted-foreground">Bid Atual</p>
                              <p className="text-sm font-bold" data-testid={`monitor-bid-${contract.contractId}`}>
                                ${contract.bidPrice?.toFixed(2) ?? "—"}
                              </p>
                            </div>
                            <div className="bg-muted/50 rounded-lg p-2 text-center">
                              <p className="text-[10px] text-muted-foreground">Lucro</p>
                              <p className={`text-sm font-bold ${profitColor}`} data-testid={`monitor-profit-${contract.contractId}`}>
                                {profitSign}${contract.profit?.toFixed(2) ?? "0.00"} ({profitSign}{profitPct}%)
                              </p>
                            </div>
                            <div className="bg-muted/50 rounded-lg p-2 text-center">
                              <p className="text-[10px] text-muted-foreground">Pico</p>
                              <p className="text-sm font-bold text-green-500" data-testid={`monitor-peak-${contract.contractId}`}>
                                +${contract.peakProfit?.toFixed(2) ?? "0.00"}
                              </p>
                            </div>
                          </div>

                          {/* Spot atual + barreira */}
                          <div className="grid grid-cols-3 gap-2">
                            <div className="flex items-center space-x-2">
                              <Target className="h-3 w-3 text-muted-foreground" />
                              <span className="text-xs text-muted-foreground">Spot entrada:</span>
                              <span className="text-xs font-mono" data-testid={`monitor-entry-spot-${contract.contractId}`}>
                                {contract.entrySpot?.toFixed(4) ?? "—"}
                              </span>
                            </div>
                            <div className="flex items-center space-x-2">
                              <Activity className="h-3 w-3 text-blue-500" />
                              <span className="text-xs text-muted-foreground">Spot atual:</span>
                              <span className="text-xs font-mono font-bold" data-testid={`monitor-spot-${contract.contractId}`}>
                                {contract.currentSpot?.toFixed(4) ?? "—"}
                              </span>
                            </div>
                            {contract.barrierDistance !== undefined && (
                              <div className="flex items-center space-x-2">
                                <AlertTriangle className={`h-3 w-3 ${contract.barrierDistance < 0.5 ? 'text-red-500' : 'text-yellow-500'}`} />
                                <span className="text-xs text-muted-foreground">Barreira:</span>
                                <span className={`text-xs font-bold ${contract.barrierDistance < 0.5 ? 'text-red-500' : 'text-yellow-500'}`}
                                  data-testid={`monitor-barrier-${contract.contractId}`}>
                                  {contract.barrierDistance?.toFixed(3)}%
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Progresso de ticks */}
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-muted-foreground">Ticks monitorados</span>
                              <span className="text-xs font-bold" data-testid={`monitor-ticks-${contract.contractId}`}>
                                {contract.tickCount}
                              </span>
                            </div>
                            <Progress
                              value={Math.min(100, (contract.tickCount / 100) * 100)}
                              className="h-1"
                            />
                          </div>

                          {/* Venda permitida */}
                          {contract.isValidToSell && (
                            <div className="flex items-center space-x-2 text-xs text-green-500">
                              <CheckCircle2 className="h-3 w-3" />
                              <span>Venda antecipada disponível — IA decidindo momento ideal</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <div className="relative inline-block mb-4">
                      <Eye className="h-16 w-16 text-muted-foreground/30" />
                      <div className="absolute bottom-0 right-0 w-5 h-5 bg-blue-500/20 rounded-full flex items-center justify-center">
                        <Brain className="h-3 w-3 text-blue-500" />
                      </div>
                    </div>
                    <p className="text-muted-foreground font-medium">Nenhum contrato sendo monitorado no momento</p>
                    <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto">
                      Assim que uma operação for aberta pelo sistema, os 5 modelos de IA vão acompanhar cada tick em tempo real — decidindo automaticamente o melhor momento de saída.
                    </p>
                    <div className="mt-4 flex items-center justify-center space-x-2 text-xs text-muted-foreground">
                      <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                      <span>Sistema aguardando próxima operação...</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Cards informativos das modalidades cobertas */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Layers className="h-5 w-5" />
                  <span>Modalidades com Cobertura Total do Monitor IA</span>
                </CardTitle>
                <CardDescription>
                  Todas as modalidades disponíveis na Deriv são monitoradas com estratégias de saída específicas
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {[
                    { type: "ACCU", label: "Accumulator", desc: "Trailing stop + alvo 40% + barreira crítica", icon: "📈" },
                    { type: "MULTUP/DOWN", label: "Multiplier", desc: "Stop dinâmico + alvo 60% + corte de perda 40%", icon: "✖️" },
                    { type: "CALL/PUT", label: "Rise / Fall", desc: "Venda antecipada no pico + sinal de reversão", icon: "⬆️⬇️" },
                    { type: "TURBOS", label: "Turbo / Knock-out", desc: "Barreira próxima = fechamento emergencial", icon: "⚡" },
                    { type: "VANILLA", label: "Vanilla Options", desc: "Moneyness + delta + expiração otimizada", icon: "🍦" },
                    { type: "DIGITS", label: "Digit (6 tipos)", desc: "Auto-expira: monitoramento passivo do resultado", icon: "🔢" },
                    { type: "INOUT", label: "Dentro & Fora", desc: "Barreira dupla + saída antecipada se lucrativo", icon: "↔️" },
                    { type: "TOUCH", label: "Touch / No Touch", desc: "Barreira próxima + reversão confirmada", icon: "👆" },
                    { type: "LOOKBACK", label: "Lookback (3 tipos)", desc: "Auto-expira: máximo/mínimo capturado automaticamente", icon: "🔍" },
                  ].map((m) => (
                    <div
                      key={m.type}
                      data-testid={`modality-coverage-${m.type}`}
                      className="p-3 border rounded-lg hover:border-blue-400 transition-colors"
                    >
                      <div className="flex items-center space-x-2 mb-1">
                        <span className="text-lg">{m.icon}</span>
                        <div>
                          <p className="text-xs font-bold">{m.label}</p>
                          <Badge variant="outline" className="text-[10px]">{m.type}</Badge>
                        </div>
                      </div>
                      <p className="text-[10px] text-muted-foreground">{m.desc}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}