import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as pgSchema from './schemas/postgres-schema';

let pgDb: any = null;
let isPostgresAvailable = false;

// 🗄️ CONECTAR DIRETO AO SUPABASE POSTGRESQL USANDO URL FORNECIDA
try {
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl && databaseUrl.includes('supabase')) {
    // Usar a URL de conexão completa do Supabase
    const client = postgres(databaseUrl);
    pgDb = drizzle(client, { schema: pgSchema });
    isPostgresAvailable = true;
    console.log('✅ Supabase PostgreSQL conectado - Sistema Dual Database ativo');
    
    // Extract host for display (sem expor senha)
    const urlObj = new URL(databaseUrl);
    console.log(`   • Host: ${urlObj.hostname}`);
    console.log(`   • Database: ${urlObj.pathname.substring(1)}`);
  } else {
    console.warn('⚠️ DATABASE_URL do Supabase não configurada. Usando apenas SQLite.');
  }
} catch (error) {
  console.error('❌ Erro ao conectar ao Supabase PostgreSQL:', error);
  console.warn('⚠️ Continuando apenas com SQLite');
}

export { pgDb, pgSchema, isPostgresAvailable };
