try {
  require('dotenv/config');
} catch (e: any) {
  // dotenv 模块不存在时忽略
}

import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { logger } from '../utils/logger';
import { DatabaseConnection, initializeDatabase as initDatabase } from '../database';
import { initializeJwtSecrets } from '../auth/jwt';
import authRoutes, { initializeAuthRoutes } from './routes/auth';
import activationRoutes, { initializeActivationRoutes } from './routes/activation';
import referralRoutes, { initializeReferralRoutes } from './routes/referral';
import paymentRoutes, { initializePaymentRoutes } from './routes/payment';
import subscriptionRoutes, { initializeSubscriptionRoutes } from './routes/subscription';
import usageRoutes, { initializeUsageRoutes } from './routes/usage';
import verificationRoutes, { initializeVerificationRoutes } from './routes/verification';
import promptRoutes, { initializePromptRoutes } from './routes/prompts';
import securityRoutes, { initializeSecurityRoutes } from './routes/security';
import adminRoutes, { initializeAdminRoutes } from './routes/admin';
import distributorRoutes, { initializeDistributorRoutes } from './routes/distributors';
import distributorPortalRoutes, { initializeDistributorPortalRoutes } from './routes/distributor-portal';
import downloadRoutes, { initializeDownloadRoutes } from './routes/downloads';
import { publicRouter as feedbackRoutes, adminRouter as feedbackAdminRoutes, initializeFeedbackRoutes } from './routes/feedback';
import { publicRouter as betaCodeRoutes, adminRouter as betaCodeAdminRoutes, initializeBetaCodeRoutes } from './routes/beta-codes';
import { SubscriptionStore } from '../storage/subscription-store';
import { ActivationStore } from '../storage/activation-store';
import { VerificationStore } from '../storage/verification-store';
import { createSecurityMiddleware, initializeSecurityMiddleware } from './middleware/security';

const app: Express = express();
const PORT = process.env.PORT || 3000;
const API_VERSION = 'v1';

let db: DatabaseConnection;

async function initializeApp(): Promise<void> {
  try {
    logger.info('[Server] Initializing...');
    
    initializeJwtSecrets();
    logger.info('[Server] JWT secrets initialized');

    db = await initDatabase();
    logger.info('[Server] Database connected');

    initializeSecurityMiddleware(db);
    initializeAuthRoutes(db);
    initializeActivationRoutes(db);
    initializeReferralRoutes(db);
    initializePaymentRoutes(db);
    initializeSubscriptionRoutes(db);
    initializeUsageRoutes(db);
    initializeVerificationRoutes(db);
    initializePromptRoutes(db);
    initializeSecurityRoutes(db);
    await initializeAdminRoutes(db);
    initializeDistributorRoutes(db);
    initializeDistributorPortalRoutes(db);
    await initializeDownloadRoutes(db);
    initializeFeedbackRoutes(db);
    initializeBetaCodeRoutes(db);
    logger.info('[Server] Routes initialized');

    const subscriptionStore = new SubscriptionStore(db);
    const activationStore = new ActivationStore(db);
    const verificationStore = new VerificationStore(db);

    const EXPIRATION_CHECK_INTERVAL = 60 * 60 * 1000;

    setInterval(async () => {
      try {
        await subscriptionStore.checkAndUpdateExpiredSubscriptions();
        await activationStore.checkAndUpdateExpiredActivations();
        await activationStore.checkAndUpdateExpiredActivationCodes();
        await verificationStore.cleanupExpired();
      } catch (error) {
        logger.error('[Server] Expiration check failed:', error);
      }
    }, EXPIRATION_CHECK_INTERVAL);

    (async () => {
      try {
        await subscriptionStore.checkAndUpdateExpiredSubscriptions();
        await activationStore.checkAndUpdateExpiredActivations();
        await activationStore.checkAndUpdateExpiredActivationCodes();
        await verificationStore.cleanupExpired();
        logger.info('[Server] Initial expiration check completed');
      } catch (error) {
        logger.error('[Server] Initial expiration check failed:', error);
      }
    })();

    app.set('trust proxy', 1);
    app.use(helmet());
    app.use(cors({
      origin: process.env.CORS_ORIGINS?.split(',') || '*',
      credentials: true,
    }));
    app.use(compression());
    app.use(`/api/${API_VERSION}/payment/wechat/callback`, express.raw({ type: 'application/json', limit: '1mb' }));
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ extended: true, limit: '50mb' }));
    app.use(createSecurityMiddleware());

    app.get('/health', async (req: Request, res: Response) => {
      const dbHealth = await db.healthCheck();
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        database: dbHealth,
      });
    });

    app.get('/', (req: Request, res: Response) => {
      res.json({
        name: 'Scholar Harness API',
        version: '1.0.0',
        documentation: '/api/docs',
      });
    });

    const apiRouter = express.Router();

    apiRouter.use('/auth', authRoutes);
    apiRouter.use('/activation', activationRoutes);
    apiRouter.use('/referral', referralRoutes);
    apiRouter.use('/payment', paymentRoutes);
    apiRouter.use('/subscription', subscriptionRoutes);
    apiRouter.use('/usage', usageRoutes);
    apiRouter.use('/beta-codes', betaCodeRoutes);
    apiRouter.use('/feedback', feedbackRoutes);
    apiRouter.use('/admin/distributors', distributorRoutes);
    apiRouter.use('/distributor', distributorPortalRoutes);
    apiRouter.use('/admin/feedback', feedbackAdminRoutes);
    apiRouter.use('/admin/beta-codes', betaCodeAdminRoutes);
    apiRouter.use('/admin/security', securityRoutes);
    apiRouter.use('/admin', adminRoutes);
    apiRouter.use('/verification', verificationRoutes);
    apiRouter.use('/prompts', promptRoutes);
    apiRouter.use('/downloads', downloadRoutes);

    app.use(`/api/${API_VERSION}`, apiRouter);

    app.use((err: Error, req: Request, res: Response, next: express.NextFunction) => {
      logger.error('[Server] Error:', err);
      res.status(500).json({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'An error occurred',
      });
    });

    app.use((req: Request, res: Response) => {
      res.status(404).json({
        error: 'Not Found',
        message: 'The requested resource was not found',
      });
    });

    app.listen(PORT, () => {
      logger.info(`[Server] Running on port ${PORT}`);
      logger.info(`[Server] API: http://localhost:${PORT}/api/${API_VERSION}`);
      logger.info(`[Server] Health: http://localhost:${PORT}/health`);
    });

  } catch (error) {
    logger.error('[Server] Initialization failed:', error);
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason, promise) => {
  logger.error('[Server] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('[Server] Uncaught Exception:', error);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  logger.info('[Server] SIGTERM received, shutting down...');
  if (db) {
    await db.disconnect();
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('[Server] SIGINT received, shutting down...');
  if (db) {
    await db.disconnect();
  }
  process.exit(0);
});

initializeApp();
