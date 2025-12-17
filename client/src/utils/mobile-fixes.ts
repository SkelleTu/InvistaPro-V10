/**
 * Utilitários para corrigir problemas de compatibilidade mobile
 */

// Suprimir overlay de erro do Vite em dispositivos móveis
export function suppressViteErrorOverlay() {
  // Função segura para remover elementos DOM
  const safeRemoveChild = (parent: Node, child: Node) => {
    try {
      if (child && child.parentNode === parent) {
        parent.removeChild(child);
      }
    } catch (error) {
      // Silenciar erros de removeChild em dispositivos móveis
      console.debug('Elemento já foi removido pelo sistema móvel');
    }
  };

  // Remover overlay existente
  const removeOverlay = () => {
    const overlays = document.querySelectorAll(
      '#vite-error-overlay, .vite-runtime-error-overlay, [data-vite-error-overlay]'
    );
    overlays.forEach((overlay) => {
      const parent = overlay.parentNode;
      if (parent) {
        safeRemoveChild(parent, overlay);
      } else {
        // Tentar com remove() como fallback
        try {
          overlay.remove();
        } catch (e) {
          // Silenciar completamente se não conseguir remover
        }
      }
    });
  };

  // Executar na inicialização
  removeOverlay();

  // Observar por novos overlays
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as Element;
          if (
            element.id === 'vite-error-overlay' ||
            (typeof element.className === 'string' && element.className.includes('vite-runtime-error-overlay')) ||
            element.hasAttribute('data-vite-error-overlay')
          ) {
            try {
              if (element.parentNode) {
                safeRemoveChild(element.parentNode, element);
              } else {
                element.remove();
              }
            } catch (e) {
              // Silenciar erros de remoção
            }
          }
        }
      });
    });
  });

  // Observar o documento inteiro
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Interceptar erros do console para evitar overlay
  const originalError = console.error;
  console.error = (...args) => {
    // Filtrar erros relacionados ao removeChild do overlay
    const errorMessage = args.join(' ');
    if (
      (errorMessage.includes('removeChild') && errorMessage.includes('not a child')) ||
      (errorMessage.includes('removeChild') && errorMessage.includes('não é um filho')) ||
      errorMessage.includes('Failed to execute \'removeChild\' on \'Node\'')
    ) {
      // Silenciar esse erro específico
      return;
    }
    originalError.apply(console, args);
  };

  // Interceptar também window.onerror para capturar erros não tratados
  const originalOnError = window.onerror;
  window.onerror = (message, source, lineno, colno, error) => {
    const errorMsg = message?.toString() || '';
    if (
      errorMsg.includes('removeChild') ||
      errorMsg.includes('not a child') ||
      errorMsg.includes('não é um filho')
    ) {
      // Silenciar erros de removeChild
      return true;
    }
    if (originalOnError) {
      return originalOnError(message, source, lineno, colno, error);
    }
    return false;
  };
}

// Otimizações para campos de input em mobile
export function optimizeInputForMobile() {
  const inputs = document.querySelectorAll('input, textarea');
  
  inputs.forEach((input) => {
    const element = input as HTMLInputElement | HTMLTextAreaElement;
    
    // Atributos para melhor experiência mobile
    element.setAttribute('autocomplete', 'on');
    element.setAttribute('autocapitalize', 'words');
    element.setAttribute('spellcheck', 'true');
    
    // Prevenir conflitos com sugestões do teclado
    element.style.webkitUserSelect = 'text';
    element.style.userSelect = 'text';
  });
}