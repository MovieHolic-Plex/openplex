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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-agent-'));
  tempDirectories.push(directory);
  const sqlite = new SQLiteStore(path.join(directory, 'db.sqlite'));
  openStores.push(sqlite);
  return new LibraryStore(sqlite.db);
}

function scriptedChat(script: Array<{
  content?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
}>): AgentChatClient {
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

describe('agent turn', () => {
  it('runs search_library then answers with the tool result', async () => {
    const library = openLibrary();
    library.upsertWork({ kind: 'video_series', title: '이끼' }, 1);
    const enqueued: number[] = [];
    const turn = await runAgentTurn({
      profileId: 1,
      message: '이끼 있어?',
      library,
      chat: scriptedChat([
        {
          toolCalls: [{
            id: 'call_1',
            name: 'search_library',
            arguments: JSON.stringify({ query: '이끼' }),
          }],
        },
        { content: '보관함에 이끼가 있습니다.' },
      ]),
      enqueueDownload: async (unitId) => {
        enqueued.push(unitId);
      },
      searchSource: async () => [],
      importLocal: async () => [],
    });

    expect(turn.reply).toBe('보관함에 이끼가 있습니다.');
    expect(turn.tools).toEqual([
      expect.objectContaining({ name: 'search_library' }),
    ]);
    expect(JSON.stringify(turn.tools[0]?.result)).toContain('이끼');
    expect(enqueued).toEqual([]);
  });

  it('enqueues a download when the model calls enqueue_download', async () => {
    const library = openLibrary();
    const work = library.upsertWork({ kind: 'video_series', title: 'Show' }, 1);
    const unit = library.upsertUnit({
      workId: work.id,
      kind: 'episode',
      ordinal: 0,
      title: 'E1',
    }, 2);
    const enqueued: number[] = [];
    const turn = await runAgentTurn({
      profileId: 1,
      message: 'E1 받아',
      library,
      chat: scriptedChat([
        {
          toolCalls: [{
            id: 'call_2',
            name: 'enqueue_download',
            arguments: JSON.stringify({ unitId: unit.id }),
          }],
        },
        { content: '받기 시작했습니다.' },
      ]),
      enqueueDownload: async (unitId) => {
        enqueued.push(unitId);
      },
      searchSource: async () => [],
      importLocal: async () => [],
    });

    expect(enqueued).toEqual([unit.id]);
    expect(turn.reply).toContain('받기');
  });

  it('rejects an unknown source adapter without calling searchSource', async () => {
    const library = openLibrary();
    const searched: string[] = [];
    const turn = await runAgentTurn({
      profileId: 1,
      message: '다른 사이트에서 찾아',
      library,
      chat: scriptedChat([
        {
          toolCalls: [{
            id: 'call_3',
            name: 'search_source',
            arguments: JSON.stringify({ adapter: 'random-pirate', query: 'foo' }),
          }],
        },
        { content: '그 소스는 없습니다.' },
      ]),
      enqueueDownload: async () => undefined,
      searchSource: async (adapter) => {
        searched.push(adapter);
        return [];
      },
      importLocal: async () => [],
    });

    expect(searched).toEqual([]);
    expect(JSON.stringify(turn.tools[0]?.result)).toMatch(/unknown adapter/i);
  });

  it('recommends a work whose title overlaps recent progress', async () => {
    const library = openLibrary();
    const moss = library.upsertWork({
      kind: 'comic',
      title: '이끼',
      overview: '스릴러 만화',
    }, 1);
    library.upsertWork({ kind: 'movie', title: '아무영화', overview: '코미디' }, 2);
    const chapter = library.upsertUnit({
      workId: moss.id,
      kind: 'chapter',
      ordinal: 0,
      title: '1화',
    }, 3);
    library.setProgress(1, chapter.id, { position: 2, duration: 20, pageIndex: 2 }, 4);

    const turn = await runAgentTurn({
      profileId: 1,
      message: '다음에 뭐 보지',
      library,
      chat: scriptedChat([
        {
          toolCalls: [{
            id: 'call_4',
            name: 'recommend_next',
            arguments: '{}',
          }],
        },
        { content: '이끼를 이어 보세요.' },
      ]),
      enqueueDownload: async () => undefined,
      searchSource: async () => [],
      importLocal: async () => [],
    });

    expect(JSON.stringify(turn.tools[0]?.result)).toContain('이끼');
    expect(JSON.stringify(turn.tools[0]?.result)).not.toContain('아무영화');
  });
});

describe('agent tool surface', () => {
  it('AGENT_TOOL_SCHEMAS names are set-equal to AGENT_TOOL_NAMES', async () => {
    const { AGENT_TOOL_SCHEMAS } = await import('../src/agent/deepseek.js');
    const { AGENT_TOOL_NAMES } = await import('../src/agent/tools.js');
    const schemaNames = AGENT_TOOL_SCHEMAS.map((schema) => schema.function.name);
    const schemaSet = new Set(schemaNames);
    const nameSet = new Set(AGENT_TOOL_NAMES);
    expect([...nameSet].every((name) => schemaSet.has(name))).toBe(true);
    expect([...schemaSet].every((name) => nameSet.has(name))).toBe(true);
    expect(schemaSet.size).toBe(schemaNames.length);
  });

  it('set_library_path with a relative path returns { error }', async () => {
    const { executeTool } = await import('../src/agent/tools.js');
    const library = openLibrary();
    const calls: Array<[number, string | null]> = [];
    const result = await executeTool('set_library_path', { libraryId: 1, path: 'relative/dir' }, {
      profileId: 1,
      library,
      enqueueDownload: async () => undefined,
      searchSource: async () => [],
      importLocal: async () => [],
      setLibraryPath: async (libraryId, p) => {
        calls.push([libraryId, p]);
        library.taxonomy.setLibraryPath(libraryId, p);
        return { library: library.taxonomy.getLibrary(libraryId) };
      },
    });
    expect(result).toHaveProperty('error');
    expect(calls).toEqual([]);
  });

  it('set_library_path with an unknown libraryId returns { error } and never throws', async () => {
    const { executeTool } = await import('../src/agent/tools.js');
    const library = openLibrary();
    const result = await executeTool('set_library_path', { libraryId: 999, path: 'C:\\media' }, {
      profileId: 1,
      library,
      enqueueDownload: async () => undefined,
      searchSource: async () => [],
      importLocal: async () => [],
      setLibraryPath: async (libraryId, p) => {
        library.taxonomy.setLibraryPath(libraryId, p);
        return { library: library.taxonomy.getLibrary(libraryId) };
      },
    });
    expect(result).toHaveProperty('error');
  });

  it('scan_library calls the scan callback and returns the { items, scanned } shape', async () => {
    const { executeTool } = await import('../src/agent/tools.js');
    const library = openLibrary();
    let scanCount = 0;
    const result = await executeTool('scan_library', {}, {
      profileId: 1,
      library,
      enqueueDownload: async () => undefined,
      searchSource: async () => [],
      importLocal: async () => [],
      scanLibrary: async () => {
        scanCount += 1;
        return { items: [], scanned: [] };
      },
    });
    expect(scanCount).toBe(1);
    expect(result).toEqual({ items: [], scanned: [] });
  });

  it('scan_library without a configured callback returns { error }', async () => {
    const { executeTool } = await import('../src/agent/tools.js');
    const library = openLibrary();
    const result = await executeTool('scan_library', {}, {
      profileId: 1,
      library,
      enqueueDownload: async () => undefined,
      searchSource: async () => [],
      importLocal: async () => [],
    });
    expect(result).toHaveProperty('error');
  });

  it('scan_metadata forwards force to the callback', async () => {
    const { executeTool } = await import('../src/agent/tools.js');
    const library = openLibrary();
    const seen: Array<[number, boolean | undefined]> = [];
    await executeTool('scan_metadata', { workId: 7, force: true }, {
      profileId: 1,
      library,
      enqueueDownload: async () => undefined,
      searchSource: async () => [],
      importLocal: async () => [],
      scanMetadata: async (workId, force) => {
        seen.push([workId, force]);
        return { scanned: workId };
      },
    });
    await executeTool('scan_metadata', { workId: 8 }, {
      profileId: 1,
      library,
      enqueueDownload: async () => undefined,
      searchSource: async () => [],
      importLocal: async () => [],
      scanMetadata: async (workId, force) => {
        seen.push([workId, force]);
        return { scanned: workId };
      },
    });
    expect(seen).toEqual([[7, true], [8, undefined]]);
  });

  it('malformed tool args return { error } instead of throwing', async () => {
    const { executeTool } = await import('../src/agent/tools.js');
    const library = openLibrary();
    const context = {
      profileId: 1,
      library,
      enqueueDownload: async () => undefined,
      searchSource: async () => [],
      importLocal: async () => [],
    };
    const missingWorkId = await executeTool('set_metadata', { genres: ['x'] }, context);
    expect(missingWorkId).toHaveProperty('error');
    const wrongTypes = await executeTool('set_library_path', { libraryId: 'abc', path: 42 }, context);
    expect(wrongTypes).toHaveProperty('error');
    const nullArgs = await executeTool(null, null, context);
    expect(nullArgs).toHaveProperty('error');
  });

  it('SYSTEM_PROMPT replaces the scrape sentence and adds the scan guidance', async () => {
    const loopSource = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../src/agent/loop.ts', import.meta.url), 'utf8'));
    expect(loopSource).not.toContain('scrape an unknown HTML catalog');
    expect(loopSource).toContain(
      'Never invent a streaming site. Never scrape a catalog or playback source; metadata providers configured by the operator are the only allowed external lookups.',
    );
    expect(loopSource).toContain('set_library_path');
    expect(loopSource).toContain('scan_library');
  });
});

describe('set_metadata rescan lock', () => {
  it('locks a work after set_metadata and unlocks with unlock: true', async () => {
    const { executeTool } = await import('../src/agent/tools.js');
    const { LocalMediaStore } = await import('../src/store/local-media-store.js');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-lock-'));
    tempDirectories.push(directory);
    const sqlite = new SQLiteStore(path.join(directory, 'db.sqlite'));
    openStores.push(sqlite);
    const library = new LibraryStore(sqlite.db);
    const localMedia = new LocalMediaStore(sqlite.db);
    const work = library.upsertWork({ kind: 'movie', title: '올드보이' }, 1);

    await executeTool('set_metadata', { workId: work.id }, {
      profileId: 1,
      library,
      enqueueDownload: async () => undefined,
      searchSource: async () => [],
      importLocal: async () => [],
      localMedia,
    });
    expect(localMedia.isMetaLocked(work.id)).toBe(true);

    await executeTool('set_metadata', { workId: work.id, unlock: true }, {
      profileId: 1,
      library,
      enqueueDownload: async () => undefined,
      searchSource: async () => [],
      importLocal: async () => [],
      localMedia,
    });
    expect(localMedia.isMetaLocked(work.id)).toBe(false);
  });
});
