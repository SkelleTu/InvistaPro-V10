import { pgDb, pgSchema } from './db-postgres';
import { eq, sql } from 'drizzle-orm';

/**
 * Script de migração para criar tabelas PostgreSQL
 * Executar com: npm run migrate:postgres
 */
async function migratePostgres() {
  console.log('🚀 Iniciando migração PostgreSQL...');
  
  try {
    // Ativar extensão pgcrypto para gen_random_uuid()
    await pgDb.execute(sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
    console.log('✅ Extensão pgcrypto ativada');

    // Fail closed if V10 and Aura accidentally point at the same Neon database.
    const platformId = String(process.env.INVISTA_PLATFORM ?? "").trim().toLowerCase();
    if (platformId !== "v10" && platformId !== "aura") {
      throw new Error("INVISTA_PLATFORM must be set to 'v10' or 'aura' before enabling Neon persistence.");
    }
    await pgDb.execute(sql`
      CREATE TABLE IF NOT EXISTS invista_database_identity (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        platform_id VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        essential_backfill_completed_at TIMESTAMP
      )
    `);
    await pgDb.execute(sql`ALTER TABLE invista_database_identity ADD COLUMN IF NOT EXISTS essential_backfill_completed_at TIMESTAMP`);
    await pgDb.insert(pgSchema.invistaDatabaseIdentity)