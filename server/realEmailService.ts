import nodemailer from 'nodemailer';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface RealEmailService {
  sendVerificationEmail(to: string, code: string): Promise<boolean>;
  getDeliveryLogs(): EmailLog[];
}

export interface EmailLog {
  to: string;
  subject: string;
  code: string;
  timestamp: Date;
  success: boolean;
  errorMessage?: string;
  messageId?: string;
}

class InvestProRealEmailService implements RealEmailService {
  private transporter: any;
  private logPath: string;
  private isConfigured: boolean = false;

  constructor() {
    this.logPath = join(process.cwd(), 'server', 'real-email-logs.json');
    this.ensureLogFileExists();
    this.setupTransporter();
  }

  private ensureLogFileExists(): void {
    if (!existsSync(this.logPath)) {
      writeFileSync(this.logPath, JSON.stringify([], null, 2));
    }
  }

  private setupTransporter(): void {
    try {
      // Configuração para Gmail e outros provedores SMTP gratuitos
      this.transporter = nodemailer.createTransporter({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: {
          user: process.env.EMAIL_USER || 'invistapro_group@outlook.com',
          pass: process.env.EMAIL_PASS || 'sua_senha_de_app_aqui'
        },
        tls: {
          rejectUnauthorized: false
        }
      });

      this.isConfigured = true;
      console.log('📧 Serviço de email real configurado (Gmail SMTP)');
    } catch (error) {
      console.log('⚠️ Erro ao configurar email real, usando modo de desenvolvimento');
      this.isConfigured = false;
    }
  }

  async sendVerificationEmail(to: string, code: string): Promise<boolean> {
    if (!this.isConfigured) {
      console.log('📧 Email real não configurado, enviando via sistema interno');
      return false;
    }

    try {
      const mailOptions = {
        from: '"InvestPro Platform" <invistapro_group@outlook.com>',
        to: to,
        subject: 'Código de Verificação InvestPro',
        html: this.generateEmailHTML(code),
        text: `Seu código de verificação InvestPro é: ${code}. Este código expira em 10 minutos.`
      };

      const info = await this.transporter.sendMail(mailOptions);
      
      // Log da entrega
      this.logDelivery(to, code, true, info.messageId);
      
      console.log('\n' + '='.repeat(70));
      console.log('📧 EMAIL REAL ENVIADO VIA GMAIL SMTP');
      console.log('='.repeat(70));
      console.log(`📨 Para: ${to}`);
      console.log(`🔐 Código: ${code}`);
      console.log(`✅ Status: ENVIADO PARA O EMAIL REAL`);
      console.log(`🆔 Message ID: ${info.messageId}`);
      console.log(`⏰ Horário: ${new Date().toLocaleString('pt-BR')}`);
      console.log('='.repeat(70));
      console.log('🎉 O usuário receberá o email no Gmail dele!');
      console.log('='.repeat(70) + '\n');

      return true;
    } catch (error) {
      console.error('Erro ao enviar email real:', error);
      this.logDelivery(to, code, false, undefined, error.message);
      return false;
    }
  }

  private generateEmailHTML(code: string): string {
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
            <p style="color: #666; margin: 5px 0; font-size: 16px;">Plataforma Profissional de Investimentos</p>
        </div>
        
        <!-- Content -->
        <div style="text-align: center;">
            <h2 style="color: #1e40af; margin-bottom: 20px;">Verificação de Email</h2>
            <p style="color: #374151; font-size: 16px; margin-bottom: 25px;">
                Bem-vindo à InvestPro! Para completar seu cadastro, utilize o código abaixo:
            </p>
            
            <div style="font-size: 36px; font-weight: bold; color: #1e40af; background: #f8fafc; padding: 20px; border-radius: 8px; letter-spacing: 8px; margin: 20px 0; border: 2px solid #e5e7eb;">
                ${code}
            </div>
            
            <p style="color: #6b7280; font-size: 14px; margin-top: 25px;">
                Este código expira em 10 minutos por motivos de segurança.
            </p>
        </div>
        
        <!-- Security Info -->
        <div style="background: #f0f9ff; padding: 20px; border-radius: 8px; margin-top: 30px; border-left: 4px solid #1e40af;">
            <h3 style="color: #1e40af; margin: 0 0 10px 0; font-size: 16px;">🔒 Segurança</h3>
            <p style="color: #475569; font-size: 14px; margin: 0;">
                Se você não solicitou este código, ignore este email. Nunca compartilhe seus códigos de verificação.
            </p>
        </div>
        
        <!-- Footer -->
        <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 0;">
                © 2025 InvestPro - Plataforma Segura de Investimentos
            </p>
            <p style="color: #9ca3af; font-size: 12px; margin: 5px 0 0 0;">
                Este é um email automático, não responda a esta mensagem.
            </p>
        </div>
    </div>
</body>
</html>
    `;
  }

  private logDelivery(to: string, code: string, success: boolean, messageId?: string, errorMessage?: string): void {
    try {
      const logs = this.getDeliveryLogs();
      const newLog: EmailLog = {
        to,
        subject: 'Código de Verificação InvestPro',
        code,
        timestamp: new Date(),
        success,
        messageId,
        errorMessage
      };
      
      logs.push(newLog);
      writeFileSync(this.logPath, JSON.stringify(logs, null, 2));
    } catch (error) {
      console.error('Erro ao salvar log de email:', error);
    }
  }

  getDeliveryLogs(): EmailLog[] {
    try {
      const data = readFileSync(this.logPath, 'utf8');
      const logs = JSON.parse(data);
      return logs.map((log: any) => ({
        ...log,
        timestamp: new Date(log.timestamp)
      }));
    } catch (error) {
      return [];
    }
  }
}

export const realEmailService = new InvestProRealEmailService();