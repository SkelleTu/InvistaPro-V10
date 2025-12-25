import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as pgSchema from './schemas/postgres-schema';

let pgDb: any = null;
let isPostgresAvailable = false;

// 🗄️ CONECTAR AO POSTGRESQL (SUPABASE, REPLIT OU QUALQUER OUTRO)
try {
  const databaseUrl = process.env.DATABASE_URL;

  // Aceitar QUALQUER URL PostgreSQL válida (Neon, Replit Database, etc)
  if (databaseUrl && (databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://'))) {
    // Usar a URL de conexão completa
    const client = postgres(databaseUrl);
    pgDb = drizzle(client, { schema: pgSchema });
    isPostgresAvailable = true;
    
    // Detectar tipo de database
    const isReplit = databaseUrl.includes('helium') || databaseUrl.includes('replit') || databaseUrl.includes('neon');
    const dbType = isReplit ? 'Replit PostgreSQL (Neon)' : 'PostgreSQL';
    
    console.log(`✅ ${dbType} conectado - Sistema Dual Database ativo`);
    
    // Extract host for display (sem expor senha)
    try {
      const urlObj = new URL(databaseUrl);
      console.log(`   • Host: ${urlObj.hostname}`);
      console.log(`   • Database: ${urlObj.pathname.substring(1)}`);
    } catch {}
    
    // IMPORTANTE: Com PostgreSQL, o flag de pausa é compartilhado entre TODOS os remixes!
    console.log('🔗 [PAUSE/RESUME] Flag de pausa centralizado ATIVO - compartilhado entre remixes');
  } else {
    console.warn('⚠️ DATABASE_URL PostgreSQL não configurada. Usando apenas SQLite.');
    console.warn('⚠️ ATENÇÃO: Sem PostgreSQL, o controle de pausa NÃO será compartilhado entre remixes!');
  }
} catch (error) {
  console.error('❌ Erro ao conectar ao PostgreSQL:', error);
  console.warn('⚠️ Continuando apenas com SQLite');
  console.warn('⚠️ ATENÇÃO: Sem PostgreSQL, o controle de pausa NÃO será compartilhado entre remixes!');
}

export { pgDb, pgSchema, isPostgresAvailable };
