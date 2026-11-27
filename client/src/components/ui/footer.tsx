import { Shield, TrendingUp, Users } from "lucide-react";

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-black/80 backdrop-blur-xl border-t border-cyan-400/15 mt-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          
          {/* Logo e Descrição */}
          <div className="md:col-span-1">
            <div className="flex items-center space-x-3 mb-4">
              <img 
                src="/aura-system-icon-192.png" 
                alt="Aura System" 
                className="w-14 h-14 rounded-xl relative z-0"
              />
              <div className="relative z-10">
                <h3 className="text-lg font-bold text-foreground">Aura System</h3>
                <p className="text-xs text-cyan-300">Renda Variável</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              Plataforma de acompanhamento de investimentos e ferramentas de renda variável. Consulte os dados e riscos de cada modalidade antes de operar.
            </p>
            <div className="flex space-x-2">
              <div className="flex items-center text-xs text-green-400">
                <Shield className="w-3 h-3 mr-1" />
                <span>Segurança da conta</span>
              </div>
              <div className="flex items-center text-xs text-blue-400">
                <TrendingUp className="w-3 h-3 mr-1" />
                <span>Renda variável</span>
              </div>
            </div>
          </div>

          {/* Empresa */}
          <div className="md:col-span-1">
            <h4 className="text-sm font-semibold text-foreground mb-4">Empresa</h4>
            <nav className="space-y-2">
              <a 
                href="/quem-somos" 
                className="block text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                Quem Somos
              </a>
              <a 
                href="/como-funciona" 
                className="block text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                Como Funciona
              </a>
              <a 
                href="/seguranca" 
                className="block text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                Segurança
              </a>
              <a 
                href="/transparencia" 
                className="block text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                Transparência
              </a>
              <a 
                href="/resultados" 
                className="block text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                Resultados
              </a>
            </nav>
          </div>

          {/* Suporte */}
          <div className="md:col-span-1">
            <h4 className="text-sm font-semibold text-foreground mb-4">Suporte</h4>
            <div className="rounded-lg border border-border/50 bg-card/40 p-4 space-y-2">
              <p className="text-sm text-foreground font-medium">Canal oficial em configuração</p>
              <p className="text-xs text-muted-foreground">
                Os dados de contato serão publicados aqui após a confirmação dos canais oficiais de atendimento.
              </p>
              <p className="text-xs text-muted-foreground">
                Não envie senhas, tokens ou documentos pessoais por mensagens.
              </p>
            </div>
          </div>

          {/* Legal */}
          <div className="md:col-span-1">
            <h4 className="text-sm font-semibold text-foreground mb-4">Legal</h4>
            <nav className="space-y-2 mb-4">
              <a 
                href="/termos-uso" 
                className="block text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                Termos de Uso
              </a>
              <a 
                href="/politica-privacidade" 
                className="block text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                Política de Privacidade
              </a>
              <a 
                href="/politica-cookies" 
                className="block text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                Política de Cookies
              </a>
              <a 
                href="/lgpd" 
                className="block text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                LGPD
              </a>
            </nav>
            
            <div className="bg-card/50 rounded-lg p-3">
              <div className="flex items-center space-x-2 mb-2">
                <Users className="w-4 h-4 text-green-400" />
                <span className="text-xs font-semibold text-foreground">Compromisso</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Disponibilizamos informações sobre funcionalidades, movimentações e riscos para apoiar o acompanhamento da sua conta.
              </p>
            </div>
          </div>
        </div>

        {/* Rodapé Inferior */}
        <div className="mt-12 pt-8 border-t border-border/30">
          <div className="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
            <div className="flex items-center space-x-4">
              <p className="text-sm text-muted-foreground">
                © {currentYear} Aura System. Todos os direitos reservados.
              </p>
            </div>
            
            <div className="flex items-center space-x-6">
              <div className="flex items-center space-x-2 text-xs">
                <Shield className="w-3 h-3 text-green-400" />
                <span className="text-muted-foreground">Conexão HTTPS</span>
              </div>
              <div className="flex items-center space-x-2 text-xs">
                <TrendingUp className="w-3 h-3 text-blue-400" />
                <span className="text-muted-foreground">Indicadores da conta</span>
              </div>
            </div>
          </div>
          
          <div className="mt-4 text-center">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-medium text-foreground">Aviso Legal:</span> Os investimentos em renda variável e sintéticos podem apresentar riscos. 
              Rentabilidade passada não garante resultados futuros. Consulte os termos dos provedores antes de operar. 
              A Invista PRO é uma plataforma de software. A negociação de ativos e contratos envolve risco; simulações não representam resultados reais.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}