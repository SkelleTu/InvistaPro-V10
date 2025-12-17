#!/bin/bash

echo "🔧 Removendo arquivos sensíveis do Git..."

# Remove cached sensitive files
git rm --cached "attached_assets/Pasted-1-Make-sure-you-have-the-prerequisites-Our-library-requires-Node-js-version-0-10-0-12-or-4--1756768742939_1756768742940.txt" 2>/dev/null
git rm --cached "attached_assets/DOCUMENT DE CREDENCIAIS (CONFIGURAÇÕES DE RECUPERAÇÃO DE SENHA)_1756773484939.txt" 2>/dev/null
git rm --cached "server/config/password-recovery/CREDENCIAIS_RECUPERACAO_SENHA.txt" 2>/dev/null
git rm --cached "attached_assets/Pasted-Criar-uma-pasta-espec-fica-contendo-absolutamente-100-do-novo-sistema-a-seguir-de-maneira-organizad-1758040703342_1758040703348.txt" 2>/dev/null
git rm --cached "attached_assets/Pasted-Criar-uma-pasta-espec-fica-contendo-absolutamente-100-do-novo-sistema-a-seguir-de-maneira-organizad-1758401258353_1758401258363.txt" 2>/dev/null

# Remove all txt files from attached_assets from cache
git rm --cached attached_assets/*.txt 2>/dev/null

# Remove database files
git rm --cached database/investpro.db 2>/dev/null
git rm --cached *.db 2>/dev/null
git rm --cached *.sqlite 2>/dev/null
git rm --cached cookies.txt 2>/dev/null
git rm --cached session_cookies.txt 2>/dev/null

echo "📝 Adicionando .gitignore atualizado..."
git add .gitignore

echo "💾 Criando commit..."
git commit -m "Remove sensitive files and update gitignore"

echo "🚀 Fazendo push para GitHub..."
git push origin main --force

echo "✅ Concluído!"
