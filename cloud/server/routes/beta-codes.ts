import { Router, Request, Response, NextFunction } from "express";
import { BetaCodeStore } from "../../storage/beta-code-store";
import { SubscriptionStore } from "../../storage/subscription-store";
import { DatabaseConnection } from "../../database/connection";
import { logger } from "../../utils/logger";
import { authMiddleware, AuthenticatedRequest, rateLimitMiddleware } from "../middleware/auth";
import { BetaCode, CreateBetaCodeInput } from "../../database/types-beta";
import { Subscription } from "../../database/types";

const adminRouter = Router();
const publicRouter = Router();
const LIFETIME_2D_CODE_TYPE = "lifetime_2d";
const LIFETIME_ONCE_CODE_TYPE = "lifetime_once";
const LIMITED_TRIAL_2D_15D_CODE_TYPE = "limited_trial_2d_15d";
const DAY_MS = 24 * 60 * 60 * 1000;

let db: DatabaseConnection;
let betaCodeStore: BetaCodeStore;
let subscriptionStore: SubscriptionStore;

export function initializeBetaCodeRoutes(database: DatabaseConnection): void {
  db = database;
  betaCodeStore = new BetaCodeStore(db);
  subscriptionStore = new SubscriptionStore(db);
}

function isUnlimitedUseCode(codeType: string): boolean {
  return codeType === LIFETIME_2D_CODE_TYPE || codeType === LIMITED_TRIAL_2D_15D_CODE_TYPE;
}

function getTwoDayExpiryDate(): Date {
  return new Date(Date.now() + 2 * DAY_MS);
}

async function logAdminAction(
  adminId: string, action: string, targetType: string, targetId: string | null,
  details: Record<string, any>, ipAddress: string | undefined
): Promise<void> {
  try {
    await db.query(
      "INSERT INTO admin_logs (admin_id, action, target_type, target_id, details, ip_address) VALUES ($1, $2, $3, $4, $5, $6)",
      [adminId, action, targetType, targetId, JSON.stringify(details), ipAddress || null]
    );
  } catch (error) {
    logger.error("[BetaCodes] Failed to log admin action:", error);
  }
}

const adminMiddleware = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user!.userId === "admin") return next();
    const user = await db.queryOne<{ role: string }>("SELECT role FROM users WHERE id = $1", [req.user!.userId]);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden", message: "Admin access required" });
    }
    next();
  } catch (error) {
    logger.error("[BetaCodes] Permission check failed:", error);
    return res.status(500).json({ error: "Internal Server Error", message: "Permission check failed" });
  }
};

adminRouter.post("/generate", authMiddleware, adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { quantity, code_type, validity_days, batch_name, expires_at, notes } = req.body;
    const isLifetimeCode = code_type === LIFETIME_2D_CODE_TYPE;
    const isLifetimeOnceCode = code_type === LIFETIME_ONCE_CODE_TYPE;
    const isLimitedTrialCode = code_type === LIMITED_TRIAL_2D_15D_CODE_TYPE;
    const input: CreateBetaCodeInput = {
      quantity,
      code_type: code_type || "trial",
      validity_days: isLifetimeCode ? 2 : (isLifetimeOnceCode ? 365 : (isLimitedTrialCode ? 15 : (validity_days || 30))),
      batch_name,
      expires_at: expires_at ? new Date(expires_at) : (isUnlimitedUseCode(code_type) ? getTwoDayExpiryDate() : undefined),
      notes,
      created_by: req.user!.userId,
    };
    const codes = await betaCodeStore.generateCodes(input);
    logger.info("[BetaCodes] Admin " + req.user!.userId + " generated " + codes.length + " beta codes");
    await logAdminAction(req.user!.userId, "generate_beta_codes", "beta_code", null, { quantity: codes.length, batch_id: codes[0]?.batch_id }, req.ip);
    return res.json({ message: "Beta codes generated successfully", total: codes.length, codes: codes.map(c => ({ id: c.id, code: c.code, code_type: c.code_type, validity_days: c.validity_days, status: c.status, batch_id: c.batch_id, batch_name: c.batch_name, created_at: c.created_at })) });
  } catch (error: any) {
    logger.error("[BetaCodes] Generate failed:", error);
    return res.status(400).json({ error: "Bad Request", code: "INTERNAL_ERROR", message: error.message || "Failed to generate beta codes" });
  }
});

