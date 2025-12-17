// client/src/utils/dom-safety.ts

// Monkey-patches defensivos para evitar crashes em mobile/autofill/HMR.
// Podem ficar em dev e prod; são "no-ops" quando tudo está correto.

(function () {
  const E = Element.prototype as any;

  // ---- insertBefore guard ----
  const _insertBefore = E.insertBefore;
  E.insertBefore = function (newNode: Node, referenceNode?: Node | null) {
    try {
      if (!referenceNode || (referenceNode as any).parentNode !== this) {
        // referência inválida -> faz fallback para appendChild
        return this.appendChild(newNode);
      }
      return _insertBefore.call(this, newNode, referenceNode);
    } catch {
      // qualquer exceção -> fallback para append
      return this.appendChild(newNode);
    }
  };

  // ---- removeChild guard (para o problema anterior também) ----
  const _removeChild = E.removeChild;
  E.removeChild = function (child: Node) {
    try {
      if (child && (child as any).parentNode === this) {
        return _removeChild.call(this, child);
      }
      // já foi removido por outro agente (IME/autofill) -> ignore
      return child;
    } catch {
      return child;
    }
  };

  // ---- replaceChild guard (opcional, pelo mesmo motivo) ----
  const _replaceChild = E.replaceChild;
  E.replaceChild = function (newChild: Node, oldChild: Node) {
    try {
      if (oldChild && (oldChild as any).parentNode === this) {
        return _replaceChild.call(this, newChild, oldChild);
      }
      // se oldChild não é filho válido, faça append como fallback
      return this.appendChild(newChild);
    } catch {
      return this.appendChild(newChild);
    }
  };

  console.log('✅ Correção global de removeChild aplicada para dispositivos móveis');
})();