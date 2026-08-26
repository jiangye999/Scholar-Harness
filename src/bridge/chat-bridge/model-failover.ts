/**
 * 模型故障自动切换包装 (步骤 3)
 *
 * chatWithFailover:
 * - 接收一个 ResolvedModel 队列 (listFailoverQueue 返回的)
 * - 对每个 entry 调用底层 API (callChatCompletion)
 * - 仅瞬时错误才切换 (5xx/429/网络/超时)
 * - 健康状态写入 modelHealthStore
 *
 * 接入点: chat-bridge.ts 中 apiClient.chat(...) 调用替换为 chatWithFailover(...)
 *
 * 注意: Codex CLI 路径不接入 (它不是 HTTP API 调用)
 */

import {
  callChatCompletion,
  callChatCompletionWithTools,
  type LLMChatRequest,
  type LLMToolChatResult,
} from '../../utils/llm-client';
import { logger } from '../../utils/logger';
import type { ResolvedModel } from './model-pool';
import type { ProviderKey } from './model-health-store';
import { modelHealthStore } from './model-health-store';

export interface ChatWithFailoverResult {
  content: string;
  usedModel: ResolvedModel;
  /** 切换历史, 用于前端进度推送 */
  switches: Array<{ from: string; to: string; reason: string }>;
}

/**
 * 判断错误是否瞬时 (适合切换到下一个模型).
 *
 * 瞬时: 5xx 服务器错误 / 429 限流 / 网络层 / 超时
 * 非瞬时: 400/401/403/404 业务错误 / 402 余额不足 / 参数错误
 */
export function isTransientError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error || '')).toLowerCase();

  // 非瞬时: 余额不足 (切了也没用, 用户得充值)
  if (/insufficient\s+balance|余额不足/.test(msg)) return false;
  // 非瞬时: 鉴权/参数/资源不存在
  if (/api error: 40[0134]/.test(msg)) return false;
  if (/unauthorized|forbidden|invalid api key|invalid_api_key|authentication/.test(msg)) return false;
  if (/not found|model_not_found|does not exist/.test(msg)) return false;

  // 瞬时: 5xx / 429
  if (/api error: 5\d{2}/.test(msg)) return true;
  if (/api error: 429/.test(msg)) return true;
  if (/rate\s*limit|too many requests|throttle/.test(msg)) return true;

  // 瞬时: 网络层 / 超时
  if (/enotfound|econnreset|econnrefused|etimedout|epipe/.test(msg)) return true;
  if (/network|timeout|timed out|fetch failed|aborted|socket hang up|eai_again/.test(msg)) return true;
  if (/service unavailable|bad gateway|gateway timeout|overloaded/.test(msg)) return true;

  // 瞬时: 空响应 (上游瞬时抽风)
  if (/empty response|empty streaming response/.test(msg)) return true;

  // 默认: 未知错误不切换 (避免在确定性错误上无意义重试)
  return false;
}

/**
 * 主入口: 对一个 ResolvedModel 队列逐个尝试, 第一个成功的返回.
 *
 * @param provider 档位 (用于健康状态写入)
 * @param queue 模型队列 (active 优先, 其余按 priority)
 * @param payload chat 请求参数 (messages/temperature/maxTokens 等)
 * @param opts 可选: onSwitch 切换回调 (推前端进度), signal 取消信号
 */
