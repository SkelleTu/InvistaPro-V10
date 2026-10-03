import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import QRCode from 'qrcode-terminal';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import path from 'path';

export interface WhatsAppService {
  sendNewUserNotification(userData: any): Promise<boolean>;
  sendDocumentUploadNotification(userData: any, documentType: string): Promise<boolean>;
  isReady(): boolean;
  getConnectionStatus(): string;
}

class InvestProWhatsAppService implements WhatsAppService {
  private client: any | null = null;
  private isClientReady: boolean = false;
  private connectionStatus: string = 'Inicializando...';
  private adminPhoneNumber: string;
  private logPath: string;
  private useSimulationMode: boolean = false;
  private readonly enabled: boolean;

  constructor() {
    this.enabled = process.env.NODE_ENV !== 'production' ||
      process.env.ENABLE_WHATSAPP_SERVICE === 'true';
    this.adminPhoneNumber = process.env.ADMIN_WHATSAPP_NUMBER || '5511999999999'; // Número do administrador
    this.logPath = path.join(process.cwd(), 'server', 'whatsapp-logs.json');

    if (!this.enabled) {
      this.connectionStatus = 'Desativado nesta implantação';
      return;
    }

    this.ensureLogFileExists();
    this.setupWhatsAppClient();
  }

  private ensureLogFileExists(): void {
    if (!existsSync(this.logPath)) {
      writeFileSync(this.logPath, JSON.stringify([], null, 2));
    }
  }

