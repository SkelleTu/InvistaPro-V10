import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as pgSchema from './schemas/postgres-schema';

let pgDb: any = null;
let isPostgresAvailable = false;

// TEMPORÁRIO: Desabilitando PostgreSQL - endpoint Neon está desativado
console.warn('⚠️ PostgreSQL desabilitado - usando apenas SQLite');

/* 
try {
  if (process.env.DATABASE_URL) {
    const sql = neon(process.env.DATABASE_URL);
    pgDb = drizzle(sql, { schema: pgSchema });
    isPostgresAvailable = true;
    console.log('✅ PostgreSQL conectado via Neon - Sistema Dual Database ativo');
  } else {
    console.warn('⚠️ DATABASE_URL não definida. Usando apenas SQLite (modo single database)');
  }
} catch (error) {
  console.error('❌ Erro ao conectar PostgreSQL:', error);
  console.warn('⚠️ Continuando apenas com SQLite');
}
*/

export { pgDb, pgSchema, isPostgresAvailable };
