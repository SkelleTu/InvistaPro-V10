/**
 * URL REGISTRY SERVICE - INVESTAPRO
 * Registra a URL atual do servidor em um serviço externo (jsonblob.com)
 * para que o EA do MT5 possa descobrir automaticamente a nova URL
 */

import fetch from 'node-fetch';
import Database from 'better-sqlite3';
import path from 'path';

const JSONBLOB_API = 'https://jsonblob.com/api/jsonBlob';
const DB_KEY = 'url_registry_blob_id';

let cachedBlobId: string | null = null;
let currentServerUrl: string = '';

function getDb() {
  const dbPath = path.join(process.cwd(), 'investapro.db');
  return new Database(dbPath);
}

function getBlobIdFromDb(): string | null {
  try {
    const db = getDb();
    db.prepare(`CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT)`).run();
    const row = db.prepare('SELECT value FROM kv_store WHERE key = ?').get(DB_KEY) as { value: string } | undefined;
    db.close();
    return row?.value || null;
  } catch {
    return null;
  }
}

function saveBlobIdToDb(blobId: string) {
  try {
    const db = getDb();
    db.prepare(`CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT)`).run();
    db.prepare('INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)').run(DB_KEY, blobId);
    db.close();
  } catch (err) {
    console.warn('⚠️ [URL Registry] Não foi possível salvar blob ID no DB:', err);
  }
}

async function createBlob(url: string): Promise<string | null> {
  try {
    const response = await fetch(JSONBLOB_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ serverUrl: url, updatedAt: new Date().toISOString() }),
    });

    if (!response.ok) return null;

    const location = response.headers.get('Location') || '';
    const blobId = location.split('/').pop() || null;
    return blobId;
  } catch {
    return null;
  }
}

async function updateBlob(blobId: string, url: string): Promise<boolean> {
  try {
    const response = await fetch(`${JSONBLOB_API}/${blobId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ serverUrl: url, updatedAt: new Date().toISOString() }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function initUrlRegistry(): Promise<void> {
  const domain = process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS?.split(',')[0] || '';
  currentServerUrl = domain ? `https://${domain}` : '';

  if (!currentServerUrl) {
    console.warn('⚠️ [URL Registry] REPLIT_DEV_DOMAIN não encontrado — URL Registry desativado');
    return;
  }

  console.log(`🌐 [URL Registry] URL atual do servidor: ${currentServerUrl}`);

  cachedBlobId = getBlobIdFromDb();

  if (cachedBlobId) {
    const updated = await updateBlob(cachedBlobId, currentServerUrl);
    if (updated) {
      console.log(`✅ [URL Registry] URL atualizada no registro externo (ID: ${cachedBlobId})`);
      console.log(`📡 [URL Registry] EA pode descobrir via: https://jsonblob.com/api/jsonBlob/${cachedBlobId}`);
    } else {
      console.warn('⚠️ [URL Registry] Falha ao atualizar blob, criando novo...');
      cachedBlobId = null;
    }
  }

  if (!cachedBlobId) {
    cachedBlobId = await createBlob(currentServerUrl);
    if (cachedBlobId) {
      saveBlobIdToDb(cachedBlobId);
      console.log(`✅ [URL Registry] Novo registro criado (ID: ${cachedBlobId})`);
      console.log(`📡 [URL Registry] EA pode descobrir via: https://jsonblob.com/api/jsonBlob/${cachedBlobId}`);
    } else {
      console.warn('⚠️ [URL Registry] Não foi possível criar registro externo de URL');
    }
  }
}

export function getRegistryInfo() {
  return {
    currentServerUrl,
    blobId: cachedBlobId,
    discoveryUrl: cachedBlobId ? `https://jsonblob.com/api/jsonBlob/${cachedBlobId}` : null,
    eaDiscoveryUrl: cachedBlobId ? `https://jsonblob.com/api/jsonBlob/${cachedBlobId}` : null,
  };
}
