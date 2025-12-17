/**
 * Controle de acesso centralizado para o sistema InvistaPRO e Sistema de Renda Variável
 * 
 * Conforme especificação: apenas Victor Felipe Diogo e Carlos Eduardo Saturnino
 * têm acesso ao Sistema de Renda Variável e funções administrativas.
 */

// Lista centralizada de usuários autorizados para o sistema
const AUTHORIZED_SYSTEM_USERS = [
  'vfdiogoseg@gmail.com',           // Victor Felipe Diogo
  'carlos.eduardo.saturnino@gmail.com',  // Carlos Eduardo Saturnino
  'carlos.eduardo.saturnino98@gmail.com'  // Carlos Eduardo Saturnino (conta alternativa)
];

/**
 * Verifica se um email tem acesso autorizado ao sistema
 * @param email Email do usuário para verificar
 * @returns true se o usuário tem acesso autorizado
 */
export function isAuthorizedEmail(email: string): boolean {
  if (!email) return false;
  
  // SEGURANÇA RESTAURADA: Apenas usuários autorizados podem acessar o sistema de trading
  const normalizedEmail = email.toLowerCase().trim();
  const normalizedAuthorizedEmails = AUTHORIZED_SYSTEM_USERS.map(e => e.toLowerCase());
  return normalizedAuthorizedEmails.includes(normalizedEmail);
}

/**
 * Lista dos emails autorizados para referência
 */
export function getAuthorizedEmails(): string[] {
  return [...AUTHORIZED_SYSTEM_USERS];
}

/**
 * Mensagem padrão para acesso negado (sem informações sensíveis)
 */
export const ACCESS_DENIED_MESSAGE = 'Acesso negado. Sistema disponível apenas para usuários autorizados.';