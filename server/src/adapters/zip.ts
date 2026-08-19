import { inflateSync } from 'node:zlib';

export type ZipImageEntry = {
  readonly name: string;
  readonly method: number;
  readonly localOffset: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
};

const IMAGE = /\.(jpe?g|png|webp|gif|avif)$/i;

export function isImageName(name: string): boolean {
  return IMAGE.test(name) && !name.startsWith('__MACOSX') && !name.includes('/__MACOSX');
}

export function compareNumericNames(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

export function listZipImages(archive: Buffer): ZipImageEntry[] {
  const eocd = findEocd(archive);
  const count = archive.readUInt16LE(eocd + 10);
  let cursor = archive.readUInt32LE(eocd + 16);
  const entries: ZipImageEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (archive.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error('Invalid zip central directory');
    }
    const method = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    if (isImageName(name)) {
      entries.push({ name, method, localOffset, compressedSize, uncompressedSize });
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries.sort((left, right) => compareNumericNames(left.name, right.name));
}

export function readZipImage(archive: Buffer, pageIndex: number): Buffer {
  const entries = listZipImages(archive);
  const entry = entries[pageIndex];
  if (!entry) throw new Error(`Zip page ${pageIndex} was not found`);
  return extractEntry(archive, entry);
}

export function extractEntry(archive: Buffer, entry: ZipImageEntry): Buffer {
  if (archive.readUInt32LE(entry.localOffset) !== 0x04034b50) {
    throw new Error('Invalid zip local header');
  }
  const nameLength = archive.readUInt16LE(entry.localOffset + 26);
  const extraLength = archive.readUInt16LE(entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const compressed = archive.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(compressed);
  if (entry.method === 8) return inflateSync(compressed);
  throw new Error(`Unsupported zip method ${entry.method}`);
}

function findEocd(archive: Buffer): number {
  const min = Math.max(0, archive.length - 22 - 0xffff);
  for (let index = archive.length - 22; index >= min; index -= 1) {
    if (archive.readUInt32LE(index) === 0x06054b50) return index;
  }
  throw new Error('Zip end-of-central-directory was not found');
}
