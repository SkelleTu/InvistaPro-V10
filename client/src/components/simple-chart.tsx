import React, { useEffect, useRef, useState } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";

interface PriceData {
  time: number;
  price: number;
}

interface Asset {
  name: string;
  symbol: string;
  currentRate: number;
  color: string;
  data: PriceData[];
}

interface MarketApiResponse {
  success: boolean;
  date: string;
  realRates: {
    cdi: number;
    selic: number;
  };
  assets: Asset[];
  source: string;
  message: string;
  fallback?: boolean;
}

export default function SimpleMarketChart() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [currentAssetIndex, setCurrentAssetIndex] = useState(0);

  // Buscar dados reais de CDI/CDB da API
  const { data: marketData, isLoading, error, refetch } = useQuery<MarketApiResponse>({
    queryKey: ['/api/market/cdi-data'],
    refetchInterval: 60000, // Atualiza a cada 1 minuto
    refetchOnWindowFocus: false,
    staleTime: 30000, // Considera dados frescos por 30 segundos
  });

  // Alterna entre ativos a cada 20 segundos
  useEffect(() => {
    if (!marketData?.assets?.length) return;
    
    const assetInterval = setInterval(() => {
      setCurrentAssetIndex(prev => (prev + 1) % marketData.assets.length);
    }, 20000);

    return () => clearInterval(assetInterval);
  }, [marketData]);

  // Get current asset and data from real API
  const currentAsset = marketData?.assets?.[currentAssetIndex];
  const priceHistory = currentAsset?.data || [];
  const currentPrice = currentAsset?.currentRate || 0;

  // Desenha o gráfico de linha
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !currentAsset || priceHistory.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Define dimensões do canvas baseado no container
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    
    const width = rect.width;
    const height = rect.height;

    // Limpa o canvas
    ctx.fillStyle = '#0f0f23';
    ctx.fillRect(0, 0, width, height);

    const prices = priceHistory.map(p => p.price);
    const rawMinPrice = Math.min(...prices);
    const rawMaxPrice = Math.max(...prices);
    const rawRange = rawMaxPrice - rawMinPrice || 0.001;
    
    // Adicionar margem de 50% acima e abaixo para "zoom out" e melhor visualização
    const margin = rawRange * 0.75; // 75% de margem para ver melhor as tendências
    const minPrice = rawMinPrice - margin;
    const maxPrice = rawMaxPrice + margin;
    const priceRange = maxPrice - minPrice;

    const padding = 30;

    // Desenha grid horizontal
    ctx.strokeStyle = '#363c4e';
    ctx.lineWidth = 0.5;
    for (let i = 1; i <= 4; i++) {
      const y = (height / 5) * i;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
    }

    // Função para formatar preço baseado no ativo
    const formatPrice = (price: number) => {
      if (currentAsset.symbol.includes('CDI') || currentAsset.symbol.includes('CDB') || currentAsset.symbol.includes('SELIC')) {
        return price.toFixed(2) + '%';
      } else {
        return price.toFixed(2);
      }
    };

    // Desenha labels de preço
    ctx.fillStyle = '#888';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const price = maxPrice - (priceRange / 4) * i;
      const y = (height / 5) * (i + 0.5);
      ctx.fillText(formatPrice(price), width - 5, y);
    }

    // Desenha a linha do preço
    if (priceHistory.length > 1) {
      ctx.strokeStyle = currentAsset.color;
      ctx.lineWidth = 2;
      ctx.beginPath();

      priceHistory.forEach((point, index) => {
        const x = padding + (index / (priceHistory.length - 1)) * (width - 2 * padding);
        const y = height - padding - ((point.price - minPrice) / priceRange) * (height - 2 * padding);

        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });

      ctx.stroke();

      // Adiciona glow effect na linha
      ctx.shadowColor = currentAsset.color;
      ctx.shadowBlur = 3;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Desenha ponto no último preço
      const lastPoint = priceHistory[priceHistory.length - 1];
      const lastX = padding + ((priceHistory.length - 1) / (priceHistory.length - 1)) * (width - 2 * padding);
      const lastY = height - padding - ((lastPoint.price - minPrice) / priceRange) * (height - 2 * padding);
      
      ctx.fillStyle = currentAsset.color;
      ctx.beginPath();
      ctx.arc(lastX, lastY, 4, 0, 2 * Math.PI);
      ctx.fill();
    }

  }, [priceHistory, currentAsset]);

  // Calculate price change
  const priceChange = priceHistory.length >= 2 ? currentPrice - priceHistory[priceHistory.length - 2].price : 0;
  const priceChangePercent = priceHistory.length >= 2 ? (priceChange / priceHistory[priceHistory.length - 2].price) * 100 : 0;
  const isPositive = priceChange >= 0;

  // Função para formatar preço
  const formatPrice = (price: number) => {
    if (!currentAsset) return '0.00%';
    if (currentAsset.symbol.includes('CDI') || currentAsset.symbol.includes('CDB') || currentAsset.symbol.includes('SELIC')) {
      return price.toFixed(2) + '%';
    } else {
      return price.toFixed(2);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <Card className="bg-slate-800/50 border border-white/10 backdrop-blur-sm mb-8">
        <CardContent className="p-6">
          <div className="flex items-center justify-center h-64">
            <div className="text-white/70">🔄 Carregando dados reais de CDI/CDB...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error || !marketData) {
    return (
      <Card className="bg-slate-800/50 border border-white/10 backdrop-blur-sm mb-8">
        <CardContent className="p-6">
          <div className="flex items-center justify-center h-64 flex-col space-y-4">
            <div className="text-red-400">❌ Erro ao carregar dados de mercado</div>
            <button 
              onClick={() => refetch()}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
            >
              Tentar novamente
            </button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!currentAsset) {
    return null;
  }

  return (
    <Card className="bg-slate-800/50 border border-white/10 backdrop-blur-sm mb-8">
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-white font-semibold text-sm" style={{ color: currentAsset.color }}>
              {currentAsset.name}
            </h3>
            <p className="text-slate-400 text-xs">
              {currentAsset.symbol} - Tempo Real
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <div className="text-right">
              <div className="text-white text-sm font-mono">{formatPrice(currentPrice)}</div>
              <div className={`text-xs ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                ({isPositive ? '+' : ''}{priceChangePercent.toFixed(2)}%)
              </div>
            </div>
            <div className={`px-2 py-1 rounded text-xs font-semibold bg-opacity-20`} 
                 style={{ 
                   backgroundColor: `${currentAsset.color}33`,
                   color: currentAsset.color 
                 }}>
              <div className="flex items-center space-x-1">
                <div className="w-1.5 h-1.5 rounded-full animate-pulse" 
                     style={{ backgroundColor: currentAsset.color }}></div>
                <span>LIVE</span>
              </div>
            </div>
          </div>
        </div>
        
        {/* Canvas para o gráfico */}
        <div className="relative h-64 rounded-lg overflow-hidden bg-slate-900/30 border border-white/5">
          <canvas
            ref={canvasRef}
            className="w-full h-full"
            data-testid="live-candlestick-chart"
            style={{ width: '100%', height: '100%' }}
          />
        </div>
        
        <div className="mt-3 pt-3 border-t border-white/10">
          <div className="flex items-center justify-between">
            <p className="text-slate-400 text-xs">
              ⚡ Dados reais em tempo real
            </p>
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              <span className="text-green-400 text-xs font-medium">
                {marketData?.source || 'HG Brasil Finance API'}
              </span>
            </div>
          </div>
          {marketData?.fallback && (
            <p className="text-amber-400 text-xs text-center mt-2">
              ⚠️ API temporariamente indisponível - usando dados de fallback
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}