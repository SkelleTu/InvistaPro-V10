import { sendEmail } from './sendgridService';
import cron from 'node-cron';

// Interface para templates de marketing
interface MarketingTemplate {
  id: string;
  subject: string;
  generateHTML: (userEmail: string) => string;
  generateText: (userEmail: string) => string;
  persuasionLevel: 'medium' | 'high' | 'extreme';
}

// Templates de marketing extremamente convincentes
class MarketingTemplates {
  // Template 1: Urgência de Oportunidade
  static urgencyTemplate: MarketingTemplate = {
    id: 'urgency-opportunity',
    subject: '⚠ ÚLTIMAS 24H: Pool de Liquidez com 130% Superior - InvistaPRO',
    persuasionLevel: 'extreme',
    generateHTML: (userEmail: string) => `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Oportunidade Única - InvistaPRO</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
        .urgent-blink { animation: blink 1.5s linear infinite; }
        @keyframes blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0.7; } }
        .gradient-gold { background: linear-gradient(135deg, #fbbf24, #f59e0b, #d97706); }
        .gradient-green { background: linear-gradient(135deg, #10b981, #059669, #047857); }
    </style>
</head>
<body style="font-family: 'Inter', Arial, sans-serif; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); margin: 0; padding: 20px; color: #ffffff;">
    <div style="max-width: 650px; margin: 0 auto; background: linear-gradient(135deg, #0f0f23 0%, #1a1a2e 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);">
        
        <!-- Header Urgente -->
        <div style="background: linear-gradient(90deg, #dc2626, #ef4444, #dc2626); padding: 15px; text-align: center;">
            <div class="urgent-blink" style="color: #ffffff; font-weight: 800; font-size: 14px; letter-spacing: 1px;">
                ⚠ OPORTUNIDADE EXPIRA EM 24 HORAS ⚠
            </div>
        </div>

        <!-- Logo e Título -->
        <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%); padding: 40px 30px; text-align: center;">
            <div style="display: inline-flex; align-items: center; justify-content: center; margin-bottom: 20px;">
                <img src="https://i.ibb.co/ZzYMMK6h/investpro-icon.png" 
                     alt="InvistaPRO Logo" 
                     style="width: 52px; height: 52px; border-radius: 14px; margin-right: 15px; box-shadow: 0 10px 30px rgba(245, 158, 11, 0.4);" />
                <div style="text-align: left;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 32px; font-weight: 800; letter-spacing: -0.5px;">InvistaPRO</h1>
                    <p style="color: #fbbf24; margin: 2px 0 0 0; font-size: 13px; font-weight: 600; letter-spacing: 0.8px;">INVISTA COM RISCO ZERO</p>
                </div>
            </div>
        </div>

        <!-- Conteúdo Principal -->
        <div style="padding: 40px 30px;">
            
            <!-- Gancho Principal -->
            <div style="background: linear-gradient(135deg, #dc2626, #ef4444); border-radius: 12px; padding: 30px; margin-bottom: 30px; text-align: center; box-shadow: 0 8px 25px rgba(220, 38, 38, 0.3);">
                <h2 style="color: #ffffff; font-size: 24px; margin: 0 0 15px 0; font-weight: 800;">
                    🔥 R$ 130 HOJE = R$ 16.900 EM 12 MESES
                </h2>
                <p style="color: #fecaca; font-size: 16px; margin: 0; font-weight: 500;">
                    130% superior às principais soluções financeiras • GARANTIDO • SEM RISCOS
                </p>
            </div>

            <!-- Prova Social Urgente -->
            <div style="background: rgba(16, 185, 129, 0.1); border: 2px solid #10b981; border-radius: 12px; padding: 25px; margin: 25px 0;">
                <h3 style="color: #10b981; margin: 0 0 15px 0; font-size: 18px; font-weight: 700;">
                    📊 RESULTADOS REAIS DOS ÚLTIMOS 30 DIAS:
                </h3>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin: 20px 0;">
                    <div style="text-align: center;">
                        <div style="color: #ffffff; font-size: 20px; font-weight: 800;">+0.835%</div>
                        <div style="color: #94a3b8; font-size: 12px;">Rendimento Mensal</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="color: #ffffff; font-size: 20px; font-weight: 800;">4.847</div>
                        <div style="color: #94a3b8; font-size: 12px;">Novos Investidores</div>
                    </div>
                </div>
                <p style="color: #e2e8f0; font-size: 14px; margin: 15px 0 0 0; text-align: center;">
                    ⭐ <strong>Maria S.</strong> depositou R$ 1.000 e já sacou R$ 1.088 este mês<br>
                    ⭐ <strong>João P.</strong> transformou R$ 350 em R$ 380 em apenas 30 dias
                </p>
            </div>

            <!-- Contador Falso de Urgência -->
            <div style="background: linear-gradient(135deg, #7c2d12, #991b1b); border-radius: 8px; padding: 20px; margin: 25px 0; text-align: center;">
                <p style="color: #fca5a5; font-size: 14px; margin: 0 0 10px 0; font-weight: 600;">
                    ⏰ VAGAS LIMITADAS RESTANTES:
                </p>
                <div style="color: #ffffff; font-size: 28px; font-weight: 800; margin: 5px 0;">
                    07 VAGAS
                </div>
                <p style="color: #fca5a5; font-size: 12px; margin: 10px 0 0 0;">
                    Após preencher, nova oportunidade apenas em 2025
                </p>
            </div>

            <!-- CTA Principal -->
            <div style="text-align: center; margin: 35px 0;">
                <a href="https://replit.com/@seuprojeto#/" 
                   style="display: inline-block; background: linear-gradient(135deg, #059669, #047857); color: #ffffff; padding: 20px 50px; text-decoration: none; border-radius: 12px; font-weight: 800; font-size: 18px; box-shadow: 0 10px 30px rgba(5, 150, 105, 0.5); text-transform: uppercase; letter-spacing: 0.5px;"
                   target="_blank">
                    💰 GARANTIR MINHA VAGA AGORA
                </a>
                <p style="color: #94a3b8; font-size: 12px; margin: 15px 0 0 0;">
                    ✅ Início imediato • ✅ Sem taxas escondidas • ✅ Saque quando quiser
                </p>
            </div>

            <!-- Escassez Social -->
            <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 25px 0;">
                <p style="color: #f59e0b; font-size: 14px; margin: 0 0 10px 0; font-weight: 600;">
                    🔥 ÚLTIMAS HORAS - MOVIMENTO INTENSO:
                </p>
                <div style="color: #e2e8f0; font-size: 13px; line-height: 1.6;">
                    • <strong>R$ 47.000</strong> depositados nas últimas 2 horas<br>
                    • <strong>23 pessoas</strong> garantiram vaga enquanto você lê este email<br>
                    • <strong>Índices atuais: 10.65%</strong> - InvistaPRO rende 130% superiores = <strong>13.85% ao ano</strong>
                </div>
            </div>

            <!-- Garantia Convincente -->
            <div style="background: linear-gradient(135deg, #1e293b, #334155); border-radius: 8px; padding: 25px; margin: 25px 0; text-align: center;">
                <h4 style="color: #10b981; margin: 0 0 15px 0; font-size: 16px; font-weight: 700;">
                    🛡️ GARANTIA BLINDADA DE RISCO ZERO
                </h4>
                <p style="color: #e2e8f0; font-size: 14px; line-height: 1.6; margin: 0;">
                    • <strong>Autorização CVM</strong> para operação<br>
                    • <strong>Backup pelo BACEN</strong> (Banco Central)<br>
                    • <strong>Seguro FGC</strong> até R$ 250.000 por conta<br>
                    • <strong>100% do seu dinheiro</strong> fica sempre acessível
                </p>
            </div>
        </div>

        <!-- Footer -->
        <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 30px; text-align: center;">
            <p style="color: #64748b; font-size: 11px; margin: 0;">
                InvistaPRO - CNPJ: 12.345.678/0001-90 | CVM: 1234<br>
                Esta é uma comunicação comercial. Para descadastrar, responda SAIR.
            </p>
        </div>
    </div>
</body>
</html>
    `,
    generateText: (userEmail: string) => `
🚨 ÚLTIMAS 24H: OPORTUNIDADE ÚNICA - InvistaPRO

Olá, Investidor!

SUA ÚLTIMA CHANCE: R$ 130 HOJE = R$ 16.900 EM 12 MESES

📊 RESULTADOS COMPROVADOS:
• 130% superior às principais soluções do mercado
• 0.835% de rendimento mensal GARANTIDO
• 4.847 novos investidores nos últimos 30 dias

⏰ APENAS 7 VAGAS RESTANTES
Após preenchimento, próxima oportunidade só em 2025.

🛡️ GARANTIAS MÁXIMAS:
✅ Autorização CVM ✅ Backup BACEN ✅ Seguro FGC ✅ Risco Zero

GARANTA SUA VAGA: https://replit.com/@seuprojeto#/

InvistaPRO - Invista com Risco Zero
Para descadastrar, responda SAIR.
    `
  };

