import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Brain, TrendingUp, TrendingDown, Minus, Activity, Trophy, Target, Zap } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";

interface ModelStat {
  modelName: string;
  symbol: string;
  weight: number;
  accuracy: number;
  totalTrades: number;
  totalProfit: number;
  recentTrend: number;
  learningRate: number;
}

interface RecentRecord {
  contractId: string;
  symbol: string;
  outcome: string;
  profit: number;
  reward: number;
  dominantModel: string | null;
  confidenceAtEntry: number | null;
  createdAt: string | null;
}

interface LearningStats {
  totalTrades: number;
  modelsStats: ModelStat[];
  recentRecords: RecentRecord[];
  overallAccuracy: number;
  totalProfit: number;
  learningCycles: number;
}

const MODEL_LABELS: Record<string, string> = {
  advanced_learning: "Aprendizado Avançado",
  quantum_neural: "Neural Quântico",
  microscopic_technical: "Análise Microscópica",
  huggingface_ai: "HuggingFace AI",
  digit_frequency: "Freq. de Dígitos",
  asset_scorer: "Avaliador de Ativos",
  market_regime: "Regime de Mercado",
  momentum_indicator: "Indicador Momentum",
  volatility_filter: "Filtro Volatilidade",
  pattern_recognition: "Reconhecimento Padrões",
};

function getWeightColor(weight: number): string {
  if (weight >= 1.5) return "text-green-400";
  if (weight >= 1.2) return "text-green-300";
  if (weight >= 0.9) return "text-yellow-400";
  if (weight >= 0.6) return "text-orange-400";
  return "text-red-400";
}

function getWeightBadge(weight: number): string {
  if (weight >= 1.5) return "bg-green-500/20 text-green-400 border-green-500/30";
  if (weight >= 1.2) return "bg-green-400/20 text-green-300 border-green-400/30";
  if (weight >= 0.9) return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  if (weight >= 0.6) return "bg-orange-500/20 text-orange-400 border-orange-500/30";
  return "bg-red-500/20 text-red-400 border-red-500/30";
}

function getTrendIcon(trend: number) {
  if (trend > 0.1) return <TrendingUp className="h-3 w-3 text-green-400" />;
  if (trend < -0.1) return <TrendingDown className="h-3 w-3 text-red-400" />;
  return <Minus className="h-3 w-3 text-gray-400" />;
}

function formatModelName(name: string): string {
  return MODEL_LABELS[name] || name;
}

