import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChartLine, Shield, TrendingUp, Banknote, Zap, BarChart3, Globe, Brain, Users, Cpu, Lock, Menu, X } from "lucide-react";
import investmentBgImage from "@assets/generated_images/Dark_investment_chart_background_ac2d4762.png";
import { useState } from "react";
import SimpleMarketChart from "@/components/simple-chart";

export default function Landing() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const currentYear = new Date().getFullYear();

  const handleLogin = () => {
    window.location.href = "/auth";
  };

  return (
    <>
      {/* Header Navigation */}
      <header className="absolute top-0 left-0 right-0 z-50 bg-black/65 backdrop-blur-xl border-b border-cyan-400/15">
        <div className="max-w-7xl mx-auto px-4 lg:px-8">
          <div className="flex justify-between items-center py-4">
            {/* Logo */}
            <div className="flex items-center space-x-3">
              <img 
                src="https://integrated-system-1c86.onrender.com/aura-system-logo.webp?v=1" 
                alt="Aura System" 
                className="w-12 h-12 rounded-lg relative z-0"
              />
              <div className="relative z-10">
                <h3 className="text-lg font-bold text-white">Aura System</h3>
                <p className="text-xs text-cyan-300 opacity-90">Renda Variável</p>
              </div>
            </div>

            {/* Desktop Navigation */}
            <nav className="hidden lg:flex items-center space-x-8">
              <a href="/quem-somos" className="text-white/80 hover:text-white transition-colors text-sm font-medium">Quem Somos</a>
              <a href="/como-funciona" className="text-white/80 hover:text-white transition-colors text-sm font-medium">Como Funciona</a>
              <a href="/tecnologia-financeira" className="text-white/80 hover:text-white transition-colors text-sm font-medium">Tecnologia</a>
              <a href="/seguranca" className="text-white/80 hover:text-white transition-colors text-sm font-medium">Segurança</a>
              <a href="/resultados" className="text-white/80 hover:text-white transition-colors text-sm font-medium">Resultados</a>
            </nav>

            {/* Login/Register Buttons */}
            <div className="hidden lg:flex items-center space-x-4">
              <Button 
                onClick={handleLogin}
                variant="outline" 
                size="sm"
                className="border-white/20 text-white hover:bg-white/10"
              >
                Login
              </Button>
              <Button 
                onClick={handleLogin}
                size="sm"
                className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700"
              >
                Cadastrar
              </Button>
            </div>

            {/* Mobile Menu Button */}
            <button
              className="lg:hidden text-white p-2"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>

          {/* Mobile Menu */}
          {mobileMenuOpen && (
            <div className="lg:hidden py-4 border-t border-white/10">
              <nav className="flex flex-col space-y-3">
                <a href="/quem-somos" className="text-white/80 hover:text-white transition-colors text-sm font-medium py-2">Quem Somos</a>
                <a href="/como-funciona" className="text-white/80 hover:text-white transition-colors text-sm font-medium py-2">Como Funciona</a>
                <a href="/tecnologia-financeira" className="text-white/80 hover:text-white transition-colors text-sm font-medium py-2">Tecnologia</a>
                <a href="/seguranca" className="text-white/80 hover:text-white transition-colors text-sm font-medium py-2">Segurança</a>
                <a href="/resultados" className="text-white/80 hover:text-white transition-colors text-sm font-medium py-2">Resultados</a>
                <div className="flex space-x-4 pt-4">
                  <Button onClick={handleLogin} variant="outline" size="sm" className="border-white/20 text-white hover:bg-white/10 flex-1">
                    Login
                  </Button>
                  <Button onClick={handleLogin} size="sm" className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 flex-1">
                    Cadastrar
                  </Button>
                </div>
              </nav>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <div 
        className="bg-gradient-to-br from-slate-900 via-slate-800 to-gray-900 flex items-center justify-center p-4 relative pt-24 pb-8"
        style={{
          backgroundImage: `url(${investmentBgImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat'
        }}
      >
        {/* Background overlay with blur effect */}
        <div className="absolute inset-0 backdrop-blur-md bg-slate-900/60 mobile-backdrop-blur mobile-backdrop-enhanced"></div>
        <div className="w-full max-w-7xl mx-auto relative z-10 px-4 lg:px-8">
          {/* Desktop Layout */}
          <div className="lg:grid lg:grid-cols-2 lg:gap-16 lg:items-center lg:min-h-[60vh]">
            {/* Left Column - Hero Content */}
            <div className="text-center lg:text-left mb-8 lg:mb-0">
              <div className="flex items-center justify-center lg:justify-start mb-6">
                <img 
                  src="https://integrated-system-1c86.onrender.com/aura-system-logo.webp?v=1" 
                  alt="Aura System" 
                  className="w-20 h-20 lg:w-24 lg:h-24 rounded-2xl shadow-lg mr-4"
                />
                <div className="text-left">
                  <h1 className="text-3xl lg:text-5xl font-bold text-white mb-1">Aura System</h1>
                  <p className="text-sm lg:text-base font-medium text-cyan-300 tracking-wide opacity-90">Renda Variável</p>
                </div>
              </div>
              
              <div className="mb-6">
                <p className="text-blue-100 text-lg lg:text-2xl font-medium mb-2">Ferramentas de análise e negociação</p>
                <p className="text-blue-200 text-sm lg:text-base opacity-90">Recursos de acompanhamento e configuração para usuários que compreendem os riscos</p>
              </div>
              
              {/* Destaque de Rendimento */}
              <div className="mb-8 bg-gradient-to-r from-amber-400/20 to-yellow-600/20 border border-amber-400/40 rounded-lg p-4 lg:p-6 backdrop-blur-sm">
                <p className="text-amber-100 text-sm lg:text-base font-semibold">
                  Mercados de renda variável e sintéticos envolvem risco. A plataforma não promete taxa de retorno nem rentabilidade.
                </p>
              </div>

              {/* Gráfico de Mercado em Tempo Real */}
              <SimpleMarketChart />

              {/* CTA Button */}
              <div className="text-center lg:text-left mt-8">
                <Button 
                  onClick={handleLogin}
                  className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white px-8 lg:px-12 py-3 lg:py-4 font-semibold text-base lg:text-lg shadow-lg hover:shadow-xl transition-all duration-300 flex items-center justify-center space-x-2"
                  size="lg"
                >
                  <TrendingUp className="h-5 w-5 lg:h-6 lg:w-6" />
                  <span>Acessar a plataforma</span>
                </Button>
              </div>
            </div>

            {/* Right Column - Features Grid */}
            <div className="space-y-3 lg:space-y-4">
              {/* AI Technology Highlight */}
              <Card className="bg-gradient-to-br from-indigo-500/20 to-purple-600/20 border-indigo-400/40 backdrop-blur-sm">
                <CardContent className="p-4 lg:p-6">
                  <div className="flex items-center space-x-3 mb-3">
                    <div className="w-8 h-8 lg:w-10 lg:h-10 bg-gradient-to-br from-indigo-400 to-purple-600 rounded-lg flex items-center justify-center">
                      <Cpu className="h-4 w-4 lg:h-5 lg:w-5 text-white" />
                    </div>
                    <h3 className="text-indigo-100 font-bold text-sm lg:text-base">Ferramentas de análise e automação</h3>
                  </div>
                  <p className="text-indigo-100/90 text-xs lg:text-sm leading-relaxed">
                    A plataforma reúne ferramentas de análise, configuração e integração com serviços externos. A disponibilidade depende de credenciais válidas, dados do provedor e validações operacionais.
                  </p>
                </CardContent>
              </Card>

              {/* Marketing Features */}
              <Card className="bg-white/10 border-white/20 backdrop-blur-sm border-2 border-amber-400/30">
                <CardContent className="p-4 flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-yellow-600 rounded-lg flex items-center justify-center">
                    <Brain className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-white font-semibold">Controles configuráveis</h3>
                    <p className="text-blue-100 text-sm">O usuário deve compreender os riscos e acompanhar as configurações antes de operar</p>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="bg-white/10 border-white/20 backdrop-blur-sm">
                <CardContent className="p-4 flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-indigo-400 to-blue-600 rounded-lg flex items-center justify-center">
                    <Users className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-white font-semibold">Uso responsável</h3>
                    <p className="text-blue-100 text-sm">Os recursos disponíveis variam conforme a conta, as permissões e os serviços conectados</p>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="bg-white/10 border-white/20 backdrop-blur-sm">
                <CardContent className="p-4 flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-yellow-600 rounded-lg flex items-center justify-center">
                    <Zap className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-white font-semibold">Monitoramento e limites</h3>
                    <p className="text-blue-100 text-sm">Controles de risco ajudam a limitar a exposição, mas não eliminam perdas nem garantem disponibilidade contínua</p>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="bg-white/10 border-white/20 backdrop-blur-sm border-2 border-green-400/30">
                <CardContent className="p-4 flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-green-400 to-emerald-600 rounded-lg flex items-center justify-center">
                    <TrendingUp className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-white font-semibold">Ferramentas de análise de mercado</h3>
                    <p className="text-blue-100 text-sm">Acompanhe dados e configurações das integrações disponíveis</p>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="bg-white/10 border-white/20 backdrop-blur-sm">
                <CardContent className="p-4 flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-cyan-600 rounded-lg flex items-center justify-center">
                    <Globe className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-white font-semibold">Micro Operações Sintéticas</h3>
                    <p className="text-blue-100 text-sm">Integração com mercados sintéticos, conforme disponibilidade do provedor</p>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="bg-white/10 border-white/20 backdrop-blur-sm">
                <CardContent className="p-4 flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-purple-400 to-violet-600 rounded-lg flex items-center justify-center">
                    <BarChart3 className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-white font-semibold">Simulação de cenários</h3>
                    <p className="text-blue-100 text-sm">Projete cenários matemáticos; simulações não representam resultados reais</p>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="bg-white/10 border-white/20 backdrop-blur-sm">
                <CardContent className="p-4 flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-red-400 to-pink-600 rounded-lg flex items-center justify-center">
                    <Shield className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-white font-semibold">Controles de risco</h3>
                    <p className="text-blue-100 text-sm">Limites e bloqueios ajudam a configurar operações, mas não eliminam perdas</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>

      {/* Footer - Rodapé Horizontal */}
      <footer className="bg-black/80 backdrop-blur-xl border-t border-cyan-400/15">
        <div className="max-w-7xl mx-auto px-4 lg:px-8 py-8">
          <div className="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
            <div className="flex items-center space-x-4">
              <p className="text-sm text-slate-300">
                © {currentYear} Aura System. Todos os direitos reservados.
              </p>
              <div className="hidden md:flex items-center space-x-2 text-xs text-slate-400">
                <span>•</span>
                <span>Araras, São Paulo, Brasil</span>
                <span>•</span>
                <span>CNPJ: 00.000.000/0001-00</span>
              </div>
            </div>
            
            <div className="flex items-center space-x-6">
              <div className="flex items-center space-x-2 text-xs">
                <Shield className="w-3 h-3 text-green-400" />
                <span className="text-slate-300">SSL Seguro</span>
              </div>
              <div className="flex items-center space-x-2 text-xs">
                <TrendingUp className="w-3 h-3 text-blue-400" />
                <span className="text-slate-300">Sem promessa de rentabilidade</span>
              </div>
            </div>
          </div>
          
          <div className="mt-4 text-center">
            <p className="text-xs text-slate-400 leading-relaxed">
              <span className="font-medium text-slate-300">Aviso Legal:</span> Os investimentos em renda variável e sintéticos podem apresentar riscos. 
              Rentabilidade passada não garante resultados futuros. Leia todos os termos antes de investir. 
              A Invista PRO é uma plataforma de software. Integrações, pagamentos e operações dependem da configuração e das condições dos provedores externos.
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}