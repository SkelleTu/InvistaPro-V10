# Backup criptografado e recuperação — InvistaPRO V10

## O que foi preparado

O workflow `.github/workflows/neon-encrypted-backup.yml` agenda um `pg_dump` diário do Neon às 06:30 UTC (03:30 no horário de Brasília) e também permite execução manual. O dump é criptografado com AES-256-GCM antes de ser enviado a um bucket privado do Supabase. Um manifesto registra os hashes SHA-256 do dump original e do arquivo criptografado.

O workflow ainda precisa dos quatro GitHub Actions Secrets abaixo para começar a executar com sucesso:

- `DATABASE_URL`: string de conexão do Neon, somente como secret.
- `SUPABASE_URL`: URL do projeto Supabase.
- `SUPABASE_SERVICE_ROLE_KEY`: chave de serviço do Supabase, somente como secret.
- `BACKUP_ENCRYPTION_KEY`: chave hexadecimal aleatória de 32 bytes.

Gere a chave localmente com `openssl rand -hex 32`. Não a envie no chat, não a grave no repositório e não reutilize a `ENCRYPTION_KEY` da aplicação. Cadastre os quatro valores em GitHub → Settings → Secrets and variables → Actions → New repository secret.

O bucket privado padrão é `invistapro-database-backups`. O script o cria se ainda não existir. Os backups não são apagados automaticamente nesta primeira versão; isso evita descarte automático antes de definirmos a política de retenção legal/contábil.

## Conferência de um backup

Cada backup tem um arquivo `.dump.enc` e um manifesto `.dump.enc.manifest.json`. Baixe ambos do bucket privado. Confira o hash criptografado informado no manifesto antes da descriptografia.

Defina localmente:
- `ENCRYPTED_BACKUP_PATH`: caminho do arquivo `.dump.enc`.
- `RESTORED_DUMP_PATH`: caminho novo para gravar o dump descriptografado.
- `BACKUP_ENCRYPTION_KEY`: chave secreta de backup.
- `EXPECTED_PLAINTEXT_SHA256`: valor `plaintextSha256` do manifesto.

Execute `npx tsx scripts/decrypt-neon-backup.ts`. O script verifica a autenticação AES-GCM e o SHA-256 antes de gravar o dump.

## Restauração

Restaure primeiro em uma nova branch/banco Neon isolado, nunca diretamente sobre produção. Depois de confirmar a integridade e validar tabelas, usuários, ledger, relatórios e registros de auditoria, planeje uma promoção controlada. O comando de restauração pode sobrescrever objetos no banco de destino; confirme o destino antes de executar:

```bash
pg_restore --no-owner --no-privileges --dbname="$RESTORE_DATABASE_URL" "$RESTORED_DUMP_PATH"
```

## Limitações que ainda exigem configuração

- O workflow só passa a executar depois que os quatro secrets forem cadastrados.
- O backup usa o projeto Supabase já conectado, mas o bucket será criado na primeira execução do workflow.
- Ainda não há alerta externo dedicado para falhas de backup; monitore as execuções do workflow até adicionarmos alertas.
- Definir retenção e cópia geográfica adicional com o responsável jurídico/contábil e conforme custo/obrigações aplicáveis.
