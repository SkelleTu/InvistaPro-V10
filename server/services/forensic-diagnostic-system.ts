import { errorTracker, type DetailedError } from './error-tracker';

export interface ForensicFinding {
  errorId: string;
  severity: DetailedError['level'];
  category: DetailedError['category'];
  message: string;
  occurrenceCount: number;
  firstSeen: string;
  lastSeen: string;
  sourceFile?: string;
  sourceLine?: number;
  sourceColumn?: number;
  endpoint?: string;
  diagnosis: string;
  probableCause: string;
  correction: string;
  verification: string;
  confidence: number;
  solved: boolean;
}

const RULES: Array<{
  test: (e: DetailedError) => boolean;
  diagnosis: string;
  cause: string;
  correction: string;
  verification: string;
  confidence: number;
}> = [
  {
    test: e => /EADDRINUSE|address already in use/i.test(e.message),
    diagnosis: 'A porta exigida pelo processo já está ocupada.',
    cause: 'Outro listener iniciou na mesma porta ou houve inicialização duplicada.',
    correction: 'Garanta um único server.listen e use process.env.PORT em 0.0.0.0.',
    verification: 'Reinicie o serviço e confirme um único listener e respostas HTTP 2xx.',
    confidence: 96
  },
  {
    test: e => /502|bad gateway|upstream|health check/i.test(e.message),
    diagnosis: 'O proxy encontrou falha ao alcançar ou validar a aplicação.',
    cause: 'Processo, porta, health check ou inicialização pesada pode impedir o upstream.',
    correction: 'Mantenha o listener HTTP independente das integrações externas e adicione health check leve.',
    verification: 'Teste /api/health e depois o endpoint que falhava; confirme ausência de 502.',
    confidence: 91
  },
  {
    test: e => /520|ETIMEDOUT|ENETUNREACH|ECONNRESET|ECONNREFUSED/i.test(e.message),
    diagnosis: 'Uma dependência externa está falhando na rede.',
    cause: 'A integração externa está indisponível, bloqueada ou excedendo timeout.',
    correction: 'Isole a integração, aplique timeout, backoff exponencial e circuit breaker.',
    verification: 'Confirme que o HTTP continua saudável mesmo quando a integração externa falha.',
    confidence: 94
  },
  {
    test: e => /websocket|WebSocket|socket hang up/i.test(e.message),
    diagnosis: 'A conexão WebSocket está falhando ou reconectando em excesso.',
    cause: 'Endpoint externo instável, sessão inválida ou política de reconexão agressiva.',
    correction: 'Desacople o WebSocket do HTTP e limite reconexões com backoff e jitter.',
    verification: 'Observe estabilidade HTTP e redução dos ciclos de reconnect nos logs.',
    confidence: 95
  },
  {
    test: e => /unauthorized|forbidden|invalid token|authentication|login/i.test(e.message),
    diagnosis: 'A falha está relacionada à autenticação ou autorização.',
    cause: 'Credencial inválida, sessão expirada, middleware incorreto ou rota protegida.',
    correction: 'Valide sessão/token, middleware e contrato do endpoint sem registrar segredos.',
    verification: 'Execute login válido e inválido e confirme 2xx/4xx previsíveis.',
    confidence: 90
  },
  {
    test: e => /cannot find module|module not found|ERR_MODULE_NOT_FOUND/i.test(e.message),
    diagnosis: 'Uma dependência ou caminho de importação não foi resolvido.',
    cause: 'Pacote ausente, nome incorreto ou diferença de ambiente.',
    correction: 'Corrija o import ou package.json e execute npm install antes do build.',
    verification: 'Execute npm run check e npm run build sem erros.',
    confidence: 99
  },
  {
    test: e => /database|postgres|sqlite|sql|drizzle|connection pool/i.test(e.message),
    diagnosis: 'A falha aponta para persistência ou conexão com banco.',
    cause: 'URL, schema, conexão, migração ou limite de conexões.',
    correction: 'Valide DATABASE_URL, migrações e pool; mantenha falhas de banco fora do listener HTTP.',
    verification: 'Execute uma consulta de saúde e uma operação de leitura/escrita controlada.',
    confidence: 88
  },
  {
    test: e => /validation|invalid|zod|schema/i.test(e.message),
    diagnosis: 'Os dados recebidos não atendem ao contrato esperado.',
    cause: 'Payload incompatível, campo ausente ou tipo incorreto.',
    correction: 'Aponte o campo inválido e alinhe o payload ao schema antes da execução.',
    verification: 'Repita a requisição com payload válido e confirme resposta 2xx.',
    confidence: 93
  }
];

