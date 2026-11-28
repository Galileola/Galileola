import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import sharp from 'sharp';

const run = promisify(execFile);
const require = createRequire(import.meta.url);

// Small servers (shared hosting) count threads against a process limit, so
// image work uses few threads and little cache.
sharp.concurrency(Number(process.env.SHARP_CONCURRENCY) || 2);
sharp.cache({ memory: 64, items: 20 });

// ffmpeg: FFMPEG_PATH if set, else the system's, else the copy bundled
// through npm (ffmpeg-static), which works on hosting without ffmpeg.
function findFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return 'ffmpeg';
  } catch {
    try {
      return require('ffmpeg-static') || 'ffmpeg';
    } catch {
      return 'ffmpeg';
    }
  }
}

export const FFMPEG = findFfmpeg();

export function ffmpeg(args) {
  return run(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...args], { maxBuffer: 20 * 1024 * 1024 });
}

/** Width, height and length of a video, read from ffmpeg's report (no ffprobe needed). */
export async function probe(file) {
  let report = '';
  try {
    await run(FFMPEG, ['-hide_banner', '-i', file], { maxBuffer: 5 * 1024 * 1024 });
  } catch (err) {
    report = err.stderr || ''; // ffmpeg exits with an error when given no output; the report is still there
  }
  const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(report);
  const v = /Stream #[^\n]*Video:[^\n]*?,\s(\d{2,5})x(\d{2,5})/.exec(report);
  if (!d || !v) throw new Error('Could not read the video');
  return { width: Number(v[1]), height: Number(v[2]), duration: Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) };
}
