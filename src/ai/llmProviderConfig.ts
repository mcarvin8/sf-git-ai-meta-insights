/**
 * LLM provider configuration — re-exported from `@mcarvin/smart-diff` so this plugin shares one implementation.
 *
 * `@mcarvin/smart-diff` v2 uses the Vercel AI SDK under the hood and supports OpenAI, OpenAI-compatible
 * gateways, Anthropic, Google, Bedrock, Mistral, Cohere, Groq, xAI, and DeepSeek.
 */
export type { LlmProviderId, ResolveLanguageModelOptions } from '@mcarvin/smart-diff';
export {
  LLM_GATEWAY_REQUIRED_MESSAGE,
  defaultModelForProvider,
  detectLlmProvider,
  isLlmProviderConfigured,
  parseLlmDefaultHeadersFromEnv,
  resolveLanguageModel,
  resolveLlmBaseUrl,
} from '@mcarvin/smart-diff';
