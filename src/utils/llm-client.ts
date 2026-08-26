import * as http from "http";
import * as https from "https";

import type { APIClient, ChatOptions, Message } from "../types";
import { logger } from "./logger";

export interface LLMToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface LLMToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface LLMToolMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: LLMToolCall[];
}

function stringifyToolMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text || "");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return String(content ?? "");
}

/**
 * Final protocol guard for OpenAI-compatible tool loops. A request is rejected
 * with a 400 when an assistant message declares `tool_calls` but the tool
 * responses are incomplete ("insufficient tool messages following tool_calls
 * message"). Strict providers (DashScope 小牛马, OpenAI, etc) enforce this
 * exactly. This function repairs ANY message list before it hits the wire:
 *  - missing tool responses are backfilled with placeholder tool messages;
 *  - orphan tool messages (no matching assistant tool_calls) are demoted to
 *    user text so their information is not lost;
 *  - the assistant→tool responses run stays contiguous.
 */
export function repairToolMessagePairing(
  inputMessages: Array<Message | LLMToolMessage>
): { messages: Array<Message | LLMToolMessage>; repaired: boolean } {
  const messages: Array<Message | LLMToolMessage> = [];
  const pendingCallIds: string[] = [];
  let repaired = false;

  const flushPending = (): void => {
    if (pendingCallIds.length === 0) return;
    for (const id of pendingCallIds) {
      messages.push({
        role: "tool",
        tool_call_id: id,
        name: "unknown",
        content: "<missing tool result: 该工具调用结果缺失，已自动补齐占位；请基于已有信息继续>",
      });
    }
    pendingCallIds.length = 0;
    repaired = true;
  };

  for (const message of inputMessages) {
    if (message.role === "assistant") {
      const toolCalls = (message as LLMToolMessage).tool_calls;
      if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        flushPending();
        for (const call of toolCalls) {
          if (call?.id) pendingCallIds.push(call.id);
        }
        messages.push(message);
        continue;
      }
      if (pendingCallIds.length > 0) flushPending();
      messages.push(message);
      continue;
    }

    if (message.role === "tool") {
      const toolMessage = message as LLMToolMessage;
      const id = String(toolMessage.tool_call_id || "");
      const index = pendingCallIds.indexOf(id);
      if (index >= 0) {
        pendingCallIds.splice(index, 1);
        messages.push(message);
      } else {
        // Orphan tool message: no assistant tool_calls referenced it. Demote to
        // user text instead of sending an invalid tool message.
        messages.push({
          role: "user",
          content: `[tool result] ${toolMessage.name || "tool"}: ${stringifyToolMessageContent(toolMessage.content)}`,
        });
        repaired = true;
      }
      continue;
    }

    if (pendingCallIds.length > 0) flushPending();
    messages.push(message);
  }
  flushPending();

  return { messages, repaired };
}

export interface LLMToolChatResult {
  content: string;
  toolCalls: LLMToolCall[];
  finishReason?: string;
  raw?: unknown;
}

export interface LLMClientConfig {
  apiUrl: string;
  apiKey: string;
  defaultModel?: string;
  defaultTemperature?: number;
  label?: string;
}

export interface LLMChatRequest {
  model?: string;
  messages: Array<Message | LLMToolMessage>;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: string;
  stream?: boolean;
  onProgress?: (chunk: string) => void;
  onThinking?: (chunk: string) => void;
  onUsage?: (usage: LLMTokenUsage) => void;
  tools?: LLMToolDefinition[];
  toolChoice?: "auto" | "none" | "required" | Record<string, unknown>;
  parallelToolCalls?: boolean;
  signal?: AbortSignal;
}

export interface LLMTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  /**
   * Tokens served from the provider KV/prefix cache (DeepSeek
   * `prompt_tokens_details.cached_tokens` / `prompt_cache_hit_tokens`).
   * Undefined when the provider reported no cache information.
   */
  cacheReadTokens?: number;
  estimated?: boolean;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string; type?: string }>;
      reasoning_content?: string;
      tool_calls?: LLMToolCall[];
      function_call?: {
        name?: string;
        arguments?: string;
      };
    };
    text?: string;
    delta?: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: LLMToolCall[];
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    reasoning_tokens?: number;
    reasoningTokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
    /** DeepSeek / OpenAI-compat cache accounting. */
    prompt_tokens_details?: { cached_tokens?: number };
    /** DeepSeek native spelling of cache hits. */
    prompt_cache_hit_tokens?: number;
  };
}

