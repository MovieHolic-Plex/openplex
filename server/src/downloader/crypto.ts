import { createDecipheriv } from 'node:crypto';

export function materializeAesKey(
  body: Buffer,
  decode?: (json: string) => Buffer | null,
): Buffer {
  const trimmed = body.toString('utf8').trim();
  if (trimmed.startsWith('{')) {
    const decoded = decode?.(trimmed);
    if (decoded && decoded.length === 16) return decoded;
  }
  return body;
}

export function decryptAes128Cbc(segment: Buffer, key: Buffer, iv: Buffer): Buffer {
  const decipher = createDecipheriv('aes-128-cbc', key, iv);
  return Buffer.concat([decipher.update(segment), decipher.final()]);
}

export function mediaSequenceIv(sequence: number): Buffer {
  const iv = Buffer.alloc(16);
  iv.writeUInt32BE(sequence >>> 0, 12);
  return iv;
}
