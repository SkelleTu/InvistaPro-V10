import { dualStorage } from '../server/storage-dual';
import { hashPassword } from '../server/auth';

async function recreateOwnerAccount() {
  console.log('\n🔧 RECRIANDO CONTA DO PROPRIETÁRIO');
  console.log('='.repeat(80));
  
  const accountData = {
    email: 'vfdiogoseg@gmail.com',
    password: 'Victor.!.1999',
    nomeCompleto: 'Victor Felipe Diogo',
    cpf: '46504889821',
    telefone: '19997238298',
    endereco: 'Apparecido Orlando cabrini n° 203',
    cidade: 'São Paulo', // Temporário - atualizar depois se necessário
    estado: 'SP', // Temporário - atualizar depois se necessário
    cep: '00000000', // Temporário - atualizar depois se necessário
    chavePix: 'vfdiogoseg@gmail.com',
    tipoChavePix: 'email',
    telefoneVerificado: true,
    contaAprovada: true,
    isAdmin: true,
    documentosVerificados: true,
    saldo: 0.00
  };

  try {
    // Verificar se já existe
    console.log('\n🔍 Verificando se conta já existe...');
    const existing = await dualStorage.getUserByEmail(accountData.email);
    
    if (existing) {
      console.log('\n⚠️  Conta já existe! Atualizando privilégios...');
      
      // Garantir que tem todos os privilégios
      const passwordHash = await hashPassword(accountData.password);
      await dualStorage.updateUser(existing.id, {
        passwordHash,
        isAdmin: true,
        contaAprovada: true,
        telefoneVerificado: true,
        documentosVerificados: true,
        nomeCompleto: accountData.nomeCompleto,
        cpf: accountData.cpf,
        telefone: accountData.telefone,
        endereco: accountData.endereco,
        cidade: accountData.cidade,
        estado: accountData.estado,
        cep: accountData.cep,
        chavePix: accountData.chavePix,
        tipoChavePix: accountData.tipoChavePix
      });
      
      console.log('\n✅ Conta atualizada com sucesso!');
      console.log('\n📋 Dados da conta:');
      console.log('  - Email:', accountData.email);
      console.log('  - Nome:', accountData.nomeCompleto);
      console.log('  - CPF:', accountData.cpf);
      console.log('  - Telefone:', accountData.telefone);
      console.log('  - Administrador: SIM ✅');
      console.log('  - Conta aprovada: SIM ✅');
      console.log('  - Documentos verificados: SIM ✅');
      
    } else {
      console.log('\n✅ Conta não existe, criando nova...');
      
      // Hash da senha
      const passwordHash = await hashPassword(accountData.password);
      
      // Criar conta
      const userData = {
        ...accountData,
        passwordHash
      };
      
      // Remover senha em texto plano
      delete (userData as any).password;
      
      const newUser = await dualStorage.createUser(userData);
      
      console.log('\n✅ CONTA CRIADA COM SUCESSO!');
      console.log('\n📋 Dados da conta:');
      console.log('  - ID:', newUser.id);
      console.log('  - Email:', newUser.email);
      console.log('  - Nome:', newUser.nomeCompleto);
      console.log('  - CPF:', newUser.cpf);
      console.log('  - Telefone:', newUser.telefone);
      console.log('  - Endereço:', newUser.endereco);
      console.log('  - Administrador:', newUser.isAdmin ? 'SIM ✅' : 'NÃO');
      console.log('  - Conta aprovada:', newUser.contaAprovada ? 'SIM ✅' : 'NÃO');
      console.log('  - Telefone verificado:', newUser.telefoneVerificado ? 'SIM ✅' : 'NÃO');
      console.log('  - Documentos verificados:', newUser.documentosVerificados ? 'SIM ✅' : 'NÃO');
      console.log('  - Saldo: R$', newUser.saldo.toFixed(2));
      console.log('  - Criado em:', newUser.createdAt);
    }
    
    console.log('\n🔐 CREDENCIAIS DE ACESSO:');
    console.log('  📧 Email: vfdiogoseg@gmail.com');
    console.log('  🔑 Senha: Victor.!.1999');
    console.log('\n✅ Você pode fazer login agora no InvistaPRO!');
    console.log('✅ Você tem acesso total ao Sistema de Renda Variável!');
    
    console.log('\n' + '='.repeat(80));
    
    // Verificar novamente para confirmar
    console.log('\n🔍 Verificando conta criada...');
    const verified = await dualStorage.getUserByEmail(accountData.email);
    if (verified) {
      console.log('✅ CONFIRMADO: Conta existe no banco de dados!');
      console.log(`   ID: ${verified.id}`);
      console.log(`   Email: ${verified.email}`);
    } else {
      console.log('❌ ERRO: Conta não foi salva corretamente!');
    }
    
  } catch (error) {
    console.error('\n❌ ERRO ao criar conta:', error);
    throw error;
  }
  
  process.exit(0);
}

recreateOwnerAccount();