export default function LearningDashboard() {
  const [selectedSymbol, setSelectedSymbol] = useState<string>("all");

  const { data: stats, isLoading } = useQuery<LearningStats>({
    queryKey: ["/api/learning/stats", selectedSymbol],
    queryFn: async () => {
      const url = selectedSymbol === "all"
        ? "/api/learning/stats"
        : `/api/learning/stats?symbol=${encodeURIComponent(selectedSymbol)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Erro ao carregar stats");
      return res.json();
    },
    refetchInterval: 10000,
  });

  const symbols = stats?.modelsStats
    ? [...new Set(stats.modelsStats.map(s => s.symbol))].sort()
    : [];

  const filteredModels = stats?.modelsStats
    ? (selectedSymbol === "all"
        ? Object.values(
            stats.modelsStats.reduce((acc: Record<string, ModelStat>, m) => {
              const existing = acc[m.modelName];
              if (!existing || m.totalTrades > existing.totalTrades) {
                acc[m.modelName] = m;
              }
              return acc;
            }, {})
          )
        : stats.modelsStats.filter(m => m.symbol === selectedSymbol)
      ).sort((a, b) => b.weight - a.weight)
    : [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        <Brain className="h-6 w-6 animate-pulse mr-2" />
        Carregando dados de aprendizado...
      </div>
    );
  }

  const totalTrades = stats?.learningCycles || 0;
  const overallAccuracy = stats?.overallAccuracy || 0;
  const totalProfit = stats?.totalProfit || 0;
  const hasData = totalTrades > 0;

  return (
    <div className="space-y-6" data-testid="learning-dashboard">
      {/* Header cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-card/50 border-border/50">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="h-4 w-4 text-blue-400" />
              <span className="text-xs text-muted-foreground">Ciclos de Aprendizado</span>
            </div>
            <div className="text-2xl font-bold text-blue-400" data-testid="learning-cycles">
              {totalTrades.toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground mt-1">trades processados</div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Target className="h-4 w-4 text-green-400" />
              <span className="text-xs text-muted-foreground">Acurácia Geral</span>
            </div>
            <div className="text-2xl font-bold text-green-400" data-testid="overall-accuracy">
              {(overallAccuracy * 100).toFixed(1)}%
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {hasData ? "acumulado" : "aguardando dados"}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Trophy className="h-4 w-4 text-yellow-400" />
              <span className="text-xs text-muted-foreground">Lucro Total</span>
            </div>
            <div className={`text-2xl font-bold ${totalProfit >= 0 ? "text-green-400" : "text-red-400"}`} data-testid="total-profit">
              ${totalProfit.toFixed(2)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">durante aprendizado</div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="h-4 w-4 text-purple-400" />
              <span className="text-xs text-muted-foreground">Modelos Ativos</span>
            </div>
            <div className="text-2xl font-bold text-purple-400" data-testid="active-models">
              {filteredModels.length}
            </div>
            <div className="text-xs text-muted-foreground mt-1">sendo calibrados</div>
          </CardContent>
        </Card>
      </div>

      {/* Filter */}
      {symbols.length > 0 && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Filtrar por ativo:</span>
          <Select value={selectedSymbol} onValueChange={setSelectedSymbol}>
            <SelectTrigger className="w-48" data-testid="select-symbol">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os ativos</SelectItem>
              {symbols.map(s => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Model Weights */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Brain className="h-4 w-4 text-purple-400" />
            Pesos dos Modelos de IA
            <Badge variant="outline" className="ml-2 text-xs">
              {hasData ? "Aprendendo em tempo real" : "Aguardando primeiros trades"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!hasData ? (
            <div className="text-center py-8 text-muted-foreground">
              <Brain className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Nenhum dado de aprendizado ainda.</p>
              <p className="text-xs mt-1">Os pesos serão atualizados após os primeiros trades.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredModels.map((model, idx) => (
                <div
                  key={`${model.modelName}-${model.symbol}`}
                  className="flex items-center gap-3"
                  data-testid={`model-row-${model.modelName}`}
                >
                  <div className="w-6 text-xs text-muted-foreground text-right">
                    #{idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">
                          {formatModelName(model.modelName)}
                        </span>
                        {getTrendIcon(model.recentTrend)}
                      </div>
                      <div className="flex items-center gap-2 ml-2 shrink-0">
                        <span className="text-xs text-muted-foreground">
                          {(model.accuracy * 100).toFixed(0)}% acc
                        </span>
                        <Badge
                          variant="outline"
                          className={`text-xs px-1.5 py-0 ${getWeightBadge(model.weight)}`}
                        >
                          {model.weight.toFixed(3)}
                        </Badge>
                      </div>
                    </div>
                    <Progress
                      value={Math.min(100, (model.weight / 3.0) * 100)}
                      className="h-1.5"
                    />
                    <div className="flex justify-between mt-0.5">
                      <span className="text-xs text-muted-foreground">
                        {model.totalTrades} trades
                      </span>
                      <span className={`text-xs ${model.totalProfit >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {model.totalProfit >= 0 ? "+" : ""}${model.totalProfit.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Learning Records */}
      {stats?.recentRecords && stats.recentRecords.length > 0 && (
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4 text-blue-400" />
              Últimos Ciclos de Aprendizado
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {stats.recentRecords.slice(0, 15).map((record, idx) => (
                <div
                  key={`${record.contractId}-${idx}`}
                  className="flex items-center justify-between py-1.5 px-3 rounded bg-background/50 border border-border/30"
                  data-testid={`learning-record-${idx}`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`text-base ${
                      record.outcome === "won" ? "text-green-400" :
                      record.outcome === "lost" ? "text-red-400" : "text-yellow-400"
                    }`}>
                      {record.outcome === "won" ? "✅" : record.outcome === "lost" ? "❌" : "💰"}
                    </span>
                    <div>
                      <div className="text-xs font-medium">{record.symbol}</div>
                      <div className="text-xs text-muted-foreground">
                        {record.dominantModel ? formatModelName(record.dominantModel) : "—"}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-xs font-medium ${record.profit >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {record.profit >= 0 ? "+" : ""}${record.profit.toFixed(2)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      recomp: {record.reward.toFixed(2)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Learning explanation */}
      <Card className="bg-blue-500/5 border-blue-500/20">
        <CardContent className="pt-4">
          <div className="flex gap-3">
            <Brain className="h-5 w-5 text-blue-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-blue-300 mb-1">Como funciona o aprendizado</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Após cada operação, o sistema calcula a recompensa (+1 para ganho, -1 para perda)
                e ajusta o peso de cada modelo usando gradiente com momentum. Modelos que acertam
                mais ganham mais influência nas próximas decisões. Os pesos são persistidos no
                banco de dados e sobrevivem a reinicializações. Quanto mais operações, mais
                precisas ficam as IAs.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
