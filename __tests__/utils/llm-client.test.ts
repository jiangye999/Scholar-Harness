import { EventEmitter } from "events";
import * as https from "https";
import { PassThrough } from "stream";

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildChatCompletionRequestBody,
  callChatCompletion,
  createLLMApiClient,
  normalizeChatCompletionUrl,
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
});