  // Template 2: FOMO Extremo
  static fomoTemplate: MarketingTemplate = {
    id: 'extreme-fomo',
    subject: '💸 Você perdeu R$ 2.847 enquanto pensava... Última chance hoje!',
    persuasionLevel: 'extreme',
    generateHTML: (userEmail: string) => `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Oportunidade Perdida - InvistaPRO</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
        .shake { animation: shake 0.5s infinite; }
        @keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-2px); } 75% { transform: translateX(2px); } }
    </style>
</head>
<body style="font-family: 'Inter', Arial, sans-serif; background: linear-gradient(135deg, #450a0a 0%, #7f1d1d 100%); margin: 0; padding: 20px; color: #ffffff;">
    <div style="max-width: 650px; margin: 0 auto; background: linear-gradient(135deg, #1a0000 0%, #2d0000 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 25px 50px rgba(0, 0, 0, 0.7);">
        
        <!-- Header Alarmante -->
        <div style="background: linear-gradient(90deg, #dc2626, #b91c1c, #dc2626); padding: 20px; text-align: center;">
            <div style="color: #ffffff; font-weight: 800; font-size: 16px; letter-spacing: 1px;" class="shake">
                💸 VOCÊ ESTÁ PERDENDO DINHEIRO AGORA MESMO! 💸
            </div>
        </div>

        <!-- Logo -->
        <div style="background: linear-gradient(135deg, #450a0a 0%, #7f1d1d 100%); padding: 30px; text-align: center;">
            <div style="display: inline-flex; align-items: center; justify-content: center;">
                <img src="https://i.ibb.co/ZzYMMK6h/investpro-icon.png" 
                     alt="InvistaPRO Logo" 
                     style="width: 48px; height: 48px; border-radius: 12px; margin-right: 15px;" />
                <div style="text-align: left;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 800;">InvistaPRO</h1>
                    <p style="color: #fbbf24; margin: 2px 0 0 0; font-size: 12px; font-weight: 600;">ÚLTIMA OPORTUNIDADE</p>
                </div>
            </div>
        </div>

        <!-- Conteúdo Chocante -->
        <div style="padding: 30px;">
            
            <!-- Impacto Emocional -->
            <div style="background: linear-gradient(135deg, #dc2626, #b91c1c); border-radius: 12px; padding: 30px; margin-bottom: 25px; text-align: center;">
                <h2 style="color: #ffffff; font-size: 22px; margin: 0 0 15px 0; font-weight: 800;">
                    😱 ENQUANTO VOCÊ PENSAVA...
                </h2>
                <div style="color: #fecaca; font-size: 32px; font-weight: 900; margin: 15px 0;">
                    R$ 2.847
                </div>
                <p style="color: #fecaca; font-size: 16px; margin: 0; font-weight: 600;">
                    FOI O QUE SEUS VIZINHOS GANHARAM investindo na InvistaPRO
                </p>
            </div>

            <!-- Prova de Perdas -->
            <div style="background: rgba(220, 38, 38, 0.2); border: 2px solid #dc2626; border-radius: 12px; padding: 25px; margin: 25px 0;">
                <h3 style="color: #dc2626; margin: 0 0 15px 0; font-size: 18px; font-weight: 700;">
                    📉 O QUE VOCÊ JÁ PERDEU:
                </h3>
                <div style="color: #e2e8f0; font-size: 14px; line-height: 2;">
                    ❌ <strong>Semana passada:</strong> R$ 89 que poderiam ser seus<br>
                    ❌ <strong>Mês passado:</strong> R$ 356 que escaparam das suas mãos<br>
                    ❌ <strong>Desde janeiro:</strong> R$ 4.267 que outros ganharam<br>
                    ❌ <strong>Enquanto lê este email:</strong> mais R$ 12 perdidos
                </div>
            </div>

            <!-- Comparação Brutal -->
            <div style="background: linear-gradient(135deg, #1e293b, #334155); border-radius: 12px; padding: 25px; margin: 25px 0;">
                <h3 style="color: #fbbf24; margin: 0 0 20px 0; font-size: 16px; font-weight: 700; text-align: center;">
                    🥊 VOCÊ vs INVESTIDOR INTELIGENTE
                </h3>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                    <div style="text-align: center; padding: 15px; background: rgba(220, 38, 38, 0.2); border-radius: 8px;">
                        <div style="color: #dc2626; font-size: 14px; font-weight: 600; margin-bottom: 8px;">VOCÊ (Poupança)</div>
                        <div style="color: #ffffff; font-size: 18px; font-weight: 800;">R$ 130</div>
                        <div style="color: #fca5a5; font-size: 12px;">após 12 meses</div>
                    </div>
                    <div style="text-align: center; padding: 15px; background: rgba(16, 185, 129, 0.2); border-radius: 8px;">
                        <div style="color: #10b981; font-size: 14px; font-weight: 600; margin-bottom: 8px;">ELE (InvistaPRO)</div>
                        <div style="color: #ffffff; font-size: 18px; font-weight: 800;">R$ 247</div>
                        <div style="color: #a7f3d0; font-size: 12px;">após 12 meses</div>
                    </div>
                </div>
                <p style="color: #e2e8f0; text-align: center; margin: 15px 0 0 0; font-size: 12px;">
                    <strong>Diferença: +R$ 117 (90% a mais!)</strong>
                </p>
            </div>

            <!-- Última Chance Dramática -->
            <div style="background: linear-gradient(135deg, #7c2d12, #991b1b); border: 3px solid #dc2626; border-radius: 12px; padding: 25px; margin: 25px 0; text-align: center;" class="shake">
                <h3 style="color: #ffffff; margin: 0 0 15px 0; font-size: 20px; font-weight: 800;">
                    ⚠️ ÚLTIMA CHANCE OFICIAL
                </h3>
                <p style="color: #fecaca; font-size: 14px; margin: 0 0 20px 0; line-height: 1.6;">
                    Este é o <strong>último email</strong> que enviaremos.<br>
                    Amanhã, as vagas estarão ocupadas e você ficará de fora até 2025.
                </p>
                <div style="color: #ffffff; font-size: 24px; font-weight: 900; margin: 10px 0;">
                    03:27:45
                </div>
                <p style="color: #fca5a5; font-size: 12px; margin: 10px 0 0 0;">
                    horas para encerramento definitivo
                </p>
            </div>

            <!-- CTA Desesperador -->
            <div style="text-align: center; margin: 35px 0;">
                <a href="https://replit.com/@seuprojeto#/" 
                   style="display: inline-block; background: linear-gradient(135deg, #dc2626, #b91c1c); color: #ffffff; padding: 22px 45px; text-decoration: none; border-radius: 12px; font-weight: 800; font-size: 18px; box-shadow: 0 10px 30px rgba(220, 38, 38, 0.6); text-transform: uppercase; letter-spacing: 0.5px; border: 2px solid #fca5a5;"
                   target="_blank">
                    🆘 PARAR DE PERDER DINHEIRO AGORA
                </a>
                <p style="color: #fca5a5; font-size: 13px; margin: 15px 0 0 0; font-weight: 600;">
                    ⚡ Último clique para mudar sua vida financeira
                </p>
            </div>

            <!-- Medo Final -->
            <div style="background: rgba(0, 0, 0, 0.5); border-radius: 8px; padding: 20px; text-align: center;">
                <p style="color: #fca5a5; font-size: 13px; margin: 0; line-height: 1.6;">
                    <strong>AVISO:</strong> Se você não agir agora, continuará vendo outras pessoas enriquecendo enquanto você fica para trás. 
                    Não queremos que isso aconteça, mas a escolha é sua.
                </p>
            </div>
        </div>

        <!-- Footer -->
        <div style="background: #000000; padding: 20px; text-align: center;">
            <p style="color: #64748b; font-size: 10px; margin: 0;">
                InvistaPRO - Esta é sua última comunicação. Para reativar, acesse o site.
            </p>
        </div>
    </div>
</body>
</html>
    `,
    generateText: (userEmail: string) => `
💸 VOCÊ PERDEU R$ 2.847 ENQUANTO PENSAVA...

ÚLTIMA CHANCE HOJE - InvistaPRO

😱 ENQUANTO VOCÊ HESITAVA:
• R$ 89 perdidos semana passada
• R$ 356 perdidos mês passado  
• R$ 4.267 perdidos desde janeiro
• Mais R$ 12 perdidos enquanto lê este email

🥊 VOCÊ vs INVESTIDOR INTELIGENTE:
Você (Poupança): R$ 130 → R$ 130 (12 meses)
Ele (InvistaPRO): R$ 130 → R$ 247 (12 meses)
DIFERENÇA: +R$ 117 (90% a mais!)

⚠️ ÚLTIMA CHANCE OFICIAL
Este é o último email. Amanhã será tarde.

⏰ RESTAM: 03:27:45 horas

PARE DE PERDER DINHEIRO: https://replit.com/@seuprojeto#/

InvistaPRO - Sua última comunicação
    `
  };

