import type { APIClient, ChatOptions, Message } from "../types";

export interface LLMClientConfig {
  apiUrl: string;
  apiKey: string;
  defaultModel?: string;
  defaultTemperature?: number;
  label?: string;
}

export interface LLMChatRequest {
  model?: string;
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  onProgress?: (chunk: string) => void;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string; type?: string }>;
      reasoning_content?: string;
    };
    text?: string;
    delta?: {
      content?: string;
    };
    finish_reason?: string;
  }>;
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

async function readStreamingChatCompletion(
  response: Response,
  label?: string,
  onProgress?: (chunk: string) => void
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error(`${label || "LLM"} API returned a streaming response without a readable body`);
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";

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

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;

    buffer += decoder.decode(chunk.value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || "";
    for (const eventText of events) {
      consumeEvent(eventText);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    consumeEvent(buffer);
  }

  if (!fullContent) {
    throw new Error(`${label || "LLM"} API returned empty streaming response`);
  }

  return fullContent;
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
  messages: Message[];
  temperature: number;
  stream?: boolean;
  max_tokens?: number;
} {
  const model = options.model || defaults.defaultModel || "gpt-4o";
  const temperature = options.temperature ?? defaults.defaultTemperature ?? 0.7;
  const body: {
    model: string;
    messages: Message[];
    temperature: number;
    stream?: boolean;
    max_tokens?: number;
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
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(buildChatCompletionRequestBody(options, config)),
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 402 && /insufficient\s+balance/i.test(errorText)) {
      throw new Error(`${config.label || "LLM"} API error: 402 - 上游模型服务余额不足或 Key 所属账户无可用额度。请充值对应模型平台，或更换有余额的 API Key。`);
    }
    throw new Error(`${config.label || "LLM"} API error: ${response.status} - ${errorText}`);
  }

  if (options.stream) {
    return readStreamingChatCompletion(response, config.label, options.onProgress);
  }

  const data = await response.json() as ChatCompletionResponse;
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
