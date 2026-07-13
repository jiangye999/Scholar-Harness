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
  stream?: boolean;
  onProgress?: (chunk: string) => void;
  tools?: LLMToolDefinition[];
  toolChoice?: "auto" | "none" | "required" | Record<string, unknown>;
  parallelToolCalls?: boolean;
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
      tool_calls?: LLMToolCall[];
    };
    finish_reason?: string;
  }>;
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
  label?: string
): Promise<RawChatCompletionHttpResponse> {
  const url = new URL(endpoint);
  const body = JSON.stringify(bodyPayload);
  const transport = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    let settled = false;
    const settleResolve = (value: RawChatCompletionHttpResponse) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const settleReject = (error: unknown) => {
      if (settled) return;
      settled = true;
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
    req.write(body);
    req.end();
  });
}

async function requestChatCompletionHttp(
  endpoint: string,
  apiKey: string,
  bodyPayload: unknown,
  expectStream: boolean,
  label?: string
): Promise<RawChatCompletionHttpResponse> {
  const attempts = expectStream ? 1 : 2;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      logger.info(`[${label || "LLM"}] Requesting ${getHostForLog(endpoint)} (stream=${expectStream}, attempt=${attempt}/${attempts})`);
      return await postChatCompletionHttp(endpoint, apiKey, bodyPayload, expectStream, label);
    } catch (error) {
      lastError = error;
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
  onProgress?: (chunk: string) => void
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
    const chunk = extractChatCompletionContent(data);
    if (!chunk) return;
    fullContent += chunk;
    onProgress?.(chunk);
  };

  return new Promise((resolve, reject) => {
    const finish = () => {
      if (settled) return;
      settled = true;
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
      reject(error);
    };

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
  } = {
    model,
    messages: options.messages,
    temperature,
  };

  if (typeof options.stream === "boolean") {
    body.stream = options.stream;
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
  const response = await requestChatCompletionHttp(
    endpoint,
    config.apiKey,
    buildChatCompletionRequestBody(options, config),
    !!options.stream,
    config.label
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
    return readStreamingChatCompletion(response.stream, config.label, options.onProgress);
  }

  const data = JSON.parse(response.text || "{}") as ChatCompletionResponse;
  const content = extractChatCompletionContent(data);
  if (!content) {
    const finishReason = data.choices?.[0]?.finish_reason;
    const preview = JSON.stringify(data).slice(0, 600);
    throw new Error(
      `${config.label || "LLM"} API returned empty response` +
      (finishReason ? ` (finish_reason=${finishReason})` : "") +
      (preview ? `; response=${preview}` : "")
    );
  }

  return content;
}

export async function callChatCompletionWithTools(
  config: LLMClientConfig,
  options: LLMChatRequest
): Promise<LLMToolChatResult> {
  if (!config.apiKey) {
    throw new Error(`${config.label || "LLM"} API key is empty`);
  }

  const endpoint = normalizeChatCompletionUrl(config.apiUrl);
  const response = await requestChatCompletionHttp(
    endpoint,
    config.apiKey,
    buildChatCompletionRequestBody({
      ...options,
      stream: false,
    }, config),
    false,
    config.label
  );

  if (!response.ok) {
    const errorText = response.text;
    if (response.status === 402 && /insufficient\s+balance/i.test(errorText)) {
      throw new Error(`${config.label || "LLM"} API error: 402 - 上游模型服务余额不足或 Key 所属账户无可用额度。请充值对应模型平台，或更换有余额的 API Key。`);
    }
    throw new Error(`${config.label || "LLM"} API error: ${response.status} - ${errorText}`);
  }

  const data = JSON.parse(response.text || "{}") as ChatCompletionResponse;
  const content = extractChatCompletionContent(data);
  const toolCalls = extractToolCalls(data);
  const finishReason = data.choices?.[0]?.finish_reason;
  if (!content && toolCalls.length === 0) {
    const preview = JSON.stringify(data).slice(0, 600);
    throw new Error(
      `${config.label || "LLM"} API returned empty response` +
      (finishReason ? ` (finish_reason=${finishReason})` : "") +
      (preview ? `; response=${preview}` : "")
    );
  }

  return {
    content,
    toolCalls,
    finishReason,
    raw: data,
  };
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
        }
      );
    },
  };
}