  // Template 3: Sucesso Social
  static socialProofTemplate: MarketingTemplate = {
    id: 'social-proof-success',
    subject: '🤑 Ana transformou R$ 500 em R$ 2.341 - Veja o Print da Conta!',
    persuasionLevel: 'high',
    generateHTML: (userEmail: string) => `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Caso de Sucesso - InvistaPRO</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
    </style>
</head>
<body style="font-family: 'Inter', Arial, sans-serif; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); margin: 0; padding: 20px; color: #ffffff;">
    <div style="max-width: 650px; margin: 0 auto; background: linear-gradient(135deg, #0f0f23 0%, #1a1a2e 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);">
        
        <!-- Header Sucesso -->
        <div style="background: linear-gradient(90deg, #059669, #10b981, #059669); padding: 20px; text-align: center;">
            <div style="color: #ffffff; font-weight: 800; font-size: 16px; letter-spacing: 1px;">
                🤑 RESULTADO REAL DE CLIENTE VERIFICADO 🤑
            </div>
        </div>

        <!-- Logo -->
        <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%); padding: 30px; text-align: center;">
            <div style="display: inline-flex; align-items: center; justify-content: center;">
                <img src="https://i.ibb.co/ZzYMMK6h/investpro-icon.png" 
                     alt="InvistaPRO Logo" 
                     style="width: 48px; height: 48px; border-radius: 12px; margin-right: 15px;" />
                <div style="text-align: left;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 800;">InvistaPRO</h1>
                    <p style="color: #10b981; margin: 2px 0 0 0; font-size: 12px; font-weight: 600;">CASO DE SUCESSO REAL</p>
                </div>
            </div>
        </div>

        <div style="padding: 30px;">
            
            <!-- Resultado Principal -->
            <div style="background: linear-gradient(135deg, #059669, #10b981); border-radius: 12px; padding: 30px; margin-bottom: 25px; text-align: center;">
                <h2 style="color: #ffffff; font-size: 20px; margin: 0 0 15px 0; font-weight: 700;">
                    📸 PRINT REAL DA CONTA DE ANA SILVA
                </h2>
                <div style="background: rgba(255,255,255,0.1); border-radius: 8px; padding: 20px; margin: 15px 0;">
                    <div style="color: #a7f3d0; font-size: 14px; margin-bottom: 10px;">INVESTIMENTO INICIAL</div>
                    <div style="color: #ffffff; font-size: 24px; font-weight: 800;">R$ 500,00</div>
                </div>
                <div style="color: #a7f3d0; font-size: 16px; margin: 15px 0;">⬇️ TRANSFORMOU EM ⬇️</div>
                <div style="background: rgba(255,255,255,0.2); border-radius: 8px; padding: 20px;">
                    <div style="color: #a7f3d0; font-size: 14px; margin-bottom: 10px;">SALDO ATUAL</div>
                    <div style="color: #ffffff; font-size: 32px; font-weight: 900;">R$ 2.341,67</div>
                    <div style="color: #a7f3d0; font-size: 14px; margin-top: 10px;">EM APENAS 7 MESES</div>
                </div>
            </div>

            <!-- Depoimento -->
            <div style="background: rgba(16, 185, 129, 0.1); border: 2px solid #10b981; border-radius: 12px; padding: 25px; margin: 25px 0;">
                <div style="display: flex; align-items: center; margin-bottom: 15px;">
                    <div style="width: 40px; height: 40px; background: #10b981; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-right: 12px;">
                        <span style="color: #ffffff; font-size: 18px;">👩</span>
                    </div>
                    <div>
                        <div style="color: #10b981; font-weight: 700; font-size: 14px;">Ana Silva, 34 anos</div>
                        <div style="color: #94a3b8; font-size: 12px;">Professora - São Paulo/SP</div>
                    </div>
                </div>
                <p style="color: #e2e8f0; font-size: 14px; line-height: 1.6; margin: 0; font-style: italic;">
                    "Eu estava desempregada e tinha apenas R$ 500 guardados. Vi um anúncio da InvistaPRO e pensei: 
                    'não tenho nada a perder'. Hoje, 7 meses depois, tenho mais de R$ 2.300! 
                    Consegui pagar minhas contas e ainda sobrou dinheiro. É REAL, gente!"
                </p>
                <div style="text-align: right; margin-top: 10px;">
                    <span style="color: #10b981; font-size: 12px; font-weight: 600;">✅ Depoimento verificado</span>
                </div>
            </div>

            <!-- Outros Cases -->
            <div style="background: linear-gradient(135deg, #1e293b, #334155); border-radius: 12px; padding: 25px; margin: 25px 0;">
                <h3 style="color: #fbbf24; margin: 0 0 20px 0; font-size: 16px; font-weight: 700; text-align: center;">
                    🏆 OUTROS CASES DE SUCESSO DESTA SEMANA
                </h3>
                <div style="space-y: 15px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #475569;">
                        <div>
                            <div style="color: #e2e8f0; font-size: 13px; font-weight: 600;">Carlos M. - Contador</div>
                            <div style="color: #94a3b8; font-size: 11px;">R$ 1.000 → R$ 3.456 (5 meses)</div>
                        </div>
                        <div style="color: #10b981; font-size: 12px; font-weight: 700;">+245%</div>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #475569;">
                        <div>
                            <div style="color: #e2e8f0; font-size: 13px; font-weight: 600;">Maria J. - Enfermeira</div>
                            <div style="color: #94a3b8; font-size: 11px;">R$ 350 → R$ 1.127 (8 meses)</div>
                        </div>
                        <div style="color: #10b981; font-size: 12px; font-weight: 700;">+222%</div>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0;">
                        <div>
                            <div style="color: #e2e8f0; font-size: 13px; font-weight: 600;">João P. - Aposentado</div>
                            <div style="color: #94a3b8; font-size: 11px;">R$ 2.000 → R$ 4.891 (4 meses)</div>
                        </div>
                        <div style="color: #10b981; font-size: 12px; font-weight: 700;">+144%</div>
                    </div>
                </div>
            </div>

            <!-- CTA Inspirado -->
            <div style="text-align: center; margin: 35px 0;">
                <div style="background: rgba(245, 158, 11, 0.1); border-radius: 8px; padding: 20px; margin-bottom: 20px;">
                    <p style="color: #fbbf24; font-size: 14px; margin: 0; font-weight: 600;">
                        💭 "E se você fosse o próximo case de sucesso?"
                    </p>
                </div>
                <a href="https://replit.com/@seuprojeto#/" 
                   style="display: inline-block; background: linear-gradient(135deg, #059669, #047857); color: #ffffff; padding: 20px 45px; text-decoration: none; border-radius: 12px; font-weight: 800; font-size: 16px; box-shadow: 0 10px 30px rgba(5, 150, 105, 0.5);"
                   target="_blank">
                    🚀 QUERO SER O PRÓXIMO CASE DE SUCESSO
                </a>
                <p style="color: #94a3b8; font-size: 12px; margin: 15px 0 0 0;">
                    ⚡ Comece com apenas R$ 130 • Mesmos resultados de Ana
                </p>
            </div>
        </div>

        <!-- Footer -->
        <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 25px; text-align: center;">
            <p style="color: #64748b; font-size: 11px; margin: 0;">
                InvistaPRO - Transformando vidas através de investimentos inteligentes<br>
                CNPJ: 12.345.678/0001-90 | Todos os resultados são reais e verificáveis
            </p>
        </div>
    </div>
</body>
</html>
    `,
    generateText: (userEmail: string) => `
🤑 ANA TRANSFORMOU R$ 500 EM R$ 2.341!

CASO REAL - InvistaPRO

📸 PRINT DA CONTA VERIFICADO:
Ana Silva, 34 anos - Professora
Investimento inicial: R$ 500,00
Saldo atual: R$ 2.341,67
Período: 7 meses

💬 DEPOIMENTO DELA:
"Estava desempregada com R$ 500 guardados. Hoje tenho mais de R$ 2.300! 
Consegui pagar minhas contas e ainda sobrou. É REAL!"

🏆 OUTROS CASES DESTA SEMANA:
• Carlos M.: R$ 1.000 → R$ 3.456 (+245%)
• Maria J.: R$ 350 → R$ 1.127 (+222%)  
• João P.: R$ 2.000 → R$ 4.891 (+144%)

💭 E se você fosse o próximo?

COMEÇAR AGORA: https://replit.com/@seuprojeto#/

InvistaPRO - Resultados reais e verificáveis
    `
  };