function extractChatCompletionUsage(data: ChatCompletionResponse): LLMTokenUsage | null {
  const usage = data.usage;
  if (!usage || typeof usage !== "object") return null;
  const rawPromptTokens = Number(
    usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens ?? usage.inputTokens ?? 0
  );
  const outputTokens = Number(
    usage.completion_tokens ?? usage.output_tokens ?? usage.completionTokens ?? usage.outputTokens ?? 0
  );
  const reportedTotal = Number(usage.total_tokens ?? usage.totalTokens ?? 0);
  const reasoningTokens = Number(
    usage.reasoning_tokens ?? usage.reasoningTokens ?? usage.completion_tokens_details?.reasoning_tokens ?? 0
  );
  // Cache reads: DeepSeek reports them via `prompt_tokens_details.cached_tokens`
  // (OpenAI-compat spelling) or `prompt_cache_hit_tokens`. Per DeepSeek's wire
  // accounting `prompt_tokens` INCLUDES cache hits, so paid input is
  // `prompt_tokens - cache_read`; when the provider reports no cache field we
  // keep cacheReadTokens undefined rather than guessing zero.
  const cacheRead = Number(
    usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? 0
  );
  const hasCacheRead = (
    usage.prompt_tokens_details?.cached_tokens !== undefined
    || usage.prompt_cache_hit_tokens !== undefined
  ) && Number.isFinite(cacheRead) && cacheRead >= 0;
  const inputTokens = hasCacheRead && rawPromptTokens > 0
    ? Math.max(0, rawPromptTokens - cacheRead)
    : rawPromptTokens;
  if (![inputTokens, outputTokens, reportedTotal, reasoningTokens].some(value => Number.isFinite(value) && value > 0)) {
    return null;
  }
  return {
    inputTokens: Number.isFinite(inputTokens) && inputTokens > 0 ? Math.floor(inputTokens) : 0,
    outputTokens: Number.isFinite(outputTokens) && outputTokens > 0 ? Math.floor(outputTokens) : 0,
    totalTokens: Number.isFinite(reportedTotal) && reportedTotal > 0
      ? Math.floor(reportedTotal)
      : Math.max(0, Math.floor(inputTokens || 0) + Math.floor(outputTokens || 0)),
    ...(Number.isFinite(reasoningTokens) && reasoningTokens > 0
      ? { reasoningTokens: Math.floor(reasoningTokens) }
      : {}),
    ...(hasCacheRead ? { cacheReadTokens: Math.floor(cacheRead) } : {}),
  };
}

interface RawChatCompletionHttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  text: string;
  stream?: NodeJS.ReadableStream;
}

type ErrorWithCause = Error & {
  code?: string;
  cause?: unknown;
  address?: string;
  port?: number | string;
  syscall?: string;
  hostname?: string;
  host?: string;
};

const DEFAULT_LLM_REQUEST_TIMEOUT_MS = 300_000;
const EMPTY_RESPONSE_MAX_ATTEMPTS = 2;

function createAbortError(message = "LLM request was cancelled by the user"): ErrorWithCause {
  const error = new Error(message) as ErrorWithCause;
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  return error;
}

function isAbortError(error: unknown): boolean {
  const record = getErrorRecord(error) as unknown as ErrorWithCause;
  return record.name === "AbortError"
    || String(record.code || "").toUpperCase() === "ABORT_ERR"
    || /cancelled by the user|request was aborted/i.test(String(record.message || ""));
}

