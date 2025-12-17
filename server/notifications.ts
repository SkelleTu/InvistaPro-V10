// Email verification service - Free internal solution
import { emailService } from './emailService';

export interface NotificationService {
  sendVerificationCode(contact: string, code: string, type: 'email' | 'phone'): Promise<boolean>;
  getLastCodeForDev?(contact: string): string | null;
}

class MockNotificationService implements NotificationService {
  private lastCodes: Map<string, string> = new Map();

  async sendVerificationCode(contact: string, code: string, type: 'email' | 'phone'): Promise<boolean> {
    // Store the code for development
    this.lastCodes.set(contact, code);
    
    if (type === 'email') {
      console.log(`📧 Email para ${contact}: Código de verificação: ${code}`);
      console.log(`🔐 Use este código para verificar seu email no app`);
    } else {
      console.log(`📱 SMS para ${contact}: Código de verificação: ${code}`);
      console.log(`🔐 Use este código para verificar seu telefone no app`);
    }
    
    // Always return true in development
    return true;
  }

  getLastCodeForDev(contact: string): string | null {
    return this.lastCodes.get(contact) || null;
  }
}

class InternalEmailService implements NotificationService {
  async sendVerificationCode(contact: string, code: string, type: 'email' | 'phone'): Promise<boolean> {
    if (type === 'phone') {
      console.log(`📱 SMS não configurado, enviando email para verificação`);
      return false;
    }

    try {
      const success = await emailService.sendVerificationCode(contact, code);
      return success;
    } catch (error) {
      console.error('Erro ao enviar email:', error);
      return false;
    }
  }
}

// Factory function to create notification service based on environment
export function createNotificationService(): NotificationService {
  // Usar sempre o serviço interno de email (gratuito)
  return new InternalEmailService();
}

export const notificationService = createNotificationService();