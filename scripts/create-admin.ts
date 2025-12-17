import { db } from "../server/db";
import { users } from "../shared/schema";
import { hashPassword } from "../server/auth";
import { eq } from "drizzle-orm";

async function createAdminUser() {
  try {
    const adminEmail = "vfdiogoseg@gmail.com";
    const adminName = "Victor Felipe Diogo";
    
    // Verificar se o usuário já existe
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.email, adminEmail))
      .limit(1);
    
    if (existingUser.length > 0) {
      console.log('✅ Usuário administrador já existe:', adminEmail);
      console.log('Atualizando privilégios de administrador...');
      
      // Atualizar para garantir que tem privilégios de admin
      await db
        .update(users)
        .set({
          isAdmin: true,
          contaAprovada: true,
          telefoneVerificado: true,
          documentosVerificados: true,
          updatedAt: new Date().toISOString()
        })
        .where(eq(users.id, existingUser[0].id));
      
      console.log('✅ Privilégios de administrador atualizados com sucesso!');
      console.log('\n📧 Email:', adminEmail);
      console.log('👤 Nome:', existingUser[0].nomeCompleto);
      console.log('🔑 Admin:', 'Sim');
      console.log('✓ Conta Aprovada:', 'Sim');
      console.log('✓ Telefone Verificado:', 'Sim');
      console.log('✓ Documentos Verificados:', 'Sim');
      
      return;
    }
    
    // Criar hash da senha padrão (usuário deve alterar após o primeiro login)
    const defaultPassword = "Victor.!.1999";
    const passwordHash = await hashPassword(defaultPassword);
    
    // Dados do administrador
    const adminData = {
      email: adminEmail,
      passwordHash: passwordHash,
      nomeCompleto: adminName,
      cpf: "00000000000", // CPF temporário para admin
      telefone: "11999999999", // Telefone temporário para admin
      endereco: "Endereço Administrativo",
      cidade: "São Paulo",
      estado: "SP",
      cep: "01000000",
      chavePix: adminEmail,
      tipoChavePix: "email",
      telefoneVerificado: true,
      contaAprovada: true,
      isAdmin: true,
      documentosVerificados: true,
      saldo: 0.00,
    };
    
    // Inserir usuário no banco de dados
    const [newAdmin] = await db
      .insert(users)
      .values(adminData)
      .returning();
    
    console.log('\n🎉 CONTA DE ADMINISTRADOR CRIADA COM SUCESSO!\n');
    console.log('==========================================');
    console.log('📧 Email:', newAdmin.email);
    console.log('👤 Nome:', newAdmin.nomeCompleto);
    console.log('🔑 Senha Padrão:', defaultPassword);
    console.log('🔐 Admin:', newAdmin.isAdmin ? 'Sim' : 'Não');
    console.log('✓ Conta Aprovada:', newAdmin.contaAprovada ? 'Sim' : 'Não');
    console.log('✓ Telefone Verificado:', newAdmin.telefoneVerificado ? 'Sim' : 'Não');
    console.log('✓ Documentos Verificados:', newAdmin.documentosVerificados ? 'Sim' : 'Não');
    console.log('==========================================\n');
    console.log('⚠️  IMPORTANTE: Altere a senha no primeiro login por segurança!\n');
    
  } catch (error) {
    console.error('❌ Erro ao criar conta de administrador:', error);
    throw error;
  } finally {
    process.exit(0);
  }
}

createAdminUser();
