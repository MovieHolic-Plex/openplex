import type { AgentChatClient, ChatCompletion, ChatMessage, ChatToolCall } from './loop.js';

const DEFAULT_URL = 'https://api.deepseek.com/chat/completions';
const DEFAULT_MODEL = 'deepseek-chat';

export type DeepSeekClientOptions = {
  readonly apiKey: string;
  readonly fetchImpl?: typeof fetch;
  readonly model?: string;
  readonly url?: string;
};

export const AGENT_TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'search_library',
      description: 'Search the local library by title',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_work',
      description: 'Get a library work and its units',
      parameters: {
        type: 'object',
        properties: { workId: { type: 'number' } },
        required: ['workId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_source',
      description: 'Search a registered source adapter',
      parameters: {
        type: 'object',
        properties: {
          adapter: { type: 'string' },
          query: { type: 'string' },
        },
        required: ['adapter', 'query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'enqueue_download',
      description: 'Queue a catalog unit for download',
      parameters: {
        type: 'object',
        properties: { unitId: { type: 'number' } },
        required: ['unitId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'import_local',
      description: 'Import comics or files from a local folder',
      parameters: {
        type: 'object',
        properties: { root: { type: 'string' } },
        required: ['root'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recommend_next',
      description: 'Recommend the next work using library RAG',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_metadata',
      description: 'Set genres, library, collection, year, studio, or original title for a work',
      parameters: {
        type: 'object',
        properties: {
          workId: { type: 'number' },
          genres: { type: 'array', items: { type: 'string' } },
          libraryId: { type: 'number' },
          collection: { type: 'string' },
          year: { type: 'number' },
          studio: { type: 'string' },
          originalTitle: { type: 'string' },
          unlock: { type: 'boolean' },
        },
        required: ['workId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scan_metadata',
      description: 'Refresh metadata for a single work from configured providers',
      parameters: {
        type: 'object',
        properties: {
          workId: { type: 'number' },
          force: { type: 'boolean' },
        },
        required: ['workId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_to_collection',
      description: 'Add a work to a named collection, creating it if needed',
      parameters: {
        type: 'object',
        properties: {
          workId: { type: 'number' },
          name: { type: 'string' },
        },
        required: ['workId', 'name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'transcode_unit',
      description: 'Transcode a local unit to a target profile',
      parameters: {
        type: 'object',
        properties: {
          unitId: { type: 'number' },
          profile: { type: 'string' },
        },
        required: ['unitId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_library_path',
      description: "Point a library at an absolute folder path (or null to clear)",
      parameters: {
        type: 'object',
        properties: {
          libraryId: { type: 'number' },
          path: { type: ['string', 'null'] },
        },
        required: ['libraryId', 'path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scan_library',
      description: 'Scan every library folder and refresh metadata for all works',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ingest_url',
      description: 'Ingest a direct media URL into the library',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url'],
      },
    },
  },
] as const;

export function createDeepSeekClient(options: DeepSeekClientOptions): AgentChatClient {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const model = options.model ?? DEFAULT_MODEL;
  const url = options.url ?? DEFAULT_URL;
  return {
    async complete(messages: readonly ChatMessage[]): Promise<ChatCompletion> {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: messages.map(toDeepSeekMessage),
          tools: AGENT_TOOL_SCHEMAS,
        }),
      });
      if (!response.ok) {
        throw new Error(`DeepSeek request failed (${response.status})`);
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

function toDeepSeekMessage(message: ChatMessage): Record<string, unknown> {
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