  private setupWhatsAppClient(): void {
    try {
      // Configurar cliente WhatsApp com autenticação local
      this.client = new Client({
        authStrategy: new LocalAuth({
          clientId: 'investpro-bot',
          dataPath: './whatsapp-session'
        }),
        puppeteer: {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-extensions',
            '--disable-plugins',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-default-apps'
          ]
        }
      });

      // Eventos do cliente
      this.client.on('qr', (qr: string) => {
        this.connectionStatus = 'Aguardando QR Code';
        console.log('\n' + '='.repeat(80));
        console.log('📱 WHATSAPP - ESCANEIE O QR CODE PARA CONECTAR');
        console.log('='.repeat(80));
        QRCode.generate(qr, { small: true });
        console.log('='.repeat(80));
        console.log('📋 1. Abra o WhatsApp no seu celular');
        console.log('📋 2. Vá em Menu > Dispositivos conectados');
        console.log('📋 3. Toque em "Conectar um dispositivo"');
        console.log('📋 4. Escaneie o código QR acima');
        console.log('='.repeat(80) + '\n');
      });

      this.client.on('ready', () => {
        this.isClientReady = true;
        this.connectionStatus = 'Conectado';
        console.log('\n' + '='.repeat(80));
        console.log('✅ WHATSAPP CONECTADO COM SUCESSO!');
        console.log('🤖 InvestPro Bot está pronto para enviar notificações');
        console.log('📱 Número conectado:', this.client?.info?.wid?.user);
        console.log('='.repeat(80) + '\n');
      });

      this.client.on('disconnected', (reason: string) => {
        this.isClientReady = false;
        this.connectionStatus = `Desconectado: ${reason}`;
        console.log('❌ WhatsApp desconectado:', reason);
        console.log('🔄 Tentando reconectar...');
      });

      this.client.on('auth_failure', (msg: string) => {
        console.error('❌ Falha na autenticação WhatsApp:', msg);
        this.isClientReady = false;
        this.connectionStatus = `Erro de autenticação: ${msg}`;
      });

      // Inicializar cliente
      this.client.initialize().catch((error: any) => {
        console.error('❌ Erro ao inicializar WhatsApp:', error);
        this.useSimulationMode = true;
        this.connectionStatus = 'Modo Simulação (Erro de conexão)';
        console.log('⚠️ WhatsApp não conseguiu conectar, usando modo simulação');
        console.log('📱 As notificações serão simuladas no console');
      });
    } catch (error) {
      console.error('❌ Erro crítico ao configurar WhatsApp:', error);
      this.useSimulationMode = true;
      this.connectionStatus = 'Modo Simulação (Erro crítico)';
      console.log('⚠️ WhatsApp não disponível, usando modo simulação');
    }
  }

  public isReady(): boolean {
    return this.isClientReady || this.useSimulationMode;
  }

  public getConnectionStatus(): string {
    return this.connectionStatus;
  }

  public async sendNewUserNotification(userData: any): Promise<boolean> {
    if (!this.enabled) return false;

    const message = this.formatNewUserMessage(userData);
    
    if (this.useSimulationMode || !this.isClientReady) {
      // Modo simulação - exibe no console
      console.log('\n' + '='.repeat(70));
      console.log('📱 WHATSAPP SIMULADO - NOVO USUÁRIO');
      console.log('='.repeat(70));
      console.log(`👤 Usuário: ${userData.nomeCompleto}`);
      console.log(`📧 Email: ${userData.email}`);
      console.log(`📱 Telefone: ${userData.telefone}`);
      console.log(`📲 Para: ${this.adminPhoneNumber}`);
      console.log(`⏰ Horário: ${new Date().toLocaleString('pt-BR')}`);
      console.log('📄 MENSAGEM QUE SERIA ENVIADA:');
      console.log('─'.repeat(70));
      console.log(message);
      console.log('='.repeat(70) + '\n');

      this.logNotification('novo-usuario', userData.email, true, 'Simulado - WhatsApp não conectado');
      return true;
    }

    try {
      const chatId = `${this.adminPhoneNumber}@c.us`;
      await this.client!.sendMessage(chatId, message);

      console.log('\n' + '='.repeat(70));
      console.log('📱 WHATSAPP - NOVO USUÁRIO NOTIFICADO');
      console.log('='.repeat(70));
      console.log(`👤 Usuário: ${userData.nomeCompleto}`);
      console.log(`📧 Email: ${userData.email}`);
      console.log(`📱 Telefone: ${userData.telefone}`);
      console.log(`✅ Mensagem enviada para: ${this.adminPhoneNumber}`);
      console.log(`⏰ Horário: ${new Date().toLocaleString('pt-BR')}`);
      console.log('='.repeat(70) + '\n');

      this.logNotification('novo-usuario', userData.email, true);
      return true;
    } catch (error) {
      console.error('❌ Erro ao enviar notificação WhatsApp de novo usuário:', error);
      this.logNotification('novo-usuario', userData.email, false, error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  public async sendDocumentUploadNotification(userData: any, documentType: string): Promise<boolean> {
    if (!this.enabled) return false;

    const message = this.formatDocumentUploadMessage(userData, documentType);
    
    if (this.useSimulationMode || !this.isClientReady) {
      // Modo simulação - exibe no console
      console.log('\n' + '='.repeat(70));
      console.log('📱 WHATSAPP SIMULADO - DOCUMENTO KYC');
      console.log('='.repeat(70));
      console.log(`👤 Usuário: ${userData.nomeCompleto}`);
      console.log(`📄 Documento: ${documentType}`);
      console.log(`📧 Email: ${userData.email}`);
      console.log(`📲 Para: ${this.adminPhoneNumber}`);
      console.log(`⏰ Horário: ${new Date().toLocaleString('pt-BR')}`);
      console.log('📄 MENSAGEM QUE SERIA ENVIADA:');
      console.log('─'.repeat(70));
      console.log(message);
      console.log('='.repeat(70) + '\n');

      this.logNotification('documento-upload', userData.email, true, 'Simulado - WhatsApp não conectado');
      return true;
    }

    try {
      const chatId = `${this.adminPhoneNumber}@c.us`;
      await this.client!.sendMessage(chatId, message);

      console.log('\n' + '='.repeat(70));
      console.log('📱 WHATSAPP - DOCUMENTO KYC NOTIFICADO');
      console.log('='.repeat(70));
      console.log(`👤 Usuário: ${userData.nomeCompleto}`);
      console.log(`📄 Documento: ${documentType}`);
      console.log(`📧 Email: ${userData.email}`);
      console.log(`✅ Mensagem enviada para: ${this.adminPhoneNumber}`);
      console.log(`⏰ Horário: ${new Date().toLocaleString('pt-BR')}`);
      console.log('='.repeat(70) + '\n');

      this.logNotification('documento-upload', userData.email, true);
      return true;
    } catch (error) {
      console.error('❌ Erro ao enviar notificação WhatsApp de documento:', error);
      this.logNotification('documento-upload', userData.email, false, error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  private formatNewUserMessage(userData: any): string {
    const formatDate = (dateString: string) => {
      return new Date(dateString).toLocaleString('pt-BR');
    };

    return `🏦 *InvestPro - NOVO USUÁRIO CADASTRADO*

👤 *DADOS PESSOAIS*
📝 Nome: ${userData.nomeCompleto || 'N/A'}
🆔 CPF: ${userData.cpf || 'N/A'}
📧 Email: ${userData.email || 'N/A'}
📱 Telefone: ${userData.telefone || 'N/A'}

🏠 *ENDEREÇO*
📍 Endereço: ${userData.endereco || 'N/A'}
🏙️ Cidade: ${userData.cidade || 'N/A'}
🗺️ Estado: ${userData.estado || 'N/A'}
📮 CEP: ${userData.cep || 'N/A'}

💳 *DADOS PIX*
🔑 Chave PIX: ${userData.chavePix || 'N/A'}
📊 Tipo: ${userData.tipoChavePix || 'N/A'}

✅ *STATUS*
📞 Telefone: ${userData.telefoneVerificado ? '✅ Verificado' : '❌ Não verificado'}
👨‍💼 Conta: ${userData.contaAprovada ? '✅ Aprovada' : '⏳ Pendente'}
📄 Documentos: ${userData.documentosVerificados ? '✅ Verificados' : '⏳ Pendente'}

⏰ *Data de Cadastro:* ${formatDate(userData.createdAt || new Date().toISOString())}

🔗 *Acesse o painel admin para gerenciar este usuário*`;
  }

  private formatDocumentUploadMessage(userData: any, documentType: string): string {
    const documentTypes: Record<string, string> = {
      'rg': 'RG (Frente)',
      'rg_verso': 'RG (Verso)', 
      'cnh': 'CNH',
      'comprovante': 'Comprovante de Residência'
    };

    const documentName = documentTypes[documentType] || documentType;
    
    return `📄 *InvestPro - DOCUMENTO KYC ENVIADO*

👤 *USUÁRIO*
📝 Nome: ${userData.nomeCompleto || 'N/A'}
📧 Email: ${userData.email || 'N/A'}
📱 Telefone: ${userData.telefone || 'N/A'}

📋 *DOCUMENTO*
🗂️ Tipo: ${documentName}
⏰ Enviado em: ${new Date().toLocaleString('pt-BR')}

📊 *STATUS ATUAL*
📄 Documentos: ${userData.documentosVerificados ? '✅ Verificados' : '⏳ Pendente análise'}
👨‍💼 Conta: ${userData.contaAprovada ? '✅ Aprovada' : '⏳ Pendente'}

🔍 *Acesse o painel admin para analisar este documento*`;
  }

  private logNotification(type: string, email: string, success: boolean, errorMessage?: string): void {
    try {
      const logs = this.getNotificationLogs();
      const newLog = {
        type,
        email,
        timestamp: new Date().toISOString(),
        success,
        errorMessage
      };
      
      logs.push(newLog);
      writeFileSync(this.logPath, JSON.stringify(logs, null, 2));
    } catch (error) {
      console.error('Erro ao salvar log de notificação WhatsApp:', error);
    }
  }

  public getNotificationLogs(): any[] {
    try {
      const data = readFileSync(this.logPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      return [];
    }
  }

  // Método para fechar cliente (útil para testes ou shutdown)
  public async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.destroy();
      this.isClientReady = false;
    }
  }
}

// Factory function para criar instância do serviço
function createWhatsAppService(): WhatsAppService {
  return new InvestProWhatsAppService();
}

export const whatsappService = createWhatsAppService();