function getHostForLog(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

function getErrorRecord(error: unknown): Record<string, unknown> {
  if (error && typeof error === "object") {
    return error as Record<string, unknown>;
  }
  return {};
}

function collectTransportErrorDetails(error: unknown): string[] {
  const err = getErrorRecord(error) as unknown as ErrorWithCause;
  const cause = getErrorRecord(err.cause);
  const details: string[] = [];

  const add = (key: string, value: unknown) => {
    if (value === undefined || value === null || value === "") return;
    details.push(`${key}=${String(value)}`);
  };

  add("name", err.name);
  add("message", err.message || String(error || ""));
  add("code", err.code);
  add("syscall", err.syscall);
  add("host", err.host || err.hostname || cause.host || cause.hostname);
  add("address", err.address || cause.address);
  add("port", err.port || cause.port);
  add("cause.name", cause.name);
  add("cause.message", cause.message);
  add("cause.code", cause.code);

  return details;
}

function isRetryableTransportError(error: unknown): boolean {
  const err = getErrorRecord(error) as unknown as ErrorWithCause;
  const cause = getErrorRecord(err.cause);
  const code = String(err.code || cause.code || "").toUpperCase();
  const message = String(err.message || cause.message || error || "");
  return [
    "ETIMEDOUT",
    "ECONNRESET",
    "ECONNREFUSED",
    "EAI_AGAIN",
    "ENOTFOUND",
    "UND_ERR_CONNECT_TIMEOUT",
    "ECONNABORTED",
    "EPIPE",
  ].includes(code) || /timeout|timed out|socket hang up|network|fetch failed|connection/i.test(message);
}

function formatTransportError(label: string | undefined, endpoint: string, error: unknown): string {
  const serviceLabel = label || "LLM";
  const host = getHostForLog(endpoint);
  const details = collectTransportErrorDetails(error);
  const detailText = details.length > 0 ? `；${details.join("；")}` : "";
  const err = getErrorRecord(error) as unknown as ErrorWithCause;
  const cause = getErrorRecord(err.cause);
  const code = String(err.code || cause.code || "").toUpperCase();
  const message = String(err.message || cause.message || error || "请求失败");

  if (/timeout|timed out/i.test(message) || code.includes("TIMEOUT")) {
    return `${serviceLabel} 连接超时：无法连接到 ${host}。请检查网络/代理/API 地址，或稍后重试${detailText}`;
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return `${serviceLabel} 域名解析失败：${host}。请检查 DNS、代理或 API 地址${detailText}`;
  }
  if (["ECONNREFUSED", "ECONNRESET", "ECONNABORTED", "EPIPE"].includes(code)) {
    return `${serviceLabel} 连接被中断：${host}。请检查代理/上游服务稳定性，或稍后重试${detailText}`;
  }

  return `${serviceLabel} 请求上游模型服务失败：${message}；host=${host}${detailText}`;
}

async function postChatCompletionHttp(
  endpoint: string,
  apiKey: string,
  bodyPayload: unknown,
  expectStream: boolean,
  label?: string,
  signal?: AbortSignal
): Promise<RawChatCompletionHttpResponse> {
  if (signal?.aborted) {
    throw createAbortError();
  }
  const url = new URL(endpoint);
  const body = JSON.stringify(bodyPayload);
  const transport = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    let settled = false;
    let removeAbortListener = () => {};
    const settleResolve = (value: RawChatCompletionHttpResponse) => {
      if (settled) return;
      settled = true;
      removeAbortListener();
      resolve(value);
    };
    const settleReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      removeAbortListener();
      reject(error);
    };

    const req = transport.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : undefined,
      method: "POST",
      path: `${url.pathname}${url.search}`,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      const status = res.statusCode || 0;
      const statusText = res.statusMessage || "";
      const ok = status >= 200 && status < 300;

      if (expectStream && ok) {
        settleResolve({
          ok,
          status,
          statusText,
          text: "",
          stream: res,
        });
        return;
      }

      const chunks: Buffer[] = [];
      res.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      res.on("end", () => {
        settleResolve({
          ok,
          status,
          statusText,
          text: Buffer.concat(chunks).toString("utf-8"),
        });
      });
      res.on("error", settleReject);
    });

    req.setTimeout(DEFAULT_LLM_REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`${label || "LLM"} request timed out after ${Math.round(DEFAULT_LLM_REQUEST_TIMEOUT_MS / 1000)}s`));
    });
    req.on("error", settleReject);
    const onAbort = () => {
      req.destroy(createAbortError());
    };
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
      removeAbortListener = () => signal.removeEventListener("abort", onAbort);
      if (signal.aborted) {
        onAbort();
        return;
      }
    }
    req.write(body);
    req.end();
  });
}

