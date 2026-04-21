import { describe, it, expect } from '@jest/globals';
import {
  LLM_GATEWAY_REQUIRED_MESSAGE,
  defaultModelForProvider,
  detectLlmProvider,
  isLlmProviderConfigured,
  parseLlmDefaultHeadersFromEnv,
  resolveLanguageModel,
  resolveLlmBaseUrl,
} from '../../src/ai/llmProviderConfig.js';

describe('llmProviderConfig re-exports', () => {
  it('re-exports all expected functions from @mcarvin/smart-diff', () => {
    expect(typeof defaultModelForProvider).toBe('function');
    expect(typeof detectLlmProvider).toBe('function');
    expect(typeof isLlmProviderConfigured).toBe('function');
    expect(typeof parseLlmDefaultHeadersFromEnv).toBe('function');
    expect(typeof resolveLanguageModel).toBe('function');
    expect(typeof resolveLlmBaseUrl).toBe('function');
  });

  it('re-exports the LLM_GATEWAY_REQUIRED_MESSAGE constant', () => {
    expect(typeof LLM_GATEWAY_REQUIRED_MESSAGE).toBe('string');
    expect(LLM_GATEWAY_REQUIRED_MESSAGE.length).toBeGreaterThan(0);
  });
});
