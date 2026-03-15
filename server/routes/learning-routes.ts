import { Router } from 'express';
import { persistentLearningEngine } from '../services/persistent-learning-engine';

const router = Router();

router.get('/stats', async (req, res) => {
  try {
    const symbol = req.query.symbol as string | undefined;
    const stats = await persistentLearningEngine.getLearningStats(symbol);
    res.json(stats);
  } catch (error) {
    console.error('❌ [API] Erro ao buscar stats de aprendizado:', error);
    res.status(500).json({ error: 'Erro ao buscar estatísticas de aprendizado' });
  }
});

router.get('/weights/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const weights = await persistentLearningEngine.getModelWeights(symbol);
    res.json(weights);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar pesos dos modelos' });
  }
});

router.post('/reset', async (req, res) => {
  try {
    const { modelName, symbol } = req.body;
    if (!modelName || !symbol) {
      return res.status(400).json({ error: 'modelName e symbol são obrigatórios' });
    }
    await persistentLearningEngine.resetModelLearning(modelName, symbol);
    res.json({ success: true, message: `Modelo ${modelName} resetado para ${symbol}` });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao resetar modelo' });
  }
});

export default router;