async function requestChatCompletionHttp(
  endpoint: string,
  apiKey: string,
  bodyPayload: unknown,
  expectStream: boolean,
  label?: string,
  signal?: AbortSignal
): Promise<RawChatCompletionHttpResponse> {
  const attempts = expectStream ? 1 : 2;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (signal?.aborted) throw createAbortError();
    try {
      logger.info(`[${label || "LLM"}] Requesting ${getHostForLog(endpoint)} (stream=${expectStream}, attempt=${attempt}/${attempts})`);
      return await postChatCompletionHttp(endpoint, apiKey, bodyPayload, expectStream, label, signal);
    } catch (error) {
      lastError = error;
      if (isAbortError(error) || signal?.aborted) {
        logger.info(`[${label || "LLM"}] Active request cancelled by user`);
        throw isAbortError(error) ? error : createAbortError();
      }
      const details = collectTransportErrorDetails(error).join("；");
      logger.warn(`[${label || "LLM"}] Upstream transport error on attempt ${attempt}/${attempts}: ${details || (error as Error)?.message || String(error)}`);
      if (!isRetryableTransportError(error) || attempt === attempts) {
        throw new Error(formatTransportError(label, endpoint, error));
      }
    }
  }

  throw new Error(formatTransportError(label, endpoint, lastError));
}

function extractChatCompletionContent(data: ChatCompletionResponse): string {
  const choice = data.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => part?.text || "").join("");
  }
  return choice?.text || choice?.delta?.content || "";
}

function extractToolCalls(data: ChatCompletionResponse): LLMToolCall[] {
  const choice = data.choices?.[0];
  const message = choice?.message;
  if (!message) return [];
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    return message.tool_calls
      .filter((call) => call?.function?.name)
      .map((call, index) => ({
        id: call.id || `tool_call_${Date.now()}_${index}`,
        type: "function" as const,
        function: {
          name: call.function.name,
          arguments: typeof call.function.arguments === "string" ? call.function.arguments : "",
        },
      }));
  }
  if (message.function_call?.name) {
    return [{
      id: `function_call_${Date.now()}`,
      type: "function",
      function: {
        name: message.function_call.name,
        arguments: message.function_call.arguments || "",
      },
    }];
  }
  return [];
}

async function readStreamingChatCompletion(
  stream: NodeJS.ReadableStream,
  label?: string,
  onProgress?: (chunk: string) => void,
  onUsage?: (usage: LLMTokenUsage) => void,
  signal?: AbortSignal
): Promise<string> {
  let buffer = "";
  let fullContent = "";
  let settled = false;

  const consumeEvent = (eventText: string) => {
    const payload = eventText
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.replace(/^data:\s?/, ""))
      .join("\n")
      .trim();
    if (!payload || payload === "[DONE]") return;

    const data = JSON.parse(payload) as ChatCompletionResponse;
    const usage = extractChatCompletionUsage(data);
    if (usage) onUsage?.(usage);
    const chunk = extractChatCompletionContent(data);
    if (!chunk) return;
    fullContent += chunk;
    onProgress?.(chunk);
  };

  return new Promise((resolve, reject) => {
    let removeAbortListener = () => {};
    const finish = () => {
      if (settled) return;
      settled = true;
      removeAbortListener();
      try {
        if (buffer.trim()) {
          consumeEvent(buffer);
        }
        if (!fullContent) {
          reject(new Error(`${label || "LLM"} API returned empty streaming response`));
          return;
        }
        resolve(fullContent);
      } catch (error) {
        reject(error);
      }
    };

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      removeAbortListener();
      reject(error);
    };

    const onAbort = () => {
      const error = createAbortError();
      const destroy = (stream as { destroy?: (err?: Error) => void }).destroy;
      if (typeof destroy === "function") destroy.call(stream, error);
      fail(error);
    };
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
      removeAbortListener = () => signal.removeEventListener("abort", onAbort);
      if (signal.aborted) {
        onAbort();
        return;
      }
    }

    stream.on("data", (chunk) => {
      try {
        buffer += Buffer.isBuffer(chunk) ? chunk.toString("utf-8") : Buffer.from(chunk).toString("utf-8");
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() || "";
        for (const eventText of events) {
          consumeEvent(eventText);
        }
      } catch (error) {
        const destroy = (stream as { destroy?: (err?: Error) => void }).destroy;
        if (typeof destroy === "function") {
          destroy.call(stream, error instanceof Error ? error : new Error(String(error)));
        }
        fail(error);
      }
    });
    stream.on("end", finish);
    stream.on("error", fail);
  });
}

