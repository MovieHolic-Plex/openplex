import type { AdapterSearchHit } from '../adapters/types.js';
import type { LibraryStore, Work } from '../store/library-store.js';
import type { LocalMediaStore } from '../store/local-media-store.js';
import { executeTool, type ToolExecution } from './tools.js';

export const MAX_AGENT_ROUNDS = 6;

export type ChatMessage = {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string | null;
  readonly toolCallId?: string;
  readonly toolCalls?: readonly ChatToolCall[];
};

export type ChatToolCall = {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
};

export type ChatCompletion = {
  readonly content: string | null;
  readonly toolCalls: readonly ChatToolCall[];
};

export type AgentChatClient = {
  complete(messages: readonly ChatMessage[]): Promise<ChatCompletion>;
};

export type AgentTurn = {
  readonly reply: string;
  readonly tools: readonly ToolExecution[];
};

export type AgentTurnInput = {
  readonly profileId: number;
  readonly message: string;
  readonly library: LibraryStore;
  readonly chat: AgentChatClient;
  readonly enqueueDownload: (unitId: number) => Promise<unknown>;
  readonly searchSource: (adapter: string, query: string) => Promise<readonly AdapterSearchHit[]>;
  readonly importLocal: (root: string) => Promise<readonly Work[]>;
  readonly adapterEnabled?: (name: string) => boolean;
  readonly scanMetadata?: (workId: number, force?: boolean) => Promise<unknown>;
  readonly transcodeUnit?: (unitId: number, profile: string) => Promise<unknown>;
  readonly ingestUrl?: (url: string) => Promise<unknown>;
  readonly setLibraryPath?: (libraryId: number, libraryPath: string | null) => Promise<unknown>;
  readonly scanLibrary?: () => Promise<unknown>;
  readonly localMedia?: Pick<LocalMediaStore, 'setMetaLocked'>;
};

const SYSTEM_PROMPT = [
  'You are a Korean media library assistant.',
  'Use only registered tools. Sources: local files and direct media URLs via ingest_url.',
  'Classify with libraries/collections/genres. Transcode with transcode_unit.',
  'Never invent a streaming site. Never scrape a catalog or playback source; metadata providers configured by the operator are the only allowed external lookups.',
  'After import_local or ingest_url, call scan_metadata for works lacking metadata. When the folder changes, call set_library_path then scan_library.',
  'Reply in Korean when the user writes Korean.',
].join(' ');

export async function runAgentTurn(input: AgentTurnInput): Promise<AgentTurn> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: input.message },
  ];
  const tools: ToolExecution[] = [];
  const context = {
    profileId: input.profileId,
    library: input.library,
    enqueueDownload: input.enqueueDownload,
    searchSource: input.searchSource,
    importLocal: input.importLocal,
    adapterEnabled: input.adapterEnabled,
    scanMetadata: input.scanMetadata,
    transcodeUnit: input.transcodeUnit,
    ingestUrl: input.ingestUrl,
    setLibraryPath: input.setLibraryPath,
    scanLibrary: input.scanLibrary,
    localMedia: input.localMedia,
  };

  for (let round = 0; round < MAX_AGENT_ROUNDS; round += 1) {
    const completion = await input.chat.complete(messages);
    if (completion.toolCalls.length === 0) {
      return { reply: completion.content ?? '', tools };
    }
    messages.push({
      role: 'assistant',
      content: completion.content,
      toolCalls: completion.toolCalls,
    });
    for (const call of completion.toolCalls) {
      const parsed = parseArguments(call.arguments);
      const result = await executeTool(call.name, parsed, context);
      tools.push({ name: call.name, arguments: parsed, result });
      messages.push({
        role: 'tool',
        toolCallId: call.id,
        content: JSON.stringify(result),
      });
    }
  }
  return { reply: '도구 호출 한도를 넘었습니다. 다시 짧게 요청해 주세요.', tools };
}

function parseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}
