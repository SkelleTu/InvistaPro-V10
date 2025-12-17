import nodemailer from 'nodemailer';
// import { internalEmailService } from './internalEmailService'; // Sistema removido
import { autonomousEmailService } from './autonomousEmailService';
import { realEmailService } from './realEmailService';

export interface EmailService {
  sendVerificationCode(email: string, code: string): Promise<boolean>;
}

class NodemailerEmailService implements EmailService {
  private transporter: any;

  constructor() {
    // Configuração flexível - suporta Gmail, Outlook, Yahoo, etc
    const emailUser = process.env.EMAIL_USER;
    const emailPass = process.env.EMAIL_PASS;
    
    // Detecta automaticamente o provedor baseado no email
    let service = 'gmail';
    if (emailUser?.includes('outlook') || emailUser?.includes('hotmail')) {
      service = 'outlook';
    } else if (emailUser?.includes('yahoo')) {
      service = 'yahoo';
    } else if (emailUser?.includes('uol')) {
      service = 'UOL';
    }
    
    this.transporter = nodemailer.createTransport({
      service: service,
      auth: {
        user: emailUser || 'invistapro_group@outlook.com',
        pass: emailPass || 'sua_senha_app'
      }
    });
  }

  async sendVerificationCode(email: string, code: string): Promise<boolean> {
    try {
      const mailOptions = {
        from: `"InvestPro Platform" <${process.env.EMAIL_USER || 'invistapro_group@outlook.com'}>`,
        to: email,
        subject: 'Código de Verificação InvestPro',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #1e40af; margin: 0;">InvestPro</h1>
              <p style="color: #666; margin: 5px 0;">Plataforma Profissional de Investimentos</p>
            </div>
            
            <div style="background: #f8fafc; padding: 30px; border-radius: 10px; text-align: center;">
              <h2 style="color: #1e40af; margin-bottom: 20px;">Verificação de Email</h2>
              <p style="color: #374151; font-size: 16px; margin-bottom: 25px;">
                Seu código de verificação é:
              </p>
              
              <div style="font-size: 36px; font-weight: bold; color: #1e40af; background: white; padding: 20px; border-radius: 8px; letter-spacing: 8px; margin: 20px 0; border: 2px solid #e5e7eb;">
                ${code}
              </div>
              
              <p style="color: #6b7280; font-size: 14px; margin-top: 25px;">
                Este código expira em 10 minutos por motivos de segurança.
              </p>
            </div>
            
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="color: #9ca3af; font-size: 12px; margin: 0;">
                Se você não solicitou este código, ignore este email.
              </p>
              <p style="color: #9ca3af; font-size: 12px; margin: 5px 0 0 0;">
                © 2025 InvestPro - Plataforma Segura de Investimentos
              </p>
            </div>
          </div>
        `
      };

      await this.transporter.sendMail(mailOptions);
      console.log(`📧 Email de verificação enviado para ${email}`);
      return true;
    } catch (error) {
      console.error('Erro ao enviar email:', error);
      return false;
    }
  }
}

// Serviço interno do Replit - REMOVIDO (sistema desnecessário)
// class ReplitInternalEmailService implements EmailService {
//   async sendVerificationCode(email: string, code: string): Promise<boolean> {
//     return await internalEmailService.sendVerificationCode(email, code);
//   }
// }

// Serviço Autônomo InvestPro - Sistema 100% independente
class InvestProAutonomousEmailService implements EmailService {
  async sendVerificationCode(email: string, code: string): Promise<boolean> {
    const htmlBody = this.generateVerificationEmailHTML(code);
    const result = await autonomousEmailService.sendEmail(
      email,
      'Código de Verificação InvestPro',
      htmlBody
    );
    return result.success;
  }

  private generateVerificationEmailHTML(code: string): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Verificação de Email - InvestPro</title>
</head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
    <div style="background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
        <!-- Header -->
        <div style="text-align: center; margin-bottom: 30px; border-bottom: 2px solid #1e40af; padding-bottom: 20px;">
            <h1 style="color: #1e40af; margin: 0; font-size: 28px;">🏦 InvestPro</h1>
            <p style="color: #666; margin: 5px 0; font-size: 16px;">Sistema Autônomo de Verificação</p>
        </div>
        
        <!-- Content -->
        <div style="text-align: center;">
            <h2 style="color: #1e40af; margin-bottom: 20px;">Verificação de Email</h2>
            <p style="color: #374151; font-size: 16px; margin-bottom: 25px;">
                Seu código de verificação é:
            </p>
            
            <div style="font-size: 36px; font-weight: bold; color: #1e40af; background: #f8fafc; padding: 20px; border-radius: 8px; letter-spacing: 8px; margin: 20px 0; border: 2px solid #e5e7eb;">
                \${code}
            </div>
        </div>
    </div>
</body>
</html>
    `;
  }
}

// Serviço de Email Real - Envia para Gmail/Outlook real do usuário
class InvestProRealEmailService implements EmailService {
  async sendVerificationCode(email: string, code: string): Promise<boolean> {
    return await realEmailService.sendVerificationEmail(email, code);
  }

  private generateVerificationEmailHTML(code: string): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Verificação de Email - InvestPro</title>
</head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
    <div style="background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
        <!-- Header -->
        <div style="text-align: center; margin-bottom: 30px; border-bottom: 2px solid #1e40af; padding-bottom: 20px;">
            <h1 style="color: #1e40af; margin: 0; font-size: 28px;">🏦 InvestPro</h1>
            <p style="color: #666; margin: 5px 0; font-size: 16px;">Sistema Autônomo de Verificação</p>
        </div>
        
        <!-- Content -->
        <div style="text-align: center;">
            <h2 style="color: #1e40af; margin-bottom: 20px;">Verificação de Email</h2>
            <p style="color: #374151; font-size: 16px; margin-bottom: 25px;">
                Seu código de verificação é:
            </p>
            
            <div style="font-size: 36px; font-weight: bold; color: #1e40af; background: #f8fafc; padding: 20px; border-radius: 8px; letter-spacing: 8px; margin: 20px 0; border: 2px solid #e5e7eb;">
                ${code}
            </div>
            
            <p style="color: #6b7280; font-size: 14px; margin-top: 25px;">
                Este código expira em 10 minutos por motivos de segurança.
            </p>
        </div>
        
        <!-- System Info -->
        <div style="background: #f0f9ff; padding: 20px; border-radius: 8px; margin-top: 30px; border-left: 4px solid #1e40af;">
            <h3 style="color: #1e40af; margin: 0 0 10px 0; font-size: 16px;">🔒 Sistema Seguro</h3>
            <p style="color: #475569; font-size: 14px; margin: 0;">
                Este email foi enviado pelo sistema autônomo InvestPro, sem dependência de provedores externos.
                Sua privacidade e segurança são nossa prioridade.
            </p>
        </div>
        
        <!-- Footer -->
        <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 0;">
                Se você não solicitou este código, ignore este email.
            </p>
            <p style="color: #9ca3af; font-size: 12px; margin: 5px 0 0 0;">
                © 2025 InvestPro - Sistema Autônomo de Email
            </p>
        </div>
    </div>
</body>
</html>
    `;
  }
}

// Factory para criar o serviço apropriado
export function createEmailService(): EmailService {
  // Tentar usar email real primeiro, depois fallback para sistema autônomo
  console.log('📧 Tentando enviar emails reais para Gmail/Outlook dos usuários');
  return new InvestProRealEmailService();
}

export const emailService = createEmailService();

// Email oficial verificado no SendGrid: invistapro_group@outlook.com