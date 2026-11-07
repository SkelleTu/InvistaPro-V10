# Relatórios financeiros e arquivo administrativo — InvistaPRO V10

## Objetivo

Disponibilizar ao administrador autorizado relatórios imprimíveis e arquiváveis, tanto por cliente quanto consolidados da plataforma. O relatório deve ser reproduzível a partir dos registros persistidos e indicar claramente o período, o fuso horário, a data/hora de geração, os filtros e a origem de cada grupo de dados.

## Escopo dos relatórios

### Dossiê individual do cliente
- Identificação cadastral estritamente necessária e status de conta/KYC.
- Saldo contábil por categoria: disponível, reservado, capital, rendimento e pendências — somente quando cada categoria estiver conciliada.
- Extrato integral de aportes, retiradas, taxas, estornos, ajustes e transferências.
- Lançamentos contábeis correspondentes, com débito/crédito, valor em centavos, moeda, referência e chave de idempotência.
- Histórico operacional/trading separado do fluxo de caixa, com status, stake, resultado, contrato e timestamps.
- Documentos enviados, situação da análise, autor da decisão e datas. Arquivos originais permanecem em armazenamento privado.
- Eventos de auditoria administrativos/financeiros pertinentes ao cliente.

### Relatório consolidado da plataforma
- Totais por período e por status.
- Total de clientes e contas ativas, sem expor dados pessoais desnecessários.
- Depósitos, saques, reservas, taxas, estornos e saldos por categoria.
- Conciliação entre ledger interno e eventos/transferências do provedor.
- Operações de trading em seção separada, sem misturar PnL com depósitos ou saldo de clientes.
- Pendências de conciliação e exceções identificadas.

## Impressão e retenção

1. O backend autorizado gera um snapshot consistente dos dados no período solicitado; nunca usar apenas os itens atualmente visíveis na tela.
2. O PDF deve conter identificador único, data/hora UTC e horário local, intervalo consultado, filtros, número de registros e totais.
3. O backend calcula SHA-256 do arquivo e registra o hash, solicitante, escopo, cliente/período e referência privada em `admin_report_exports`.
4. O PDF fica em bucket privado de objetos; o hash e os metadados ficam em PostgreSQL. O endpoint de download exige autorização administrativa e não expõe URL pública permanente.
5. Cada geração e download bem-sucedidos geram evento de auditoria com usuário administrador, ação, data, motivo e request ID. Falhas de geração são registradas nos logs da aplicação; auditoria financeira dedicada para tentativas malsucedidas ainda é uma melhoria pendente.
6. O PDF é uma cópia documental; o PostgreSQL e o ledger são a fonte oficial. Uma correção gera novo lançamento/relatório, nunca edição do PDF histórico.

## Segurança e integridade

- Acesso administrativo com autorização verificada no servidor em cada rota.
- Isolamento por cliente e proteção contra IDOR.
- Sem URLs públicas permanentes para documentos ou PDFs.
- Redação de CPF, endereço, chave PIX e outros dados pessoais nos relatórios globais, salvo necessidade justificada.
- Exportações com limites de período, paginação interna e limites de tamanho para evitar consultas sem controle.
- Armazenamento privado, criptografia em trânsito e em repouso, hash SHA-256 e trilha de acesso.
- Política de retenção, descarte e atendimento a solicitações de titulares definida conforme obrigações legais e orientação jurídica/contábil. Não apagar registros financeiros por rotina operacional.
- Backup independente do banco e teste periódico de restauração. A janela de histórico informada pelo projeto Neon não deve ser tratada como arquivo permanente nem como única cópia de segurança.

## Estado da implementação nesta branch

- A Central Administrativa possui exportação de PDF individual e consolidado, além de arquivo dos relatórios já gerados.
- A consulta que compõe cada PDF roda em uma transação PostgreSQL com isolamento `REPEATABLE READ`, para que as seções do relatório sejam lidas a partir do mesmo snapshot.
- O PDF inclui identificador, data/hora UTC e horário de São Paulo, solicitante, escopo, período, quantidade de registros, identificação do cliente (CPF mascarado), saldos atuais do ledger, lançamentos contábeis, movimentos legados, operações de trading, intenções/pagamentos, saques, metadados de documentos e eventos de auditoria.
- O relatório global inclui saldos disponíveis, reservados, capital e rendimentos por cliente e total da plataforma. Contas administrativas são excluídas dos totais de clientes.
- O arquivo é enviado a bucket privado, lido novamente para validar o SHA-256 e registrado em `admin_report_exports`. O download exige autenticação administrativa, revalida o hash e registra evento de auditoria.
- O painel individual mostra extrato contábil, solicitações de saque, operações e histórico legado. O extrato visual carrega até 1.000 lançamentos e 500 solicitações de saque por consulta; o PDF não usa esse limite visual.
- Os arquivos KYC originais não são incorporados ao PDF. Permanecem em armazenamento privado e são acessados separadamente pelo visualizador administrativo protegido. O PDF registra tipo, estado, datas e decisão do documento.
- A lista do arquivo administrativo mostra os 100 relatórios mais recentes; a retenção dos objetos não é apagada automaticamente.

## Pendências para ativação em produção

- Configurar `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e o bucket privado de relatórios no ambiente de produção. O serviço deve falhar fechado se o armazenamento privado não estiver disponível.
- Configurar os quatro GitHub Actions Secrets do backup Neon (`DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BACKUP_ENCRYPTION_KEY`) e verificar ao menos um backup e uma restauração em banco isolado.
- Aplicar a migração financeira no Neon por meio do boot da versão publicada. A migração é aditiva; nenhum saldo legado é convertido automaticamente para o ledger.
- Conciliar formalmente o histórico antigo antes de tratar valores legados como saldo oficial. Até essa conciliação, `users.saldo` e `movimentos` são exibidos como legado e não alimentam o ledger.
- Definir política jurídica/contábil de retenção, descarte, exportação e atendimento a titulares. O arquivo atual não substitui controles legais nem aconselhamento jurídico/contábil.
- A integração Mercado Pago ainda não está registrada. PIX, liquidação e saques reais permanecem desativados até credenciais, webhooks, sandbox, conciliação e aprovação explícita.

## Critérios de aceite

- Exportação individual e global respeita filtros e inclui 100% dos registros do período.
- Totais do PDF reconciliam com a consulta de origem e exibem exceções quando não reconciliados.
- Hash SHA-256 é validado após armazenamento e download.
- Tentativas sem privilégio são bloqueadas e auditadas.
- Testes cobrem cliente sem dados, grande volume, períodos, fuso horário, paginação, caracteres especiais, acesso indevido, falha de storage e restauração do arquivo.
