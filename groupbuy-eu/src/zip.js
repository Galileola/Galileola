import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// A minimal ZIP writer for backups: files are stored as they are (photos are already compressed),
// written one at a time to a stream, so a large photo folder doesn't have to fit in memory.
// Supports up to 65,535 files and 4 GB in total (no ZIP64).

const dosTime = (d) => ((d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)) & 0xffff;
const dosDate = (d) => (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;

export async function writeZip(out, files) {
  const central = [];
  let offset = 0;
  const write = (buf) =>
    new Promise((resolve, reject) => {
      offset += buf.length;
      out.write(buf, (err) => (err ? reject(err) : resolve()));
    });
  for (const { name, file } of files) {
    const data = fs.readFileSync(file);
    const stat = fs.statSync(file);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(data) >>> 0;
    const time = dosTime(stat.mtime);
    const date = dosDate(stat.mtime);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const at = offset;
    await write(local);
    await write(nameBuf);
    await write(data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(0, 10);
    entry.writeUInt16LE(time, 12);
    entry.writeUInt16LE(date, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBuf.length, 28);
    entry.writeUInt32LE(at, 42);
    central.push(entry, nameBuf);
  }
  const start = offset;
  for (const b of central) await write(b);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(offset - start, 12);
  end.writeUInt32LE(start, 16);
  await write(end);
}

// Every file directly inside `dir` (the photo folder has no subfolders).
export const filesIn = (dir) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile() && !e.name.startsWith('.'))
        .map((e) => ({ name: e.name, file: path.join(dir, e.name) }))
    : [];
