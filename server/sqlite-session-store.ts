import session from "express-session";
import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "database", "sessions.db");

/**
 * Persistent SQLite-backed session store.
 * Sessions survive server restarts and are only cleared when:
 * - The user manually logs out
 * - The browser cache/cookies are cleared
 * - The session cookie expires (1 year)
 */
export class SqliteSessionStore extends session.Store {
  private db: ReturnType<typeof Database>;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.db = new Database(DB_PATH);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.init();
    this.startCleanup();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid  TEXT PRIMARY KEY NOT NULL,
        sess TEXT NOT NULL,
        expire INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_expire_idx ON sessions(expire);
    `);
    console.log("✅ [SessionStore] SQLite persistente iniciado —", DB_PATH);
  }

  /** Remove sessões expiradas a cada hora */
  private startCleanup() {
    this.cleanupInterval = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      const result = this.db.prepare("DELETE FROM sessions WHERE expire < ?").run(now);
      if ((result.changes as number) > 0) {
        console.log(`🧹 [SessionStore] ${result.changes} sessão(ões) expirada(s) removida(s)`);
      }
    }, 60 * 60 * 1000); // a cada 1 hora
    if (this.cleanupInterval.unref) this.cleanupInterval.unref();
  }

  get(sid: string, callback: (err: any, session?: session.SessionData | null) => void) {
    try {
      const now = Math.floor(Date.now() / 1000);
      const row = this.db.prepare("SELECT sess FROM sessions WHERE sid = ? AND expire > ?").get(sid, now) as any;
      if (!row) return callback(null, null);
      const sess = JSON.parse(row.sess);
      callback(null, sess);
    } catch (err) {
      callback(err);
    }
  }

  set(sid: string, sessionData: session.SessionData, callback?: (err?: any) => void) {
    try {
      const expire = sessionData.cookie?.expires
        ? Math.floor(new Date(sessionData.cookie.expires).getTime() / 1000)
        : Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;

      this.db
        .prepare(
          `INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)
           ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire`
        )
        .run(sid, JSON.stringify(sessionData), expire);

      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  destroy(sid: string, callback?: (err?: any) => void) {
    try {
      this.db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  touch(sid: string, sessionData: session.SessionData, callback?: (err?: any) => void) {
    try {
      const expire = sessionData.cookie?.expires
        ? Math.floor(new Date(sessionData.cookie.expires).getTime() / 1000)
        : Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;

      this.db.prepare("UPDATE sessions SET expire = ? WHERE sid = ?").run(expire, sid);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  length(callback: (err: any, length?: number) => void) {
    try {
      const now = Math.floor(Date.now() / 1000);
      const row = this.db.prepare("SELECT COUNT(*) as count FROM sessions WHERE expire > ?").get(now) as any;
      callback(null, row.count);
    } catch (err) {
      callback(err);
    }
  }

  clear(callback?: (err?: any) => void) {
    try {
      this.db.prepare("DELETE FROM sessions").run();
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }
}
