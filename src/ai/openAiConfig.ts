/**
 * OpenAI-compatible LLM gateways (OpenAI.com, Azure OpenAI, corporate proxies, etc.).
 * `LLM_*` environment variables override matching `OPENAI_*` defaults where applicable.
 */

/** `LLM_BASE_URL` overrides `OPENAI_BASE_URL` when set. */
export function resolveLlmBaseUrl(): string | undefined {
  return process.env.LLM_BASE_URL?.trim() ?? process.env.OPENAI_BASE_URL?.trim();
}

function parseHeaderJsonObject(raw: string | undefined): Record<string, string> {
  const trimmed = raw?.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value.length > 0) {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Merged default headers: `OPENAI_DEFAULT_HEADERS` first, then `LLM_DEFAULT_HEADERS` overrides.
 */
export function parseLlmDefaultHeadersFromEnv(): Record<string, string> | undefined {
  const base = parseHeaderJsonObject(process.env.OPENAI_DEFAULT_HEADERS);
  const override = parseHeaderJsonObject(process.env.LLM_DEFAULT_HEADERS);
  const merged = { ...base, ...override };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function findAuthorizationHeaderName(headers: Record<string, string>): string | undefined {
  return Object.keys(headers).find((k) => k.toLowerCase() === 'authorization');
}

/** Strip a single `Bearer <token>` prefix; otherwise return the trimmed value. */
function stripBearerPrefix(value: string): string {
  const trimmed = value.trim();
  const match = /^Bearer\s+(\S+)/i.exec(trimmed);
  return match?.[1] ?? trimmed;
}

/**
 * OpenAI's Node SDK always sends `Authorization: Bearer ${apiKey}`.
 * If `Authorization` is only present in `defaultHeaders` as a raw `sk-...` token (no Bearer),
 * that header overrides the SDK value and many OpenAI-compatible gateways reject the request
 * (`param: api_key`). When no `LLM_API_KEY` / `OPENAI_API_KEY` is set, promote recognizable
 * tokens from `Authorization` into `apiKey` and drop that header from `defaultHeaders`.
 */
export function splitPromotableAuthorizationFromHeaders(headers: Record<string, string>): {
  defaultHeaders: Record<string, string>;
  apiKeyFromAuthHeader?: string;
} {
  const authName = findAuthorizationHeaderName(headers);
  if (!authName) {
    return { defaultHeaders: headers };
  }
  const raw = headers[authName];
  if (!raw) {
    return { defaultHeaders: headers };
  }
  const token = stripBearerPrefix(raw);
  const looksBearer = /^Bearer\s+\S+/i.test(raw.trim());
  const looksOpenAiKey = /^sk-/i.test(token);
  if (!looksBearer && !looksOpenAiKey) {
    return { defaultHeaders: headers };
  }
  const next: Record<string, string> = { ...headers };
  delete next[authName];
  return { defaultHeaders: next, apiKeyFromAuthHeader: token };
}

export function shouldUseLlmGateway(): boolean {
  const apiKey = process.env.LLM_API_KEY?.trim() ?? process.env.OPENAI_API_KEY?.trim();
  if (apiKey) return true;
  if (resolveLlmBaseUrl()) return true;
  const jsonHeaders = parseLlmDefaultHeadersFromEnv();
  if (jsonHeaders && Object.keys(jsonHeaders).length > 0) return true;
  return false;
}

export type OpenAiLikeClient = {
  chat: {
    completions: {
      create(...options: unknown[]): Promise<unknown>;
    };
  };
};

/** Constructor-style options for the official OpenAI Node SDK (for tests and `createOpenAiLikeClient`). */
export type OpenAiLikeClientInit = {
  apiKey: string;
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
};

export function resolveOpenAiLikeClientInit(): OpenAiLikeClientInit {
  const baseURL = resolveLlmBaseUrl();
  const mergedHeaders = parseLlmDefaultHeadersFromEnv() ?? {};
  const envApiKey = process.env.LLM_API_KEY?.trim() ?? process.env.OPENAI_API_KEY?.trim() ?? '';

  let defaultHeaders: Record<string, string> | undefined;
  let apiKey = envApiKey;

  if (apiKey.length === 0) {
    const split = splitPromotableAuthorizationFromHeaders(mergedHeaders);
    if (split.apiKeyFromAuthHeader) {
      apiKey = split.apiKeyFromAuthHeader;
    }
    defaultHeaders = Object.keys(split.defaultHeaders).length > 0 ? split.defaultHeaders : undefined;
  } else {
    defaultHeaders = Object.keys(mergedHeaders).length > 0 ? mergedHeaders : undefined;
  }

  return {
    apiKey: apiKey.length > 0 ? apiKey : 'unused',
    ...(baseURL ? { baseURL } : {}),
    ...(defaultHeaders ? { defaultHeaders } : {}),
  };
}

/** Build options for `new OpenAI(...)` (official OpenAI Node SDK). */
export async function createOpenAiLikeClient(): Promise<OpenAiLikeClient> {
  const { default: OpenAI } = await import('openai');
  return new OpenAI(resolveOpenAiLikeClientInit()) as OpenAiLikeClient;
}
