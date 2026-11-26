import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { createCipheriv, randomBytes } from "node:crypto";
import { sqlite } from "./db";

const TIME_ZONE = "America/Sao_Paulo";
const MAX_BACKUPS = 30;
const BACKUP_PREFIX = "investpro_backup_";
const BACKUP_DIR = path.resolve(
  process.env.SQLITE_BACKUP_DIR?.trim() || path.join(process.cwd(), "database-backups"),
);
const SOURCE_PATH = path.join(process.cwd(), "database", "investpro.db");

let backupInProgress: Promise<string> | null = null;
let cachedDriveToken: { value: string; expiresAt: number } | null = null;
let driveConfigurationWarningShown = false;

type DriveFile = { id: string; name: string; modifiedTime?: string };

function getSaoPauloDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getBackupName(date: string): string {
  return `${BACKUP_PREFIX}${date}.db`;
}

function getDriveConfig() {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN?.trim();
  const folderId = process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID?.trim();
  const encryptionKey = process.env.SQLITE_BACKUP_ENCRYPTION_KEY?.trim();
  if (!clientId || !clientSecret || !refreshToken || !folderId || !encryptionKey) return null;
  const keyBytes = Buffer.from(encryptionKey, "base64");
  if (keyBytes.length !== 32) {
    throw new Error("SQLITE_BACKUP_ENCRYPTION_KEY deve ser uma chave Base64 de 32 bytes.");
  }
  return { clientId, clientSecret, refreshToken, folderId, encryptionKey: keyBytes };
}

async function getDriveAccessToken(): Promise<string> {
  const config = getDriveConfig();
  if (!config) throw new Error("Google Drive não configurado: faltam credenciais OAuth ou ID da pasta.");
  if (cachedDriveToken && cachedDriveToken.expiresAt > Date.now() + 60_000) {
    return cachedDriveToken.value;
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) {
    throw new Error(`Falha OAuth Google Drive (HTTP ${response.status}). Verifique a configuração OAuth.`);
  }
  const token = await response.json() as { access_token?: string; expires_in?: number };
  if (!token.access_token) throw new Error("Google OAuth não retornou access_token.");
  cachedDriveToken = {
    value: token.access_token,
    expiresAt: Date.now() + Math.max(60, token.expires_in ?? 3600) * 1000,
  };
  return token.access_token;
}

async function driveRequest(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await getDriveAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(url, { ...init, headers });
  if (response.status === 401) {
    cachedDriveToken = null;
    const retryToken = await getDriveAccessToken();
    headers.set("Authorization", `Bearer ${retryToken}`);
    return fetch(url, { ...init, headers });
  }
  return response;
}

async function listDriveBackups(): Promise<DriveFile[]> {
  const config = getDriveConfig();
  if (!config) return [];
  const query = `'${config.folderId.replace(/'/g, "\\'")}' in parents and trashed = false and name contains '${BACKUP_PREFIX}'`;
  const params = new URLSearchParams({
    q: query,
    pageSize: "1000",
    orderBy: "name",
    fields: "files(id,name,modifiedTime),nextPageToken",
  });
  const response = await driveRequest(`https://www.googleapis.com/drive/v3/files?${params}`);
  if (!response.ok) throw new Error(`Falha ao listar backups no Drive (HTTP ${response.status}).`);
  const data = await response.json() as { files?: DriveFile[] };
  return data.files ?? [];
}

