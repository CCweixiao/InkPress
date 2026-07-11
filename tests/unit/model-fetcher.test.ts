import { describe, expect, it, vi, type Mock } from "vitest";
import {
  fetchAnthropicModels,
  ModelFetchError,
} from "../../src/lib/ai/model-fetcher";

function mockResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = { "content-type": "application/json" }
) {
  return new Response(JSON.stringify(body), {
    status,
    headers,
  });
}

function makeFetcher(responses: Response[] | Response): Mock {
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  return vi.fn(async () => queue.shift() ?? new Response("{}", { status: 200 }));
}

describe("fetchAnthropicModels", () => {
  it("normalizes a successful Anthropic /v1/models response", async () => {
    const fetchImpl = makeFetcher(
      mockResponse(200, {
        data: [
          { id: "claude-opus-4-6", type: "model", display_name: "Claude Opus 4.6" },
          { id: "claude-sonnet-4-5", type: "model", display_name: "Claude Sonnet 4.5" },
          { id: "claude-haiku-4-5", type: "model" },
        ],
      })
    );

    const models = await fetchAnthropicModels({
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(models).toEqual([
      { id: "claude-haiku-4-5", name: "claude-haiku-4-5" },
      { id: "claude-opus-4-6", name: "Claude Opus 4.6" },
      { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
    ]);
    // 校验请求头与 URL
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/models");
    expect(init?.method).toBe("GET");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(init?.redirect).toBe("error");
  });

  it("rejects empty baseUrl or apiKey as invalid_url", async () => {
    await expect(
      fetchAnthropicModels({ baseUrl: "", apiKey: "sk", fetchImpl: makeFetcher(new Response()) })
    ).rejects.toMatchObject({ code: "invalid_url" });
    await expect(
      fetchAnthropicModels({ baseUrl: "https://x.com", apiKey: "  ", fetchImpl: makeFetcher(new Response()) })
    ).rejects.toMatchObject({ code: "invalid_url" });
  });

  it("blocks SSRF: localhost / private IP before fetching", async () => {
    const fetchImpl = makeFetcher(new Response());
    for (const baseUrl of [
      "http://localhost",
      "http://127.0.0.1",
      "http://192.168.1.1",
      "http://10.0.0.1",
    ]) {
      fetchImpl.mockClear();
      await expect(
        fetchAnthropicModels({ baseUrl, apiKey: "sk", fetchImpl })
      ).rejects.toMatchObject({ code: "ssrf_blocked" });
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("maps upstream 401 to unauthorized", async () => {
    const fetchImpl = makeFetcher(mockResponse(401, { error: { type: "authentication_error" } }));
    await expect(
      fetchAnthropicModels({ baseUrl: "https://api.anthropic.com", apiKey: "bad", fetchImpl })
    ).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("maps upstream 403 to unauthorized", async () => {
    const fetchImpl = makeFetcher(mockResponse(403, { error: {} }));
    await expect(
      fetchAnthropicModels({ baseUrl: "https://api.anthropic.com", apiKey: "bad", fetchImpl })
    ).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("maps upstream 5xx to upstream_error", async () => {
    const fetchImpl = makeFetcher(mockResponse(500, "internal"));
    await expect(
      fetchAnthropicModels({ baseUrl: "https://api.anthropic.com", apiKey: "sk", fetchImpl })
    ).rejects.toMatchObject({ code: "upstream_error" });
  });

  it("maps AbortError (timeout) to timeout", async () => {
    const fetchImpl = vi.fn(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }) as unknown as typeof fetch;
    await expect(
      fetchAnthropicModels({
        baseUrl: "https://api.anthropic.com",
        apiKey: "sk",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        timeoutMs: 50,
      })
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("maps network error to network_error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(
      fetchAnthropicModels({ baseUrl: "https://api.anthropic.com", apiKey: "sk", fetchImpl })
    ).rejects.toMatchObject({ code: "network_error" });
  });

  it("rejects unparseable JSON as parse_error", async () => {
    const fetchImpl = makeFetcher(
      new Response("not json at all", { status: 200, headers: { "content-type": "text/plain" } })
    );
    await expect(
      fetchAnthropicModels({ baseUrl: "https://api.anthropic.com", apiKey: "sk", fetchImpl })
    ).rejects.toMatchObject({ code: "parse_error" });
  });

  it("rejects HTML content-type (zhipu Anthropic endpoint scenario) as parse_error", async () => {
    const fetchImpl = makeFetcher(
      new Response("<!DOCTYPE html><html></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      })
    );
    await expect(
      fetchAnthropicModels({ baseUrl: "https://open.bigmodel.cn/api/anthropic", apiKey: "sk", fetchImpl })
    ).rejects.toMatchObject({ code: "parse_error" });
  });

  it("uses modelsBaseUrl with /models path when provided (OpenAI-style endpoint)", async () => {
    const fetchImpl = makeFetcher(
      mockResponse(200, {
        data: [{ id: "glm-4.6" }, { id: "glm-4.5" }],
      })
    );
    const models = await fetchAnthropicModels({
      baseUrl: "https://open.bigmodel.cn/api/anthropic",
      apiKey: "sk",
      modelsBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
      fetchImpl,
    });
    expect(models).toEqual([
      { id: "glm-4.5", name: "glm-4.5" },
      { id: "glm-4.6", name: "glm-4.6" },
    ]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://open.bigmodel.cn/api/paas/v4/models");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk");
    expect(headers["Authorization"]).toBe("Bearer sk");
  });

  it("rejects empty data array as parse_error", async () => {
    const fetchImpl = makeFetcher(mockResponse(200, { data: [] }));
    await expect(
      fetchAnthropicModels({ baseUrl: "https://api.anthropic.com", apiKey: "sk", fetchImpl })
    ).rejects.toMatchObject({ code: "parse_error" });
  });

  it("rejects missing data array as parse_error", async () => {
    const fetchImpl = makeFetcher(mockResponse(200, { foo: "bar" }));
    await expect(
      fetchAnthropicModels({ baseUrl: "https://api.anthropic.com", apiKey: "sk", fetchImpl })
    ).rejects.toMatchObject({ code: "parse_error" });
  });

  it("filters out items with type !== 'model'", async () => {
    const fetchImpl = makeFetcher(
      mockResponse(200, {
        data: [
          { id: "claude-opus-4-6", type: "model", display_name: "Opus" },
          { id: "claude-opus-4-6-20250101", type: "model_snapshot", display_name: "Snapshot" },
        ],
      })
    );
    const models = await fetchAnthropicModels({
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(models).toEqual([{ id: "claude-opus-4-6", name: "Opus" }]);
  });

  it("uses id as name when display_name is missing", async () => {
    const fetchImpl = makeFetcher(
      mockResponse(200, {
        data: [{ id: "gpt-4o" }],
      })
    );
    const models = await fetchAnthropicModels({
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(models).toEqual([{ id: "gpt-4o", name: "gpt-4o" }]);
  });

  it("throws ModelFetchError instances (not generic Error)", async () => {
    const fetchImpl = makeFetcher(mockResponse(401, {}));
    try {
      await fetchAnthropicModels({
        baseUrl: "https://api.anthropic.com",
        apiKey: "bad",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ModelFetchError);
    }
  });
});
