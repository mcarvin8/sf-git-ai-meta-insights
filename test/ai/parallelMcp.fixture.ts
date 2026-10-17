import type { FetchLike } from '../../src/ai/parallelMcpClient.js';

export type RecordedRequest = { url: string; init: RequestInit; body?: Record<string, unknown> };

export type ToolResponder = (
  name: string,
  args: Record<string, unknown>,
  init: RequestInit,
) => unknown | Response | Promise<unknown | Response>;

/**
 * Fake Parallel MCP server at the fetch level: answers initialize with a session id, accepts the
 * initialized notification, routes tools/call to `respond`, and records every request.
 */
export function mockParallelMcp(respond: ToolResponder, sessionId: string | null = 'session-1') {
  const requests: RecordedRequest[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    requests.push({ url, init, body });
    if (init.method === 'DELETE') return new Response(null, { status: 200 });
    if (body?.id === undefined) return new Response(null, { status: 202 });
    if (body.method === 'initialize') {
      return Response.json(
        { jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} } } },
        { headers: sessionId ? { 'Mcp-Session-Id': sessionId } : {} },
      );
    }
    const params = body.params as { name: string; arguments: Record<string, unknown> };
    const result = await respond(params.name, params.arguments, init);
    if (result instanceof Response) return result;
    return Response.json({ jsonrpc: '2.0', id: body.id, result });
  };
  return { requests, fetchImpl };
}

/** A `tools/call` result carrying Parallel's JSON payload as structured content. */
export function structured(data: unknown) {
  return { structuredContent: data, content: [] };
}

export const LONG_TEXT = 'Use the new enableFoo field on the FooSettings metadata type. '.repeat(40);
