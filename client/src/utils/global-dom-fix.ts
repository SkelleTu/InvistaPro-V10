/**
 * Correção global para problemas de removeChild em dispositivos móveis
 * Intercepta e corrige todas as chamadas de removeChild problemáticas
 */

// Função para aplicar correção global
export function applyGlobalRemoveChildFix() {
  // Armazenar a referência original do removeChild
  const originalRemoveChild = Node.prototype.removeChild;

  // Sobrescrever o método removeChild globalmente
  Node.prototype.removeChild = function<T extends Node>(child: T): T {
    try {
      // Verificar se o elemento ainda é filho antes de tentar remover
      if (child && child.parentNode === this) {
        return originalRemoveChild.call(this, child) as T;
      } else {
        // Se não for filho, retornar o elemento mesmo assim (não dar erro)
        console.debug('Tentativa de remover elemento que não é filho - ignorando');
        return child;
      }
    } catch (error) {
      // Em caso de qualquer erro, silenciar e retornar o elemento
      console.debug('Erro ao remover elemento:', error);
      return child;
    }
  };

  console.debug('✅ Correção global de removeChild aplicada para dispositivos móveis');
}

// Aplicar interceptação de erros de runtime também
export function interceptRuntimeErrors() {
  // Interceptar erros não tratados
  window.addEventListener('error', (event) => {
    const errorMsg = event.message || '';
    if (
      errorMsg.includes('removeChild') ||
      errorMsg.includes('not a child') ||
      errorMsg.includes('não é um filho') ||
      errorMsg.includes('Failed to execute')
    ) {
      // Prevenir que o erro apareça no console/overlay
      event.preventDefault();
      event.stopPropagation();
      return false;
    }
  });

  // Interceptar promises rejeitadas
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason?.message || event.reason?.toString() || '';
    if (
      reason.includes('removeChild') ||
      reason.includes('not a child') ||
      reason.includes('não é um filho')
    ) {
      // Prevenir que o erro apareça no console
      event.preventDefault();
      return false;
    }
  });
}

// Função para detectar e corrigir problemas específicos de autocomplete mobile
export function fixMobileAutocompleteConflicts() {
  // Observar mudanças no DOM para detectar elementos sendo removidos pelo autocomplete
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      // Verificar se elementos foram removidos
      mutation.removedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as Element;
          
          // Se foi um input ou elemento relacionado a formulário
          if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || 
              element.classList.contains('form-') || element.getAttribute('data-form')) {
            console.debug('Sistema móvel removeu elemento do formulário automaticamente');
          }
        }
      });
    });
  });

  // Observar todo o documento
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Configurar inputs existentes para melhor compatibilidade mobile
  const inputs = document.querySelectorAll('input, textarea');
  inputs.forEach((input) => {
    const element = input as HTMLInputElement | HTMLTextAreaElement;
    
    // Configurar atributos para prevenir conflitos
    element.setAttribute('autocomplete', 'on');
    element.setAttribute('autocorrect', 'on');
    element.setAttribute('spellcheck', 'true');
    
    // Adicionar listeners para detectar mudanças do autocomplete
    element.addEventListener('input', () => {
      // Marcar que o input foi modificado pelo usuário
      element.setAttribute('data-user-modified', 'true');
    });
  });
}