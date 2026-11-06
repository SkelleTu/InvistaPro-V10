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
4. O PDF e seu manifesto ficam em bucket privado de objetos; links de download são temporários e exigem autorização administrativa.
5. Cada geração, visualização/download e tentativa de exportação deve gerar evento de auditoria com usuário administrador, ação, data, motivo e request ID.
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

## Lacunas identificadas na implementação atual

- A listagem administrativa global de movimentações consulta somente 100 registros.
- A ficha individual consulta no máximo 500 movimentações e 200 operações; a interface ainda exibe apenas 50 linhas em cada tabela.
- O modelo legado `movimentos.valor` usa ponto flutuante (`REAL`), não centavos inteiros. Esses registros devem ser preservados como legado e reconciliados antes de qualquer conversão contábil.
- O campo `users.saldo` também é legado e não substitui saldo derivado de lançamentos balanceados.
- A tabela de exportações e o ledger desta etapa fornecem a fundação; as rotas de snapshot, geração de PDF, upload privado, hash e histórico de downloads ainda precisam ser conectadas antes de anunciar a função como pronta.

## Critérios de aceite

- Exportação individual e global respeita filtros e inclui 100% dos registros do período.
- Totais do PDF reconciliam com a consulta de origem e exibem exceções quando não reconciliados.
- Hash SHA-256 é validado após armazenamento e download.
- Tentativas sem privilégio são bloqueadas e auditadas.
- Testes cobrem cliente sem dados, grande volume, períodos, fuso horário, paginação, caracteres especiais, acesso indevido, falha de storage e restauração do arquivo.
