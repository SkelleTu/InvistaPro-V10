import { invistaPriceActionAiProvider } from './price-action-ai-provider';
import { PriceActionAiCoordinator } from './price-action-ai-coordinator';
import { PriceActionAiPipeline } from './price-action-ai-pipeline';

/** Production composition root. Importing this does not start feeds or place orders. */
export const priceActionAiCoordinator = new PriceActionAiCoordinator(invistaPriceActionAiProvider);
export const priceActionAiPipeline = new PriceActionAiPipeline(priceActionAiCoordinator);