  static getAllTemplates(): MarketingTemplate[] {
    return [this.urgencyTemplate, this.fomoTemplate, this.socialProofTemplate];
  }
}

// Gerenciador de campanha de marketing
class MarketingCampaignManager {
  private static instance: MarketingCampaignManager;
  private emailList: string[] = [];
  private campaignRunning = false;

  static getInstance(): MarketingCampaignManager {
    if (!this.instance) {
      this.instance = new MarketingCampaignManager();
    }
    return this.instance;
  }

  // Adicionar email à lista de marketing
  addToMarketingList(email: string): void {
    if (!this.emailList.includes(email)) {
      this.emailList.push(email);
      console.log(`📧 Email ${email} adicionado à lista de marketing`);
    }
  }

  // Remover email da lista
  removeFromMarketingList(email: string): void {
    const index = this.emailList.indexOf(email);
    if (index > -1) {
      this.emailList.splice(index, 1);
      console.log(`📧 Email ${email} removido da lista de marketing`);
    }
  }

  // Enviar email de marketing para um destinatário
  private async sendMarketingEmail(email: string, template: MarketingTemplate): Promise<boolean> {
    try {
      const success = await sendEmail({
        to: email,
        from: 'invistapro_group@outlook.com',
        subject: template.subject,
        html: template.generateHTML(email),
        text: template.generateText(email),
        headers: {
          'X-InvestPro-Type': 'marketing',
          'X-Campaign-ID': template.id,
          'List-Unsubscribe': '<mailto:sair@invistapro.com>'
        }
      });

      if (success) {
        console.log(`✅ Email de marketing enviado para ${email} - Template: ${template.id}`);
      } else {
        console.log(`❌ Falha ao enviar marketing para ${email}`);
      }

      return success;
    } catch (error) {
      console.error(`❌ Erro no marketing para ${email}:`, error);
      return false;
    }
  }

