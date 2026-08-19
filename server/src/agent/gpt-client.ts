import { AGENT_TOOL_SCHEMAS } from './deepseek.js';
import type { GptOauthSession } from './gpt-oauth.js';
import type { AgentChatClient, ChatCompletion, ChatMessage, ChatToolCall } from './loop.js';

export function createGptOauthClient(options: {
  readonly session: GptOauthSession;
  readonly fetchImpl?: typeof fetch;
}): AgentChatClient {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  return {
    async complete(messages: readonly ChatMessage[]): Promise<ChatCompletion> {
      const token = await options.session.accessToken();
      const response = await fetchImpl(options.session.chatUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: options.session.model,
          messages: messages.map(toOpenAiMessage),
          tools: AGENT_TOOL_SCHEMAS,
        }),
      });
      if (!response.ok) {
        throw new Error(`GPT request failed (${response.status})`);
      }
      const body = await response.json() as {
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: Array<{
              id: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
      };
      const message = body.choices?.[0]?.message;
      const toolCalls: ChatToolCall[] = (message?.tool_calls ?? []).flatMap((call) => {
        if (!call.function?.name) return [];
        return [{
          id: call.id,
          name: call.function.name,
          arguments: call.function.arguments ?? '{}',
        }];
      });
      return { content: message?.content ?? null, toolCalls };
    },
  };
}

function toOpenAiMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: message.toolCallId,
      content: message.content ?? '',
    };
  }
  if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: 'assistant',
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments },
      })),
    };
  }
  return { role: message.role, content: message.content ?? '' };
}
