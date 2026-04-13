/**
 * OpenAI-compatible LLM gateways — re-exported from `@mcarvin/smart-diff` so this plugin shares one implementation.
 */
export type { OpenAiLikeClient, OpenAiLikeClientInit } from '@mcarvin/smart-diff';
export {
  createOpenAiLikeClient,
  LLM_GATEWAY_REQUIRED_MESSAGE,
  parseLlmDefaultHeadersFromEnv,
  resolveLlmBaseUrl,
  resolveOpenAiLikeClientInit,
  shouldUseLlmGateway,
  splitPromotableAuthorizationFromHeaders,
} from '@mcarvin/smart-diff';
