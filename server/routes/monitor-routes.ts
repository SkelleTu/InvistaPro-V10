import { Router, type Request, type Response } from 'express';
import { contractMonitor } from '../services/contract-monitor';
import { isAuthenticated } from '../auth';

const router = Router();

router.get('/status', isAuthenticated, (req: Request, res: Response) => {
  const contracts = contractMonitor.getMonitoredContracts();
  const mapped = contracts.map(({ contractId, state, finalResult, finalProfit, closedAt }) => ({
    contractId,
    contractType: state.input.contractType,
    symbol: state.input.symbol,
    direction: state.input.direction,
    buyPrice: state.input.buyPrice,
    bidPrice: state.bidPrice,
    profit: finalProfit ?? state.profit,
    profitPct: state.profitPct,
    peakProfit: state.peakProfit,
    currentSpot: state.currentSpot,
    entrySpot: state.entrySpot,
    barrierDistance: state.barrierDistance,
    isValidToSell: state.isValidToSell,
    tickCount: state.tickCount,
    status: state.status,
    ageMs: Date.now() - state.input.openedAt,
    lastUpdate: state.lastUpdate,
    finalResult,
    finalProfit,
    closedAt,
  }));

  const activeContracts = mapped.filter(c => c.status !== 'closed').length;

  res.json({
    activeContracts,
    contracts: mapped,
    timestamp: Date.now(),
  });
});

router.get('/contract/:id', isAuthenticated, (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const state = contractMonitor.getContractState(id);
  if (!state) {
    return res.status(404).json({ error: 'Contrato não monitorado' });
  }
  res.json({
    contractId: id,
    contractType: state.input.contractType,
    symbol: state.input.symbol,
    direction: state.input.direction,
    buyPrice: state.input.buyPrice,
    bidPrice: state.bidPrice,
    profit: state.profit,
    profitPct: state.profitPct,
    peakProfit: state.peakProfit,
    currentSpot: state.currentSpot,
    entrySpot: state.entrySpot,
    barrierDistance: state.barrierDistance,
    isValidToSell: state.isValidToSell,
    tickCount: state.tickCount,
    status: state.status,
    ageMs: Date.now() - state.input.openedAt,
    aiSignalBuffer: state.aiSignalBuffer,
  });
});

export default router;
