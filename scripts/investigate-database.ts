import { dualStorage } from '../server/storage-dual';
import { db } from '../server/db';
import { users } from '@shared/schema';

async function investigateDatabase() {
  console.log('\n🔍 INVESTIGAÇÃO URGENTE DO BANCO DE DADOS');
  console.log('='.repeat(80));
  
  try {
    // 1. Verificar todos os usuários no banco
    console.log('\n📊 Listando TODOS os usuários no banco de dados:');
    const allUsers = await dualStorage.getAllUsers();
    
    if (allUsers.length === 0) {
      console.log('\n⚠️  ALERTA: Banco de dados está VAZIO! Nenhum usuário encontrado!');
    } else {
      console.log(`\n✅ Encontrados ${allUsers.length} usuário(s) no banco:\n`);
      allUsers.forEach((user, index) => {
        console.log(`${index + 1}. ${user.email} - ${user.nomeCompleto}`);
        console.log(`   ID: ${user.id}`);
        console.log(`   Admin: ${user.isAdmin ? 'SIM' : 'NÃO'}`);
        console.log(`   Conta aprovada: ${user.contaAprovada ? 'SIM' : 'NÃO'}`);
        console.log(`   Criado em: ${user.createdAt}`);
        console.log('');
      });
    }
    
    // 2. Buscar especificamente pelo email problemático
    console.log('\n🔍 Buscando especificamente por: vfdiogoseg@gmail.com');
    const specificUser = await dualStorage.getUserByEmail('vfdiogoseg@gmail.com');
    if (specificUser) {
      console.log('✅ Usuário ENCONTRADO!');
      console.log('Dados:', specificUser);
    } else {
      console.log('❌ Usuário NÃO encontrado!');
    }
    
    // 3. Verificar diretamente no DB sem o storage layer
    console.log('\n🔍 Verificação direta no banco (sem storage layer):');
    const directQuery = await db.select().from(users);
    console.log(`Registros encontrados: ${directQuery.length}`);
    
    if (directQuery.length > 0) {
      console.log('\nUsuários na query direta:');
      directQuery.forEach(u => console.log(`  - ${u.email} (ID: ${u.id})`));
    }
    
    console.log('\n' + '='.repeat(80));
    
  } catch (error) {
    console.error('\n❌ ERRO CRÍTICO na investigação:', error);
  }
  
  process.exit(0);
}

investigateDatabase();
