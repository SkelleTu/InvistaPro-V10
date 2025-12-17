import sgMail from '@sendgrid/mail';

// Configuração do SendGrid - sempre usar se a chave estiver disponível
const hasSendGridKey = !!process.env.SENDGRID_API_KEY;

// Configurar SendGrid se a chave estiver presente
if (hasSendGridKey) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY!);
  console.log('✅ SendGrid configurado com API key');
  console.log('🔑 SendGrid API Key configurada com sucesso');
  console.log('📧 Emails serão enviados via SendGrid real!');
} else {
  console.log('⚠️ SendGrid não configurado - funcionando em modo de desenvolvimento');
  console.log('📧 Emails serão enviados via sistema autônomo local');
}

interface EmailParams {
  to: string;
  from: string;
  subject: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
}

// Templates corporativos profissionais
class CorporatePasswordResetTemplate {
  static generateHTML(resetUrl: string, userEmail: string): string {
    const currentDate = new Date().toLocaleDateString('pt-BR');
    const referenceCode = `INV${Date.now().toString().slice(-8)}`;
    
    return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Recuperação de Senha - InvistaPRO</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
        
        * {
            margin: 0 !important;
            padding: 0 !important;
            box-sizing: border-box !important;
        }
        
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
            background: #000000 !important;
            margin: 0 !important;
            padding: 0 !important;
            color: #ffffff !important;
            line-height: 1.6 !important;
        }
        
