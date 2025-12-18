import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as pgSchema from './schemas/postgres-schema';

let pgDb: any = null;
let isPostgresAvailable = false;

// 🗄️ CONECTAR DIRETO AO SUPABASE POSTGRESQL (não via Neon)
try {
  const pgHost = process.env.PGHOST;
  const pgUser = process.env.PGUSER;
  const pgPassword = process.env.PGPASSWORD;
  const pgDatabase = process.env.PGDATABASE;
  const pgPort = process.env.PGPORT || '5432';

  if (pgHost && pgUser && pgPassword && pgDatabase) {
    // Construir connection string para Supabase
    const connectionString = `postgresql://${pgUser}:${pgPassword}@${pgHost}:${pgPort}/${pgDatabase}?sslmode=require`;
    
    const client = postgres(connectionString);
    pgDb = drizzle(client, { schema: pgSchema });
    isPostgresAvailable = true;
    console.log('✅ Supabase PostgreSQL conectado - Sistema Dual Database ativo');
    console.log(`   • Host: ${pgHost}`);
    console.log(`   • Database: ${pgDatabase}`);
  } else {
    console.warn('⚠️ Credenciais do Supabase não configuradas. Usando apenas SQLite.');
    console.warn('   Configure: PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT');
  }
} catch (error) {
  console.error('❌ Erro ao conectar ao Supabase PostgreSQL:', error);
  console.warn('⚠️ Continuando apenas com SQLite');
}

export { pgDb, pgSchema, isPostgresAvailable };
