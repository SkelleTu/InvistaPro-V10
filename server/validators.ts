// Validators for real data validation
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// CPF validation
export function validateCPF(cpf: string): boolean {
  cpf = cpf.replace(/[^\d]/g, '');
  
  if (cpf.length !== 11) return false;
  
  // Check for repeated digits
  if (/^(\d)\1+$/.test(cpf)) return false;
  
  // Validate first digit
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(cpf[i]) * (10 - i);
  }
  let remainder = sum % 11;
  let firstDigit = remainder < 2 ? 0 : 11 - remainder;
  
  if (parseInt(cpf[9]) !== firstDigit) return false;
  
  // Validate second digit
  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(cpf[i]) * (11 - i);
  }
  remainder = sum % 11;
  let secondDigit = remainder < 2 ? 0 : 11 - remainder;
  
  return parseInt(cpf[10]) === secondDigit;
}

// Email validation with real domains
export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return false;
  
  // List of valid email domains
  const validDomains = [
    'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com',
    'icloud.com', 'aol.com', 'protonmail.com', 'zoho.com', 'mail.com',
    'yandex.com', 'gmx.com', 'terra.com.br', 'uol.com.br', 'bol.com.br',
    'ig.com.br', 'r7.com', 'zipmail.com.br', 'oi.com.br', 'globo.com',
    'globomail.com', 'ibest.com.br', 'superig.com.br', 'click21.com.br',
    'pop.com.br', 'brturbo.com.br', 'veloxmail.com.br', 'ig.com.br'
  ];
  
  const domain = email.split('@')[1]?.toLowerCase();
  return validDomains.includes(domain);
}

// CEP validation with API call
export async function validateCEP(cep: string): Promise<{ valid: boolean; data?: any; error?: string }> {
  cep = cep.replace(/[^\d]/g, '');
  
  if (cep.length !== 8) {
    return { valid: false, error: 'CEP deve ter 8 dígitos' };
  }
  
  try {
    // Use dynamic import for fetch in Node.js environment
    const fetch = global.fetch || (await import('node-fetch')).default;
    const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    
    if (!response.ok) {
      return { valid: false, error: 'Erro ao consultar CEP' };
    }
    
    const data = await response.json();
    
    if (data.erro) {
      return { valid: false, error: 'CEP não encontrado' };
    }
    
    return { 
      valid: true, 
      data: {
        cep: data.cep,
        logradouro: data.logradouro,
        bairro: data.bairro,
        localidade: data.localidade,
        uf: data.uf
      }
    };
  } catch (error) {
    return { valid: false, error: 'Erro ao validar CEP' };
  }
}

// Phone validation (Brazilian format)
export function validatePhone(phone: string): boolean {
  phone = phone.replace(/[^\d]/g, '');
  
  // Mobile: 11 digits (11NNNNNNNNN) or landline: 10 digits (11NNNNNNNN)
  if (phone.length !== 10 && phone.length !== 11) return false;
  
  // Check if starts with valid area code (11-99)
  const areaCode = parseInt(phone.substring(0, 2));
  if (areaCode < 11 || areaCode > 99) return false;
  
  // For mobile phones (11 digits), third digit should be 9
  if (phone.length === 11 && phone[2] !== '9') return false;
  
  return true;
}

// Validate all user data
export async function validateUserData(userData: any): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  
  // Validate CPF
  if (!validateCPF(userData.cpf)) {
    errors.push('CPF inválido');
  }
  
  // Validate email
  if (!validateEmail(userData.email)) {
    errors.push('Email inválido ou de domínio não permitido');
  }
  
  // Validate phone
  if (!validatePhone(userData.telefone)) {
    errors.push('Telefone inválido. Use formato brasileiro: (11) 99999-9999');
  }
  
  // Validate CEP
  const cepValidation = await validateCEP(userData.cep);
  if (!cepValidation.valid) {
    errors.push(cepValidation.error || 'CEP inválido');
  }
  
  return { valid: errors.length === 0, errors };
}