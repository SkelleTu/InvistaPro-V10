import { useState } from "react";
import { Button } from "@/components/ui/button";
import { LogOut, User, Settings, Shield, TrendingUp, Moon, Layout, BarChart3, Monitor, LayoutDashboard } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/contexts/ThemeContext";
import { useQuery } from "@tanstack/react-query";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import UserProfileModal from "@/components/profile/user-profile-modal";
import AdminPanel from "@/components/admin/admin-panel";
import { useLocation } from "wouter";
const AURA_LOGO = "https://integrated-system-1c86.onrender.com/aura-system-logo.webp?v=1";
export default function Header() {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [location, setLocation] = useLocation();
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);
  const handleLogout = async () => {
    try { await fetch("/api/logout", { method: "POST", credentials: "include" }); }
    catch (error) { console.error("Erro ao fazer logout:", error); }
    finally { window.location.href = "/"; }
  };
  const { data: tradingAccessCheck } = useQuery({ queryKey: ["/api/auto-trading/check-access"], enabled: !!user, staleTime: 5 * 60 * 1000 });
  const { data: adminAccessCheck } = useQuery({ queryKey: ["/api/admin/check-access"], enabled: !!user, staleTime: 5 * 60 * 1000 });
  const isAdmin = Boolean((adminAccessCheck as any)?.hasAccess);
  const hasTradingAccess = Boolean((tradingAccessCheck as any)?.hasAccess);
  const navItems = [
    { label: "Dashboard", path: "/", icon: LayoutDashboard },
    ...(hasTradingAccess ? [
      { label: "Negociação", path: "/trading", icon: BarChart3 },
      { label: "MetaTrader", path: "/metatrader", icon: TrendingUp },
      { label: "MT5 Desktop", path: "/metatrader5", icon: Monitor },
    ] : []),
  ];
  return <>
    <div className="relative z-40 h-20">
      <header className="fixed top-2 left-1/2 -translate-x-1/2 z-40 w-[calc(100vw-16px)] max-w-[1700px] flex items-center gap-3">
        <div className="hidden sm:flex items-center gap-2 h-12 px-3 rounded-2xl border border-cyan-400/15 bg-black/65 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,.45)] shrink-0">
          <img src={AURA_LOGO} alt="Aura System" className="w-8 h-8 object-contain drop-shadow-[0_0_10px_rgba(0,229,255,.45)]" />
          <div className="flex flex-col leading-tight"><span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/85">Aura System</span><span className="text-[9px] font-bold uppercase tracking-[0.16em] text-cyan-300">Renda Variável</span></div>
        </div>
        <nav aria-label="Navegação da Renda Variável" className="h-12 min-w-0 flex-1 flex items-center rounded-2xl overflow-hidden border border-cyan-400/15 bg-black/65 shadow-[0_8px_32px_rgba(0,0,0,.5)] backdrop-blur-xl">
          <div className="w-full h-full min-w-0 overflow-x-auto overflow-y-hidden flex items-center gap-1 px-2 sm:px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {navItems.map((item) => {
              const active = location === item.path || (item.path !== "/" && location.startsWith(item.path));
              const Icon = item.icon;
              return <button key={item.path} type="button" onClick={() => setLocation(item.path)} aria-current={active ? "page" : undefined}
                className={active
                  ? "relative flex h-9 shrink-0 items-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-3 text-[10px] font-black uppercase tracking-[.14em] text-cyan-300 shadow-[0_0_14px_rgba(0,229,255,.12)]"
                  : "relative flex h-9 shrink-0 items-center gap-2 rounded-xl border border-transparent px-3 text-[10px] font-black uppercase tracking-[.14em] text-white/65 transition-all hover:border-cyan-400/15 hover:bg-cyan-400/[.06] hover:text-white"}>
                <Icon className="h-3.5 w-3.5" /><span>{item.label}</span>
              </button>;
            })}
          </div>
        </nav>
        <div className="flex h-12 shrink-0 items-center gap-1 rounded-2xl border border-cyan-400/15 bg-black/65 px-1.5 shadow-[0_8px_32px_rgba(0,0,0,.45)] backdrop-blur-xl">
          <Button variant="ghost" size="sm" onClick={toggleTheme} className="h-9 rounded-xl px-2 text-white/75 hover:bg-cyan-400/10 hover:text-cyan-200" data-testid="theme-switcher" title={theme === "dark" ? "Mudar para Tema Windows 10" : "Mudar para Tema Dark"}>
            {theme === "dark" ? <Layout className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            <span className="hidden xl:inline ml-1 text-[9px] font-bold uppercase tracking-wider">{theme === "dark" ? "Windows 10" : "Dark"}</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-9 max-w-[180px] rounded-xl px-2 text-white/80 hover:bg-cyan-400/10 hover:text-white"><User className="h-4 w-4 shrink-0" /><span className="hidden md:inline ml-2 truncate text-xs">{user?.nomeCompleto || user?.email}</span></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 border-cyan-400/15 bg-[#05070a] text-white">
              <DropdownMenuItem onClick={() => setProfileModalOpen(true)}><Settings className="h-4 w-4 mr-2" /> Perfil e KYC</DropdownMenuItem>
              {hasTradingAccess && <><DropdownMenuSeparator /><DropdownMenuItem onClick={() => setLocation("/trading")}><BarChart3 className="h-4 w-4 mr-2" /> Sistema de Renda Variável</DropdownMenuItem><DropdownMenuItem onClick={() => setLocation("/metatrader")}><TrendingUp className="h-4 w-4 mr-2" /> MetaTrader 4/5</DropdownMenuItem><DropdownMenuItem onClick={() => setLocation("/metatrader5")}><Monitor className="h-4 w-4 mr-2" /> MetaTrader 5 — Desktop</DropdownMenuItem></>}
              {isAdmin && <><DropdownMenuSeparator /><DropdownMenuItem onClick={() => setAdminPanelOpen(true)}><Shield className="h-4 w-4 mr-2" /> Painel Administrativo</DropdownMenuItem></>}
              <DropdownMenuSeparator /><DropdownMenuItem onClick={handleLogout}><LogOut className="h-4 w-4 mr-2" /> Sair</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
    </div>
    <UserProfileModal isOpen={profileModalOpen} onClose={() => setProfileModalOpen(false)} />
    {isAdmin && <AdminPanel isOpen={adminPanelOpen} onClose={() => setAdminPanelOpen(false)} />}
  </>;
}