adminRouter.get("/", authMiddleware, adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, batchId, limit, offset } = req.query;
    const codes = await betaCodeStore.listCodes({
      status: status as string, batchId: batchId as string,
      limit: limit ? parseInt(limit as string, 10) : 100, offset: offset ? parseInt(offset as string, 10) : 0,
    });
    return res.json({ codes: codes.map(c => ({ id: c.id, code: c.code, code_type: c.code_type, validity_days: c.validity_days, status: c.status, batch_id: c.batch_id, batch_name: c.batch_name, used_by: c.used_by, expires_at: c.expires_at, used_at: c.used_at, notes: c.notes, created_at: c.created_at })) });
  } catch (error) {
    logger.error("[BetaCodes] List failed:", error);
    return res.status(500).json({ error: "Internal Server Error", code: "INTERNAL_ERROR", message: "Failed to list beta codes" });
  }
});

adminRouter.get("/stats", authMiddleware, adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const stats = await betaCodeStore.getStats();
    return res.json({ stats });
  } catch (error) {
    logger.error("[BetaCodes] Stats failed:", error);
    return res.status(500).json({ error: "Internal Server Error", code: "INTERNAL_ERROR", message: "Failed to get beta code stats" });
  }
});

adminRouter.delete("/:id", authMiddleware, adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const code = await betaCodeStore.disableCode(id);
    if (!code) return res.status(404).json({ error: "Not Found", code: "NOT_FOUND", message: "Beta code not found" });
    logger.info("[BetaCodes] Admin " + req.user!.userId + " disabled beta code " + id);
    await logAdminAction(req.user!.userId, "disable_beta_code", "beta_code", id, { code: code.code }, req.ip);
    return res.json({ message: "Beta code disabled", code: { id: code.id, code: code.code, status: code.status } });
  } catch (error) {
    logger.error("[BetaCodes] Disable failed:", error);
    return res.status(500).json({ error: "Internal Server Error", code: "INTERNAL_ERROR", message: "Failed to disable beta code" });
  }
});

publicRouter.post("/validate", rateLimitMiddleware(20, 60000), async (req: Request, res: Response) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: "Bad Request", message: "Beta code is required" });
    const trimmedCode = code.trim().toUpperCase();
    if (trimmedCode.length !== 8 && trimmedCode.length !== 17) {
      return res.status(400).json({ error: "Bad Request", code: "INVALID_FORMAT", message: "内测码格式无效" });
    }
    const betaCode = await betaCodeStore.findByCode(trimmedCode);
    if (!betaCode) return res.json({ valid: false, reason: "内测码不存在", code: "NOT_FOUND" });
    const isLifetimeCode = betaCode.code_type === LIFETIME_2D_CODE_TYPE || betaCode.code_type === LIFETIME_ONCE_CODE_TYPE;
    const isUnlimitedUse = isUnlimitedUseCode(betaCode.code_type);
    if (betaCode.status === "used" && !isUnlimitedUse) return res.json({ valid: false, reason: "内测码已被使用", code: "ALREADY_USED" });
    if (betaCode.status === "expired") return res.json({ valid: false, reason: "内测码已过期", code: "EXPIRED" });
    if (betaCode.status === "disabled") return res.json({ valid: false, reason: "内测码已禁用", code: "DISABLED" });
    if (betaCode.expires_at && new Date() > new Date(betaCode.expires_at)) return res.json({ valid: false, reason: "内测码已过期", code: "EXPIRED_BY_TIME" });
    return res.json({
      valid: true,
      code_type: betaCode.code_type,
      validity_days: betaCode.validity_days,
      unlimited_uses: isUnlimitedUse,
      access_type: isLifetimeCode ? "lifetime" : "trial",
      message: isLifetimeCode
        ? (betaCode.code_type === LIFETIME_ONCE_CODE_TYPE ? "有效 - 一次性永久内测码，每个码仅可使用一次" : "有效 - 2天限时永久内测码，不限使用人数")
        : (isUnlimitedUse ? `有效 - 2天限时${betaCode.validity_days}天试用码，不限使用人数` : `有效 - ${betaCode.validity_days}天免费试用`),
    });
  } catch (error) {
    logger.error("[BetaCodes] Validate failed:", error);
    return res.status(500).json({ error: "Internal Server Error", code: "INTERNAL_ERROR", message: "Failed to validate beta code" });
  }
});

/**
 * 已登录用户：激活内测码
 * 需要认证（authMiddleware），用于 EXE 购买页面的内测码激活
 */
