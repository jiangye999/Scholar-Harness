import { Router } from 'express';
import { NiceAIGCBridgeAdapter } from '../../bridge/niceaigc/niceaigc-bridge';
import { logger } from '../../utils/logger';

const router = Router();

let niceAIGCAdapter: NiceAIGCBridgeAdapter | null = null;

export function initializeNiceAIGCRoutes(adapter: NiceAIGCBridgeAdapter): void {
  niceAIGCAdapter = adapter;
}

router.post('/chat', async (req, res) => {
  try {
    if (!niceAIGCAdapter) {
      res.status(503).json({ error: 'NiceAIGC Bridge not initialized' });
      return;
    }

    const { message, options = {} } = req.body;

    if (!message) {
      res.status(400).json({ error: 'Message is required' });
      return;
    }

    logger.info(`[NiceAIGC Route] Received chat request`);

    const response = await niceAIGCAdapter.chat({
      messages: [{ role: 'user', content: message }],
      ...options,
    });

    res.json({
      success: true,
      response,
      provider: 'niceaigc',
    });
  } catch (error) {
    logger.error('[NiceAIGC Route] Error:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    });
  }
});

router.get('/test', async (req, res) => {
  try {
    if (!niceAIGCAdapter) {
      res.status(503).json({ error: 'NiceAIGC Bridge not initialized' });
      return;
    }

    const connected = await niceAIGCAdapter.testConnection();

    if (connected) {
      res.json({
        success: true,
        message: 'NiceAIGC connection successful',
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'NiceAIGC connection failed',
      });
    }
  } catch (error) {
    logger.error('[NiceAIGC Route] Test error:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    });
  }
});

export default router;
