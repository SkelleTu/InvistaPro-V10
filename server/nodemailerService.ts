import nodemailer from 'nodemailer';

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

class NodemailerService {
  private transporter: ReturnType<typeof nodemailer.createTransport>;

  constructor() {
    // Configurar transporter usando variáveis de ambiente para segurança
    const emailUser = process.env.GMAIL_USER || process.env.EMAIL_USER;
    const emailPass = process.env.GMAIL_PASSWORD || process.env.EMAIL_PASSWORD;
    
    if (!emailUser || !emailPass) {
      console.log('⚠️ Credenciais de email não configuradas - modo simulação');
      console.log('📧 Configure GMAIL_USER e GMAIL_PASSWORD para emails reais');
    }
    
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: emailUser || 'demo@example.com',
        pass: emailPass || 'demo-password'
      }
    });
  }

  async sendEmail(options: EmailOptions): Promise<boolean> {
    try {
      console.log('\n🚀 ENVIANDO EMAIL VIA NODEMAILER (Gmail SMTP)');
      console.log('📧 Para:', options.to);
      console.log('📋 Assunto:', options.subject);

      const emailUser = process.env.GMAIL_USER || process.env.EMAIL_USER || 'noreply@investpro.local';
      
      const info = await this.transporter.sendMail({
        from: `"InvistaPRO" <${emailUser}>`,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text || 'Email em HTML não suportado.'
      });

      console.log('✅ Email enviado com sucesso via Gmail!');
      console.log('🆔 Message ID:', info.messageId);
      console.log('📨 Response:', info.response);
      
      return true;
    } catch (error: any) {
      console.error('❌ Erro no envio via nodemailer:', error);
      console.error('🔍 Detalhes:', error.message);
      return false;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const emailUser = process.env.GMAIL_USER || process.env.EMAIL_USER;
      if (!emailUser) {
        console.log('⚠️ Pular teste - credenciais não configuradas');
        return false;
      }
      
      console.log('\n🧪 TESTANDO CONEXÃO NODEMAILER...');
      await this.transporter.verify();
      console.log('✅ Conexão Gmail SMTP verificada com sucesso!');
      return true;
    } catch (error: any) {
      console.error('❌ Falha na verificação Gmail SMTP:', error instanceof Error ? error.message : String(error));
      return false;
    }
  }
}

export const nodemailerService = new NodemailerService();

