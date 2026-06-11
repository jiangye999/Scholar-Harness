import { Router, Request, Response } from 'express';
import { ActivationStore } from '../../storage/activation-store';
import { DatabaseConnection } from '../../database/connection';
import { logger } from '../../utils/logger';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

let activationStore: ActivationStore;

export function initializeActivationRoutes(db: DatabaseConnection): void {
  activationStore = new ActivationStore(db);
}

router.post('/activate', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { code, device_id, device_name, device_os } = req.body;
    const device_ip = req.ip;

    if (!code || !device_id) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Activation code and device_id are required',
      });
    }

    const result = await activationStore.activateCode({
      code,
      user_id: req.user!.userId,
      device_id,
      device_name,
      device_os,
      device_ip,
    });

    return res.json({
      message: 'Activation successful',
      activation: {
        id: result.activation.id,
        activation_token: result.activation.activation_token,
        device_id: result.activation.device_id,
        activated_at: result.activation.activated_at,
        expires_at: result.activation.expires_at,
      },
      code_info: {
        code_type: result.code.code_type,
        validity_days: result.code.validity_days,
      },
    });
  } catch (error) {
    const message = (error as Error).message;
    logger.error('[Activation] Failed:', message);

    if (message.includes('Invalid') || message.includes('already')) {
      return res.status(400).json({
        error: 'Bad Request',
        message,
      });
    }

    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Activation failed',
    });
  }
});

router.post('/verify', async (req: Request, res: Response) => {
  try {
    const { activation_token, device_id } = req.body;

    if (!activation_token || !device_id) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'activation_token and device_id are required',
      });
    }

    const activation = await activationStore.verifyActivation(activation_token, device_id);

    if (!activation) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or expired activation',
        valid: false,
      });
    }

    return res.json({
      valid: true,
      activation: {
        id: activation.id,
        user_id: activation.user_id,
        device_id: activation.device_id,
        expires_at: activation.expires_at,
        last_verified_at: activation.last_verified_at,
      },
    });
  } catch (error) {
    logger.error('[Activation] Verification failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Verification failed',
    });
  }
});

router.get('/my-activations', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const activations = await activationStore.getActivationsByUser(req.user!.userId);
    const activationRows = activations as Array<typeof activations[number] & {
      code?: string;
      code_type?: string;
    }>;

    return res.json({
      activations: activationRows.map(a => ({
        id: a.id,
        code: a.code,
        code_type: a.code_type,
        device_id: a.device_id,
        device_name: a.device_name,
        device_os: a.device_os,
        status: a.status,
        activated_at: a.activated_at,
        expires_at: a.expires_at,
        last_verified_at: a.last_verified_at,
      })),
    });
  } catch (error) {
    logger.error('[Activation] Get activations failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get activations',
    });
  }
});

router.get('/my-codes', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const codes = await activationStore.getCodesByPurchaser(req.user!.userId);

    return res.json({
      codes: codes.map(c => ({
        id: c.id,
        code: c.code,
        code_type: c.code_type,
        price: c.price,
        status: c.status,
        validity_days: c.validity_days,
        created_at: c.created_at,
        used_at: c.used_at,
        referral_bonus: c.referral_bonus,
      })),
    });
  } catch (error) {
    logger.error('[Activation] Get codes failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get codes',
    });
  }
});

router.post('/deactivate', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { activation_id } = req.body;

    if (!activation_id) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'activation_id is required',
      });
    }

    const activations = await activationStore.getActivationsByUser(req.user!.userId);
    const activation = activations.find(a => a.id === activation_id);

    if (!activation) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Activation not found',
      });
    }

    await activationStore.deactivateActivation(activation_id);

    return res.json({
      message: 'Activation deactivated',
    });
  } catch (error) {
    logger.error('[Activation] Deactivation failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Deactivation failed',
    });
  }
});

export default router;
