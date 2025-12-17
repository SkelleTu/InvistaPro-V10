import fs from 'fs';
import path from 'path';

export interface ErrorContext {
  userId?: string;
  userEmail?: string;
  requestPath?: string;
  requestMethod?: string;
  requestBody?: any;
  requestHeaders?: any;
  requestQuery?: any;
  requestParams?: any;
  sessionData?: any;
  timestamp: string;
  errorId: string;
}

export interface DetailedError {
  id: string;
  timestamp: string;
  level: 'CRITICAL' | 'ERROR' | 'WARNING' | 'INFO';
  category: 'DATABASE' | 'API_EXTERNAL' | 'WEBSOCKET' | 'AUTH' | 'VALIDATION' | 'UNKNOWN';
  message: string;
  stack?: string;
  context: ErrorContext;
  originalError?: any;
  recovery?: string;
  solved?: boolean;
}

class ErrorTracker {
  private errorLogPath: string;
  private errorDatabase: DetailedError[] = [];
  private maxErrorsInMemory = 1000;

  constructor() {
    // Garantir que o diretório de logs existe
    const logsDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    
    this.errorLogPath = path.join(logsDir, 'detailed-errors.log');
    this.loadExistingErrors();
  }

  private generateErrorId(): string {
    return `ERR_${Date.now()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  }

  private loadExistingErrors(): void {
    try {
      if (fs.existsSync(this.errorLogPath)) {
        const fileContent = fs.readFileSync(this.errorLogPath, 'utf8');
        const lines = fileContent.split('\n').filter(line => line.trim());
        
        this.errorDatabase = lines.map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        }).filter(Boolean).slice(-this.maxErrorsInMemory);
      }
    } catch (error) {
      console.error('❌ Erro ao carregar logs de erro existentes:', error);
    }
  }

  captureError(
    error: Error | any,
    level: DetailedError['level'] = 'ERROR',
    category: DetailedError['category'] = 'UNKNOWN',
    context: Partial<ErrorContext> = {}
  ): string {
    const errorId = this.generateErrorId();
    const timestamp = new Date().toISOString();

    const detailedError: DetailedError = {
      id: errorId,
      timestamp,
      level,
      category,
      message: error?.message || String(error),
      stack: error?.stack,
      context: {
        timestamp,
        errorId,
        ...context
      },
      originalError: this.sanitizeError(error),
      solved: false
    };

    // Adicionar ao banco em memória
    this.errorDatabase.push(detailedError);
    
    // Manter apenas os últimos N erros em memória
    if (this.errorDatabase.length > this.maxErrorsInMemory) {
      this.errorDatabase = this.errorDatabase.slice(-this.maxErrorsInMemory);
    }

    // Escrever no arquivo de log
    this.writeToLogFile(detailedError);

    // Log detalhado no console
    this.logToConsole(detailedError);

    return errorId;
  }

  private sanitizeError(error: any): any {
    if (!error) return error;
    
    return {
      name: error.name,
      message: error.message,
      code: error.code,
      status: error.status,
      statusCode: error.statusCode,
      stack: error.stack,
      cause: error.cause,
      errno: error.errno,
      syscall: error.syscall,
      address: error.address,
      port: error.port
    };
  }

  private writeToLogFile(detailedError: DetailedError): void {
    try {
      const logLine = JSON.stringify(detailedError) + '\n';
      fs.appendFileSync(this.errorLogPath, logLine);
    } catch (writeError) {
      console.error('❌ CRÍTICO: Erro ao escrever log de erro:', writeError);
    }
  }

  private logToConsole(detailedError: DetailedError): void {
    const emoji = this.getLevelEmoji(detailedError.level);
    const categoryBadge = `[${detailedError.category}]`;
    
    console.log('\n' + '='.repeat(80));
    console.log(`${emoji} ERRO DETECTADO ${categoryBadge} - ID: ${detailedError.id}`);
    console.log('='.repeat(80));
    console.log(`📅 Timestamp: ${detailedError.timestamp}`);
    console.log(`🔥 Nível: ${detailedError.level}`);
    console.log(`📝 Mensagem: ${detailedError.message}`);
    
    if (detailedError.context.userId) {
      console.log(`👤 Usuário: ${detailedError.context.userId} (${detailedError.context.userEmail || 'N/A'})`);
    }
    
    if (detailedError.context.requestPath) {
      console.log(`🌐 Endpoint: ${detailedError.context.requestMethod} ${detailedError.context.requestPath}`);
    }
    
    if (detailedError.context.requestBody && Object.keys(detailedError.context.requestBody).length > 0) {
      console.log(`📦 Request Body:`, JSON.stringify(detailedError.context.requestBody, null, 2));
    }
    
    if (detailedError.stack) {
      console.log(`📍 Stack Trace:`);
      console.log(detailedError.stack);
    }
    
    if (detailedError.originalError) {
      console.log(`🔍 Erro Original Detalhado:`, JSON.stringify(detailedError.originalError, null, 2));
    }
    
    console.log('='.repeat(80));
    console.log(`💾 Log salvo em: ${this.errorLogPath}`);
    console.log('='.repeat(80) + '\n');
  }

  private getLevelEmoji(level: DetailedError['level']): string {
    switch (level) {
      case 'CRITICAL': return '🚨';
      case 'ERROR': return '❌';
      case 'WARNING': return '⚠️';
      case 'INFO': return 'ℹ️';
      default: return '❓';
    }
  }

  // Métodos para consulta de erros
  getErrorById(errorId: string): DetailedError | null {
    return this.errorDatabase.find(err => err.id === errorId) || null;
  }

  getRecentErrors(limit: number = 50): DetailedError[] {
    return this.errorDatabase.slice(-limit).reverse();
  }

  getErrorsByCategory(category: DetailedError['category']): DetailedError[] {
    return this.errorDatabase.filter(err => err.category === category);
  }

  getUnsolvedErrors(): DetailedError[] {
    return this.errorDatabase.filter(err => !err.solved);
  }

  markErrorAsSolved(errorId: string, recovery?: string): boolean {
    const error = this.errorDatabase.find(err => err.id === errorId);
    if (error) {
      error.solved = true;
      error.recovery = recovery;
      this.writeToLogFile(error);
      return true;
    }
    return false;
  }

  // Método para criar contexto a partir de request Express
  createContextFromRequest(req: any): Partial<ErrorContext> {
    return {
      userId: req.user?.id,
      userEmail: req.user?.email,
      requestPath: req.path,
      requestMethod: req.method,
      requestBody: this.sanitizeRequestBody(req.body),
      requestHeaders: this.sanitizeHeaders(req.headers),
      sessionData: req.session ? {
        id: req.session.id,
        passport: req.session.passport
      } : undefined
    };
  }

  private sanitizeRequestBody(body: any): any {
    if (!body) return body;
    
    const sanitized = { ...body };
    
    // Remove campos sensíveis
    const sensitiveFields = ['password', 'token', 'secret', 'key', 'auth', 'credential'];
    sensitiveFields.forEach(field => {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    });
    
    return sanitized;
  }

  private sanitizeHeaders(headers: any): any {
    if (!headers) return headers;
    
    const sanitized = { ...headers };
    
    // Remove headers sensíveis
    const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key', 'x-auth-token'];
    sensitiveHeaders.forEach(header => {
      if (sanitized[header]) {
        sanitized[header] = '[REDACTED]';
      }
    });
    
    return sanitized;
  }

  // Método para capturar erros não tratados
  setupGlobalErrorHandlers(): void {
    // Capturar erros não tratados
    process.on('uncaughtException', (error) => {
      const errorId = this.captureError(error, 'CRITICAL', 'UNKNOWN', {
        requestPath: 'GLOBAL_UNCAUGHT_EXCEPTION'
      });
      
      console.error(`🚨 EXCEÇÃO CRÍTICA NÃO TRATADA - ID: ${errorId}`);
      console.error('O processo será encerrado em 3 segundos...');
      
      setTimeout(() => {
        process.exit(1);
      }, 3000);
    });

    // Capturar promises rejeitadas não tratadas
    process.on('unhandledRejection', (reason, promise) => {
      const errorId = this.captureError(
        reason as Error, 
        'CRITICAL', 
        'UNKNOWN', 
        {
          requestPath: 'GLOBAL_UNHANDLED_REJECTION',
          requestBody: { promise: promise?.toString() }
        }
      );
      
      console.error(`🚨 PROMISE REJECTION NÃO TRATADA - ID: ${errorId}`);
    });
  }

  // Relatório de saúde do sistema
  getSystemHealthReport(): object {
    const recentErrors = this.getRecentErrors(100);
    const unsolvedErrors = this.getUnsolvedErrors();
    const errorsByCategory = {
      DATABASE: this.getErrorsByCategory('DATABASE').length,
      API_EXTERNAL: this.getErrorsByCategory('API_EXTERNAL').length,
      WEBSOCKET: this.getErrorsByCategory('WEBSOCKET').length,
      AUTH: this.getErrorsByCategory('AUTH').length,
      VALIDATION: this.getErrorsByCategory('VALIDATION').length,
      UNKNOWN: this.getErrorsByCategory('UNKNOWN').length
    };

    return {
      totalErrors: this.errorDatabase.length,
      recentErrors: recentErrors.length,
      unsolvedErrors: unsolvedErrors.length,
      errorsByCategory,
      healthScore: Math.max(0, 100 - (unsolvedErrors.length * 5)),
      lastError: recentErrors[0] || null
    };
  }
}

// Singleton instance
export const errorTracker = new ErrorTracker();

// Auto-configurar handlers globais
errorTracker.setupGlobalErrorHandlers();

export default ErrorTracker;