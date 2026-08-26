import { EventEmitter } from "events";
import * as https from "https";
import { PassThrough } from "stream";

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildChatCompletionRequestBody,
  callChatCompletion,
  callChatCompletionWithTools,
  createLLMApiClient,
  normalizeChatCompletionUrl,
  repairToolMessagePairing,
} from "../../src/utils/llm-client";

vi.mock("https", () => ({
  request: vi.fn(),
}));

interface CapturedHttpsRequest {
  options: https.RequestOptions;
  body: string;
}

const httpsRequestMock = vi.mocked(https.request);

function mockHttpsJsonResponse(payload: unknown): CapturedHttpsRequest[] {
  const captured: CapturedHttpsRequest[] = [];
  httpsRequestMock.mockImplementation(((options: https.RequestOptions, callback: (response: PassThrough & {
    statusCode?: number;
    statusMessage?: string;
  }) => void) => {
    const request = new EventEmitter() as EventEmitter & {
      setTimeout: ReturnType<typeof vi.fn>;
      write: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
    };
    const record: CapturedHttpsRequest = { options, body: "" };
    captured.push(record);

    request.setTimeout = vi.fn();
    request.write = vi.fn((chunk: string | Buffer) => {
      record.body += Buffer.isBuffer(chunk) ? chunk.toString("utf-8") : String(chunk);
    });
    request.end = vi.fn(() => {
      queueMicrotask(() => {
        const response = new PassThrough() as PassThrough & {
          statusCode?: number;
          statusMessage?: string;
        };
        response.statusCode = 200;
        response.statusMessage = "OK";
        callback(response);
        response.end(JSON.stringify(payload));
      });
    });
    request.destroy = vi.fn((error?: Error) => {
      if (error) request.emit("error", error);
    });
    return request;
  }) as typeof https.request);
  return captured;
}

function mockHttpsJsonResponseSequence(payloads: unknown[]): CapturedHttpsRequest[] {
  const captured: CapturedHttpsRequest[] = [];
  httpsRequestMock.mockImplementation(((options: https.RequestOptions, callback: (response: PassThrough & {
    statusCode?: number;
    statusMessage?: string;
  }) => void) => {
    const request = new EventEmitter() as EventEmitter & {
      setTimeout: ReturnType<typeof vi.fn>;
      write: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
    };
    const record: CapturedHttpsRequest = { options, body: "" };
    const responseIndex = captured.length;
    captured.push(record);

    request.setTimeout = vi.fn();
    request.write = vi.fn((chunk: string | Buffer) => {
      record.body += Buffer.isBuffer(chunk) ? chunk.toString("utf-8") : String(chunk);
    });
    request.end = vi.fn(() => {
      queueMicrotask(() => {
        const response = new PassThrough() as PassThrough & {
          statusCode?: number;
          statusMessage?: string;
        };
        response.statusCode = 200;
        response.statusMessage = "OK";
        callback(response);
        response.end(JSON.stringify(payloads[Math.min(responseIndex, payloads.length - 1)]));
      });
    });
    request.destroy = vi.fn((error?: Error) => {
      if (error) request.emit("error", error);
    });
    return request;
  }) as typeof https.request);
  return captured;
}

function mockHttpsStreamingResponse(bodies: string[]): CapturedHttpsRequest[] {
  const captured: CapturedHttpsRequest[] = [];
  httpsRequestMock.mockImplementation(((options: https.RequestOptions, callback: (response: PassThrough & {
    statusCode?: number;
    statusMessage?: string;
  }) => void) => {
    const request = new EventEmitter() as EventEmitter & {
      setTimeout: ReturnType<typeof vi.fn>;
      write: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
    };
    const record: CapturedHttpsRequest = { options, body: "" };
    const responseIndex = captured.length;
    captured.push(record);

    request.setTimeout = vi.fn();
    request.write = vi.fn((chunk: string | Buffer) => {
      record.body += Buffer.isBuffer(chunk) ? chunk.toString("utf-8") : String(chunk);
    });
    request.end = vi.fn(() => {
      queueMicrotask(() => {
        const response = new PassThrough() as PassThrough & {
          statusCode?: number;
          statusMessage?: string;
        };
        response.statusCode = 200;
        response.statusMessage = "OK";
        callback(response);
        response.write(bodies[Math.min(responseIndex, bodies.length - 1)]);
        response.end();
      });
    });
    request.destroy = vi.fn((error?: Error) => {
      if (error) request.emit("error", error);
    });
    return request;
  }) as typeof https.request);
  return captured;
}

