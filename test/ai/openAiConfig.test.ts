import { describe, it, expect } from '@jest/globals';
import {
  createOpenAiLikeClient,
  parseLlmDefaultHeadersFromEnv,
  resolveLlmBaseUrl,
  resolveOpenAiLikeClientInit,
  shouldUseLlmGateway,
  splitPromotableAuthorizationFromHeaders,
} from '../../src/ai/openAiConfig.js';

describe('openAiConfig re-exports', () => {
  it('re-exports all expected functions from @mcarvin/smart-diff', () => {
    expect(typeof createOpenAiLikeClient).toBe('function');
    expect(typeof parseLlmDefaultHeadersFromEnv).toBe('function');
    expect(typeof resolveLlmBaseUrl).toBe('function');
    expect(typeof resolveOpenAiLikeClientInit).toBe('function');
    expect(typeof shouldUseLlmGateway).toBe('function');
    expect(typeof splitPromotableAuthorizationFromHeaders).toBe('function');
  });
});