export async function chatWithFailover(
  provider: ProviderKey,
  queue: ResolvedModel[],
  payload: LLMChatRequest,
  opts: {
    onSwitch?: (from: ResolvedModel | null, to: ResolvedModel, reason: string) => void;
    signal?: AbortSignal;
  } = {},
): Promise<ChatWithFailoverResult> {
  if (!queue || queue.length === 0) {
    throw new Error(`[ModelFailover] ${provider} 模型池为空, 无法调用`);
  }

  // 过滤掉冷却中的 entry
  const effectiveQueue = queue.filter(m => !modelHealthStore.isCoolingDown(provider, m.id));
  if (effectiveQueue.length === 0) {
    // 所有 entry 都在冷却中, 强制用第一个 (不跳过, 让用户看到真实错误)
    logger.warn(`[ModelFailover] ${provider} 所有模型都在冷却中, 强制重试 ${queue[0].id}`);
    effectiveQueue.push(queue[0]);
  }

  const switches: ChatWithFailoverResult['switches'] = [];
  let lastError: unknown = null;
  let lastAttemptedModel: ResolvedModel | null = null;

  for (let i = 0; i < effectiveQueue.length; i++) {
    const entry = effectiveQueue[i];
    lastAttemptedModel = entry;

    if (i > 0) {
      const from = effectiveQueue[i - 1];
      const reason = (lastError instanceof Error ? lastError.message : String(lastError || '')).slice(0, 200);
      logger.warn(`[ModelFailover] ${provider} 由 ${from.id}(${from.model}) 切换到 ${entry.id}(${entry.model}), 原因: ${reason}`);
      switches.push({ from: from.id, to: entry.id, reason });
      try {
        opts.onSwitch?.(from, entry, reason);
      } catch {
        // 回调失败不影响主流程
      }
    }

    try {
      const content = await callChatCompletion(
        {
          apiUrl: entry.api_url,
          apiKey: entry.api_key,
          label: `${provider}:${entry.id}`,
          defaultModel: entry.model,
        },
        { ...payload, model: entry.model, signal: opts.signal },
      );
      modelHealthStore.markHealthy(provider, entry.id);
      return { content, usedModel: entry, switches };
    } catch (error) {
      lastError = error;
      const reason = (error instanceof Error ? error.message : String(error || '')).slice(0, 200);

      if (isTransientError(error)) {
        modelHealthStore.markUnhealthy(provider, entry.id, reason);
        logger.warn(`[ModelFailover] ${provider}:${entry.id}(${entry.model}) 瞬时错误, 将切换下一个: ${reason}`);
        continue;
      }

      // 非瞬时错误: 立即抛出, 不再尝试后续 entry
      logger.error(`[ModelFailover] ${provider}:${entry.id}(${entry.model}) 非瞬时错误, 终止切换: ${reason}`);
      modelHealthStore.markUnhealthy(provider, entry.id, reason, 10_000); // 短冷却, 避免马上又选这个
      throw error;
    }
  }

  // 所有 entry 都失败, 抛出最后一个错误
  const lastMsg = (lastError instanceof Error ? lastError.message : String(lastError || ''));
  const tried = effectiveQueue.map(m => `${m.id}(${m.model})`).join(' → ');
  const aggregateError = new Error(
    `[ModelFailover] ${provider} 所有模型均失败 (尝试顺序: ${tried}). 最后错误: ${lastMsg}`,
  );
  if (lastError instanceof Error) {
    (aggregateError as any).cause = lastError;
  }
  throw aggregateError;
}

export interface ChatWithToolsFailoverResult {
  result: LLMToolChatResult;
  usedModel: ResolvedModel;
  switches: Array<{ from: string; to: string; reason: string }>;
}

/** The tool_calls equivalent of chatWithFailover. */
export async function chatWithToolsFailover(
  provider: ProviderKey,
  queue: ResolvedModel[],
  payload: LLMChatRequest,
  opts: {
    onSwitch?: (from: ResolvedModel | null, to: ResolvedModel, reason: string) => void;
    signal?: AbortSignal;
  } = {},
): Promise<ChatWithToolsFailoverResult> {
  if (!queue || queue.length === 0) {
    throw new Error(`[ModelFailover] ${provider} 模型池为空, 无法调用工具模式`);
  }

  const effectiveQueue = queue.filter(model => !modelHealthStore.isCoolingDown(provider, model.id));
  if (effectiveQueue.length === 0) {
    logger.warn(`[ModelFailover] ${provider} 所有工具模型都在冷却中, 强制重试 ${queue[0].id}`);
    effectiveQueue.push(queue[0]);
  }

  const switches: ChatWithToolsFailoverResult['switches'] = [];
  let lastError: unknown = null;

  for (let index = 0; index < effectiveQueue.length; index += 1) {
    const entry = effectiveQueue[index];
    if (index > 0) {
      const from = effectiveQueue[index - 1];
      const reason = (lastError instanceof Error ? lastError.message : String(lastError || '')).slice(0, 200);
      switches.push({ from: from.id, to: entry.id, reason });
      logger.warn(`[ModelFailover] ${provider} 工具模式由 ${from.id}(${from.model}) 切换到 ${entry.id}(${entry.model}), 原因: ${reason}`);
      try {
        opts.onSwitch?.(from, entry, reason);
      } catch {
        // Progress callbacks are best effort.
      }
    }

    try {
      const result = await callChatCompletionWithTools(
        {
          apiUrl: entry.api_url,
          apiKey: entry.api_key,
          label: `${provider}:${entry.id}:tools`,
          defaultModel: entry.model,
        },
        { ...payload, model: entry.model, signal: opts.signal },
      );
      modelHealthStore.markHealthy(provider, entry.id);
      return { result, usedModel: entry, switches };
    } catch (error) {
      lastError = error;
      const reason = (error instanceof Error ? error.message : String(error || '')).slice(0, 200);
      if (isTransientError(error)) {
        modelHealthStore.markUnhealthy(provider, entry.id, reason);
        logger.warn(`[ModelFailover] ${provider}:${entry.id}(${entry.model}) 工具模式瞬时错误, 将切换下一个: ${reason}`);
        continue;
      }
      modelHealthStore.markUnhealthy(provider, entry.id, reason, 10_000);
      throw error;
    }
  }

  const lastMessage = lastError instanceof Error ? lastError.message : String(lastError || '');
  const tried = effectiveQueue.map(model => `${model.id}(${model.model})`).join(' → ');
  const aggregateError = new Error(
    `[ModelFailover] ${provider} 工具模式所有模型均失败 (尝试顺序: ${tried}). 最后错误: ${lastMessage}`,
  );
  if (lastError instanceof Error) (aggregateError as Error & { cause?: unknown }).cause = lastError;
  throw aggregateError;
}