publicRouter.post("/activate", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { code } = req.body;
    const userId = req.user!.userId;

    if (!code) {
      return res.status(400).json({
        success: false,
        reason: "内测码不能为空",
      });
    }

    const trimmedCode = code.trim().toUpperCase();

    // 验证内测码
    const betaCodeRecord = await betaCodeStore.findByCode(trimmedCode);
    
    if (!betaCodeRecord) {
      return res.json({
        success: false,
        reason: "内测码不存在",
      });
    }
    
    const isLifetimeCode = betaCodeRecord.code_type === LIFETIME_2D_CODE_TYPE || betaCodeRecord.code_type === LIFETIME_ONCE_CODE_TYPE;
    const isUnlimitedUse = isUnlimitedUseCode(betaCodeRecord.code_type);

    // 普通试用码不覆盖已有订阅；限时永久码可以把已有订阅升级为永久。
    const existingSubscription = await subscriptionStore.getActiveSubscription(userId);
    
    if (existingSubscription && !isLifetimeCode) {
      return res.json({
        success: false,
        reason: "您已有活跃订阅，无需使用内测码",
      });
    }

    if (betaCodeRecord.status === "used" && !isUnlimitedUse) {
      return res.json({
        success: false,
        reason: "内测码已被使用",
      });
    }
    
    if (betaCodeRecord.status === "expired") {
      return res.json({
        success: false,
        reason: "内测码已过期",
      });
    }
    
    if (betaCodeRecord.status === "disabled") {
      return res.json({
        success: false,
        reason: "内测码已禁用",
      });
    }
    
    if (betaCodeRecord.expires_at && new Date() > new Date(betaCodeRecord.expires_at)) {
      return res.json({
        success: false,
        reason: "内测码已过期",
      });
    }

    // 内测码有效，创建订阅。lifetime_2d 是限时活动码，但兑换后的账号永久可用。
    const usedCode = await betaCodeStore.useCode({
      code: trimmedCode,
      user_id: userId,
    });

    const startDate = new Date();
    const endDate = isLifetimeCode
      ? new Date(new Date(startDate).setFullYear(startDate.getFullYear() + 100))
      : new Date(Date.now() + betaCodeRecord.validity_days * DAY_MS);
    
    const trialSubscription = existingSubscription
      ? await db.queryOne<Subscription>(
          `UPDATE subscriptions
           SET plan_type = $1,
               status = $2,
               start_date = $3,
               end_date = $4,
               trial_start = $5,
               trial_end = $6,
               quota_total = $7,
               quota_remaining = $8,
               max_file_upload = $9,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $10
           RETURNING *`,
          [
            isLifetimeCode ? "lifetime" : "trial",
            isLifetimeCode ? "active" : "trial",
            startDate,
            endDate,
            isLifetimeCode ? null : startDate,
            isLifetimeCode ? null : endDate,
            -1,
            -1,
            -1,
            existingSubscription.id,
          ]
        )
      : await db.queryOne<Subscription>(
          `INSERT INTO subscriptions (
            user_id, plan_type, status, start_date, end_date,
            price, currency, auto_renew,
            quota_total, quota_used, quota_remaining,
            max_file_upload, file_upload_used,
            trial_start, trial_end
          )
          VALUES ($1, $4, $5, $2, $3, 0, 'CNY', false, $8, 0, $8, $9, 0, $6, $7)
          RETURNING *`,
          [
            userId,
            startDate,
            endDate,
            isLifetimeCode ? "lifetime" : "trial",
            isLifetimeCode ? "active" : "trial",
            isLifetimeCode ? null : startDate,
            isLifetimeCode ? null : endDate,
            -1,
            -1,
          ]
        );
    
    if (!trialSubscription) {
      return res.status(500).json({
        success: false,
        reason: "创建或更新订阅失败",
      });
    }
    
    logger.info(`[BetaCodes] User ${userId} activated beta code ${trimmedCode}, lifetime=${usedCode.isLifetime}`);

    return res.json({
      success: true,
      trial_days: isLifetimeCode ? undefined : betaCodeRecord.validity_days,
      access_type: isLifetimeCode ? "lifetime" : "trial",
      message: isLifetimeCode ? "已激活永久免费使用权限" : `已激活${betaCodeRecord.validity_days}天免费试用期`,
      subscription: {
        plan_type: trialSubscription.plan_type,
        status: trialSubscription.status,
        start_date: trialSubscription.start_date,
        end_date: trialSubscription.end_date,
      },
    });
  } catch (error: any) {
    logger.error("[BetaCodes] Activate failed:", error);
    
    // 处理已知错误码
    if (error.message === "BETA_CODE_NOT_FOUND") {
      return res.json({ success: false, reason: "内测码不存在" });
    }
    if (error.message === "BETA_CODE_ALREADY_USED") {
      return res.json({ success: false, reason: "内测码已被使用" });
    }
    if (error.message === "BETA_CODE_EXPIRED" || error.message === "BETA_CODE_EXPIRED_BY_TIME") {
      return res.json({ success: false, reason: "内测码已过期" });
    }
    if (error.message === "BETA_CODE_DISABLED") {
      return res.json({ success: false, reason: "内测码已禁用" });
    }
    
    return res.status(500).json({
      success: false,
      reason: "内测码激活失败，请稍后重试",
    });
  }
});

export { adminRouter, publicRouter };
