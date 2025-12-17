import './utils/dom-safety';
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { suppressViteErrorOverlay, optimizeInputForMobile } from "./utils/mobile-fixes";
import { applyGlobalRemoveChildFix, interceptRuntimeErrors, fixMobileAutocompleteConflicts } from "./utils/global-dom-fix";
import { ensurePortalRootExists } from "./utils/portal-helper";

// Aplicar correção global de removeChild ANTES de tudo
applyGlobalRemoveChildFix();
interceptRuntimeErrors();
ensurePortalRootExists();

// Aplicar correções específicas para mobile
if (window.innerWidth <= 768) {
  suppressViteErrorOverlay();
  
  // Aplicar otimizações após DOM estar pronto
  document.addEventListener('DOMContentLoaded', () => {
    optimizeInputForMobile();
    fixMobileAutocompleteConflicts();
  });
  
  // Também aplicar quando novos elementos são adicionados
  setTimeout(() => {
    optimizeInputForMobile();
    fixMobileAutocompleteConflicts();
  }, 1000);
}

createRoot(document.getElementById("root")!).render(<App />);