describe("llm-client", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes compatible chat completion endpoints", () => {
    expect(normalizeChatCompletionUrl("https://api.example.com/v1/"))
      .toBe("https://api.example.com/v1/chat/completions");
    expect(normalizeChatCompletionUrl("https://api.example.com/v1/chat/completions"))
      .toBe("https://api.example.com/v1/chat/completions");
  });

  it("builds request bodies without forcing max_tokens", () => {
    const body = buildChatCompletionRequestBody({
      messages: [{ role: "user", content: "hello" }],
    }, {
      defaultModel: "model-a",
      defaultTemperature: 0.2,
    });

    expect(body).toEqual({
      model: "model-a",
      messages: [{ role: "user", content: "hello" }],
      temperature: 0.2,
    });
  });

  it("calls OpenAI-compatible chat APIs and returns content", async () => {
    const requests = mockHttpsJsonResponse({
      choices: [{ message: { content: "response text" } }],
    });

    const content = await callChatCompletion(
      { apiUrl: "https://api.example.com/v1", apiKey: "test-key", label: "Test" },
      {
        model: "model-a",
        messages: [{ role: "user", content: "hello" }],
        temperature: 0.3,
        maxTokens: 512,
      }
    );

    expect(content).toBe("response text");
    expect(httpsRequestMock).toHaveBeenCalledTimes(1);
    expect(requests[0].options).toMatchObject({
      protocol: "https:",
      hostname: "api.example.com",
      method: "POST",
      path: "/v1/chat/completions",
      headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
    });
    expect(JSON.parse(requests[0].body)).toMatchObject({
      model: "model-a",
      max_tokens: 512,
    });
  });

  it("reports provider token usage for non-streaming responses", async () => {
    mockHttpsJsonResponse({
      choices: [{ message: { content: "response text" } }],
      usage: {
        prompt_tokens: 123,
        completion_tokens: 45,
        total_tokens: 168,
        completion_tokens_details: { reasoning_tokens: 7 },
      },
    });
    const onUsage = vi.fn();

    await callChatCompletion(
      { apiUrl: "https://api.example.com/v1", apiKey: "test-key", label: "Test" },
      {
        messages: [{ role: "user", content: "hello" }],
        onUsage,
      }
    );

    expect(onUsage).toHaveBeenCalledWith({
      inputTokens: 123,
      outputTokens: 45,
      totalTokens: 168,
      reasoningTokens: 7,
    });
  });

  it("reports DeepSeek OpenAI-compat cache reads and subtracts them from paid input", async () => {
    mockHttpsJsonResponse({
      choices: [{ message: { content: "response text" } }],
      usage: {
        prompt_tokens: 283,
        completion_tokens: 2,
        total_tokens: 285,
        prompt_tokens_details: { cached_tokens: 256 },
      },
    });
    const onUsage = vi.fn();

    await callChatCompletion(
      { apiUrl: "https://api.example.com/v1", apiKey: "test-key", label: "Test" },
      {
        messages: [{ role: "user", content: "hello" }],
        onUsage,
      }
    );

    expect(onUsage).toHaveBeenCalledWith({
      inputTokens: 27,
      outputTokens: 2,
      totalTokens: 285,
      cacheReadTokens: 256,
    });
  });

  it("reports DeepSeek native prompt_cache_hit_tokens spelling", async () => {
    mockHttpsJsonResponse({
      choices: [{ message: { content: "response text" } }],
      usage: {
        prompt_tokens: 283,
        completion_tokens: 2,
        total_tokens: 285,
        prompt_cache_hit_tokens: 256,
      },
    });
    const onUsage = vi.fn();

    await callChatCompletion(
      { apiUrl: "https://api.example.com/v1", apiKey: "test-key", label: "Test" },
      {
        messages: [{ role: "user", content: "hello" }],
        onUsage,
      }
    );

    expect(onUsage).toHaveBeenCalledWith({
      inputTokens: 27,
      outputTokens: 2,
      totalTokens: 285,
      cacheReadTokens: 256,
    });
  });

  it("omits cacheReadTokens when the provider reports no cache fields", async () => {
    mockHttpsJsonResponse({
      choices: [{ message: { content: "response text" } }],
      usage: {
        prompt_tokens: 40,
        completion_tokens: 2,
        total_tokens: 42,
      },
    });
    const onUsage = vi.fn();

    await callChatCompletion(
      { apiUrl: "https://api.example.com/v1", apiKey: "test-key", label: "Test" },
      {
        messages: [{ role: "user", content: "hello" }],
        onUsage,
      }
    );

    expect(onUsage).toHaveBeenCalledWith({
      inputTokens: 40,
      outputTokens: 2,
      totalTokens: 42,
    });
  });

  it("retries a non-streaming chat request once when the upstream response is empty", async () => {
    mockHttpsJsonResponseSequence([
      { choices: [{ message: { content: "" }, finish_reason: "stop" }] },
      { choices: [{ message: { content: "response after retry" }, finish_reason: "stop" }] },
    ]);

    const content = await callChatCompletion(
      { apiUrl: "https://api.example.com/v1", apiKey: "test-key", label: "Test" },
      { messages: [{ role: "user", content: "hello" }] }
    );

    expect(content).toBe("response after retry");
    expect(httpsRequestMock).toHaveBeenCalledTimes(2);
  });

  it("retries an empty tool-call response once with the same request", async () => {
    const requests = mockHttpsStreamingResponse([
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"lookup","arguments":""}}]},"finish_reason":null}]}\n\n' +
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"query\\":\\"hello\\"}"}}]},"finish_reason":null}]}\n\n' +
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n',
    ]);

    const result = await callChatCompletionWithTools(
      { apiUrl: "https://api.example.com/v1", apiKey: "test-key", label: "Test" },
      {
        messages: [{ role: "user", content: "hello" }],
        tools: [{
          type: "function",
          function: { name: "lookup", parameters: { type: "object" } },
        }],
      }
    );

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].function.name).toBe("lookup");
    expect(httpsRequestMock).toHaveBeenCalledTimes(2);
    expect(requests[1].body).toBe(requests[0].body);
  });

  it("reports an empty response only after the retry is also empty", async () => {
    mockHttpsStreamingResponse([
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    ]);

    await expect(callChatCompletionWithTools(
      { apiUrl: "https://api.example.com/v1", apiKey: "test-key", label: "Test" },
      {
        messages: [{ role: "user", content: "hello" }],
        tools: [{
          type: "function",
          function: { name: "lookup", parameters: { type: "object" } },
        }],
      }
    )).rejects.toThrow("API returned empty response after retry");
    expect(httpsRequestMock).toHaveBeenCalledTimes(2);
  });

  it("lets APIClient calls override apiUrl per request", async () => {
    const requests = mockHttpsJsonResponse({
      choices: [{ message: { content: "ok" } }],
    });

    const client = createLLMApiClient({
      apiUrl: "https://default.example.com/v1",
      apiKey: "key",
      defaultModel: "model-a",
    });

    await client.chat({
      apiUrl: "https://override.example.com/v1",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(httpsRequestMock).toHaveBeenCalledTimes(1);
    expect(requests[0].options).toMatchObject({
      hostname: "override.example.com",
      path: "/v1/chat/completions",
    });
  });

  it("aborts an active upstream request without retrying it", async () => {
    const destroy = vi.fn();
    httpsRequestMock.mockImplementation(((options: https.RequestOptions) => {
      const request = new EventEmitter() as EventEmitter & {
        setTimeout: ReturnType<typeof vi.fn>;
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
        destroy: ReturnType<typeof vi.fn>;
      };
      request.setTimeout = vi.fn();
      request.write = vi.fn();
      request.end = vi.fn();
      request.destroy = destroy.mockImplementation((error?: Error) => {
        if (error) request.emit("error", error);
      });
      return request;
    }) as typeof https.request);
    const controller = new AbortController();

    const pending = callChatCompletion(
      { apiUrl: "https://api.example.com/v1", apiKey: "test-key", label: "Test" },
      {
        messages: [{ role: "user", content: "keep working" }],
        signal: controller.signal,
      }
    );
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(httpsRequestMock).toHaveBeenCalledTimes(1);
  });
});

