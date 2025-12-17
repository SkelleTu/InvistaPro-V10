// client/src/utils/portal-helper.ts

// Portal root utilities para evitar problemas de insertBefore com modais/portais

export function getPortalRoot() {
  let el = document.getElementById('portal-root');
  if (!el) {
    el = document.createElement('div');
    el.id = 'portal-root';
    
    try {
      // Usar appendChild de forma segura
      document.body.appendChild(el);
    } catch (error) {
      console.debug('Erro ao criar portal root:', error);
      // Fallback: tentar inserir no documento
      try {
        if (document.documentElement) {
          document.documentElement.appendChild(el);
        }
      } catch (fallbackError) {
        console.debug('Erro no fallback do portal:', fallbackError);
      }
    }
  }
  return el;
}

// Função para criar portais seguros
export function createSafePortal(children: React.ReactNode) {
  try {
    const portalRoot = getPortalRoot();
    if (!portalRoot) {
      console.warn('Portal root não encontrado, renderizando inline');
      return children;
    }
    
    // Importar createPortal dinamicamente para evitar problemas de SSR
    const { createPortal } = require('react-dom');
    return createPortal(children, portalRoot);
  } catch (error) {
    console.debug('Erro ao criar portal, renderizando inline:', error);
    return children;
  }
}

// Função para garantir que o portal root existe no DOM
export function ensurePortalRootExists() {
  if (typeof document === 'undefined') return; // SSR safety
  
  setTimeout(() => {
    getPortalRoot();
  }, 0);
}