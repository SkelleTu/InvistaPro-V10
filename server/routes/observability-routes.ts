import { Router, type Request, type Response } from "express";
import { isAuthenticated } from "../auth";
import { isAuthorizedEmail } from "../config/access";
import { observability, clientErrorPayload } from "../services/production-observability";
import { getSecretHealth } from "../services/secret-health";
import { getForensicReport } from "../services/forensic-observability";

const router = Router();

async function isObservabilityAdmin(req: Request, res: Response, next: () => void) {
  const email = (req as any).user?.email;
  const configuredAdmin = process.env.ADMIN_EMAIL;
  const allowed = Boolean(email && (
    isAuthorizedEmail(email) ||
    (configuredAdmin && email.toLowerCase() === configuredAdmin.toLowerCase())
  ));

  if (!allowed) return res.status(403).json({ success: false, message: "Acesso restrito ao monitoramento administrativo." });
  next();
}

// Browser runtime errors are intentionally accepted without authentication so login-page failures
// can be reported too. Payloads are sanitized before being logged.
router.post("/client-error", (req, res) => {
  try {
    const event = clientErrorPayload(req.body || {}, req);
    res.status(202).json({ success: true, eventId: event.id, timestamp: event.timestamp });
  } catch (error) {
    console.error("[OBSERVABILITY] client-error ingestion failed:", error);
    res.status(202).json({ success: false });
  }
});

router.get("/health", (_req, res) => {
  res.json({ success: true, ...observability.getHealth(), secrets: getSecretHealth() });
});

router.get("/forensic", isAuthenticated, isObservabilityAdmin, (_req, res) => {\n  try {\n    const report = getForensicReport();\n    res.status(report.status === "complete" ? 200 : 503).json({ success: true, ...report });\n  } catch (error) {\n    console.error("[OBSERVABILITY] forensic audit failed:", error);\n    res.status(500).json({ success: false, message: "Falha no inventário forense." });\n  }\n});\n\nrouter.get("/errors", isAuthenticated, isObservabilityAdmin, (_req, res) => {
  const limit = Number(_req.query.limit || 100);
  res.json({
    success: true,
    health: observability.getHealth(),
    errors: observability.getRecent(limit),
  });
});

router.get("/errors/:id", isAuthenticated, isObservabilityAdmin, (req, res) => {
  const event = observability.getById(req.params.id);
  if (!event) return res.status(404).json({ success: false, message: "Evento não encontrado." });
  res.json({ success: true, event });
});

// Server-Sent Events stream. This lets an authenticated admin watch errors as they happen.
router.get("/stream", isAuthenticated, isObservabilityAdmin, (req: Request, res: Response) => {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event: unknown) => {
    try { res.write(`data: ${JSON.stringify(event)}\\n\\n`); } catch {}
  };

  send({ type: "snapshot", health: observability.getHealth(), errors: observability.getRecent(50) });
  const unsubscribe = observability.subscribe(event => send({ type: "event", event }));

  const heartbeat = setInterval(() => {
    try { res.write(`: heartbeat ${Date.now()}\\n\\n`); } catch {}
  }, 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

export default router;
