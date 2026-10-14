import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import session from "express-session";
import crypto from "crypto";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { dualStorage as storage } from "./storage-dual";
import { User } from "@shared/schema";
import { createRequire } from "module";
import { isAuthorizedEmail, ACCESS_DENIED_MESSAGE } from "./config/access";

declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      nomeCompleto: string;
      contaAprovada: boolean | null;
      telefoneVerificado: boolean | null;
      saldo: number;
      passwordHash: string;
      codigoVerificacao?: string | null;

    }
  }
}

const require = createRequire(import.meta.url);
const createMemoryStoreFactory: any = require("memorystore");
const connectPgSimpleFactory: any = require("connect-pg-simple");

const scryptAsync = promisify(scrypt);

// Password hashing functions
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

export async function comparePasswords(supplied: string, stored: string): Promise<boolean> {
  const [hashed, salt] = stored.split(".");
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

// Generate verification code
export function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function setupAuth(app: Express) {
  const configuredSessionSecret = process.env.SESSION_SECRET?.trim();
  const isProduction = process.env.NODE_ENV === "production";
  // Persistent login requires a stable secret across restarts and instances.
  // Fail at boot rather than silently invalidating every session after restart.
  if (isProduction && !configuredSessionSecret) {
    throw new Error("SESSION_SECRET is required in production for persistent and secure authentication.");
  }
  if (isProduction && !process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required in production for persistent authenticated sessions.");
  }
  const sessionSecret = configuredSessionSecret || crypto.randomBytes(32).toString("hex");

  // PostgreSQL store is mandatory in production; MemoryStore is development-only.
  let sessionStore: session.Store;
  if (process.env.DATABASE_URL) {
    const PgStore = connectPgSimpleFactory(session);
    sessionStore = new PgStore({
      conString: process.env.DATABASE_URL,
      createTableIfMissing: true,
      tableName: "user_sessions",
    });
    console.log("✅ [SessionStore] PostgreSQL selecionado para sessões persistentes.");
  } else {
    const MemoryStore = createMemoryStoreFactory(session);
    sessionStore = new MemoryStore({ checkPeriod: 24 * 60 * 60 * 1000 });
    console.warn("⚠️ [SessionStore] DATABASE_URL ausente; usando MemoryStore em modo fallback.");
  }

  // 1 ano em ms — usuário só é deslogado se limpar cookies/cache ou clicar em "Sair"
  const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

  const sessionSettings: session.SessionOptions = {
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false, // Não cria sessão para visitantes não logados
    rolling: true,            // Renova o cookie a cada requisição (mantém vivo enquanto usa)
    store: sessionStore,
    name: 'investpro.sid',
    cookie: {
      httpOnly: true,
      secure: isProduction,
      maxAge: ONE_YEAR_MS,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
    },
  };

  app.set("trust proxy", 1);
  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  // Passport local strategy
  passport.use(
    new LocalStrategy(
      { usernameField: "email" },
      async (email, password, done) => {
        try {
          console.log('🔍 Buscando usuário por email:', email);
          const user = await storage.getUserByEmail(email);
          if (!user) {
            console.log('❌ Usuário não encontrado:', email);
            return done(null, false, { message: "Email não encontrado" });
          }

          console.log('👤 Usuário encontrado:', { id: user.id, email: user.email, aprovado: user.contaAprovada });

          if (!user.contaAprovada) {
            console.log('⏳ Conta não aprovada:', email);
            return done(null, false, { message: "Conta ainda não aprovada pelo administrador" });
          }



          console.log('🔐 Verificando senha para:', email);
          const isValidPassword = await comparePasswords(password, user.passwordHash);
          if (!isValidPassword) {
            console.log('❌ Senha incorreta para:', email);
            return done(null, false, { message: "Senha incorreta" });
          }

          console.log('✅ Login validado com sucesso para:', email);
          return done(null, user);
        } catch (error) {
          console.error('❌ Erro na estratégia do Passport:', error);
          return done(error);
        }
      }
    )
  );

  passport.serializeUser((user: any, done) => done(null, user.id));
  
  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await storage.getUser(id);
      done(null, user || false);
    } catch (error) {
      done(error);
    }
  });
}

// Middleware to check if user is authenticated
type DelegatedBrowserCheck = "active" | "inactive" | "unavailable";

async function checkDelegatedBrowserSession(req: any): Promise<DelegatedBrowserCheck> {
  const delegated = req.session?.universalBrowserAccess;
  if (!delegated) return "active";
  const universalUrl = String(process.env.UNIVERSAL_SERVER_URL ?? "").replace(/\/$/, "");
  const serviceKey = String(process.env.INVISTA_UNIVERSAL_SERVER_KEY ?? "").trim();
  const sessionId = String(delegated.sessionId ?? "");
  const userId = String(delegated.userId ?? "");
  const platform = String(delegated.platform ?? "");
  const authenticatedUserId = String(req.user?.id ?? "");
  const expectedPlatform = process.env.INVISTA_PLATFORM === "aura" ? "aura" : "main";
  // Bind the delegated cookie to both the Passport identity and this deployment.
  // A valid Universal session for a different user/platform must never authorize this request.
  if (!authenticatedUserId || authenticatedUserId !== userId || platform !== expectedPlatform) {
    return "inactive";
  }
  if (!universalUrl || !serviceKey || !sessionId || !userId || !["main", "aura"].includes(platform)) {
    return "unavailable";
  }
  try {
    const query = new URLSearchParams({ sessionId, userId, platform });
    const response = await fetch(`${universalUrl}/api/invista/session/remote-status?${query.toString()}`, {
      method: "GET",
      headers: { "x-invista-server-key": serviceKey },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return "unavailable";
    const result: any = await response.json();
    return result?.ok === true && result?.active === true ? "active" : "inactive";
  } catch {
    return "unavailable";
  }
}

export async function isAuthenticated(req: any, res: any, next: any) {
  // Passport normally installs this method through passport.session().
  if (typeof req.isAuthenticated !== "function" || !req.isAuthenticated()) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  // Only delegated Browser Use sessions incur the Universal Server check.
  // If the source login is logged out or its heartbeat expires, remote access is revoked.
  const delegatedStatus = await checkDelegatedBrowserSession(req);
  if (delegatedStatus === "active") return next();
  if (delegatedStatus === "unavailable") {
    return res.status(503).json({ message: "Não foi possível validar a sessão remota. Tente novamente." });
  }

  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.session?.destroy) {
    req.session.destroy(() => {
      res.clearCookie("investpro.sid", { path: "/" });
      res.status(401).json({ message: "A sessão de origem foi encerrada. Faça login novamente." });
    });
    return;
  }
  return res.status(401).json({ message: "A sessão de origem foi encerrada. Faça login novamente." });
}

// Middleware to check if user account is approved
export function isApproved(req: any, res: any, next: any) {
  if (req.user && req.user.contaAprovada) {
    return next();
  }
  res.status(403).json({ message: "Conta ainda não aprovada pelo administrador" });
}

// Middleware específico para Sistema de Renda Variável
export function isAuthorizedForTradingSystem(req: any, res: any, next: any) {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  
  if (!isAuthorizedEmail(req.user.email)) {
    console.log(`❌ Acesso negado ao Sistema de Renda Variável para: ${req.user.email}`);
    return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
  }
  
  console.log(`✅ Acesso autorizado ao Sistema de Renda Variável para: ${req.user.email}`);
  return next();
}