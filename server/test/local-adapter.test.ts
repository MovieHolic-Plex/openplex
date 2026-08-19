import { crc32 } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalAdapter } from '../src/adapters/local-adapter.js';
import { listZipImages, readZipImage } from '../src/adapters/zip.js';
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

function tempRoot(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-import-'));
  tempDirectories.push(directory);
  return directory;
}

function jpeg(tag: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xd9]), Buffer.from(tag)]);
}

function storeZip(files: Record<string, Buffer>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const localFull = Buffer.concat([local, nameBytes, data]);
    locals.push(localFull);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, nameBytes]));
    offset += localFull.length;
  }
  const centralBlob = Buffer.concat(centrals);
  const localBlob = Buffer.concat(locals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length, 8);
  end.writeUInt16LE(centrals.length, 10);
  end.writeUInt32LE(centralBlob.length, 12);
  end.writeUInt32LE(localBlob.length, 16);
  return Buffer.concat([localBlob, centralBlob, end]);
}

describe('zip image listing', () => {
  it('lists image entries in numeric order and reads page bytes', () => {
    const archive = storeZip({
      '__MACOSX/._2.jpg': Buffer.from('skip'),
      'pages/10.jpg': jpeg('ten'),
      'pages/2.jpg': jpeg('two'),
      'pages/1.jpg': jpeg('one'),
      'readme.txt': Buffer.from('nope'),
    });
    const entries = listZipImages(archive);
    expect(entries.map((entry) => entry.name)).toEqual([
      'pages/1.jpg',
      'pages/2.jpg',
      'pages/10.jpg',
    ]);
    expect(readZipImage(archive, 0)).toEqual(jpeg('one'));
  });
});

describe('LocalAdapter', () => {
  it('imports a folder of images and a cbz chapter into the library', async () => {
    const root = tempRoot();
    const moss = path.join(root, '이끼');
    fs.mkdirSync(moss);
    fs.writeFileSync(path.join(moss, '02.jpg'), jpeg('second'));
    fs.writeFileSync(path.join(moss, '01.jpg'), jpeg('first'));

    const other = path.join(root, '유미의 세포들');
    fs.mkdirSync(other);
    fs.writeFileSync(path.join(other, '1화.cbz'), storeZip({
      'a.jpg': jpeg('cell-a'),
      'b.jpg': jpeg('cell-b'),
    }));

    const sqlite = new SQLiteStore(path.join(root, 'lib.db'));
    openStores.push(sqlite);
    const library = new LibraryStore(sqlite.db);
    const adapter = new LocalAdapter({ library, now: () => 5_000 });
    const imported = adapter.importRoot(root);

    expect(imported).toHaveLength(2);
    const comics = library.listWorks({ kind: 'comic' });
    expect(comics.map((work) => work.title).sort()).toEqual(['유미의 세포들', '이끼']);

    const mossWork = comics.find((work) => work.title === '이끼');
    if (!mossWork) throw new Error('missing moss');
    const mossUnits = library.listUnits(mossWork.id);
    expect(mossUnits).toHaveLength(1);
    const pages = adapter.listPages(mossUnits[0]?.id ?? 0);
    expect(pages).toHaveLength(2);
    expect(adapter.readPage(mossUnits[0]?.id ?? 0, 0)).toEqual(jpeg('first'));
    expect(adapter.readPage(mossUnits[0]?.id ?? 0, 1)).toEqual(jpeg('second'));

    const yumi = comics.find((work) => work.title === '유미의 세포들');
    if (!yumi) throw new Error('missing yumi');
    const chapter = library.listUnits(yumi.id)[0];
    expect(adapter.listPages(chapter?.id ?? 0)).toHaveLength(2);
    expect(adapter.readPage(chapter?.id ?? 0, 0)).toEqual(jpeg('cell-a'));
  });

  it('is idempotent when the same root is imported twice', () => {
    const root = tempRoot();
    fs.mkdirSync(path.join(root, 'Solo'));
    fs.writeFileSync(path.join(root, 'Solo', '1.jpg'), jpeg('x'));
    const sqlite = new SQLiteStore(path.join(root, 'lib.db'));
    openStores.push(sqlite);
    const library = new LibraryStore(sqlite.db);
    const adapter = new LocalAdapter({ library, now: () => 1 });
    adapter.importRoot(root);
    adapter.importRoot(root);
    expect(library.listWorks({ kind: 'comic' })).toHaveLength(1);
    expect(library.listUnits(library.listWorks()[0]?.id ?? 0)).toHaveLength(1);
  });
});
