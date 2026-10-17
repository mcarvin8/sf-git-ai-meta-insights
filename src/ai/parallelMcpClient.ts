import { randomUUID } from 'node:crypto';

import { SgaiError } from '../errors.js';

/** Parallel Search MCP endpoint. Anonymous use needs no account or API key. */
export const PARALLEL_MCP_ENDPOINT = 'https://search.parallel.ai/mcp';

/** Optional Parallel API key for higher rate limits than anonymous use. */
export const PARALLEL_API_KEY_ENV = 'PARALLEL_API_KEY';

const USER_AGENT = 'sf-git-ai-meta-insights';
const PROTOCOL_VERSION = '2025-03-26';
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Parallel asks clients to send one stable `session_id` on every tool call of a run; it is used for
 * free-tier rate limiting, so reusing it keeps one run's calls together.
 */
const RUN_SESSION_ID = randomUUID();

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type ParallelToolOptions = {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Defaults to the `PARALLEL_API_KEY` environment variable; anonymous when unset. */
  apiKey?: string;
};

type JsonRpcResponse = {
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string };
};

type ToolCallResult = {
  isError?: boolean;
  structuredContent?: unknown;
  content?: Array<{ type?: string; text?: string }>;
};

/**
 * Call one Parallel Search MCP tool over the streamable HTTP transport with plain `fetch`.
 * Implements only what is needed for a single request: initialize, the initialized notification,
 * one `tools/call`, and a best-effort session close. Only the tool arguments leave the machine.
 */
export async function callParallelTool(
  name: string,
  args: Record<string, unknown>,
  options: ParallelToolOptions = {},
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const deadline = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  const apiKey = (options.apiKey ?? process.env[PARALLEL_API_KEY_ENV])?.trim();

  let sessionId: string | undefined;
  const post = async (body: Record<string, unknown>): Promise<Response> => {
    signal.throwIfAborted();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'User-Agent': USER_AGENT,
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    if (sessionId) {
      headers['Mcp-Session-Id'] = sessionId;
      headers['MCP-Protocol-Version'] = PROTOCOL_VERSION;
    }
    const response = await fetchImpl(PARALLEL_MCP_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', ...body }),
      signal,
    });
    if (!response.ok) {
      const hint =
        response.status === 429 && !apiKey
          ? ` Anonymous use is rate limited; set ${PARALLEL_API_KEY_ENV} for higher limits.`
          : '';
      throw new SgaiError(`Parallel MCP request "${String(body.method)}" failed with HTTP ${response.status}.${hint}`, {
        name: 'ReferenceDocsRequestFailed',
      });
    }
    return response;
  };

  try {
    const init = await post({
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: USER_AGENT, version: '1.0.0' },
      },
    });
    sessionId = init.headers.get('Mcp-Session-Id') ?? undefined;
    await readRpcResult(init, 1);

    await post({ method: 'notifications/initialized' });

    const call = await post({
      id: 2,
      method: 'tools/call',
      params: { name, arguments: { ...args, session_id: RUN_SESSION_ID } },
    });
    return parseToolResult(name, (await readRpcResult(call, 2)) as ToolCallResult);
  } finally {
    if (sessionId) {
      // Best-effort session close; failures here never affect the result.
      await fetchImpl(PARALLEL_MCP_ENDPOINT, {
        method: 'DELETE',
        headers: {
          'Mcp-Session-Id': sessionId,
          'User-Agent': USER_AGENT,
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        signal: AbortSignal.timeout(5000),
      }).catch(() => undefined);
    }
  }
}

async function readRpcResult(response: Response, id: number): Promise<unknown> {
  const text = await response.text();
  const messages = (response.headers.get('Content-Type') ?? '').includes('text/event-stream')
    ? parseEventStream(text)
    : [parseJson(text)];
  const message = messages.find((m) => m?.id === id);
  if (!message) {
    throw new SgaiError(`Parallel MCP returned no response for request ${id}.`, {
      name: 'ReferenceDocsInvalidResponse',
    });
  }
  if (message.error) {
    throw new SgaiError(`Parallel MCP error: ${message.error.message ?? JSON.stringify(message.error)}`, {
      name: 'ReferenceDocsRequestFailed',
    });
  }
  return message.result;
}

function parseEventStream(text: string): Array<JsonRpcResponse | undefined> {
  return text
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => parseJson(line.slice('data:'.length).trim()));
}

function parseJson(text: string): JsonRpcResponse | undefined {
  try {
    return JSON.parse(text) as JsonRpcResponse;
  } catch {
    return undefined;
  }
}

function parseToolResult(name: string, result: ToolCallResult | undefined): unknown {
  const textBlocks = (result?.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string);
  if (result?.isError) {
    throw new SgaiError(`Parallel ${name} failed: ${textBlocks.join(' ') || 'unknown error'}`, {
      name: 'ReferenceDocsToolError',
    });
  }
  if (result?.structuredContent !== undefined) return result.structuredContent;
  try {
    return JSON.parse(textBlocks.join('\n')) as unknown;
  } catch (err) {
    throw new SgaiError(`Parallel ${name} returned a response that is not JSON.`, {
      name: 'ReferenceDocsInvalidResponse',
      cause: err,
    });
  }
}
