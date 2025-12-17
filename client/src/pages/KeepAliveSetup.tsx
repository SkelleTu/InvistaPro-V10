import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Copy, ExternalLink, CheckCircle, AlertCircle, Clock, Zap } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface PingService {
  name: string;
  url: string;
  description: string;
  features: string[];
  setupUrl: string;
  recommended?: boolean;
}

export default function KeepAliveSetup() {
  const { toast } = useToast();
  const [currentUrl, setCurrentUrl] = useState('');
  const [uptime, setUptime] = useState<number>(0);
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    // Detectar URL do Replit
    const url = window.location.origin;
    setCurrentUrl(url);

    // Verificar status do sistema
    const checkStatus = async () => {
      try {
        const response = await fetch('/api/status');
        const data = await response.json();
        setUptime(data.uptime || 0);
        setIsOnline(true);
      } catch (error) {
        setIsOnline(false);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  const pingEndpoints = [
    { path: '/api/ping', description: 'Ultra-leve (texto simples)' },
    { path: '/api/keepalive', description: 'Com informações de uptime' },
    { path: '/api/status', description: 'Status do sistema' },
    { path: '/api/alive', description: 'Check de disponibilidade' },
    { path: '/api/heartbeat', description: 'Heartbeat do servidor' },
    { path: '/api/health', description: 'Health check completo' },
  ];

  const pingServices: PingService[] = [
    {
      name: 'UptimeRobot',
      url: 'https://uptimerobot.com',
      description: '50 monitores grátis, intervalo de 5 minutos',
      features: ['100% Gratuito', 'Email alerts', 'Dashboard completo', 'SSL monitoring'],
      setupUrl: 'https://uptimerobot.com/signUp',
      recommended: true
    },
    {
      name: 'Freshping',
      url: 'https://freshping.io',
      description: 'Monitores ilimitados, múltiplas regiões',
      features: ['Ilimitado grátis', 'Global checks', 'Status page', 'SMS alerts'],
      setupUrl: 'https://freshping.io/signup',
      recommended: true
    },
    {
      name: 'Cron-Job.org',
      url: 'https://cron-job.org',
      description: 'Cron jobs grátis, execução em múltiplos intervalos',
      features: ['Grátis', 'Intervalos customizados', 'Logs detalhados', 'Notificações'],
      setupUrl: 'https://cron-job.org/en/signup/',
    },
    {
      name: 'StatusCake',
      url: 'https://statuscake.com',
      description: '10 monitores grátis, intervalo de 5 minutos',
      features: ['10 monitores', 'Performance tests', 'SSL monitoring', 'Alertas'],
      setupUrl: 'https://www.statuscake.com/pricing/',
    },
    {
      name: 'Hetrix Tools',
      url: 'https://hetrixtools.com',
      description: '15 monitores grátis com vários recursos',
      features: ['15 monitores', 'Blacklist check', 'Uptime reports', 'API access'],
      setupUrl: 'https://hetrixtools.com/pricing/',
    }
  ];

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: 'Copiado!',
      description: `${label} copiado para a área de transferência`,
    });
  };

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl" data-testid="keepalive-setup-page">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2" data-testid="text-page-title">
          🔥 Sistema Anti-Hibernação 24/7
        </h1>
        <p className="text-muted-foreground text-lg">
          Configure serviços externos para manter seu sistema sempre ativo
        </p>
      </div>

      {/* Status Card */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {isOnline ? (
              <CheckCircle className="h-5 w-5 text-green-500" />
            ) : (
              <AlertCircle className="h-5 w-5 text-red-500" />
            )}
            Status do Sistema
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/10 rounded-lg">
                <Zap className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Status</p>
                <p className="font-semibold" data-testid="text-system-status">
                  {isOnline ? 'Online' : 'Offline'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <Clock className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Uptime</p>
                <p className="font-semibold" data-testid="text-uptime">
                  {formatUptime(uptime)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-500/10 rounded-lg">
                <CheckCircle className="h-5 w-5 text-purple-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Keep-Alive Interno</p>
                <p className="font-semibold text-green-600">Ativo</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Alert Card */}
      <Card className="mb-6 border-orange-500/50 bg-orange-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-orange-600">
            <AlertCircle className="h-5 w-5" />
            ⚠️ Importante: Por que configurar ping externo?
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm">
            O Replit <strong>detecta pings internos como "auto-tráfego"</strong> e NÃO os considera para manter o servidor ativo 24/7.
          </p>
          <p className="text-sm font-semibold text-orange-600">
            ❌ Sem ping externo: Servidor hiberna quando você fecha o navegador
          </p>
          <p className="text-sm font-semibold text-green-600">
            ✅ Com ping externo: Servidor SEMPRE ativo (24/7/365)
          </p>
        </CardContent>
      </Card>

      {/* URLs Section */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>📍 URLs para Configuração</CardTitle>
          <CardDescription>
            Use qualquer uma destas URLs nos serviços de monitoramento
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {pingEndpoints.map((endpoint) => (
            <div key={endpoint.path} className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors">
              <div className="flex-1">
                <code className="text-sm font-mono bg-muted px-2 py-1 rounded" data-testid={`text-endpoint-${endpoint.path.replace(/\//g, '-')}`}>
                  {currentUrl}{endpoint.path}
                </code>
                <p className="text-xs text-muted-foreground mt-1">{endpoint.description}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(`${currentUrl}${endpoint.path}`, endpoint.path)}
                data-testid={`button-copy-${endpoint.path.replace(/\//g, '-')}`}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Services Section */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-4">🚀 Serviços de Monitoramento Gratuitos</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {pingServices.map((service) => (
            <Card key={service.name} className={service.recommended ? 'border-green-500/50' : ''}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {service.name}
                      {service.recommended && (
                        <Badge variant="default" className="bg-green-500">Recomendado</Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {service.description}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1">
                  {service.features.map((feature) => (
                    <div key={feature} className="flex items-center gap-2 text-sm">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      <span>{feature}</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="default"
                    className="flex-1"
                    onClick={() => window.open(service.setupUrl, '_blank')}
                    data-testid={`button-setup-${service.name.toLowerCase().replace(/\s/g, '-')}`}
                  >
                    Configurar
                    <ExternalLink className="ml-2 h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => window.open(service.url, '_blank')}
                  >
                    Visitar Site
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Instructions */}
      <Card>
        <CardHeader>
          <CardTitle>📝 Como Configurar (5 minutos)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                1
              </div>
              <div>
                <h3 className="font-semibold mb-1">Escolha um serviço</h3>
                <p className="text-sm text-muted-foreground">
                  Recomendamos <strong>UptimeRobot</strong> ou <strong>Freshping</strong> - ambos 100% gratuitos
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                2
              </div>
              <div>
                <h3 className="font-semibold mb-1">Crie uma conta</h3>
                <p className="text-sm text-muted-foreground">
                  Clique em "Configurar" no serviço escolhido e crie uma conta gratuita
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                3
              </div>
              <div>
                <h3 className="font-semibold mb-1">Adicione um monitor</h3>
                <p className="text-sm text-muted-foreground">
                  Configure um novo monitor HTTP/HTTPS com uma das URLs acima (recomendamos <code>/api/ping</code>)
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                4
              </div>
              <div>
                <h3 className="font-semibold mb-1">Configure o intervalo</h3>
                <p className="text-sm text-muted-foreground">
                  Use intervalo de <strong>5 minutos</strong> (disponível em planos gratuitos)
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                5
              </div>
              <div>
                <h3 className="font-semibold mb-1">Pronto! 🎉</h3>
                <p className="text-sm text-muted-foreground">
                  Seu sistema agora rodará 24/7 sem hibernar! Para redundância máxima, configure 2-3 serviços diferentes.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