type StreamingToolCallDelta = {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
};

async function readStreamingToolChatCompletion(
  stream: NodeJS.ReadableStream,
  label?: string,
  onProgress?: (chunk: string) => void,
  onThinking?: (chunk: string) => void,
  onUsage?: (usage: LLMTokenUsage) => void,
  signal?: AbortSignal
): Promise<LLMToolChatResult> {
  let buffer = "";
  let fullContent = "";
  let finishReason: string | undefined;
  const toolCallParts = new Map<number, { id: string; name: string; arguments: string }>();
  let settled = false;

  const consumeEvent = (eventText: string) => {
    const payload = eventText
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.replace(/^data:\s?/, ""))
      .join("\n")
      .trim();
    if (!payload || payload === "[DONE]") return;

    const data = JSON.parse(payload) as ChatCompletionResponse;
    const usage = extractChatCompletionUsage(data);
    if (usage) onUsage?.(usage);
    const choice = data.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) finishReason = choice.finish_reason;

    const delta = choice.delta;
    if (!delta) return;
    const reasoning = typeof delta.reasoning_content === "string" ? delta.reasoning_content : "";
    if (reasoning) onThinking?.(reasoning);
    const content = typeof delta.content === "string" ? delta.content : "";
    if (content) {
      fullContent += content;
      onProgress?.(content);
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const raw of delta.tool_calls as unknown as StreamingToolCallDelta[]) {
        const index = typeof raw.index === "number" ? raw.index : 0;
        const existing = toolCallParts.get(index) || { id: "", name: "", arguments: "" };
        if (raw.id) existing.id = raw.id;
        if (raw.function?.name) existing.name += raw.function.name;
        if (raw.function?.arguments) existing.arguments += raw.function.arguments;
        toolCallParts.set(index, existing);
      }
    }
  };

  return new Promise((resolve, reject) => {
    let removeAbortListener = () => {};
    const finish = () => {
      if (settled) return;
      settled = true;
      removeAbortListener();
      try {
        if (buffer.trim()) consumeEvent(buffer);
        const toolCalls: LLMToolCall[] = Array.from(toolCallParts.entries())
          .sort((left, right) => left[0] - right[0])
          .map(([, part]) => ({
            id: part.id || `tool_call_${Date.now()}_${part.name || "call"}`,
            type: "function" as const,
            function: { name: part.name, arguments: part.arguments },
          }))
          .filter((call) => call.function.name);
        if (!fullContent && toolCalls.length === 0) {
          reject(new Error(`${label || "LLM"} API returned empty streaming response`));
          return;
        }
        resolve({ content: fullContent, toolCalls, finishReason });
      } catch (error) {
        reject(error);
      }
    };

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      removeAbortListener();
      reject(error);
    };

    const onAbort = () => {
      const error = createAbortError();
      const destroy = (stream as { destroy?: (err?: Error) => void }).destroy;
      if (typeof destroy === "function") destroy.call(stream, error);
      fail(error);
    };
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
      removeAbortListener = () => signal.removeEventListener("abort", onAbort);
      if (signal.aborted) {
        onAbort();
        return;
      }
    }

    stream.on("data", (chunk) => {
      try {
        buffer += Buffer.isBuffer(chunk) ? chunk.toString("utf-8") : Buffer.from(chunk).toString("utf-8");
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() || "";
        for (const eventText of events) {
          consumeEvent(eventText);
        }
      } catch (error) {
        const destroy = (stream as { destroy?: (err?: Error) => void }).destroy;
        if (typeof destroy === "function") {
          destroy.call(stream, error instanceof Error ? error : new Error(String(error)));
        }
        fail(error);
      }
    });
    stream.on("end", finish);
    stream.on("error", fail);
  });
}

