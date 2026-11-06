import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPdf } from "../server/services/admin-financial-reports";

const read = (path: string) => readFileSync(path, "utf8");
const reportService = read("server/services/admin-financial-reports.ts");
const storage = read("server/services/private-document-storage.ts");
const adminRoutes = read("server/routes/admin.ts");
const schema = read("server/schemas/postgres-schema.ts");
const ui = read("client/src/pages/central-administrativa.tsx");
const env = read("render-invista-pro-v10.env.example");

const pdf = buildPdf(["INVISTAPRO — TESTE DE RELATORIO", "Linha de integridade", "R$ 100,00"]);
assert.equal(pdf.subarray(0, 8).toString("ascii"), "%PDF-1.4");
assert.match(pdf.toString("ascii"), /\/Type \/Catalog/);
assert.match(pdf.toString("ascii"), /\/Type \/Page/);
assert.match(pdf.toString("ascii"), /%%EOF/);

assert.match(reportService, /createHash\("sha256"\)/);
assert.match(reportService, /storePrivateReport\(reportId, pdf\)/);
assert.match(reportService, /contentSha256: hash/);
assert.match(reportService, /REPORT_HASH_MISMATCH/);
assert.match(reportService, /financialAuditEvents/);
assert.match(reportService, /pgSchema\.ledgerEntries/);
assert.match(reportService, /pgSchema\.tradeOperations/);
assert.match(storage, /SUPABASE_REPORTS_BUCKET/);
assert.match(storage, /public: false/);
assert.match(storage, /supabase-report:\/\//);
assert.match(adminRoutes, /router\.post\('\/reports', isAuthenticated, isAdmin/);
assert.match(adminRoutes, /router\.get\('\/reports', isAuthenticated, isAdmin/);
assert.match(adminRoutes, /router\.get\('\/reports\/:reportId\/download', isAuthenticated, isAdmin/);
assert.match(schema, /export const adminReportExports = pgTable\("admin_report_exports"/);
assert.match(ui, /Imprimir \/ arquivar dossiê/);
assert.match(ui, /PDF geral da plataforma/);
assert.match(ui, /Arquivo de relatórios PDF/);
assert.match(env, /SUPABASE_REPORTS_BUCKET=admin-reports/);

console.log("✓ admin financial reports: PDF structure, private archive, SHA-256, audit and UI controls");