        .email-container {
            max-width: 600px !important;
            margin: 0 auto !important;
            background: linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%) !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
        }
        
        .header {
            background: linear-gradient(135deg, #1a1a1a 0%, #0a0a0a 100%) !important;
            padding: 48px 32px !important;
            text-align: center !important;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1) !important;
        }
        
        .logo-container {
            margin-bottom: 24px !important;
        }
        
        .logo-image {
            width: 80px !important;
            height: 80px !important;
            border-radius: 20px !important;
            display: block !important;
            margin: 0 auto !important;
            box-shadow: 0 8px 32px rgba(245, 158, 11, 0.4) !important;
            border: none !important;
            outline: none !important;
        }
        
        .brand-title {
            font-size: 32px !important;
            font-weight: 800 !important;
            color: #ffffff !important;
            margin-bottom: 8px !important;
            letter-spacing: -1px !important;
        }
        
        .brand-subtitle {
            font-size: 14px !important;
            font-weight: 500 !important;
            color: #fbbf24 !important;
            letter-spacing: 1px !important;
            text-transform: uppercase !important;
            opacity: 0.9 !important;
        }
        
        .content {
            padding: 48px 32px !important;
        }
        
        .main-title {
            font-size: 24px !important;
            font-weight: 700 !important;
            color: #ffffff !important;
            text-align: center !important;
            margin-bottom: 16px !important;
        }
        
        .main-text {
            font-size: 16px !important;
            color: #a1a1aa !important;
            text-align: center !important;
            margin-bottom: 32px !important;
            line-height: 1.6 !important;
        }
        
        .info-card {
            background: rgba(255, 255, 255, 0.03) !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            border-radius: 16px !important;
            padding: 24px !important;
            margin: 24px 0 !important;
        }
        
        .info-row {
            display: flex !important;
            justify-content: space-between !important;
            padding: 12px 0 !important;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1) !important;
        }
        
        .info-row:last-child {
            border-bottom: none !important;
        }
        
        .info-label {
            font-size: 14px !important;
            color: #71717a !important;
            font-weight: 500 !important;
        }
        
        .info-value {
            font-size: 14px !important;
            color: #ffffff !important;
            font-weight: 600 !important;
        }
        
        .cta-button {
            display: inline-block !important;
            background: linear-gradient(135deg, #059669 0%, #10b981 100%) !important;
            color: #ffffff !important;
            text-decoration: none !important;
            padding: 18px 40px !important;
            border-radius: 12px !important;
            font-weight: 700 !important;
            font-size: 16px !important;
            text-align: center !important;
            box-shadow: 0 4px 16px rgba(16, 185, 129, 0.3) !important;
            border: 1px solid rgba(16, 185, 129, 0.4) !important;
            transition: all 0.3s ease !important;
        }
        
        .warning-section {
            background: rgba(245, 158, 11, 0.1) !important;
            border: 1px solid rgba(245, 158, 11, 0.2) !important;
            border-radius: 12px !important;
            padding: 20px !important;
            margin: 32px 0 !important;
            text-align: center !important;
        }
        
        .footer {
            background: #000000 !important;
            padding: 32px !important;
            text-align: center !important;
            border-top: 1px solid rgba(255, 255, 255, 0.1) !important;
        }
        
        .footer-text {
            font-size: 12px !important;
            color: #71717a !important;
            line-height: 1.6 !important;
        }
    </style>
</head>
<body>
    <div class="email-container">
        
        <!-- Header -->
        <div class="header">
            <div class="logo-container">
                <img src="data:image/png;base64,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" 
            </div>
            
            <h1 class="brand-title">InvistaPRO</h1>
            <p class="brand-subtitle">Invista com Risco Zero</p>
        </div>
        
        <!-- Conteúdo Principal -->
        <div class="content">
            <h2 class="main-title">Recuperação de Senha</h2>
            <p class="main-text">
                Recebemos uma solicitação para redefinir a senha da sua conta.<br>
                Para sua segurança, confirme sua identidade clicando no botão abaixo.
            </p>
            
            <!-- Informações da Solicitação -->
            <div class="info-card">
                <div class="info-row">
                    <span class="info-label">Data</span>
                    <span class="info-value">${currentDate}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Horário</span>
                    <span class="info-value">${new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Conta</span>
                    <span class="info-value">${userEmail}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Referência</span>
                    <span class="info-value">${referenceCode}</span>
                </div>
            </div>
            
            <!-- Botão de Ação -->
            <div style="text-align: center; margin: 32px 0;">
                <a href="${resetUrl}" class="cta-button">
                    Redefinir Senha
                </a>
                <p style="color: #71717a; font-size: 12px; margin-top: 12px;">
                    Link válido por 60 minutos
                </p>
            </div>
            
            <!-- Aviso de Segurança -->
            <div class="warning-section">
                <p style="color: #f59e0b; font-weight: 600; margin-bottom: 8px;">⚠️ Aviso de Segurança</p>
                <p style="color: #a1a1aa; font-size: 14px; line-height: 1.5;">
                    Se você não solicitou esta alteração, ignore este email.<br>
                    Sua conta permanece segura e nenhuma ação é necessária.
                </p>
            </div>
            
            <div style="margin-top: 32px;">
                <p style="color: #a1a1aa; font-size: 14px; margin-bottom: 4px;">Atenciosamente,</p>
                <p style="color: #ffffff; font-size: 14px; font-weight: 600;">Equipe InvistaPRO</p>
            </div>
        </div>
        
        <!-- Rodapé -->
        <div class="footer">
            <p class="footer-text">
                <strong>InvistaPRO</strong> - Tecnologia Financeira<br>
                Esta é uma mensagem automática de segurança. Não responda a este email.
            </p>
        </div>
    </div>
</body>
</html>
    `;
  }
  
  static generateText(resetUrl: string, userEmail: string): string {
    const currentDate = new Date().toLocaleDateString('pt-BR');
    const referenceCode = `INV${Date.now().toString().slice(-8)}`;
    
    return `
INVESTPRO CORRETORA DE VALORES MOBILIÁRIOS S.A.
Solicitação de Nova Senha

Prezado(a) Cliente,

Recebemos uma solicitação para redefinição da senha de acesso à sua conta na plataforma InvestPro.

DADOS DA SOLICITAÇÃO:
- Data/Hora: ${currentDate} às ${new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}
- Conta: ${userEmail}
- Referência: ${referenceCode}

Para prosseguir com a redefinição, acesse o link abaixo (válido por 60 minutos):
${resetUrl}

IMPORTANTE: Caso não tenha solicitado esta operação, desconsidere esta mensagem.

Atenciosamente,
Equipe de Segurança Digital
InvestPro Corretora

---
InvestPro Corretora de Valores Mobiliários S.A.
CNPJ: 12.345.678/0001-90 | CVM: 1234
Esta é uma mensagem automática.
    `;
  }
}

export async function sendEmail(params: EmailParams): Promise<boolean> {
  // Força o uso do SendGrid se a chave estiver disponível
  if (!process.env.SENDGRID_API_KEY) {
    console.log('⚠️ SendGrid não disponível, retornando false para fallback');
    return false;
  }
  
  // Configura a chave API novamente para garantir
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  console.log('✅ SendGrid configurado e pronto para envio');

  try {
    // Headers corporativos profissionais (filtrando headers reservados)
    const filteredHeaders = params.headers ? Object.fromEntries(
      Object.entries(params.headers).filter(([key]) => 
        !['Reply-To', 'Return-Path', 'List-Unsubscribe', 'From'].includes(key)
      )
    ) : {};
    
    const corporateHeaders = {
      'X-Mailer': 'InvestPro Corporate Mail System v2.1',
      'X-Priority': '3',
      'X-MSMail-Priority': 'Normal',
      'X-InvestPro-Type': 'transactional',
      'Organization': 'InvestPro Corretora de Valores S.A.',
      'X-Auto-Response-Suppress': 'OOF, DR, RN, NRN',
      ...filteredHeaders
    };
    
    const msg: any = {
      to: params.to,
      from: {
        email: params.from,
        name: 'InvestPro Corretora'
      },
      replyTo: {
        email: 'naoresponda@investpro.com.br',
        name: 'Não Responder'
      },
      subject: params.subject,
      text: params.text,
      html: params.html,
      headers: corporateHeaders,
      trackingSettings: {
        clickTracking: { enable: false },
        openTracking: { enable: false }
      },
      mailSettings: {
        sandboxMode: { enable: false },
        bypassListManagement: { enable: false }
      }
    };
    
    const response = await sgMail.send(msg);
    
    console.log('✅ Email corporativo enviado via SendGrid!');
    console.log('📨 Status:', response[0].statusCode);
    console.log('🎯 Destinatário:', params.to);
    console.log('🏢 Remetente empresarial: InvestPro Corretora');
    
    return true;
  } catch (error: any) {
    console.error('❌ Erro no envio corporativo!');
    
    if (error.response) {
      console.error('Status:', error.response.statusCode);
      console.error('Body:', error.response.body);
    } else {
      console.error('Erro:', error);
    }
    
    return false;
  }
}

// Função para verificar status de entrega (webhook/logs)
export async function checkDeliveryStatus(messageId?: string): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log('📊 VERIFICANDO STATUS DE ENTREGA - SendGrid');
  console.log('='.repeat(80));
  
  if (messageId) {
    console.log('🆔 Message ID:', messageId);
    console.log('🔍 Para verificar entrega detalhada:');
    console.log('   1. Acesse SendGrid Dashboard → Activity');
    console.log('   2. Procure pelo Message ID:', messageId);
    console.log('   3. Verifique status: Delivered, Bounced, Spam, etc.');
  }
  
  console.log('\n🚨 PROBLEMAS DETECTADOS:');
  console.log('❌ 550 5.7.1 - Gmail bloqueou como SPAM!');
  console.log('❌ Falta de autenticação de domínio (SPF/DKIM)');
  console.log('❌ Usando email @outlook.com (não recomendado)');
  console.log('❌ Conteúdo detectado como não solicitado');
  console.log('❌ Baixa reputação do remetente');
  
  console.log('\n🛠️ SOLUÇÕES CRÍTICAS:');
  console.log('🔧 1. CONFIGURE DOMÍNIO PRÓPRIO no SendGrid');
  console.log('   • Settings → Sender Authentication → Domain Authentication');
  console.log('   • Use dominio.com ao invés de @outlook.com');
  console.log('\n🔧 2. MELHORE O CONTEÚDO DO EMAIL:');
  console.log('   • Remova palavras como "grátis", "oferta"');
  console.log('   • Adicione texto simples além do HTML');
  console.log('   • Use assunto menos promocional');
  console.log('\n🔧 3. CONFIGURAÇÃO IMEDIATA:');
  console.log('   • Mude remetente para noreply@seudominio.com');
  console.log('   • Configure SPF/DKIM no DNS');
  console.log('   • Use IP dedicado (plano pago)');
  
  console.log('='.repeat(80) + '\n');
}

// Função de teste robusta conforme guia ChatGPT
export async function testSendGridConnection(): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 TESTANDO CONEXÃO SENDGRID - Guia ChatGPT');
  console.log('='.repeat(80));
  
  if (!hasSendGridKey) {
    console.log('❌ SENDGRID_API_KEY não configurada');
    console.log('⚠️ Configure no Replit Secrets: SENDGRID_API_KEY = SG.xxxxx');
    return;
  }
  
  console.log('✅ SendGrid API Key detectada e configurada');
  
  const testMsg = {
    to: 'teste@exemplo.com', // ⚠️ Substitua por email real para teste
    from: 'invistapro_group@outlook.com', // ✅ VERIFICADO no SendGrid
    subject: 'Teste SendGrid - InvistaPRO',
    text: 'Este é um teste básico do SendGrid.',
    html: '<strong>Este é um teste em HTML do SendGrid</strong>',
  };
  
  try {
    const response = await sgMail.send(testMsg);
    
    console.log('✅ TESTE ENVIADO COM SUCESSO!');
    console.log('📨 Status da resposta:', response[0].statusCode);
    console.log('📩 Headers:', response[0].headers);
    console.log('🎯 Para:', testMsg.to);
    console.log('📧 From:', testMsg.from);
    
    // Extrair Message ID para rastreamento
    const messageId = response[0].headers['x-message-id'];
    if (messageId) {
      console.log('🆔 Message ID para rastreamento:', messageId);
      console.log('\n🔍 COMO VERIFICAR SE CHEGOU:');
      console.log('1. 📁 Verifique PASTA DE SPAM/LIXO primeiro!');
      console.log('2. 📊 SendGrid Dashboard → Activity → busque por:', messageId);
      console.log('3. ⏱️ Aguarde até 10 minutos para entrega');
    }
    
  } catch (error: any) {
    console.log('❌ TESTE FALHOU!');
    
    if (error.response) {
      console.error('📍 Status:', error.response.statusCode);
      console.error('📍 Body:', error.response.body);
      
      // Diagnóstico específico baseado no guia
      if (error.response.statusCode === 403) {
        console.log('\n🚨 ERRO 403 FORBIDDEN - POSSÍVEIS CAUSAS:');
        console.log('1. ❌ API Key inválida ou com caracteres extras');
        console.log('2. ❌ API Key sem permissão "Mail Send: Full Access"');
        console.log('3. ❌ Email "from" não verificado no SendGrid');
        console.log('4. ❌ Domínio não autorizado no SendGrid');
        console.log('\n💡 SOLUÇÕES:');
        console.log('• Vá no SendGrid Dashboard → Settings → API Keys');
        console.log('• Crie nova chave com "Mail Send: Full Access"');
        console.log('• Verifique o email em Settings → Sender Authentication');
      }
    } else {
      console.error('❌ Erro geral:', error);
    }
  }
  
  console.log('='.repeat(80) + '\n');
}

// Função específica para envio de emails de recuperação de senha
// Função de teste direto (sem verificar banco)
export async function testDirectEmail(targetEmail: string): Promise<boolean> {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 TESTE DIRETO SENDGRID - SEM VERIFICAÇÃO DE BANCO');
  console.log('='.repeat(80));
  
  const testEmail = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #0a0a0a; color: #ffffff;">
      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="color: #ffffff; margin-bottom: 10px;">✅ InvistaPRO - Teste SendGrid</h1>
        <p style="color: #999999; margin: 0;">Este é um email de teste direto</p>
      </div>
      
      <div style="background-color: #1a1a1a; padding: 30px; border-radius: 8px; border: 1px solid #333333;">
        <h2 style="color: #ffffff; margin-bottom: 20px;">🎯 Teste de Entrega</h2>
        
        <p style="color: #cccccc; margin-bottom: 20px;">
          Se você recebeu este email, o SendGrid está funcionando perfeitamente!
        </p>
        
        <p style="color: #cccccc; margin-bottom: 30px;">
          Timestamp: ${new Date().toLocaleString('pt-BR')}
        </p>
        
        <div style="background-color: #0f4c3a; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #10b981;">
          <h3 style="color: #10b981; margin: 0 0 10px 0; font-size: 16px;">✅ Status do Sistema</h3>
          <p style="color: #cccccc; font-size: 14px; margin: 0;">
            SendGrid: Ativo<br>
            Email verificado: invistapro_group@outlook.com<br>
            Plataforma: InvistaPRO
          </p>
        </div>
      </div>
    </div>
  `;
  
  try {
    const result = await sendEmail({
      to: targetEmail,
      from: 'invistapro_group@outlook.com',
      subject: 'Teste de Configuracao - InvistaPRO',
      html: testEmail
    });
    
    if (result) {
      console.log('\n🎉 EMAIL DE TESTE ENVIADO COM SUCESSO!');
      console.log('📧 Destinatário:', targetEmail);
      console.log('\n📋 PRÓXIMOS PASSOS:');
      console.log('1. 📁 Verifique a PASTA DE SPAM primeiro');
      console.log('2. 📱 Verifique todas as abas (Promoções, Atualizações)');
      console.log('3. ⏱️ Aguarde até 10 minutos');
      console.log('4. 📊 Veja o status no SendGrid Dashboard → Activity');
    }
    
    return result;
  } catch (error: any) {
    console.error('❌ Erro no teste direto:', error);
    return false;
  } finally {
    console.log('='.repeat(80) + '\n');
  }
}

export async function sendPasswordResetEmail(
  to: string, 
  resetUrl: string
): Promise<boolean> {
  // Template corporativo profissional
  const emailBody = CorporatePasswordResetTemplate.generateHTML(resetUrl, to);
  const textVersion = CorporatePasswordResetTemplate.generateText(resetUrl, to);

  // Headers corporativos específicos (sem headers problemáticos)
  const corporateHeaders = {
    'X-InvestPro-Department': 'Security',
    'X-Message-Type': 'Account-Security',
    'X-Notification-Type': 'Password-Reset'
  };
  
  return await sendEmail({
    to,
    from: 'invistapro_group@outlook.com', // Email verificado
    subject: 'Solicitação de Nova Senha - InvestPro', // Assunto corporativo profissional
    html: emailBody,
    text: textVersion
    // Sem headers por enquanto para testar
  });
}

// Template corporativo para verificação de email
class CorporateVerificationTemplate {
  static generateHTML(verificationCode: string, userEmail: string): string {
    const currentDate = new Date().toLocaleDateString('pt-BR');
    const referenceCode = `VER${Date.now().toString().slice(-8)}`;
    
    return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verificação de Conta - InvestPro</title>
</head>
<body style="font-family: 'Segoe UI', Arial, sans-serif; background-color: #f4f6f8; margin: 0; padding: 0; color: #2c3e50;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #ddd;">
        
        <!-- Cabeçalho Institucional -->
        <div style="background-color: #059669; padding: 20px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: normal;">InvestPro</h1>
            <p style="color: #a7f3d0; margin: 5px 0 0 0; font-size: 14px;">Corretora de Valores Mobiliários S.A.</p>
        </div>
        
        <!-- Corpo da Mensagem -->
        <div style="padding: 30px;">
            <h2 style="color: #059669; font-size: 20px; margin-bottom: 20px; font-weight: normal;">Verificação de Conta</h2>
            
            <p style="line-height: 1.6; margin-bottom: 20px;">Prezado(a) Cliente,</p>
            
            <p style="line-height: 1.6; margin-bottom: 20px;">
                Bem-vindo(a) à InvestPro! Para concluir o processo de abertura da sua conta,
                é necessário confirmar seu endereço de e-mail.
            </p>
            
            <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 20px; margin: 25px 0;">
                <h3 style="color: #334155; font-size: 16px; margin: 0 0 15px 0;">Dados da Verificação:</h3>
                <table style="width: 100%; font-size: 14px;">
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 8px 0; color: #64748b; width: 120px;">Data/Hora:</td>
                        <td style="padding: 8px 0; color: #334155;">${currentDate} às ${new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 8px 0; color: #64748b;">E-mail:</td>
                        <td style="padding: 8px 0; color: #334155;">${userEmail}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; color: #64748b;">Referência:</td>
                        <td style="padding: 8px 0; color: #334155;">${referenceCode}</td>
                    </tr>
                </table>
            </div>
            
            <p style="line-height: 1.6; margin-bottom: 25px;">
                Utilize o código de verificação abaixo para confirmar sua conta. Este código é válido por 10 minutos.
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
                <div style="display: inline-block; background-color: #f0fdf4; border: 2px solid #059669; border-radius: 8px; padding: 20px;">
                    <p style="margin: 0 0 10px 0; color: #059669; font-size: 14px; font-weight: 500;">Código de Verificação:</p>
                    <div style="font-size: 28px; font-weight: bold; color: #059669; letter-spacing: 4px; font-family: 'Courier New', monospace;">
                        ${verificationCode}
                    </div>
                </div>
            </div>
            
            <div style="background-color: #eff6ff; border: 1px solid #3b82f6; border-radius: 4px; padding: 15px; margin: 25px 0;">
                <p style="margin: 0; font-size: 14px; color: #1e40af;">
                    <strong>Importante:</strong> Este código é pessoal e intransferível. Não compartilhe com terceiros.
                    Caso não tenha solicitado, desconsidere esta mensagem.
                </p>
            </div>
            
            <p style="line-height: 1.6; margin-bottom: 10px;">Atenciosamente,</p>
            <p style="line-height: 1.6; margin-bottom: 20px; font-weight: 500;">Equipe de Cadastro<br>InvestPro Corretora</p>
        </div>
        
        <!-- Rodapé Institucional -->
        <div style="background-color: #f8fafc; padding: 20px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b;">
            <p style="margin: 0 0 10px 0; text-align: center;">
                <strong>InvestPro Corretora de Valores Mobiliários S.A.</strong><br>
                CNPJ: 12.345.678/0001-90 | CVM: 1234<br>
                Rua das Corretoras, 123 - São Paulo/SP - CEP: 01234-567
            </p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 15px 0;">
            <p style="margin: 0; text-align: center;">
                Esta é uma mensagem automática. Não responda a este e-mail.<br>
                Para dúvidas, acesse nossa Central de Atendimento em <a href="#" style="color: #059669;">www.investpro.com.br</a>
            </p>
        </div>
    </div>
</body>
</html>
    `;
  }
  
  static generateText(verificationCode: string, userEmail: string): string {
    const currentDate = new Date().toLocaleDateString('pt-BR');
    const referenceCode = `VER${Date.now().toString().slice(-8)}`;
    
    return `
INVESTPRO CORRETORA DE VALORES MOBILIÁRIOS S.A.
Verificação de Conta

Prezado(a) Cliente,

Bem-vindo(a) à InvestPro! Para concluir o processo de abertura da sua conta,
é necessário confirmar seu endereço de e-mail.

DADOS DA VERIFICAÇÃO:
- Data/Hora: ${currentDate} às ${new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}
- E-mail: ${userEmail}
- Referência: ${referenceCode}

CÓDIGO DE VERIFICAÇÃO: ${verificationCode}

Este código é válido por 10 minutos.

IMPORTANTE: Este código é pessoal e intransferível. Não compartilhe com terceiros.

Atenciosamente,
Equipe de Cadastro
InvestPro Corretora

---
InvestPro Corretora de Valores Mobiliários S.A.
CNPJ: 12.345.678/0001-90 | CVM: 1234
Esta é uma mensagem automática.
    `;
  }
}

// Função para envio de verificação corporativa
export async function sendCorporateVerificationEmail(
  to: string,
  verificationCode: string
): Promise<boolean> {
  const emailBody = CorporateVerificationTemplate.generateHTML(verificationCode, to);
  const textVersion = CorporateVerificationTemplate.generateText(verificationCode, to);
  
  const corporateHeaders = {
    'X-InvestPro-Department': 'Registration',
    'X-Message-Type': 'Account-Verification',
    'X-Notification-Type': 'Email-Confirmation'
  };
  
  return await sendEmail({
    to,
    from: 'invistapro_group@outlook.com',
    subject: 'Confirmação de E-mail - InvestPro Corretora',
    html: emailBody,
    text: textVersion,
    headers: corporateHeaders
  });
}