function sourceFromStack(stack?: string): { sourceFile?: string; sourceLine?: number; sourceColumn?: number } {
  if (!stack) return {};
  const matches = [...stack.matchAll(/(?:at .*?\()?((?:[A-Za-z]:)?[^\s()]+):(\d+):(\d+)\)?/g)];
  const preferred = matches.find(m => !/node_modules/.test(m[1]) && !/internal\//.test(m[1])) || matches[0];
  if (!preferred) return {};
  return { sourceFile: preferred[1], sourceLine: Number(preferred[2]), sourceColumn: Number(preferred[3]) };
}

function endpointOf(e: DetailedError): string | undefined {
  if (!e.context.requestPath) return undefined;
  return `${e.context.requestMethod || 'REQUEST'} ${e.context.requestPath}`;
}

function findingFor(error: DetailedError, all: DetailedError[]): ForensicFinding {
  const normalized = error.message.toLowerCase();
  const matches = all.filter(e => e.message.toLowerCase() === normalized && e.category === error.category);
  const rule = RULES.find(r => r.test(error));
  const source = sourceFromStack(error.stack);
  const fallback = {
    diagnosis: 'Falha registrada sem assinatura conhecida.',
    cause: 'É necessário correlacionar stack trace, endpoint e contexto do evento.',
    correction: 'Abra o erro pelo ID, corrija a primeira causa no stack trace e valide novamente.',
    verification: 'Reexecute o fluxo original e confirme que o mesmo erro não reaparece.',
    confidence: 72
  };
  const selected = rule || { test: () => true, ...fallback };
  return {
    errorId: error.id,
    severity: error.level,
    category: error.category,
    message: error.message,
    occurrenceCount: matches.length,
    firstSeen: matches[matches.length - 1]?.timestamp || error.timestamp,
    lastSeen: matches[0]?.timestamp || error.timestamp,
    ...source,
    endpoint: endpointOf(error),
    diagnosis: selected.diagnosis,
    probableCause: selected.cause,
    correction: selected.correction,
    verification: selected.verification,
    confidence: selected.confidence,
    solved: Boolean(error.solved)
  };
}

class ForensicDiagnosticSystem {
  scan(limit = 100): {
    generatedAt: string;
    coverage: string;
    totalTracked: number;
    unsolved: number;
    critical: number;
    findings: ForensicFinding[];
  } {
    const errors = errorTracker.getRecentErrors(Math.min(Math.max(limit, 1), 500));
    const findings = errors.map(e => findingFor(e, errorTracker.getRecentErrors(500)));
    return {
      generatedAt: new Date().toISOString(),
      coverage: 'Todos os eventos atualmente capturados pelo ErrorTracker: exceções globais, rejeições, erros HTTP e safeExecute.',
      totalTracked: errors.length,
      unsolved: findings.filter(f => !f.solved).length,
      critical: findings.filter(f => f.severity === 'CRITICAL').length,
      findings
    };
  }

  get(errorId: string): ForensicFinding | null {
    const error = errorTracker.getErrorById(errorId);
    if (!error) return null;
    return findingFor(error, errorTracker.getRecentErrors(500));
  }

  solve(errorId: string, recovery: string): boolean {
    return errorTracker.markErrorAsSolved(errorId, recovery);
  }
}

export const forensicDiagnosticSystem = new ForensicDiagnosticSystem();
export default forensicDiagnosticSystem;
