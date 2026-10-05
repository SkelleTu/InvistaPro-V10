import type { Express } from "express";
import { createServer, type Server } from "http";
import { dualStorage as dbStorage } from "./storage-dual";
import { setupAuth, isAuthenticated, isApproved, hashPassword, comparePasswords, generateVerificationCode } from "./auth";
import { db } from "./db";
import { eq } from "drizzle-orm";
import { registerUserSchema, loginSchema, phoneVerificationSchema, insertMovimentoSchema, updateUserSchema, uploadDocumentSchema, withdrawalRequestSchema, users, movimentos, documentos } from "@shared/schema";
import { notificationService } from "./notifications";
// import { internalEmailService } from "./internalEmailService"; // Sistema removido
import { autonomousEmailService } from "./autonomousEmailService";
import { sendPasswordResetWithNodemailer } from './nodemailerService';
import { sendPasswordResetEmail } from "./sendgridService";
import { whatsappService } from "./whatsappService";
import { marketingManager, addUserToMarketing, removeUserFromMarketing } from './marketingEmailService';
import { validateUserData, ValidationError } from "./validators";
import passport from "passport";
import QRCode from "qrcode";
import multer from "multer";
import path from "path";
import crypto from "crypto";
import { mkdirSync } from "fs";
import kycRoutes from "./routes/kyc";
import adminRoutes from "./routes/admin";
import monitorRoutes from "./routes/monitor-routes";
import learningRoutes from "./routes/learning-routes";
import metaTraderRoutes from "./routes/metatrader-routes";
import fetch from "node-fetch";
import express from "express";
import { keepAliveSystem } from "./services/keep-alive-system";
import { marketDataCollector } from "./services/market-data-collector";
import { 
  derivTokenConfigSchema, 
  tradeModeConfigSchema, 
  manualTradeSchema,
  type DerivToken,
  type TradeConfiguration,
  type TradeOperation,
  type AiLog,
  blockedAssets
} from "@shared/schema";
import { and } from "drizzle-orm";
import { derivAPI, DerivAPIService } from './services/deriv-api';
import { executeFrenetic9TokensBurst, getSlotBalances, closeAllSlotConnections, selectBestAsset } from './services/frenetico-9tokens';
import { huggingFaceAI } from './services/huggingface-ai';
import { isolatedAutoTradingScheduler as autoTradingScheduler } from './services/isolated-auto-trading-scheduler';
import { realStatsTracker } from './services/real-stats-tracker';
import { isAuthorizedEmail, ACCESS_DENIED_MESSAGE } from './config/access';
import { errorTracker } from './services/error-tracker';
import observabilityRoutes from "./routes/observability-routes";
import { contractMonitor } from './services/contract-monitor';
import { asyncErrorHandler } from './middleware/error-handler';
import { tpmSystem } from './services/tpm-system';
import { getRegistryInfo } from './services/url-registry';
import { registerUniversalSession, setUniversalTradingArmed, disconnectUniversalSession } from './services/universal-server-session';

// PIX payload generator compatível com Santander