export function normalizeChatCompletionUrl(apiUrl: string): string {
  const trimmed = apiUrl.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("LLM API URL is empty");
  }

  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.replace(/\/+$/, "");
    if (
      (hostname === "scholarharness.com" || hostname === "api.scholarharness.com") &&
      (pathname === "/api/v1" || pathname.startsWith("/api/v1/activation") || pathname.startsWith("/api/v1/beta-codes"))
    ) {
      throw new Error(
        "LLM API URL 指向 Scholar Harness 官网账号服务，不是模型服务地址。请改为 OpenAI 兼容的模型 API 地址，例如 https://openrouter.ai/api/v1 或 https://dashscope.aliyuncs.com/compatible-mode/v1。"
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("LLM API URL 指向")) {
      throw error;
    }
  }

  return trimmed.endsWith("/chat/completions")
    ? trimmed
    : `${trimmed}/chat/completions`;
}

export function buildChatCompletionRequestBody(
  options: LLMChatRequest,
  defaults: Pick<LLMClientConfig, "defaultModel" | "defaultTemperature"> = {}
): {
  model: string;
  messages: Array<Message | LLMToolMessage>;
  temperature: number;
  stream?: boolean;
  max_tokens?: number;
  tools?: LLMToolDefinition[];
  tool_choice?: "auto" | "none" | "required" | Record<string, unknown>;
  parallel_tool_calls?: boolean;
  reasoning_effort?: string;
  stream_options?: { include_usage?: boolean };
} {
  const model = options.model || defaults.defaultModel || "gpt-4o";
  const temperature = options.temperature ?? defaults.defaultTemperature ?? 0.7;
  const body: {
    model: string;
    messages: Array<Message | LLMToolMessage>;
    temperature: number;
    stream?: boolean;
    max_tokens?: number;
    tools?: LLMToolDefinition[];
    tool_choice?: "auto" | "none" | "required" | Record<string, unknown>;
    parallel_tool_calls?: boolean;
    reasoning_effort?: string;
    stream_options?: { include_usage?: boolean };
  } = {
    model,
    messages: options.messages,
    temperature,
  };

  if (typeof options.stream === "boolean") {
    body.stream = options.stream;
    if (options.stream) {
      // Preserve usage/cost accounting for streaming responses.
      body.stream_options = { include_usage: true };
    }
  }
  if (Number.isFinite(options.maxTokens) && options.maxTokens && options.maxTokens > 0) {
    body.max_tokens = Math.floor(options.maxTokens);
  }
  if (Array.isArray(options.tools) && options.tools.length > 0) {
    body.tools = options.tools;
    body.tool_choice = options.toolChoice || "auto";
  }
  if (typeof options.parallelToolCalls === "boolean") {
    body.parallel_tool_calls = options.parallelToolCalls;
  }
  if (typeof options.reasoningEffort === "string" && options.reasoningEffort.trim()) {
    body.reasoning_effort = options.reasoningEffort.trim();
  }

  return body;
}

