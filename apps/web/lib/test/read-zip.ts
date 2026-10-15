import { inflateRawSync } from 'node:zlib';
import { crc32 } from '@/lib/developer-skill/zip';

/**
 * Read a ZIP archive back for tests: walk the central directory (the way real
 * unzip tools do, rather than trusting local headers), inflate each entry and
 * check its CRC and size. Throws on anything malformed.
 */
export function readZip(archive: Uint8Array): Map<string, string> {
  const buf = Buffer.from(archive);
  const endAt = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endAt < 0) throw new Error('no end of central directory record');
  const count = buf.readUInt16LE(endAt + 10);
  const dirSize = buf.readUInt32LE(endAt + 12);
  const dirOffset = buf.readUInt32LE(endAt + 16);
  if (dirOffset + dirSize !== endAt) throw new Error('central directory does not end where the end record starts');

  const files = new Map<string, string>();
  let at = dirOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error(`bad central header at ${at}`);
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const compressed = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const localAt = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8');

    if (buf.readUInt32LE(localAt) !== 0x04034b50) throw new Error(`bad local header for ${name}`);
    const localNameLen = buf.readUInt16LE(localAt + 26);
    const localExtraLen = buf.readUInt16LE(localAt + 28);
    const dataAt = localAt + 30 + localNameLen + localExtraLen;
    const data = buf.subarray(dataAt, dataAt + compressed);
    const raw = method === 8 ? inflateRawSync(data) : method === 0 ? data : null;
    if (!raw) throw new Error(`unsupported method ${method} for ${name}`);
    if (raw.length !== size) throw new Error(`size mismatch for ${name}`);
    if (crc32(raw) !== crc) throw new Error(`crc mismatch for ${name}`);
    if (files.has(name)) throw new Error(`duplicate entry ${name}`);
    files.set(name, raw.toString('utf8'));

    at += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}
