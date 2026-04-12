import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  createOpenAiLikeClient,
  parseLlmDefaultHeadersFromEnv,
  resolveLlmBaseUrl,
  resolveOpenAiLikeClientInit,
  shouldUseLlmGateway,
  splitPromotableAuthorizationFromHeaders,
} from '../../src/ai/openAiConfig.js';

describe('openAiConfig', () => {
  beforeEach(() => {
    delete process.env.LLM_BASE_URL;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_DEFAULT_HEADERS;
    delete process.env.OPENAI_DEFAULT_HEADERS;
    delete process.env.LLM_MAX_TOKENS;
    delete process.env.OPENAI_MAX_TOKENS;
  });

  it('shouldUseLlmGateway is false when nothing is configured', () => {
    expect(shouldUseLlmGateway()).toBe(false);
  });

  it('shouldUseLlmGateway is true when OPENAI_API_KEY is set', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(shouldUseLlmGateway()).toBe(true);
  });

  it('shouldUseLlmGateway is true when LLM_API_KEY is set', () => {
    process.env.LLM_API_KEY = 'llm-key';
    expect(shouldUseLlmGateway()).toBe(true);
  });

  it('shouldUseLlmGateway is true when LLM_BASE_URL is set', () => {
    process.env.LLM_BASE_URL = 'https://gateway.example/v1';
    expect(shouldUseLlmGateway()).toBe(true);
  });

  it('shouldUseLlmGateway is true when OPENAI_BASE_URL is set', () => {
    process.env.OPENAI_BASE_URL = 'https://openai-compatible.example/v1';
    expect(shouldUseLlmGateway()).toBe(true);
  });

  it('shouldUseLlmGateway is true when LLM_DEFAULT_HEADERS JSON has keys', () => {
    process.env.LLM_DEFAULT_HEADERS = '{"x-api-key":"secret"}';
    expect(shouldUseLlmGateway()).toBe(true);
  });

  it('parseLlmDefaultHeadersFromEnv returns undefined for invalid JSON in both env vars', () => {
    process.env.LLM_DEFAULT_HEADERS = '{ not json';
    process.env.OPENAI_DEFAULT_HEADERS = 'also bad';
    expect(parseLlmDefaultHeadersFromEnv()).toBeUndefined();
    expect(shouldUseLlmGateway()).toBe(false);
  });

  it('parseLlmDefaultHeadersFromEnv merges OPENAI then LLM overrides same keys', () => {
    process.env.OPENAI_DEFAULT_HEADERS = '{"x":"from-openai","y":"1"}';
    process.env.LLM_DEFAULT_HEADERS = '{"x":"from-llm"}';
    expect(parseLlmDefaultHeadersFromEnv()).toEqual({ x: 'from-llm', y: '1' });
  });

  it('parseLlmDefaultHeadersFromEnv uses only OPENAI when LLM unset', () => {
    process.env.OPENAI_DEFAULT_HEADERS = '{"a":"1"}';
    expect(parseLlmDefaultHeadersFromEnv()).toEqual({ a: '1' });
  });

  it('parseLlmDefaultHeadersFromEnv returns undefined for JSON array or null', () => {
    process.env.LLM_DEFAULT_HEADERS = '[]';
    expect(parseLlmDefaultHeadersFromEnv()).toBeUndefined();
    process.env.LLM_DEFAULT_HEADERS = 'null';
    expect(parseLlmDefaultHeadersFromEnv()).toBeUndefined();
  });

  it('parseLlmDefaultHeadersFromEnv ignores invalid OPENAI JSON but keeps valid LLM', () => {
    process.env.OPENAI_DEFAULT_HEADERS = 'not-json';
    process.env.LLM_DEFAULT_HEADERS = '{"ok":"yes"}';
    expect(parseLlmDefaultHeadersFromEnv()).toEqual({ ok: 'yes' });
  });

  it('resolveLlmBaseUrl prefers LLM_BASE_URL over OPENAI_BASE_URL', () => {
    process.env.LLM_BASE_URL = 'https://a';
    process.env.OPENAI_BASE_URL = 'https://b';
    expect(resolveLlmBaseUrl()).toBe('https://a');
    delete process.env.LLM_BASE_URL;
    expect(resolveLlmBaseUrl()).toBe('https://b');
  });

  it('createOpenAiLikeClient merges default headers from OPENAI and LLM', async () => {
    process.env.LLM_BASE_URL = 'http://gateway.example';
    process.env.OPENAI_DEFAULT_HEADERS = '{"x-tenant":"t0"}';
    process.env.LLM_DEFAULT_HEADERS = '{"Authorization":"Bearer json"}';
    process.env.OPENAI_API_KEY = 'k';

    const client = await createOpenAiLikeClient();
    expect(typeof client.chat.completions.create).toBe('function');
  });

  it('createOpenAiLikeClient uses OPENAI_BASE_URL when LLM_BASE_URL unset', async () => {
    process.env.OPENAI_BASE_URL = 'https://custom.gateway.example/v1';
    process.env.OPENAI_API_KEY = 'secret';

    const client = await createOpenAiLikeClient();
    expect(typeof client.chat.completions.create).toBe('function');
  });

  it('createOpenAiLikeClient prefers LLM_API_KEY over OPENAI_API_KEY', async () => {
    process.env.LLM_BASE_URL = 'http://x';
    process.env.OPENAI_API_KEY = 'openai-key';
    process.env.LLM_API_KEY = 'llm-override';

    const client = await createOpenAiLikeClient();
    expect(typeof client.chat.completions.create).toBe('function');
  });

  it('createOpenAiLikeClient accepts OPENAI_DEFAULT_HEADERS alias only', async () => {
    process.env.LLM_BASE_URL = 'http://x';
    process.env.OPENAI_DEFAULT_HEADERS = '{"x-tenant":"t1"}';
    process.env.OPENAI_API_KEY = 'k';

    const client = await createOpenAiLikeClient();
    expect(typeof client.chat.completions.create).toBe('function');
  });

  it('resolveOpenAiLikeClientInit promotes raw sk- Authorization into apiKey and drops duplicate header', () => {
    process.env.LLM_BASE_URL = 'https://gateway.example/v1';
    process.env.LLM_DEFAULT_HEADERS = '{"Authorization":"sk-from-header","x-alfa-rbac":"rbac-token"}';

    expect(resolveOpenAiLikeClientInit()).toEqual({
      apiKey: 'sk-from-header',
      baseURL: 'https://gateway.example/v1',
      defaultHeaders: { 'x-alfa-rbac': 'rbac-token' },
    });
  });

  it('resolveOpenAiLikeClientInit promotes Bearer token from Authorization when no env api key', () => {
    process.env.LLM_DEFAULT_HEADERS = '{"Authorization":"Bearer sk-bearer"}';

    expect(resolveOpenAiLikeClientInit()).toEqual({
      apiKey: 'sk-bearer',
      defaultHeaders: undefined,
    });
  });

  it('resolveOpenAiLikeClientInit leaves non-OpenAI Authorization in defaultHeaders when no env api key', () => {
    process.env.LLM_DEFAULT_HEADERS = '{"Authorization":"Basic YWxhZGRpbjpvcGVuc2VzYW1l"}';

    expect(resolveOpenAiLikeClientInit()).toEqual({
      apiKey: 'unused',
      defaultHeaders: { Authorization: 'Basic YWxhZGRpbjpvcGVuc2VzYW1l' },
    });
  });

  it('resolveOpenAiLikeClientInit keeps merged headers verbatim when LLM_API_KEY is set', () => {
    process.env.LLM_API_KEY = 'sk-env';
    process.env.LLM_DEFAULT_HEADERS = '{"Authorization":"sk-header","x":"1"}';

    expect(resolveOpenAiLikeClientInit()).toEqual({
      apiKey: 'sk-env',
      defaultHeaders: { Authorization: 'sk-header', x: '1' },
    });
  });

  it('splitPromotableAuthorizationFromHeaders returns unchanged when no Authorization header', () => {
    const h = { 'x-tenant': 'a' };
    expect(splitPromotableAuthorizationFromHeaders(h)).toEqual({ defaultHeaders: h });
  });

  it('splitPromotableAuthorizationFromHeaders returns unchanged when Authorization is empty', () => {
    const h = { Authorization: '' };
    expect(splitPromotableAuthorizationFromHeaders(h)).toEqual({ defaultHeaders: h });
  });

  it('splitPromotableAuthorizationFromHeaders leaves Basic auth in headers', () => {
    const h = { Authorization: 'Basic YWxhZGRpbjpvcGVuc2VzYW1l' };
    expect(splitPromotableAuthorizationFromHeaders(h)).toEqual({ defaultHeaders: h });
  });

  it('splitPromotableAuthorizationFromHeaders promotes Bearer non-sk tokens', () => {
    const h = {
      Authorization:
        'Bearer eyJhbGciOiJIUzI1NiJ.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    };
    expect(splitPromotableAuthorizationFromHeaders(h)).toEqual({
      defaultHeaders: {},
      apiKeyFromAuthHeader:
        'eyJhbGciOiJIUzI1NiJ.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    });
  });
});
