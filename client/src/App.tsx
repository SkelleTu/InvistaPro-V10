import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/auth-page";
import ResetPasswordPage from "@/pages/reset-password-page";
import Home from "@/pages/home";
import Landing from "@/pages/landing";
import PendingApprovalPage from "./pages/pending-approval";
import TermosUso from "@/pages/termos-uso";
import PoliticaPrivacidade from "@/pages/politica-privacidade";
import PoliticaCookies from "@/pages/politica-cookies";
import LGPD from "@/pages/lgpd";
import QuemSomos from "@/pages/quem-somos";
import ComoFunciona from "@/pages/como-funciona";
import Seguranca from "@/pages/seguranca";
import Transparencia from "@/pages/transparencia";
import Resultados from "@/pages/resultados";
import TecnologiaFinanceira from "@/pages/tecnologia-financeira";
import TradingSystemPage from "@/pages/trading-system";
import MetaTraderPage from "@/pages/metatrader-page";
import MetaTrader5Page from "@/pages/metatrader5-page";
import KeepAliveSetup from "@/pages/KeepAliveSetup";

import { useAuth } from "@/hooks/useAuth";
import { ThemeProvider } from "@/contexts/ThemeContext";

const PUBLIC_PATHS = [
  "/", "/auth", "/reset-password",
  "/termos-uso", "/politica-privacidade", "/politica-cookies",
  "/lgpd", "/quem-somos", "/como-funciona", "/seguranca",
  "/transparencia", "/resultados", "/tecnologia-financeira",
  "/setup/keepalive",
];

function SaveAndRedirectToAuth({ currentPath }: { currentPath: string }) {
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!PUBLIC_PATHS.includes(currentPath)) {
      sessionStorage.setItem("redirect_after_login", currentPath);
    }
    setLocation("/auth");
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

function Router() {
  const { isAuthenticated, isLoading, isApproved, isPhoneVerified } = useAuth();
  const [location] = useLocation();

  return (
    <Switch>
      {/* Páginas institucionais - acessíveis a todos */}
      <Route path="/termos-uso" component={TermosUso} />
      <Route path="/politica-privacidade" component={PoliticaPrivacidade} />
      <Route path="/politica-cookies" component={PoliticaCookies} />
      <Route path="/lgpd" component={LGPD} />
      <Route path="/quem-somos" component={QuemSomos} />
      <Route path="/como-funciona" component={ComoFunciona} />
      <Route path="/seguranca" component={Seguranca} />
      <Route path="/transparencia" component={Transparencia} />
      <Route path="/resultados" component={Resultados} />
      <Route path="/tecnologia-financeira" component={TecnologiaFinanceira} />
      <Route path="/setup/keepalive" component={KeepAliveSetup} />
      
      {(() => {
        if (isLoading) {
          return (
            <Route>
              <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            </Route>
          );
        }

        if (!isAuthenticated || !isPhoneVerified) {
          return (
            <>
              <Route path="/auth" component={AuthPage} />
              <Route path="/reset-password" component={ResetPasswordPage} />
              <Route path="/" component={Landing} />
              {/* Se tentou acessar rota protegida sem autenticação, salva o destino e redireciona para login */}
              <Route>
                <SaveAndRedirectToAuth currentPath={location} />
              </Route>
            </>
          );
        }

        if (!isApproved) {
          return <Route><PendingApprovalPage /></Route>;
        }

        return (
          <>
            <Route path="/" component={Home} />
            <Route path="/dashboard" component={Home} />
            <Route path="/trading" component={TradingSystemPage} />
            <Route path="/metatrader" component={MetaTraderPage} />
            <Route path="/metatrader5" component={MetaTrader5Page} />
          </>
        );
      })()}
      
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
