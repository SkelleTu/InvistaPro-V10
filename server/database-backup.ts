import fs from 'fs';
import path from 'path';
import { sqlite } from './db';

const BACKUP_DIR = path.join(process.cwd(), 'database-backups');
const MAX_BACKUPS = 30; // Manter últimos 30 backups

// Garantir que o diretório de backup existe
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  console.log('📁 Diretório de backups criado:', BACKUP_DIR);
}

/**
 * Cria um backup do banco de dados
 * Formato: investpro_backup_YYYY-MM-DD_HH-mm-ss.db
 */
export function createDatabaseBackup(): string {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupFileName = `investpro_backup_${timestamp}.db`;
    const backupPath = path.join(BACKUP_DIR, backupFileName);
    const sourcePath = path.join(process.cwd(), 'database', 'investpro.db');
    
    // Verificar se o arquivo fonte existe
    if (!fs.existsSync(sourcePath)) {
      console.warn('⚠️ Arquivo de banco de dados não encontrado para backup');
      return '';
    }
    
    // Executar VACUUM para otimizar antes do backup
    try {
      sqlite.prepare('VACUUM').run();
    } catch (e) {
      console.log('ℹ️ VACUUM ignorado (banco pode estar em uso)');
    }
    
    // Copiar arquivo
    fs.copyFileSync(sourcePath, backupPath);
    
    const stats = fs.statSync(backupPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    
    console.log(`✅ Backup criado: ${backupFileName} (${sizeMB} MB)`);
    
    // Limpar backups antigos
    cleanOldBackups();
    
    return backupPath;
  } catch (error) {
    console.error('❌ Erro ao criar backup:', error);
    return '';
  }
}

/**
 * Remove backups antigos, mantendo apenas os mais recentes
 */
function cleanOldBackups(): void {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('investpro_backup_') && f.endsWith('.db'))
      .map(f => ({
        name: f,
        path: path.join(BACKUP_DIR, f),
        time: fs.statSync(path.join(BACKUP_DIR, f)).mtime.getTime()
      }))
      .sort((a, b) => b.time - a.time); // Mais recentes primeiro
    
    // Remover backups excedentes
    if (files.length > MAX_BACKUPS) {
      const toDelete = files.slice(MAX_BACKUPS);
      toDelete.forEach(file => {
        fs.unlinkSync(file.path);
        console.log(`🗑️ Backup antigo removido: ${file.name}`);
      });
    }
  } catch (error) {
    console.error('❌ Erro ao limpar backups antigos:', error);
  }
}

/**
 * Lista todos os backups disponíveis
 */
export function listBackups(): Array<{ name: string; date: Date; size: string }> {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('investpro_backup_') && f.endsWith('.db'))
      .map(f => {
        const filePath = path.join(BACKUP_DIR, f);
        const stats = fs.statSync(filePath);
        return {
          name: f,
          date: stats.mtime,
          size: (stats.size / 1024 / 1024).toFixed(2) + ' MB'
        };
      })
      .sort((a, b) => b.date.getTime() - a.date.getTime());
    
    return files;
  } catch (error) {
    console.error('❌ Erro ao listar backups:', error);
    return [];
  }
}

/**
 * Restaura um backup específico
 */
export function restoreBackup(backupFileName: string): boolean {
  try {
    const backupPath = path.join(BACKUP_DIR, backupFileName);
    const targetPath = path.join(process.cwd(), 'database', 'investpro.db');
    
    if (!fs.existsSync(backupPath)) {
      console.error('❌ Arquivo de backup não encontrado:', backupFileName);
      return false;
    }
    
    // Criar backup do estado atual antes de restaurar
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const preRestoreBackup = path.join(BACKUP_DIR, `pre_restore_${timestamp}.db`);
    if (fs.existsSync(targetPath)) {
      fs.copyFileSync(targetPath, preRestoreBackup);
      console.log(`📦 Backup pré-restauração criado: pre_restore_${timestamp}.db`);
    }
    
    // Restaurar backup
    fs.copyFileSync(backupPath, targetPath);
    console.log(`✅ Backup restaurado: ${backupFileName}`);
    console.log('⚠️ IMPORTANTE: Reinicie o servidor para aplicar as mudanças!');
    
    return true;
  } catch (error) {
    console.error('❌ Erro ao restaurar backup:', error);
    return false;
  }
}

// Backup automático ao iniciar o servidor
console.log('🔄 Criando backup automático ao iniciar...');
const initialBackup = createDatabaseBackup();
if (initialBackup) {
  console.log('✅ Backup inicial criado com sucesso');
} else {
  console.warn('⚠️ Não foi possível criar backup inicial');
}
