import express from "express";
import { isAuthenticated } from "../auth";
import { getClientFinancialSummary, listClientLedger } from "../services/financial-ledger";

const router = express.Router();

function sessionUserId(req: express.Request) {
  return String((req as any).session?.passport?.user || "");
}

// Read-only until the payment provider and financial activation gates are approved.
router.get("/summary", isAuthenticated, async (req, res) => {
  try {
    const userId = sessionUserId(req);
    if (!userId) return res.status(401).json({ message: "Sessão inválida." });
    const summary = await getClientFinancialSummary(userId);
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    return res.json(summary);
  } catch (error) {
    console.error("Client financial summary unavailable:", error);
    return res.status(503).json({ message: "Resumo financeiro contábil ainda indisponível." });
  }
});

router.get("/ledger", isAuthenticated, async (req, res) => {
  try {
    const userId = sessionUserId(req);
    if (!userId) return res.status(401).json({ message: "Sessão inválida." });
    const limit = Number.parseInt(String(req.query.limit || "100"), 10);
    const offset = Number.parseInt(String(req.query.offset || "0"), 10);
    if (!Number.isFinite(limit) || !Number.isFinite(offset) || offset < 0) {
      return res.status(400).json({ message: "Paginação inválida." });
    }
    const entries = await listClientLedger(userId, limit, offset);
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    return res.json({ entries, limit: Math.min(Math.max(limit, 1), 1000), offset });
  } catch (error) {
    console.error("Client ledger unavailable:", error);
    return res.status(503).json({ message: "Extrato contábil ainda indisponível." });
  }
});

router.post("/deposits", isAuthenticated, (_req, res) => {
  return res.status(503).json({
    code: "PAYMENT_PROVIDER_NOT_CONFIGURED",
    message: "Aportes via provedor permanecem bloqueados até a configuração e homologação do gateway.",
  });
});

router.post("/withdrawals", isAuthenticated, (_req, res) => {
  return res.status(503).json({
    code: "PAYOUT_PROVIDER_NOT_CONFIGURED",
    message: "Saques permanecem bloqueados até a configuração e homologação do gateway.",
  });
});

export default router;
