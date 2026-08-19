import { createDeepSeekClient } from './deepseek.js';
import { createGptOauthClient } from './gpt-client.js';
import type { GptOauthSession } from './gpt-oauth.js';
import type { AgentChatClient } from './loop.js';

export const AGENT_PROVIDER = {
  auto: 'auto',
  gptOauth: 'gpt-oauth',
  deepseek: 'deepseek',
} as const;

export type AgentProvider = (typeof AGENT_PROVIDER)[keyof typeof AGENT_PROVIDER];

export type AgentUnavailable = {
  readonly code: string;
  readonly message: string;
};

export type ResolvedAgent = {
  readonly chat?: AgentChatClient;
  readonly unavailable?: AgentUnavailable;
};

export function parseAgentProvider(raw: string | undefined): AgentProvider {
  if (raw === AGENT_PROVIDER.gptOauth || raw === AGENT_PROVIDER.deepseek) return raw;
  return AGENT_PROVIDER.auto;
}

export function resolveAgentChat(options: {
  readonly provider?: AgentProvider;
  readonly oauth?: GptOauthSession;
  readonly deepseekKey?: string;
  readonly fetchImpl?: typeof fetch;
}): ResolvedAgent {
  const provider = options.provider ?? AGENT_PROVIDER.auto;
  if (provider === AGENT_PROVIDER.gptOauth) {
    if (!options.oauth || !options.oauth.hasToken()) {
      return {
        unavailable: {
          code: 'AGENT_OAUTH_REQUIRED',
          message: 'GPT OAuth token is not configured',
        },
      };
    }
    return { chat: createGptOauthClient({ session: options.oauth, fetchImpl: options.fetchImpl }) };
  }
  if (provider === AGENT_PROVIDER.deepseek) {
    if (!options.deepseekKey) {
      return {
        unavailable: {
          code: 'AGENT_UNAVAILABLE',
          message: 'DeepSeek API key is not configured',
        },
      };
    }
    return {
      chat: createDeepSeekClient({ apiKey: options.deepseekKey, fetchImpl: options.fetchImpl }),
    };
  }
  if (options.oauth?.hasToken()) {
    return { chat: createGptOauthClient({ session: options.oauth, fetchImpl: options.fetchImpl }) };
  }
  if (options.deepseekKey) {
    return {
      chat: createDeepSeekClient({ apiKey: options.deepseekKey, fetchImpl: options.fetchImpl }),
    };
  }
  return {
    unavailable: {
      code: 'AGENT_UNAVAILABLE',
      message: 'No agent provider is configured',
    },
  };
}
