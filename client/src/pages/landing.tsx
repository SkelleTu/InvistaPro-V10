import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChartLine, Shield, TrendingUp, Banknote, Zap, BarChart3, Globe, Brain, Users, Cpu, Lock, Menu, X } from "lucide-react";
import iconImage from "@/assets/investpro-icon.png";
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
      <header className="absolute top-0 left-0 right-0 z-50 bg-slate-900/80 backdrop-blur-md border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 lg:px-8">
          <div className="flex justify-between items-center py-4">
            {/* Logo */}
            <div className="flex items-center space-x-3">
              <img 
                src={iconImage} 
                alt="InvistaPRO Logo" 
                className="w-12 h-12 rounded-lg relative z-0"
              />
              <div className="relative z-10">
                <h3 className="text-lg font-bold text-white">InvistaPRO</h3>
                <p className="text-xs text-blue-100 opacity-90">Invista com Risco Zero</p>
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
                  src={iconImage} 
                  alt="InvistaPRO Logo" 
                  className="w-20 h-20 lg:w-24 lg:h-24 rounded-2xl shadow-lg mr-4"
                />
                <div className="text-left">
                  <h1 className="text-3xl lg:text-5xl font-bold text-white mb-1">InvistaPRO</h1>
                  <p className="text-sm lg:text-base font-medium text-blue-100 tracking-wide opacity-90">Invista com Risco Zero</p>
                </div>
              </div>
              
              <div className="mb-6">
                <p className="text-blue-100 text-lg lg:text-2xl font-medium mb-2">Investimentos 100% Automatizados</p>
                <p className="text-blue-200 text-sm lg:text-base opacity-90">Sem conhecimento necessário • Para iniciantes e experientes</p>
              </div>
              
              {/* Destaque de Rendimento */}
              <div className="mb-8 bg-gradient-to-r from-amber-400/20 to-yellow-600/20 border border-amber-400/40 rounded-lg p-4 lg:p-6 backdrop-blur-sm">
                <p className="text-amber-100 text-sm lg:text-base font-semibold">
                  ⚡ Potencial de até <span className="text-amber-200 font-bold text-lg lg:text-xl">130%</span> das melhores rendas fixas do mercado, operadas diariamente pelos algoritmos
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
                  <span>Começar a Lucrar Agora</span>
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
                    <h3 className="text-indigo-100 font-bold text-sm lg:text-base">Tecnologia Avançada</h3>
                  </div>
                  <p className="text-indigo-100/90 text-xs lg:text-sm leading-relaxed">
                    Nossos algoritmos são potencializados com Inteligência Artificial de última geração, fazendo todo o processo de análise e otimização de forma completamente automatizada para você.
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
                    <h3 className="text-white font-semibold">100% Automático</h3>
                    <p className="text-blue-100 text-sm">Não precisa entender NADA de investimentos para lucrar</p>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="bg-white/10 border-white/20 backdrop-blur-sm">
                <CardContent className="p-4 flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-indigo-400 to-blue-600 rounded-lg flex items-center justify-center">
                    <Users className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-white font-semibold">Para Todos os Perfis</h3>
                    <p className="text-blue-100 text-sm">Iniciantes ou especialistas, nosso sistema funciona igual</p>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="bg-white/10 border-white/20 backdrop-blur-sm">
                <CardContent className="p-4 flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-yellow-600 rounded-lg flex items-center justify-center">
                    <Zap className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-white font-semibold">Gestão Inteligente</h3>
                    <p className="text-blue-100 text-sm">Algoritmos profissionais trabalham 24/7 por você</p>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="bg-white/10 border-white/20 backdrop-blur-sm border-2 border-green-400/30">
                <CardContent className="p-4 flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-green-400 to-emerald-600 rounded-lg flex items-center justify-center">
                    <TrendingUp className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-white font-semibold">Até 130% de Rentabilidade</h3>
                    <p className="text-blue-100 text-sm">Superior às principais soluções do mercado financeiro</p>
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
                    <p className="text-blue-100 text-sm">Diversificação em mercados globais com alta liquidez</p>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="bg-white/10 border-white/20 backdrop-blur-sm">
                <CardContent className="p-4 flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-purple-400 to-violet-600 rounded-lg flex items-center justify-center">
                    <BarChart3 className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-white font-semibold">Rendimento Composto</h3>
                    <p className="text-blue-100 text-sm">Seus lucros geram mais lucros automaticamente</p>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="bg-white/10 border-white/20 backdrop-blur-sm">
                <CardContent className="p-4 flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-red-400 to-pink-600 rounded-lg flex items-center justify-center">
                    <Shield className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-white font-semibold">Capital 100% Protegido</h3>
                    <p className="text-blue-100 text-sm">Zero risco sobre seu investimento inicial</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>

      {/* Footer - Rodapé Horizontal */}
      <footer className="bg-slate-900/95 backdrop-blur-sm border-t border-white/10">
        <div className="max-w-7xl mx-auto px-4 lg:px-8 py-8">
          <div className="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
            <div className="flex items-center space-x-4">
              <p className="text-sm text-slate-300">
                © {currentYear} InvistaPRO. Todos os direitos reservados.
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
                <span className="text-slate-300">Rendimentos até 130%</span>
              </div>
            </div>
          </div>
          
          <div className="mt-4 text-center">
            <p className="text-xs text-slate-400 leading-relaxed">
              <span className="font-medium text-slate-300">Aviso Legal:</span> Os investimentos em renda variável e sintéticos podem apresentar riscos. 
              Rentabilidade passada não garante resultados futuros. Leia todos os termos antes de investir. 
              InvistaPRO não é uma instituição financeira, atuamos como facilitadores de investimentos automatizados.
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}