  // Campanha automática de marketing
  async runMarketingCampaign(): Promise<void> {
    if (this.campaignRunning) {
      console.log('📧 Campanha de marketing já está rodando...');
      return;
    }

    if (this.emailList.length === 0) {
      console.log('📧 Lista de marketing vazia. Adicionando emails de teste...');
      // Adicionar alguns emails de exemplo para teste
      this.emailList = [
        'cliente1@exemplo.com',
        'cliente2@exemplo.com',
        'investidor@exemplo.com'
      ];
    }

    this.campaignRunning = true;
    console.log(`🚀 Iniciando campanha de marketing para ${this.emailList.length} destinatários`);

    const templates = MarketingTemplates.getAllTemplates();
    
    for (const email of this.emailList) {
      // Escolher template aleatório
      const randomTemplate = templates[Math.floor(Math.random() * templates.length)];
      
      // Delay aleatório entre 30 segundos e 2 minutos para parecer mais natural
      const delay = Math.floor(Math.random() * (120000 - 30000) + 30000);
      
      setTimeout(async () => {
        await this.sendMarketingEmail(email, randomTemplate);
      }, delay);
    }

    this.campaignRunning = false;
  }

  // Agendar campanhas automáticas
  startAutomaticCampaigns(): void {
    console.log('📅 Configurando campanhas automáticas de marketing...');

    // Campanhas 2-3 vezes por semana em horários aleatórios
    // Segunda, Quarta e Sexta às 10h, 14h ou 18h
    const schedules = [
      '0 10 * * 1',  // Segunda às 10h
      '0 14 * * 3',  // Quarta às 14h  
      '0 18 * * 5',  // Sexta às 18h
    ];

    schedules.forEach((schedule, index) => {
      cron.schedule(schedule, () => {
        console.log(`📧 Executando campanha automática ${index + 1}...`);
        this.runMarketingCampaign();
      });
    });

    // Campanha de urgência adicional - Domingos às 20h (FOMO do final de semana)
    cron.schedule('0 20 * * 0', () => {
      console.log('🚨 Executando campanha de URGÊNCIA dominical...');
      this.runUrgentCampaign();
    });

    console.log('✅ Campanhas automáticas configuradas:');
    console.log('   • Segundas 10h: Campanha regular');
    console.log('   • Quartas 14h: Campanha regular');  
    console.log('   • Sextas 18h: Campanha regular');
    console.log('   • Domingos 20h: Campanha de urgência');
  }

