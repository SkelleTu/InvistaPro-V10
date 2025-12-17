import { dualStorage } from '../server/storage-dual';

async function checkAccount() {
  const email = 'vfdiogoseg@gmail.com';
  
  console.log('\n🔍 Verificando conta:', email);
  console.log('='.repeat(60));
  
  try {
    const user = await dualStorage.getUserByEmail(email);
    
    if (!user) {
      console.log('\n❌ Conta não encontrada no sistema!');
      console.log('\nA conta com o email', email, 'não existe no banco de dados.');
      console.log('Você precisa criar uma conta primeiro.');
      return;
    }
    
    console.log('\n✅ Conta encontrada!');
    console.log('\n📋 Informações da conta:');
    console.log('  - Email:', user.email);
    console.log('  - Nome completo:', user.nomeCompleto);
    console.log('  - CPF:', user.cpf);
    console.log('  - Telefone:', user.telefone);
    console.log('\n📊 Status da conta:');
    console.log('  - Conta aprovada:', user.contaAprovada ? '✅ SIM' : '❌ NÃO');
    console.log('  - Telefone verificado:', user.telefoneVerificado ? '✅ SIM' : '❌ NÃO');
    console.log('  - É administrador:', user.isAdmin ? '✅ SIM' : '❌ NÃO');
    console.log('  - Documentos verificados:', user.documentosVerificados ? '✅ SIM' : '❌ NÃO');
    console.log('\n💰 Informações financeiras:');
    console.log('  - Saldo:', `R$ ${user.saldo.toFixed(2)}`);
    console.log('\n📅 Datas:');
    console.log('  - Conta criada em:', user.createdAt);
    if (user.aprovadaEm) {
      console.log('  - Aprovada em:', user.aprovadaEm);
      console.log('  - Aprovada por:', user.aprovadaPor);
    }
    
    // Verificar se há algum problema que impediria o login
    console.log('\n🔐 Diagnóstico de acesso:');
    if (!user.contaAprovada) {
      console.log('  ⚠️  PROBLEMA: Conta não aprovada!');
      console.log('     A conta precisa ser aprovada por um administrador.');
    }
    if (!user.passwordHash) {
      console.log('  ⚠️  PROBLEMA: Senha não configurada!');
    }
    
    if (user.contaAprovada && user.passwordHash) {
      console.log('  ✅ A conta está configurada corretamente e deve permitir login.');
    }
    
    console.log('\n' + '='.repeat(60));
    
  } catch (error) {
    console.error('\n❌ Erro ao verificar conta:', error);
  }
  
  process.exit(0);
}

checkAccount();
