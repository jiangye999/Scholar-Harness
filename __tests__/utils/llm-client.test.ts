import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildChatCompletionRequestBody,
  callChatCompletion,
  createLLMApiClient,
  normalizeChatCompletionUrl,
} from "../../src/utils/llm-client";

describe("llm-client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "response text" } }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

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
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
      })
    );
    const requestInit = fetchMock.mock.calls[0][1] as RequestInit & { body: string };
    expect(JSON.parse(requestInit.body)).toMatchObject({
      model: "model-a",
      max_tokens: 512,
    });
  });

  it("lets APIClient calls override apiUrl per request", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "ok" } }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createLLMApiClient({
      apiUrl: "https://default.example.com/v1",
      apiKey: "key",
      defaultModel: "model-a",
    });

    await client.chat({
      apiUrl: "https://override.example.com/v1",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(fetchMock.mock.calls[0][0]).toBe("https://override.example.com/v1/chat/completions");
  });
});
