import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runAgentTurn, type AgentChatClient } from '../src/agent/loop.js';
import { LibraryStore } from '../src/store/library-store.js';
import { SQLiteStore } from '../src/store/sqlite-store.js';

const tempDirectories: string[] = [];
const openStores: SQLiteStore[] = [];

afterEach(() => {
  for (const store of openStores.splice(0)) {
    if (store.db.open) store.close();
  }
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function openLibrary(): LibraryStore {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-agent-meta-'));
  tempDirectories.push(directory);
  const sqlite = new SQLiteStore(path.join(directory, 'db.sqlite'));
  openStores.push(sqlite);
  return new LibraryStore(sqlite.db);
}

type ScriptStep = {
  content?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
};

function scriptedChat(script: ScriptStep[]): AgentChatClient {
  let step = 0;
  return {
    async complete() {
      const next = script[step] ?? { content: 'done' };
      step += 1;
      return {
        content: next.content ?? null,
        toolCalls: next.toolCalls ?? [],
      };
    },
  };
}

describe('agent metadata sequence (set_library_path -> scan_library -> scan_metadata)', () => {
  it('drives the full sequence via tool calls and surfaces each result', async () => {
    const library = openLibrary();
    library.taxonomy.setLibraryPath(1, null);
    const work = library.upsertWork({ kind: 'video_series', title: '스캔대상' }, 1);

    const setPathCalls: Array<{ libraryId: number; libraryPath: string | null }> = [];
    let scanLibraryCalls = 0;
    const scanMetadataCalls: Array<{ workId: number; force?: boolean }> = [];

    const turn = await runAgentTurn({
      profileId: 1,
      message: '폴더를 바꾸고 전체 스캔한 뒤 메타데이터 채워줘',
      library,
      chat: scriptedChat([
        {
          toolCalls: [{
            id: 'call_meta_1',
            name: 'set_library_path',
            arguments: JSON.stringify({ libraryId: 1, path: 'C:\\Media\\Series' }),
          }],
        },
        {
          toolCalls: [{
            id: 'call_meta_2',
            name: 'scan_library',
            arguments: '{}',
          }],
        },
        {
          toolCalls: [{
            id: 'call_meta_3',
            name: 'scan_metadata',
            arguments: JSON.stringify({ workId: work.id }),
          }],
        },
        { content: '폴더를 지정하고 스캔해 메타데이터를 채웠습니다.' },
      ]),
      enqueueDownload: async () => undefined,
      searchSource: async () => [],
      importLocal: async () => [],
      setLibraryPath: async (libraryId, libraryPath) => {
        setPathCalls.push({ libraryId, libraryPath });
        library.taxonomy.setLibraryPath(libraryId, libraryPath);
        return { library: library.taxonomy.getLibrary(libraryId) };
      },
      scanLibrary: async () => {
        scanLibraryCalls += 1;
        return { items: [{ id: work.id, title: '스캔대상' }], scanned: [work.id] };
      },
      scanMetadata: async (workId, force) => {
        scanMetadataCalls.push({ workId, force });
        return { matched: true, provider: 'tmdb' };
      },
    });

    expect(setPathCalls).toEqual([{ libraryId: 1, libraryPath: 'C:\\Media\\Series' }]);
    expect(scanLibraryCalls).toBe(1);
    expect(scanMetadataCalls).toEqual([{ workId: work.id, force: undefined }]);

    expect(turn.reply).toBe('폴더를 지정하고 스캔해 메타데이터를 채웠습니다.');
    expect(turn.tools.map((tool) => tool.name)).toEqual([
      'set_library_path',
      'scan_library',
      'scan_metadata',
    ]);
    const [setPathResult, scanLibraryResult, scanMetadataResult] = turn.tools;
    expect(setPathResult?.result).toMatchObject({ library: { id: 1, path: 'C:\\Media\\Series' } });
    expect(scanLibraryResult?.result).toMatchObject({ items: [{ id: work.id }], scanned: [work.id] });
    expect(scanMetadataResult?.result).toMatchObject({ matched: true, provider: 'tmdb' });
  });

  it('surfaces user_locked skips from scan_metadata without throwing', async () => {
    const library = openLibrary();
    const work = library.upsertWork({ kind: 'movie', title: '잠긴영화' }, 1);

    const turn = await runAgentTurn({
      profileId: 1,
      message: '메타 다시 스캔해줘',
      library,
      chat: scriptedChat([
        {
          toolCalls: [{
            id: 'call_lock_1',
            name: 'scan_metadata',
            arguments: JSON.stringify({ workId: work.id }),
          }],
        },
        { content: '사용자가 수정한 항목이라 건너뛰었습니다.' },
      ]),
      enqueueDownload: async () => undefined,
      searchSource: async () => [],
      importLocal: async () => [],
      scanMetadata: async (workId, force) => {
        expect(force).toBeUndefined();
        return { skipped: 'user_locked', workId };
      },
    });

    expect(turn.tools).toHaveLength(1);
    expect(turn.tools[0]?.result).toEqual({ skipped: 'user_locked', workId: work.id });
    expect(turn.reply).toBe('사용자가 수정한 항목이라 건너뛰었습니다.');
  });

  it('passes force through the loop when the model asks for a forced rescan', async () => {
    const library = openLibrary();
    const work = library.upsertWork({ kind: 'movie', title: '강제영화' }, 1);
    const forces: Array<boolean | undefined> = [];

    await runAgentTurn({
      profileId: 1,
      message: '잠금 무시하고 다시 스캔해줘',
      library,
      chat: scriptedChat([
        {
          toolCalls: [{
            id: 'call_force_1',
            name: 'scan_metadata',
            arguments: JSON.stringify({ workId: work.id, force: true }),
          }],
        },
        { content: '강제로 다시 스캔했습니다.' },
      ]),
      enqueueDownload: async () => undefined,
      searchSource: async () => [],
      importLocal: async () => [],
      scanMetadata: async (_workId, force) => {
        forces.push(force);
        return { matched: true };
      },
    });

    expect(forces).toEqual([true]);
  });

  it('an unknown tool name in the loop returns { error } and does not throw', async () => {
    const library = openLibrary();
    const turn = await runAgentTurn({
      profileId: 1,
      message: '이상한 도구 써봐',
      library,
      chat: scriptedChat([
        {
          toolCalls: [{
            id: 'call_unknown_1',
            name: 'definitely_not_a_real_tool',
            arguments: '{}',
          }],
        },
        { content: '그 도구는 없습니다.' },
      ]),
      enqueueDownload: async () => undefined,
      searchSource: async () => [],
      importLocal: async () => [],
    });

    expect(turn.tools).toHaveLength(1);
    expect(turn.tools[0]?.result).toHaveProperty('error');
  });
});
