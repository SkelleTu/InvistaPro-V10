import { useState } from "react";
import { Button } from "@/components/ui/button";
import { LogOut, User, Settings, Shield, TrendingUp, Palette, Moon, Layout, BarChart3, Monitor } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/contexts/ThemeContext";
import { useQuery } from "@tanstack/react-query";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import UserProfileModal from "@/components/profile/user-profile-modal";
import AdminPanel from "@/components/admin/admin-panel";
import { useLocation } from "wouter";

export default function Header() {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [, setLocation] = useLocation();
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await fetch('/api/logout', {
        method: 'POST',
        credentials: 'include'
      });
      window.location.href = '/';
    } catch (error) {
      console.error('Erro ao fazer logout:', error);
      window.location.href = '/';
    }
  };

  // Verificar acesso ao sistema de trading via backend
  const { data: tradingAccessCheck } = useQuery({
    queryKey: ["/api/auto-trading/check-access"],
    enabled: !!user,
    staleTime: 5 * 60 * 1000, // Cache por 5 minutos
  });
  
  // Verificar acesso admin via backend
  const { data: adminAccessCheck } = useQuery({
    queryKey: ["/api/admin/check-access"],
    enabled: !!user,
    staleTime: 5 * 60 * 1000, // Cache por 5 minutos
  });
  
  const isAdmin = Boolean((adminAccessCheck as any)?.hasAccess);
  const hasTradingAccess = Boolean((tradingAccessCheck as any)?.hasAccess);

  return (
    <>
      <header className="aura-platform-header sticky top-0 z-40 border-b border-cyan-400/15 bg-black/55 px-4 shadow-[0_8px_32px_rgba(0,0,0,.35)] backdrop-blur-xl sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-3">
              <img src="https://integrated-system-1c86.onrender.com/aura-system-logo.webp?v=1" alt="Aura System"
                className="relative z-0 h-10 w-10 rounded-xl object-contain drop-shadow-[0_0_10px_rgba(0,229,255,.35)] sm:h-11 sm:w-11" />
              <div className="relative z-10 flex flex-col">
                <h1 className="text-xl font-black tracking-tight text-white sm:text-2xl">Aura System</h1>
                <span className="text-[10px] font-black uppercase tracking-[.24em] text-cyan-300">Renda Variável</span>
              </div>
            </div>
            
            <div className="flex items-center space-x-4">
              {/* Theme Switcher */}
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleTheme}
                className="flex items-center space-x-2 hover:bg-accent"
                data-testid="theme-switcher"
                title={theme === 'dark' ? 'Mudar para Tema Windows 10' : 'Mudar para Tema Dark'}
              >
                {theme === 'dark' ? (
                  <>
                    <Layout className="h-4 w-4" />
                    <span className="hidden sm:inline text-xs">Windows 10</span>
                  </>
                ) : (
                  <>
                    <Moon className="h-4 w-4" />
                    <span className="hidden sm:inline text-xs">Dark</span>
                  </>
                )}
              </Button>
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="flex items-center space-x-2">
                    <User className="h-4 w-4" />
                    <span className="hidden sm:inline">{user?.nomeCompleto || user?.email}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onClick={() => setProfileModalOpen(true)}>
                    <Settings className="h-4 w-4 mr-2" />
                    Perfil e KYC
                  </DropdownMenuItem>
                  
                  {hasTradingAccess && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setLocation("/trading")}>
                        <BarChart3 className="h-4 w-4 mr-2" />
                        Sistema de Renda Variável
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setLocation("/metatrader")}>
                        <TrendingUp className="h-4 w-4 mr-2" />
                        MetaTrader 4/5
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setLocation("/metatrader5")}>
                        <Monitor className="h-4 w-4 mr-2" />
                        MetaTrader 5 — Desktop
                      </DropdownMenuItem>
                    </>
                  )}
                  
                  {isAdmin && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setAdminPanelOpen(true)}>
                        <Shield className="h-4 w-4 mr-2" />
                        Painel Administrativo
                      </DropdownMenuItem>
                    </>
                  )}
                  
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout}>
                    <LogOut className="h-4 w-4 mr-2" />
                    Sair
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </header>

      <UserProfileModal 
        isOpen={profileModalOpen} 
        onClose={() => setProfileModalOpen(false)} 
      />
      
      {isAdmin && (
        <AdminPanel 
          isOpen={adminPanelOpen} 
          onClose={() => setAdminPanelOpen(false)} 
        />
      )}
    </>
  );
}