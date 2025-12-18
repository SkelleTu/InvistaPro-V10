import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import session from "express-session";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { User } from "@shared/schema";
import { MemoryStore } from "express-session";
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
  // Session configuration with MemoryStore (local storage)
  const sessionStore = new MemoryStore();

  const isProduction = process.env.NODE_ENV === 'production';
  
  const sessionSettings: session.SessionOptions = {
    secret: process.env.SESSION_SECRET || "change-this-in-production",
    resave: true, // Força re-save da sessão
    saveUninitialized: true, // Salva sessões não inicializadas
    store: sessionStore,
    name: 'investpro.sid', // Nome customizado para o cookie
    cookie: {
      httpOnly: true,
      secure: isProduction, // Usar HTTPS apenas em produção
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: isProduction ? 'none' : 'lax', // 'none' para cross-origin em produção
      path: '/', // Garantir que cookie é válido para todo o site
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
export function isAuthenticated(req: any, res: any, next: any) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: "Unauthorized" });
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