// Função para recuperação de senha com Nodemailer
export async function sendPasswordResetWithNodemailer(
  to: string, 
  resetUrl: string
): Promise<boolean> {
  const emailBody = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Recuperação de Senha - InvistaPRO</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                margin: 0;
                padding: 0;
                background-color: #0a0a0a;
                color: #ffffff;
            }
            .container {
                max-width: 600px;
                margin: 0 auto;
                background: linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%);
                border: 1px solid rgba(255, 255, 255, 0.1);
            }
            .header {
                background: linear-gradient(135deg, #1a1a1a 0%, #0a0a0a 100%);
                padding: 40px 20px;
                text-align: center;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            }
            .logo {
                width: 60px;
                height: 60px;
                background: #fbbf24;
                border-radius: 15px;
                margin: 0 auto 20px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 24px;
                font-weight: bold;
                color: #000;
            }
            .brand-title {
                font-size: 28px;
                font-weight: bold;
                color: #ffffff;
                margin-bottom: 8px;
            }
            .brand-subtitle {
                font-size: 14px;
                color: #fbbf24;
                letter-spacing: 1px;
                text-transform: uppercase;
            }
            .content {
                padding: 40px 20px;
            }
            .main-title {
                font-size: 24px;
                font-weight: bold;
                color: #ffffff;
                text-align: center;
                margin-bottom: 16px;
            }
            .main-text {
                font-size: 16px;
                color: #a1a1aa;
                text-align: center;
                margin-bottom: 30px;
                line-height: 1.6;
            }
            .info-card {
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 12px;
                padding: 20px;
                margin: 20px 0;
            }
            .info-row {
                display: flex;
                justify-content: space-between;
                padding: 8px 0;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            }
            .info-row:last-child {
                border-bottom: none;
            }
            .info-label {
                color: #71717a;
                font-size: 14px;
            }
            .info-value {
                color: #ffffff;
                font-size: 14px;
                font-weight: 600;
            }
            .cta-button {
                display: inline-block;
                background: linear-gradient(135deg, #059669 0%, #10b981 100%);
                color: #ffffff !important;
                text-decoration: none;
                padding: 16px 32px;
                border-radius: 8px;
                font-weight: bold;
                font-size: 16px;
                text-align: center;
                margin: 20px 0;
            }
            .footer {
                background: #000000;
                padding: 30px 20px;
                text-align: center;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
                font-size: 12px;
                color: #71717a;
            }
            .warning {
                background: rgba(245, 158, 11, 0.1);
                border: 1px solid rgba(245, 158, 11, 0.2);
                border-radius: 8px;
                padding: 16px;
                margin: 20px 0;
                text-align: center;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="logo">IP</div>
                <h1 class="brand-title">InvistaPRO</h1>
                <p class="brand-subtitle">Invista com Risco Zero</p>
            </div>
            
            <div class="content">
                <h2 class="main-title">Recuperação de Senha</h2>
                <p class="main-text">
                    Recebemos uma solicitação para redefinir a senha da sua conta.<br>
                    Para sua segurança, confirme sua identidade clicando no botão abaixo.
                </p>
                
                <div class="info-card">
                    <div class="info-row">
                        <span class="info-label">Data</span>
                        <span class="info-value">${new Date().toLocaleDateString('pt-BR')}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Horário</span>
                        <span class="info-value">${new Date().toLocaleTimeString('pt-BR')}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Conta</span>
                        <span class="info-value">${to}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Referência</span>
                        <span class="info-value">INV${Date.now().toString().slice(-8)}</span>
                    </div>
                </div>
                
                <div style="text-align: center;">
                    <a href="${resetUrl}" class="cta-button">
                        Redefinir Senha
                    </a>
                    <p style="color: #71717a; font-size: 12px; margin-top: 12px;">
                        Link válido por 60 minutos
                    </p>
                </div>
                
                <div class="warning">
                    <p style="color: #f59e0b; font-weight: 600; margin-bottom: 8px;">⚠️ Aviso de Segurança</p>
                    <p style="color: #a1a1aa; font-size: 14px;">
                        Se você não solicitou esta alteração, ignore este email.<br>
                        Sua conta permanece segura e nenhuma ação é necessária.
                    </p>
                </div>
                
                <div style="margin-top: 30px;">
                    <p style="color: #a1a1aa; font-size: 14px; margin-bottom: 4px;">Atenciosamente,</p>
                    <p style="color: #ffffff; font-size: 14px; font-weight: 600;">Equipe InvistaPRO</p>
                </div>
            </div>
            
            <div class="footer">
                <strong>InvistaPRO</strong> - Tecnologia Financeira<br>
                Esta é uma mensagem automática de segurança. Não responda a este email.
            </div>
        </div>
    </body>
    </html>
  `;

  const textVersion = `
INVESTPRO - RECUPERAÇÃO DE SENHA

Prezado(a) Cliente,

Recebemos uma solicitação para redefinição da senha de acesso à sua conta na plataforma InvestPro.

DADOS DA SOLICITAÇÃO:
- Data/Hora: ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}
- Conta: ${to}
- Referência: INV${Date.now().toString().slice(-8)}

Para prosseguir com a redefinição, acesse o link abaixo (válido por 60 minutos):
${resetUrl}

IMPORTANTE: Caso não tenha solicitado esta operação, desconsidere esta mensagem.

Atenciosamente,
Equipe de Segurança Digital
InvestPro

---
InvestPro - Invista com Risco Zero
Esta é uma mensagem automática.
  `;

  return nodemailerService.sendEmail({
    to,
    subject: 'InvistaPRO - Recuperação de Senha',
    html: emailBody,
    text: textVersion
  });
}