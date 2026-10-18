import { afterEach, describe, expect, it, vi } from 'vitest';

import { callParallelTool, PARALLEL_MCP_ENDPOINT } from '../../src/ai/parallelMcpClient.js';
import { SgaiError } from '../../src/errors.js';
import { mockParallelMcp, structured } from './parallelMcp.fixture.js';

describe('callParallelTool', () => {
  it('performs the MCP handshake, calls the tool, and closes the session', async () => {
    const { fetchImpl, requests } = mockParallelMcp(() => structured({ ok: true }));

    const result = await callParallelTool('web_fetch', { urls: ['https://example.com/doc'] }, { fetchImpl });

    expect(result).toEqual({ ok: true });
    expect(requests.map((r) => r.body?.method ?? r.init.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/call',
      'DELETE',
    ]);
    for (const request of requests) {
      expect(request.url).toBe(PARALLEL_MCP_ENDPOINT);
      const headers = new Headers(request.init.headers);
      expect(headers.get('User-Agent')).toBe('sf-git-ai-meta-insights');
      expect(headers.has('Authorization')).toBe(false);
    }
    const [init, notification, call, close] = requests;
    expect(init.body).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'sf-git-ai-meta-insights', version: '1.0.0' },
      },
    });
    expect(new Headers(init.init.headers).has('Mcp-Session-Id')).toBe(false);
    expect(new Headers(init.init.headers).get('Accept')).toBe('application/json, text/event-stream');
    expect(new Headers(init.init.headers).get('Content-Type')).toBe('application/json');
    expect(notification.body).toEqual({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(new Headers(notification.init.headers).get('Mcp-Session-Id')).toBe('session-1');
    expect(new Headers(notification.init.headers).get('MCP-Protocol-Version')).toBe('2025-03-26');
    expect(call.body).toEqual({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'web_fetch',
        arguments: { urls: ['https://example.com/doc'], session_id: expect.stringMatching(/^[0-9a-f-]{36}$/) },
      },
    });
    expect(new Headers(close.init.headers).get('Mcp-Session-Id')).toBe('session-1');
  });

  it('skips the session close when the server issues no session id', async () => {
    const { fetchImpl, requests } = mockParallelMcp(() => structured({}), null);
    await callParallelTool('web_fetch', {}, { fetchImpl });
    expect(requests.some((r) => r.init.method === 'DELETE')).toBe(false);
    expect(new Headers(requests[2].init.headers).has('Mcp-Session-Id')).toBe(false);
  });

  it('ignores session close failures', async () => {
    const { fetchImpl: base } = mockParallelMcp(() => structured({ ok: 1 }));
    const fetchImpl = async (url: string, init: RequestInit) =>
      init.method === 'DELETE' ? Promise.reject(new Error('close failed')) : base(url, init);
    await expect(callParallelTool('web_fetch', {}, { fetchImpl })).resolves.toEqual({ ok: 1 });
  });

  it('parses JSON from text content when there is no structured content', async () => {
    const { fetchImpl } = mockParallelMcp(() => ({
      content: [
        { type: 'image', text: 'ignored' },
        { type: 'text', text: '{"results":' },
        { type: 'text', text: '[]}' },
      ],
    }));
    await expect(callParallelTool('web_fetch', {}, { fetchImpl })).resolves.toEqual({ results: [] });
  });

  it('reads responses delivered as a server-sent event stream', async () => {
    const { fetchImpl } = mockParallelMcp(
      () =>
        new Response(
          [
            'event: message',
            'data: not json',
            `data: ${JSON.stringify({ jsonrpc: '2.0', id: 9, result: {} })}`,
            `data: ${JSON.stringify({ jsonrpc: '2.0', id: 2, result: structured({ streamed: true }) })}`,
            '',
          ].join('\n'),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
    );
    await expect(callParallelTool('web_fetch', {}, { fetchImpl })).resolves.toEqual({ streamed: true });
  });

  it('rejects tool errors with the tool text', async () => {
    const { fetchImpl } = mockParallelMcp(() => ({
      isError: true,
      content: [{ type: 'text', text: 'Rate limit exceeded' }],
    }));
    const error = await callParallelTool('web_fetch', {}, { fetchImpl }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SgaiError);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe('ReferenceDocsToolError');
    expect((error as Error).message).toBe('Parallel web_fetch failed: Rate limit exceeded');
  });

  it('reports an unknown tool error when the error has no text', async () => {
    const { fetchImpl } = mockParallelMcp(() => ({ isError: true }));
    await expect(callParallelTool('web_search', {}, { fetchImpl })).rejects.toThrow(
      'Parallel web_search failed: unknown error',
    );
  });

  it('rejects non-JSON text content', async () => {
    const { fetchImpl } = mockParallelMcp(() => ({ content: [{ type: 'text', text: 'not JSON' }] }));
    const error = await callParallelTool('web_fetch', {}, { fetchImpl }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SgaiError);
    expect((error as Error).name).toBe('ReferenceDocsInvalidResponse');
    expect((error as Error).message).toBe('Parallel web_fetch returned a response that is not JSON.');
    expect((error as Error).cause).toBeInstanceOf(SyntaxError);
  });

  it('only sets a cause when one is given', () => {
    expect(new SgaiError('m', { name: 'N' })).not.toHaveProperty('cause');
    expect(new SgaiError('m', { name: 'N', cause: 'why' }).cause).toBe('why');
  });

  it('rejects JSON-RPC errors', async () => {
    const { fetchImpl } = mockParallelMcp(
      () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, error: { code: -32602, message: 'bad args' } })),
    );
    await expect(callParallelTool('web_fetch', {}, { fetchImpl })).rejects.toThrow('Parallel MCP error: bad args');
  });

  it('serializes JSON-RPC errors that have no message', async () => {
    const { fetchImpl } = mockParallelMcp(
      () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, error: { code: -1 } })),
    );
    await expect(callParallelTool('web_fetch', {}, { fetchImpl })).rejects.toThrow('Parallel MCP error: {"code":-1}');
  });

  it('rejects a response without the matching request id', async () => {
    const { fetchImpl } = mockParallelMcp(() => new Response('garbage'));
    const error = await callParallelTool('web_fetch', {}, { fetchImpl }).catch((e: unknown) => e);
    expect((error as Error).name).toBe('ReferenceDocsInvalidResponse');
    expect((error as Error).message).toBe('Parallel MCP returned no response for request 2.');
  });

  it('rejects HTTP failures with the method and status', async () => {
    const { fetchImpl } = mockParallelMcp(() => new Response('busy', { status: 429 }));
    const error = await callParallelTool('web_fetch', {}, { fetchImpl }).catch((e: unknown) => e);
    expect((error as Error).name).toBe('ReferenceDocsRequestFailed');
    expect((error as Error).message).toBe(
      'Parallel MCP request "tools/call" failed with HTTP 429. Anonymous use is rate limited; set PARALLEL_API_KEY for higher limits.',
    );

    const other = mockParallelMcp(() => new Response('down', { status: 503 }));
    await expect(callParallelTool('web_fetch', {}, { fetchImpl: other.fetchImpl })).rejects.toThrow(
      /^Parallel MCP request "tools\/call" failed with HTTP 503\.$/,
    );
  });

  it('omits the rate-limit hint when an API key is in use', async () => {
    const { fetchImpl } = mockParallelMcp(() => new Response('busy', { status: 429 }));
    await expect(callParallelTool('web_fetch', {}, { fetchImpl, apiKey: 'k' })).rejects.toThrow(
      /^Parallel MCP request "tools\/call" failed with HTTP 429\.$/,
    );
  });

  it('reuses one session_id across calls in a run', async () => {
    const { fetchImpl, requests } = mockParallelMcp(() => structured({}));
    await callParallelTool('web_fetch', {}, { fetchImpl });
    await callParallelTool('web_search', {}, { fetchImpl });
    const ids = requests
      .filter((r) => r.body?.method === 'tools/call')
      .map((r) => (r.body as { params: { arguments: { session_id: string } } }).params.arguments.session_id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  describe('API key', () => {
    const original = process.env.PARALLEL_API_KEY;
    afterEach(() => {
      if (original === undefined) delete process.env.PARALLEL_API_KEY;
      else process.env.PARALLEL_API_KEY = original;
    });

    it('sends PARALLEL_API_KEY as a Bearer token on every request', async () => {
      process.env.PARALLEL_API_KEY = '  env-key  ';
      const { fetchImpl, requests } = mockParallelMcp(() => structured({}));
      await callParallelTool('web_fetch', {}, { fetchImpl });
      expect(requests).toHaveLength(4);
      for (const request of requests) {
        expect(new Headers(request.init.headers).get('Authorization')).toBe('Bearer env-key');
      }
    });

    it('prefers an explicit apiKey and stays anonymous when the key is blank', async () => {
      process.env.PARALLEL_API_KEY = 'env-key';
      const explicit = mockParallelMcp(() => structured({}));
      await callParallelTool('web_fetch', {}, { fetchImpl: explicit.fetchImpl, apiKey: 'explicit' });
      expect(new Headers(explicit.requests[0].init.headers).get('Authorization')).toBe('Bearer explicit');

      process.env.PARALLEL_API_KEY = '   ';
      const blank = mockParallelMcp(() => structured({}));
      await callParallelTool('web_fetch', {}, { fetchImpl: blank.fetchImpl });
      for (const request of blank.requests) {
        expect(new Headers(request.init.headers).has('Authorization')).toBe(false);
      }
    });
  });

  it('uses the global fetch when no fetchImpl is given', async () => {
    const { fetchImpl, requests } = mockParallelMcp(() => structured({ global: true }));
    vi.stubGlobal('fetch', fetchImpl);
    try {
      await expect(callParallelTool('web_fetch', {})).resolves.toEqual({ global: true });
      expect(requests.map((r) => r.body?.method ?? r.init.method)).toEqual([
        'initialize',
        'notifications/initialized',
        'tools/call',
        'DELETE',
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reads a response without a Content-Type header as JSON', async () => {
    const { fetchImpl } = mockParallelMcp(() => {
      const response = new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: structured({ bare: true }) }));
      response.headers.delete('Content-Type');
      expect(response.headers.has('Content-Type')).toBe(false);
      return response;
    });
    await expect(callParallelTool('web_fetch', {}, { fetchImpl })).resolves.toEqual({ bare: true });
  });

  it('propagates network failures', async () => {
    await expect(
      callParallelTool('web_fetch', {}, { fetchImpl: () => Promise.reject(new Error('offline')) }),
    ).rejects.toThrow('offline');
  });

  it('aborts on timeout and on caller cancellation', async () => {
    const hang = (_name: string, _args: Record<string, unknown>, init: RequestInit) =>
      new Promise<never>((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      });

    await expect(
      callParallelTool('web_fetch', {}, { fetchImpl: mockParallelMcp(hang).fetchImpl, timeoutMs: 20 }),
    ).rejects.toThrow();

    const controller = new AbortController();
    const pending = callParallelTool(
      'web_fetch',
      {},
      { fetchImpl: mockParallelMcp(hang).fetchImpl, signal: controller.signal },
    );
    controller.abort(new Error('cancelled'));
    await expect(pending).rejects.toThrow('cancelled');
  });

  it('does not send anything when the caller signal is already aborted', async () => {
    const { fetchImpl, requests } = mockParallelMcp(() => structured({}));
    await expect(
      callParallelTool('web_fetch', {}, { fetchImpl, signal: AbortSignal.abort(new Error('stop')) }),
    ).rejects.toThrow('stop');
    expect(requests).toHaveLength(0);
  });
});