describe("repairToolMessagePairing", () => {
  const assistantWithCalls = (ids: string[]): any => ({
    role: "assistant",
    content: null,
    tool_calls: ids.map(id => ({ id, type: "function", function: { name: "tool_" + id, arguments: "{}" } })),
  });

  it("leaves a complete pairing untouched", () => {
    const messages = [
      { role: "user", content: "hi" },
      assistantWithCalls(["c1", "c2"]),
      { role: "tool", tool_call_id: "c1", name: "a", content: "ok1" },
      { role: "tool", tool_call_id: "c2", name: "b", content: "ok2" },
    ];
    const result = repairToolMessagePairing(messages);
    expect(result.repaired).toBe(false);
    expect(result.messages.length).toBe(4);
  });

  it("backfills missing tool responses so the request cannot 400", () => {
    const messages = [
      assistantWithCalls(["c1"]),
      // tool response for c1 is missing entirely
      { role: "user", content: "next request" },
    ];
    const result = repairToolMessagePairing(messages);
    expect(result.repaired).toBe(true);
    const toolMessages = result.messages.filter(m => m.role === "tool");
    expect(toolMessages.length).toBe(1);
    expect((toolMessages[0] as { tool_call_id?: string }).tool_call_id).toBe("c1");
    // backfill must come before the user message (contiguous assistant->tool)
    const toolIndex = result.messages.findIndex(m => m.role === "tool");
    const userIndex = result.messages.findIndex(m => m.role === "user");
    expect(toolIndex).toBeLessThan(userIndex);
  });

  it("demotes orphan tool messages to user text", () => {
    const messages = [
      { role: "assistant", content: "no calls here" },
      { role: "tool", tool_call_id: "ghost", name: "x", content: "orphan result" },
    ];
    const result = repairToolMessagePairing(messages);
    expect(result.repaired).toBe(true);
    expect(result.messages.some(m => m.role === "tool")).toBe(false);
    expect(result.messages.some(m => m.role === "user" && String(m.content).includes("orphan result"))).toBe(true);
  });

  it("backfills trailing pending call ids at the end of the list", () => {
    const messages = [assistantWithCalls(["c1"])];
    const result = repairToolMessagePairing(messages);
    expect(result.repaired).toBe(true);
    expect(result.messages.filter(m => m.role === "tool").length).toBe(1);
  });
});
