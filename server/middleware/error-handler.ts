import { Request, Response, NextFunction } from 'express';
import { errorTracker } from '../services/error-tracker';

export interface CustomError extends Error {
  statusCode?: number;
  status?: number;
  code?: string;
  category?: 'DATABASE' | 'API_EXTERNAL' | 'WEBSOCKET' | 'AUTH' | 'VALIDATION' | 'UNKNOWN';
}

// Middleware para capturar todos os erros
export function globalErrorHandler(err: CustomError, req: Request, res: Response, next: NextFunction) {
  // Determinar nível do erro
  const level = err.statusCode && err.statusCode < 500 ? 'WARNING' : 'ERROR';
  
  // Determinar categoria
  const category = err.category || determineErrorCategory(err);
  
  // Capturar erro com contexto completo (sanitizado)
  const sanitizedContext = errorTracker.createContextFromRequest(req);
  const errorId = errorTracker.captureError(err, level, category, {
    ...sanitizedContext,
    requestQuery: req.query,
    requestParams: req.params
  });

  // Resposta padronizada
  const statusCode = err.statusCode || err.status || 500;
  
  res.status(statusCode).json({
    success: false,
    message: statusCode >= 500 ? 'Erro interno do servidor' : err.message,
    errorId,
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV === 'development' && {
      stack: err.stack,
      originalError: err.message
    })
  });
}

// Middleware para capturar erros async
export function asyncErrorHandler(fn: Function) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Determinar categoria do erro baseado no erro
function determineErrorCategory(err: CustomError): CustomError['category'] {
  const message = err.message?.toLowerCase() || '';
  const stack = err.stack?.toLowerCase() || '';
  
  if (message.includes('database') || message.includes('sqlite') || message.includes('sql')) {
    return 'DATABASE';
  }
  
  if (message.includes('websocket') || message.includes('ws') || stack.includes('websocket')) {
    return 'WEBSOCKET';
  }
  
  if (message.includes('auth') || message.includes('unauthorized') || message.includes('forbidden')) {
    return 'AUTH';
  }
  
  if (message.includes('validation') || message.includes('invalid') || err.statusCode === 400) {
    return 'VALIDATION';
  }
  
  if (message.includes('fetch') || message.includes('request') || message.includes('api')) {
    return 'API_EXTERNAL';
  }
  
  return 'UNKNOWN';
}

// Middleware para log de requests (sem duplicar erro tracking)
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  
  // Override do res.json para log de performance apenas
  const originalJson = res.json;
  res.json = function(this: Response, body: any) {
    const duration = Date.now() - start;
    
    // Log apenas para performance monitoring, não para error tracking
    if (res.statusCode >= 400) {
      console.log(`⚡ Request: ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
    }
    
    return originalJson.call(this, body);
  };
  
  next();
}

// Wrapper para funções que podem gerar erros
export function safeExecute<T>(
  operation: () => Promise<T>,
  context: {
    operationName: string;
    category?: CustomError['category'];
    level?: 'CRITICAL' | 'ERROR' | 'WARNING' | 'INFO';
  }
): Promise<T | null> {
  return operation().catch(error => {
    const errorId = errorTracker.captureError(
      error,
      context.level || 'ERROR',
      context.category || 'UNKNOWN',
      {
        requestPath: context.operationName,
        requestMethod: 'SAFE_EXECUTE'
      }
    );
    
    console.error(`❌ Erro em ${context.operationName} - ID: ${errorId}`);
    return null;
  });
}

export default {
  globalErrorHandler,
  asyncErrorHandler,
  requestLogger,
  safeExecute
};