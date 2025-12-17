import { Phone, Mail, MapPin, Shield, TrendingUp, Users, ExternalLink } from "lucide-react";
import iconImage from "@/assets/investpro-icon.png";

export function Footer() {
  const currentYear = new Date().getFullYear();

  const handleWhatsAppClick = () => {
    const message = "Olá! Preciso de suporte com a plataforma InvistaPRO.";
    const whatsappUrl = `https://wa.me/5519997238298?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank');
  };

  const handleEmailClick = () => {
    window.location.href = "mailto:vfdiogoseg@gmail.com?subject=Suporte InvistaPRO";
  };

  return (
    <footer className="bg-background/95 backdrop-blur-sm border-t border-border/50 mt-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          
          {/* Logo e Descrição */}
          <div className="md:col-span-1">
            <div className="flex items-center space-x-3 mb-4">
              <img 
                src={iconImage} 
                alt="InvistaPRO Logo" 
                className="w-14 h-14 rounded-xl relative z-0"
              />
              <div className="relative z-10">
                <h3 className="text-lg font-bold text-foreground">InvistaPRO</h3>
                <p className="text-xs text-muted-foreground">Invista com Risco Zero</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              Plataforma financeira de investimentos automatizados com tecnologia avançada e rendimentos de até 130% das melhores rendas fixas do mercado.
            </p>
            <div className="flex space-x-2">
              <div className="flex items-center text-xs text-green-400">
                <Shield className="w-3 h-3 mr-1" />
                <span>100% Seguro</span>
              </div>
              <div className="flex items-center text-xs text-blue-400">
                <TrendingUp className="w-3 h-3 mr-1" />
                <span>Alta Rentabilidade</span>
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
            <div className="space-y-3">
              <button
                onClick={handleWhatsAppClick}
                className="flex items-center space-x-2 text-sm text-muted-foreground hover:text-green-400 transition-colors group"
                data-testid="footer-whatsapp"
              >
                <Phone className="w-4 h-4 group-hover:text-green-400" />
                <span>(19) 99723-8298</span>
                <ExternalLink className="w-3 h-3 opacity-50" />
              </button>
              <button
                onClick={handleEmailClick}
                className="flex items-center space-x-2 text-sm text-muted-foreground hover:text-blue-400 transition-colors group"
                data-testid="footer-email"
              >
                <Mail className="w-4 h-4 group-hover:text-blue-400" />
                <span>vfdiogoseg@gmail.com</span>
              </button>
              <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                <MapPin className="w-4 h-4" />
                <span>Araras, SP - Brasil</span>
              </div>
            </div>
            
            <div className="mt-4 pt-4 border-t border-border/30">
              <p className="text-xs text-muted-foreground mb-2">Horário de Atendimento:</p>
              <p className="text-xs text-foreground font-medium">
                Segunda à Sexta: 9h às 18h<br />
                Sábado: 9h às 15h
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
                Operamos com total transparência, conformidade regulatória e compromisso com a segurança dos seus investimentos.
              </p>
            </div>
          </div>
        </div>

        {/* Rodapé Inferior */}
        <div className="mt-12 pt-8 border-t border-border/30">
          <div className="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
            <div className="flex items-center space-x-4">
              <p className="text-sm text-muted-foreground">
                © {currentYear} InvistaPRO. Todos os direitos reservados.
              </p>
              <div className="hidden md:flex items-center space-x-2 text-xs text-muted-foreground">
                <span>•</span>
                <span>Araras, São Paulo, Brasil</span>
                <span>•</span>
                <span>CNPJ: 00.000.000/0001-00</span>
              </div>
            </div>
            
            <div className="flex items-center space-x-6">
              <div className="flex items-center space-x-2 text-xs">
                <Shield className="w-3 h-3 text-green-400" />
                <span className="text-muted-foreground">SSL Seguro</span>
              </div>
              <div className="flex items-center space-x-2 text-xs">
                <TrendingUp className="w-3 h-3 text-blue-400" />
                <span className="text-muted-foreground">Rendimentos até 130%</span>
              </div>
            </div>
          </div>
          
          <div className="mt-4 text-center">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-medium text-foreground">Aviso Legal:</span> Os investimentos em renda variável e sintéticos podem apresentar riscos. 
              Rentabilidade passada não garante resultados futuros. Leia todos os termos antes de investir. 
              InvistaPRO não é uma instituição financeira, atuamos como facilitadores de investimentos automatizados.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}