async function uploadBackupToDrive(filePath: string, fileName: string): Promise<void> {
  const config = getDriveConfig();
  if (!config) {
    if (!driveConfigurationWarningShown) {
      console.warn("[BACKUP] Google Drive ou chave de criptografia não configurados. Backup local será mantido; sincronização remota aguardará configuração segura.");
      driveConfigurationWarningShown = true;
    }
    return;
  }

  const driveFileName = `${fileName}.enc`;
  const existing = (await listDriveBackups()).filter((file) => file.name === driveFileName);
  const target = existing.sort((a, b) =>
    String(b.modifiedTime ?? "").localeCompare(String(a.modifiedTime ?? "")),
  )[0];
  const metadata = target
    ? { name: driveFileName }
    : { name: driveFileName, parents: [config.folderId] };
  const binary = await fs.promises.readFile(filePath);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", config.encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(binary), cipher.final()]);
  const encrypted = Buffer.concat([Buffer.from("IPRODB1"), iv, cipher.getAuthTag(), ciphertext]);
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", new Blob([new Uint8Array(encrypted)], { type: "application/octet-stream" }), driveFileName);

  const endpoint = target
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(target.id)}?uploadType=multipart&fields=id,name,size,modifiedTime`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,modifiedTime";
  const response = await driveRequest(endpoint, {
    method: target ? "PATCH" : "POST",
    body: form,
  });
  if (!response.ok) {
    throw new Error(`Falha ao enviar backup diário ao Google Drive (HTTP ${response.status}).`);
  }

  await pruneDriveBackups();
  console.info(`[BACKUP] Cópia diária sincronizada com Google Drive: ${fileName}`);
}

async function pruneDriveBackups(): Promise<void> {
  const files = await listDriveBackups();
  const dated = files
    .map((file) => ({ ...file, date: file.name.match(/^investpro_backup_(\d{4}-\d{2}-\d{2})\.db$/)?.[1] }))
    .filter((file): file is DriveFile & { date: string } => Boolean(file.date))
    .sort((a, b) => b.date.localeCompare(a.date));

  for (const file of dated.slice(MAX_BACKUPS)) {
    const response = await driveRequest(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}`, {
      method: "DELETE",
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Falha ao aplicar retenção de 30 dias no Drive (HTTP ${response.status}).`);
    }
  }
}

function pruneLocalBackups(): void {
  const files = fs.readdirSync(BACKUP_DIR)
    .map((name) => ({ name, date: name.match(/^investpro_backup_(\d{4}-\d{2}-\d{2})\.db$/)?.[1] }))
    .filter((file): file is { name: string; date: string } => Boolean(file.date))
    .sort((a, b) => b.date.localeCompare(a.date));

  for (const file of files.slice(MAX_BACKUPS)) {
    fs.unlinkSync(path.join(BACKUP_DIR, file.name));
    console.info(`[BACKUP] Backup local antigo removido: ${file.name}`);
  }
}

/**
 * Atualiza uma única cópia por dia no fuso de São Paulo.
 * Usa a API de backup online do SQLite e troca o arquivo atomicamente,
 * sem copiar diretamente o banco ativo nem executar VACUUM nele.
 */
export function createDatabaseBackup(): Promise<string> {
  if (backupInProgress) return backupInProgress;

  backupInProgress = (async () => {
    let temporaryPath = "";
    try {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      if (!fs.existsSync(SOURCE_PATH)) {
        console.warn("[BACKUP] Banco SQLite ainda não existe; backup adiado.");
        return "";
      }

      const date = getSaoPauloDate();
      const fileName = getBackupName(date);
      const backupPath = path.join(BACKUP_DIR, fileName);
      temporaryPath = path.join(BACKUP_DIR, `.${fileName}.${process.pid}.${Date.now()}.tmp`);

      await sqlite.backup(temporaryPath);

      const verificationDb = new Database(temporaryPath, { readonly: true, fileMustExist: true });
      try {
        const integrity = verificationDb.pragma("quick_check", { simple: true });
        if (integrity !== "ok") throw new Error(`SQLite quick_check falhou: ${String(integrity)}`);
      } finally {
        verificationDb.close();
      }

      await fs.promises.rename(temporaryPath, backupPath);
      temporaryPath = "";
      await fs.promises.chmod(backupPath, 0o600);

      const size = fs.statSync(backupPath).size;
      console.info(`[BACKUP] ${fileName} atualizado com integridade validada (${(size / 1024 / 1024).toFixed(2)} MB).`);

      pruneLocalBackups();
      try {
        await uploadBackupToDrive(backupPath, fileName);
      } catch (driveError: any) {
        console.error("[BACKUP] Cópia local validada, mas sincronização com Google Drive falhou:", driveError?.message || String(driveError));
      }
      return backupPath;
    } catch (error) {
      console.error("[BACKUP] Erro ao criar backup SQLite:", error);
      return "";
    } finally {
      if (temporaryPath && fs.existsSync(temporaryPath)) {
        try { await fs.promises.unlink(temporaryPath); } catch { /* limpeza best-effort */ }
      }
    }
  })().finally(() => {
    backupInProgress = null;
  });

  return backupInProgress;
}

export function listBackups(): Array<{ name: string; date: Date; size: string }> {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs.readdirSync(BACKUP_DIR)
      .filter((name) => /^investpro_backup_\d{4}-\d{2}-\d{2}\.db$/.test(name))
      .map((name) => {
        const filePath = path.join(BACKUP_DIR, name);
        const stats = fs.statSync(filePath);
        return { name, date: stats.mtime, size: `${(stats.size / 1024 / 1024).toFixed(2)} MB` };
      })
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  } catch (error) {
    console.error("[BACKUP] Erro ao listar backups:", error);
    return [];
  }
}

/**
 * Restaura somente arquivos diários reconhecidos. A cópia atual é preservada
 * antes da troca; o servidor deve ser reiniciado para reabrir o banco.
 */
export async function restoreBackup(backupFileName: string): Promise<boolean> {
  if (!/^investpro_backup_\d{4}-\d{2}-\d{2}\.db$/.test(backupFileName)) return false;
  const backupPath = path.join(BACKUP_DIR, path.basename(backupFileName));
  if (!fs.existsSync(backupPath)) return false;

  const candidate = new Database(backupPath, { readonly: true, fileMustExist: true });
  try {
    const integrity = candidate.pragma("quick_check", { simple: true });
    if (integrity !== "ok") throw new Error("Backup inválido: quick_check não retornou ok.");
  } finally {
    candidate.close();
  }

  const currentPath = SOURCE_PATH;
  const preRestorePath = path.join(BACKUP_DIR, `pre_restore_${Date.now()}.db`);
  if (fs.existsSync(currentPath)) await sqlite.backup(preRestorePath);
  await fs.promises.copyFile(backupPath, `${currentPath}.restore.tmp`);
  await fs.promises.rename(`${currentPath}.restore.tmp`, currentPath);
  console.warn(`[BACKUP] Banco restaurado de ${backupFileName}. Reinicie o processo para reabrir a conexão SQLite.`);
  return true;
}