export async function callChatCompletion(
  config: LLMClientConfig,
  options: LLMChatRequest
): Promise<string> {
  if (!config.apiKey) {
    throw new Error(`${config.label || "LLM"} API key is empty`);
  }

  const endpoint = normalizeChatCompletionUrl(config.apiUrl);
  const requestBody = buildChatCompletionRequestBody(options, config);

  for (let attempt = 1; attempt <= EMPTY_RESPONSE_MAX_ATTEMPTS; attempt += 1) {
    const response = await requestChatCompletionHttp(
      endpoint,
      config.apiKey,
      requestBody,
      !!options.stream,
      config.label,
      options.signal
    );

    if (!response.ok) {
      const errorText = response.text;
      if (response.status === 402 && /insufficient\s+balance/i.test(errorText)) {
        throw new Error(`${config.label || "LLM"} API error: 402 - 上游模型服务余额不足或 Key 所属账户无可用额度。请充值对应模型平台，或更换有余额的 API Key。`);
      }
      throw new Error(`${config.label || "LLM"} API error: ${response.status} - ${errorText}`);
    }

    if (options.stream) {
      if (!response.stream) {
        throw new Error(`${config.label || "LLM"} API returned a streaming response without a readable body`);
      }
      try {
        return await readStreamingChatCompletion(response.stream, config.label, options.onProgress, options.onUsage, options.signal);
      } catch (error) {
        if (!/returned empty streaming response/i.test((error as Error)?.message || '') || attempt === EMPTY_RESPONSE_MAX_ATTEMPTS) {
          throw error;
        }
        logger.warn(`[${config.label || "LLM"}] Empty streaming response; retrying the same request (${attempt + 1}/${EMPTY_RESPONSE_MAX_ATTEMPTS})`);
        continue;
      }
    }

    const data = JSON.parse(response.text || "{}") as ChatCompletionResponse;
    const usage = extractChatCompletionUsage(data);
    if (usage) options.onUsage?.(usage);
    const content = extractChatCompletionContent(data);
    if (content) return content;

    const finishReason = data.choices?.[0]?.finish_reason;
    if (attempt < EMPTY_RESPONSE_MAX_ATTEMPTS) {
      logger.warn(
        `[${config.label || "LLM"}] Empty response` +
        (finishReason ? ` (finish_reason=${finishReason})` : '') +
        `; retrying the same request (${attempt + 1}/${EMPTY_RESPONSE_MAX_ATTEMPTS})`
      );
      continue;
    }
    const preview = JSON.stringify(data).slice(0, 600);
    throw new Error(
      `${config.label || "LLM"} API returned empty response after retry` +
      (finishReason ? ` (finish_reason=${finishReason})` : "") +
      (preview ? `; response=${preview}` : "")
    );
  }

  throw new Error(`${config.label || "LLM"} API returned empty response after retry`);
}

export async function callChatCompletionWithTools(
  config: LLMClientConfig,
  options: LLMChatRequest
): Promise<LLMToolChatResult> {
  if (!config.apiKey) {
    throw new Error(`${config.label || "LLM"} API key is empty`);
  }

  const endpoint = normalizeChatCompletionUrl(config.apiUrl);
  const paired = repairToolMessagePairing(options.messages);
  if (paired.repaired) {
    logger.warn(
      `[${config.label || "LLM"}] Repaired incomplete tool message pairing before request; roles=${paired.messages.map(m => m.role).join(",")}`
    );
  }
  const requestBody = buildChatCompletionRequestBody({
    ...options,
    stream: true,
    messages: paired.messages,
  }, config);

  for (let attempt = 1; attempt <= EMPTY_RESPONSE_MAX_ATTEMPTS; attempt += 1) {
    const response = await requestChatCompletionHttp(
      endpoint,
      config.apiKey,
      requestBody,
      true,
      config.label,
      options.signal
    );

    if (!response.ok) {
      const errorText = response.text;
      if (response.status === 402 && /insufficient\s+balance/i.test(errorText)) {
        throw new Error(`${config.label || "LLM"} API error: 402 - 上游模型服务余额不足或 Key 所属账户无可用额度。请充值对应模型平台，或更换有余额的 API Key。`);
      }
      throw new Error(`${config.label || "LLM"} API error: ${response.status} - ${errorText}`);
    }

    if (!response.stream) {
      throw new Error(`${config.label || "LLM"} API returned a streaming response without a readable body`);
    }
    try {
      return await readStreamingToolChatCompletion(
        response.stream,
        config.label,
        options.onProgress,
        options.onThinking,
        options.onUsage,
        options.signal
      );
    } catch (error) {
      const isEmpty = /returned empty streaming response/i.test((error as Error)?.message || '');
      if (!isEmpty) throw error;
      if (attempt === EMPTY_RESPONSE_MAX_ATTEMPTS) break;
      logger.warn(`[${config.label || "LLM"}] Empty streaming tool response; retrying the same request (${attempt + 1}/${EMPTY_RESPONSE_MAX_ATTEMPTS})`);
      continue;
    }
  }

  throw new Error(`${config.label || "LLM"} API returned empty response after retry`);
}

export function createLLMApiClient(config: LLMClientConfig): APIClient {
  return {
    async chat(options: ChatOptions): Promise<string> {
      return callChatCompletion(
        {
          ...config,
          apiUrl: options.apiUrl || config.apiUrl,
        },
        {
          model: options.model,
          messages: options.messages,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          onUsage: options.onUsage,
          signal: options.abortSignal,
        }
      );
    },
  };
}