  // Campanha especial de urgência (só template de FOMO)
  private async runUrgentCampaign(): Promise<void> {
    const fomoTemplate = MarketingTemplates.fomoTemplate;
    
    for (const email of this.emailList) {
      const delay = Math.floor(Math.random() * 60000); // Delay de até 1 minuto
      
      setTimeout(async () => {
        await this.sendMarketingEmail(email, fomoTemplate);
      }, delay);
    }
  }

  // Obter estatísticas
  getStats(): { totalEmails: number; campaignRunning: boolean } {
    return {
      totalEmails: this.emailList.length,
      campaignRunning: this.campaignRunning
    };
  }
}

// Exportar instância única
export const marketingManager = MarketingCampaignManager.getInstance();

// Função para inicializar o sistema de marketing
export function initializeMarketingSystem(): void {
  // Segurança: campanhas promocionais não podem ser iniciadas no boot nem usar
  // destinatários de teste fixos. Só habilitar após fluxo explícito de consentimento,
  // lista real autorizada e revisão do conteúdo/descadastro.
  console.warn("[MARKETING] Campanhas automáticas desativadas; nenhum e-mail será enviado no boot.");
}

// Exportar função para adicionar usuários à lista de marketing
export function addUserToMarketing(email: string): void {
  marketingManager.addToMarketingList(email);
}

// Exportar função para remover usuários 
export function removeUserFromMarketing(email: string): void {
  marketingManager.removeFromMarketingList(email);
}