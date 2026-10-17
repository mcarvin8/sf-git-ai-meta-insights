import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createGitClient } from "@mcarvin/smart-diff";
import {
  fetchDocumentation,
  summarizeWithDocumentation,
} from "./summarize.mjs";

const url = "https://example.com/release-notes";
const page = {
  results: [{ url, excerpts: ["In this release, we deprecate the legacy API."] }],
  errors: [],
};

function mockMcp(toolResult = { structuredContent: page, content: [] }) {
  const requests = [];
  const fetchImpl = async (input, init) => {
    requests.push({ url: String(input), ...init });
    if (init.method === "GET") return new Response(null, { status: 405 });
    if (init.method === "DELETE") return new Response(null, { status: 200 });
    const request = JSON.parse(init.body);
    if (!request.id && request.id !== 0) return new Response(null, { status: 202 });
    const result =
      request.method === "initialize"
        ? {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "fixture", version: "1" },
          }
        : typeof toolResult === "function"
        ? await toolResult(init)
        : toolResult;
    return Response.json({ jsonrpc: "2.0", id: request.id, result });
  };
  return { requests, fetchImpl };
}

test("anonymous transport sends only the selected URL and identifies every request", async () => {
  const { fetchImpl, requests } = mockMcp();
  const docs = await fetchDocumentation(url, { fetchImpl });
  assert.deepEqual(docs, {
    url,
    excerpts: page.results[0].excerpts[0],
    truncated: false,
  });
  for (const request of requests) {
    assert.equal(request.url, "https://search.parallel.ai/mcp");
    assert.equal(
      new Headers(request.headers).get("User-Agent"),
      "sf-git-ai-meta-insights-sf-release-notes/1.0.0",
    );
    assert.equal(new Headers(request.headers).has("Authorization"), false);
  }
  const call = requests
    .map((r) => r.body && JSON.parse(r.body))
    .find((r) => r?.method === "tools/call");
  assert.deepEqual(call.params, {
    name: "web_fetch",
    arguments: { urls: [url] },
  });
});

test("text JSON responses work and long excerpts carry an explicit truncation flag", async () => {
  const data = {
    results: [{ url, excerpts: ["x".repeat(13_000)] }],
    errors: [],
  };
  const { fetchImpl } = mockMcp({
    content: [{ type: "text", text: JSON.stringify(data) }],
  });
  const docs = await fetchDocumentation(url, { fetchImpl });
  assert.equal(docs.excerpts.length, 12_000);
  assert.equal(docs.truncated, true);
});

test("tool, extraction, empty and malformed results fail explicitly", async () => {
  for (const result of [
    { isError: true, content: [{ type: "text", text: "Rate limit exceeded" }] },
    {
      structuredContent: {
        results: [],
        errors: [{ url, error_type: "FETCH_ERROR" }],
      },
      content: [],
    },
    { structuredContent: { results: [], errors: [] }, content: [] },
    {
      structuredContent: { results: [{ url, excerpts: [null] }], errors: [] },
      content: [],
    },
    { content: [{ type: "text", text: "not JSON" }] },
  ]) {
    await assert.rejects(fetchDocumentation(url, mockMcp(result)));
  }
});

test("invalid URLs are rejected before any request", async () => {
  for (const invalid of [
    "file:///tmp/doc",
    "https://user:secret@example.com/doc",
    "invalid",
  ]) {
    await assert.rejects(
      fetchDocumentation(invalid, {
        fetchImpl: () => assert.fail("unexpected request"),
      }),
    );
  }
});

test("network failure, timeout and cancellation propagate through the transport", async () => {
  await assert.rejects(
    fetchDocumentation(url, {
      fetchImpl: () => Promise.reject(new Error("offline")),
    }),
    /offline/,
  );
  for (const cancel of [false, true]) {
    const controller = new AbortController();
    const { fetchImpl } = mockMcp(
      (init) =>
        new Promise((_, reject) => {
          init.signal.addEventListener(
            "abort",
            () => reject(init.signal.reason),
            { once: true },
          );
          if (cancel) controller.abort(new Error("cancelled"));
        }),
    );
    await assert.rejects(
      fetchDocumentation(url, {
        fetchImpl,
        signal: controller.signal,
        timeoutMs: 50,
      }),
    );
  }
});

test("a real diff reaches the configured provider with documentation and usage intact", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "sf-git-ai-meta-insights-docs-"));
  const git = await createGitClient(cwd);
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  try {
    await git.init();
    const author = {
      name: "Test",
      email: "test@example.com",
      timestamp: 1_700_000_000,
      timezoneOffset: "+0000",
    };
    await writeFile(join(cwd, "config.json"), '{"legacy": true}\n');
    await git.add([], { all: true });
    const from = (await git.commit({ message: "initial", author })).id;
    await writeFile(join(cwd, "config.json"), '{"modern": true}\n');
    await git.add([], { all: true });
    const to = (
      await git.commit({
        message: "migrate config",
        author: { ...author, timestamp: author.timestamp + 1 },
      })
    ).id;

    process.env.LLM_PROVIDER = "openai-compatible";
    process.env.LLM_BASE_URL = "https://llm.example/v1";
    process.env.LLM_MODEL = "chosen-model";
    process.env.LLM_API_KEY = "fixture-key";
    process.env.LLM_DEFAULT_HEADERS = JSON.stringify({
      "X-Selected-Header": "kept",
    });
    let llmCalls = 0;
    globalThis.fetch = async (input, init) => {
      llmCalls++;
      assert.equal(String(input), "https://llm.example/v1/chat/completions");
      assert.equal(new Headers(init.headers).get("X-Selected-Header"), "kept");
      const body = JSON.parse(init.body);
      assert.equal(body.model, "chosen-model");
      assert.match(body.messages[0].content, /senior software engineer/);
      assert.match(body.messages[0].content, /untrusted data/);
      assert.match(body.messages[1].content, /modern/);
      assert.match(body.messages[1].content, /Version/);
      assert.match(
        body.messages[1].content,
        /https:\/\/example.com\/release-notes/,
      );
      return Response.json({
        choices: [{ message: { content: "Release notes summary" } }],
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
      });
    };
    const mcp = mockMcp();
    const result = await summarizeWithDocumentation(
      { from, to, cwd, url },
      mcp,
    );
    assert.equal(result.summary, "Release notes summary");
    assert.equal(result.usage.totalTokens, 14);
    assert.equal(llmCalls, 1);
    assert.ok(mcp.requests.every((r) => !r.body?.includes("modern")));

    await assert.rejects(
      summarizeWithDocumentation(
        { from, cwd, url },
        mockMcp({
          isError: true,
          content: [{ type: "text", text: "retrieval failed" }],
        }),
      ),
    );
    assert.equal(
      llmCalls,
      1,
      "retrieval failure must stop before model execution",
    );
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, originalEnv);
    await git.dispose();
    await rm(cwd, { recursive: true, force: true });
  }
});
