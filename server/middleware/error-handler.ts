import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { errorTracker } from '../services/error-tracker';

export interface CustomError extends Error {
  statusCode?: number;
  status?: number;
  code?: string;
  category?: 'DATABASE' | 'API_EXTERNAL' | 'WEBSOCKET' | 'AUTH' | 'VALIDATION' | 'UNKNOWN';
}

const SENSITIVE_KEYS = /password|passwd|pwd|token|secret|authorization|cookie|api[_-]?key|apikey|database[_-]?url|session/i;
const MAX_FIELD_LENGTH = 1200;

function redact(value: any, depth = 0): any {
  if (depth > 5) return '[MAX_DEPTH]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > MAX_FIELD_LENGTH ? value.slice(0, MAX_FIELD_LENGTH) + '…' : value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map(v => redact(v, depth + 1));
  const out: Record<string, any> = {};
  for (const [key, val] of Object.entries(value)) out[key] = SENSITIVE_KEYS.test(key) ? '[REDACTED]' : redact(val, depth + 1);
  return out;
}

function safeRequest(req: Request) {
  return {
    method: req.method, path: req.path, originalUrl: req.originalUrl,
    query: redact(req.query), params: redact(req.params), body: redact(req.body),
    headers: {
      userAgent: req.get('user-agent') || undefined,
      contentType: req.get('content-type') || undefined,
      referer: req.get('referer') || undefined,
      origin: req.get('origin') || undefined,
      host: req.get('host') || undefined
    }
  };
}

function writeDiagnostic(event: string, data: Record<string, any>) {
  console.log(JSON.stringify({ diagnostic: true, event, timestamp: new Date().toISOString(), ...data }));
}

export function globalErrorHandler(err: CustomError, req: Request, res: Response, next: NextFunction) {
  const requestId = (req as any).requestId || 'no-request-id';
  const level = err.statusCode && err.statusCode < 500 ? 'WARNING' : 'ERROR';
  const category = err.category || determineErrorCategory(err);
  const sanitizedContext = errorTracker.createContextFromRequest(req);
  const errorId = errorTracker.captureError(err, level, category, {
    ...sanitizedContext, requestId, requestQuery: redact(req.query), requestParams: redact(req.params)
  });
  writeDiagnostic('REQUEST_ERROR', {
    requestId, errorId, category, level,
    statusCode: err.statusCode || err.status || 500,
    error: err.message, stack: err.stack, request: safeRequest(req)
  });
  const statusCode = err.statusCode || err.status || 500;
  if (!res.headersSent) {
    res.status(statusCode).json({
      success: false,
      message: statusCode >= 500 ? 'Erro interno do servidor' : err.message,
      errorId, requestId, timestamp: new Date().toISOString(),
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack, originalError: err.message })
    });
  }
}

export function asyncErrorHandler(fn: Function) {
  return (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res, next)).catch(next);
}

function determineErrorCategory(err: CustomError): CustomError['category'] {
  const message = err.message?.toLowerCase() || '';
  const stack = err.stack?.toLowerCase() || '';
  if (message.includes('database') || message.includes('sqlite') || message.includes('sql')) return 'DATABASE';
  if (message.includes('websocket') || message.includes('ws') || stack.includes('websocket')) return 'WEBSOCKET';
  if (message.includes('auth') || message.includes('unauthorized') || message.includes('forbidden')) return 'AUTH';
  if (message.includes('validation') || message.includes('invalid') || err.statusCode === 400) return 'VALIDATION';
  if (message.includes('fetch') || message.includes('request') || message.includes('api')) return 'API_EXTERNAL';
  return 'UNKNOWN';
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const requestId = crypto.randomUUID();
  (req as any).requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  const start = Date.now();
  let capturedResponse: any = undefined;
  const originalJson = res.json;
  res.json = function(this: Response, body: any) {
    capturedResponse = redact(body);
    return originalJson.call(this, body);
  };
  writeDiagnostic('REQUEST_START', { requestId, request: safeRequest(req) });
  res.on('finish', () => writeDiagnostic('REQUEST_END', {
    requestId, method: req.method, path: req.path, statusCode: res.statusCode,
    durationMs: Date.now() - start, response: capturedResponse,
    contentType: res.getHeader('content-type') || undefined
  }));
  res.on('close', () => {
    if (!res.writableEnded) writeDiagnostic('REQUEST_ABORTED', {
      requestId, method: req.method, path: req.path, durationMs: Date.now() - start
    });
  });
  next();
}

export function safeExecute<T>(
  operation: () => Promise<T>,
  context: { operationName: string; category?: CustomError['category']; level?: 'CRITICAL' | 'ERROR' | 'WARNING' | 'INFO'; }
): Promise<T | null> {
  return operation().catch(error => {
    const errorId = errorTracker.captureError(error, context.level || 'ERROR', context.category || 'UNKNOWN', {
      requestPath: context.operationName, requestMethod: 'SAFE_EXECUTE'
    });
    console.error(`❌ Erro em ${context.operationName} - ID: ${errorId}`);
    return null;
  });
}

export default { globalErrorHandler, asyncErrorHandler, requestLogger, safeExecute };
