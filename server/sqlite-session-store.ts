import session from "express-session";
import { sqlite } from "./db";

function expiryFor(data: session.SessionData): string {
  const cookie = data.cookie;
  const explicit = cookie?.expires ? new Date(cookie.expires).getTime() : Number.NaN;
  const maxAge = Number(cookie?.maxAge);
  const expiresAt = Number.isFinite(explicit)
    ? explicit
    : Date.now() + (Number.isFinite(maxAge) && maxAge > 0 ? maxAge : 365 * 24 * 60 * 60 * 1000);
  return new Date(Math.max(expiresAt, Date.now() + 1000)).toISOString();
}

/**
 * Persistent sessions in the shared SQLite database.
 * The sessions table is replicated to Supabase, avoiding Neon quota dependency.
 */
export class SqliteSessionStore extends session.Store {
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    super();
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY NOT NULL,
        sess TEXT NOT NULL,
        expire DATETIME NOT NULL
      );
      CREATE INDEX IF NOT EXISTS IDX_session_expire ON sessions(expire);
    `);
    this.cleanupInterval = setInterval(() => {
      try {
        const result = sqlite.prepare(
          "DELETE FROM sessions WHERE julianday(expire) <= julianday('now')"
        ).run();
        if (result.changes > 0) {
          console.log(`🧹 [SessionStore] ${result.changes} sessão(ões) expirada(s) removida(s).`);
        }
      } catch (error: any) {
        console.warn("[SessionStore] Limpeza de sessões falhou:", error?.message || error);
      }
    }, 60 * 60 * 1000);
    this.cleanupInterval.unref();
    console.log("✅ [SessionStore] SQLite persistente compartilhado iniciado; sincronização Supabase habilitada.");
  }

  get(sid: string, callback: (err: any, sessionData?: session.SessionData | null) => void): void {
    try {
      const row = sqlite.prepare("SELECT sess, expire FROM sessions WHERE sid = ?").get(sid) as any;
      if (!row) return callback(null, null);
      const expiresAt = typeof row.expire === "number"
        ? row.expire * 1000
        : Date.parse(String(row.expire));
      if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
        sqlite.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
        return callback(null, null);
      }
      callback(null, JSON.parse(row.sess));
    } catch (error) {
      callback(error);
    }
  }

  set(sid: string, data: session.SessionData, callback?: (err?: any) => void): void {
    try {
      sqlite.prepare(`
        INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET
          sess = excluded.sess,
          expire = excluded.expire
      `).run(sid, JSON.stringify(data), expiryFor(data));
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }

  touch(sid: string, data: session.SessionData, callback?: (err?: any) => void): void {
    try {
      sqlite.prepare("UPDATE sessions SET sess = ?, expire = ? WHERE sid = ?")
        .run(JSON.stringify(data), expiryFor(data), sid);
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }

  destroy(sid: string, callback?: (err?: any) => void): void {
    try {
      sqlite.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }

  clear(callback?: (err?: any) => void): void {
    try {
      sqlite.prepare("DELETE FROM sessions").run();
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }

  length(callback: (err: any, length?: number) => void): void {
    try {
      const row = sqlite.prepare(
        "SELECT COUNT(*) AS count FROM sessions WHERE julianday(expire) > julianday('now')"
      ).get() as any;
      callback(null, Number(row?.count ?? 0));
    } catch (error) {
      callback(error);
    }
  }

  all(callback: (err: any, sessions?: Record<string, session.SessionData>) => void): void {
    try {
      const rows = sqlite.prepare(
        "SELECT sid, sess FROM sessions WHERE julianday(expire) > julianday('now')"
      ).all() as any[];
      const result: Record<string, session.SessionData> = {};
      for (const row of rows) result[row.sid] = JSON.parse(row.sess);
      callback(null, result);
    } catch (error) {
      callback(error);
    }
  }

  close(): void {
    clearInterval(this.cleanupInterval);
  }
}
