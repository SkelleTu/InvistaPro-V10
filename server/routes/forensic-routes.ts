import { Router, type Request, type Response } from 'express';
import { isAuthenticated } from '../auth';
import { forensicDiagnosticSystem } from '../services/forensic-diagnostic-system';

const router = Router();

router.get('/report', isAuthenticated, (req: Request, res: Response) => {
  const rawLimit = Number(req.query.limit || 100);
  const limit = Number.isFinite(rawLimit) ? rawLimit : 100;
  res.json({
    success: true,
    system: 'Invista Pro Forensic Diagnostic',
    report: forensicDiagnosticSystem.scan(limit),
  });
});

router.get('/error/:id', isAuthenticated, (req: Request, res: Response) => {
  const finding = forensicDiagnosticSystem.get(req.params.id);
  if (!finding) {
    return res.status(404).json({
      success: false,
      message: 'Erro não encontrado no histórico do ErrorTracker.',
    });
  }
  res.json({ success: true, finding });
});

router.post('/error/:id/solve', isAuthenticated, (req: Request, res: Response) => {
  const recovery = typeof req.body?.recovery === 'string' ? req.body.recovery.slice(0, 2000) : '';
  if (!recovery) {
    return res.status(400).json({
      success: false,
      message: 'Informe a correção aplicada para marcar o erro como resolvido.',
    });
  }
  const solved = forensicDiagnosticSystem.solve(req.params.id, recovery);
  if (!solved) {
    return res.status(404).json({
      success: false,
      message: 'Erro não encontrado no histórico do ErrorTracker.',
    });
  }
  res.json({ success: true, errorId: req.params.id, solved: true });
});

export default router;
