import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { startVideo, videoResult } from './fal.js';
import { renderOverlay } from './typeset.js';
import { jobFiles, saveFile } from './jobs.js';

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const POLL_MS = 6000;
const GIVE_UP_MS = 15 * 60 * 1000;

async function videoSize(file) {
  const { stdout } = await run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', file]);
  const [width, height] = stdout.trim().split('x').map(Number);
  return { width, height };
}

// Puts the banner text on the AI video: it fades in after half a second.
async function addText(job, formatId, rawVideo) {
  const files = jobFiles(job.id);
  const state = job.formats[formatId];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adstudio-'));
  try {
    const input = path.join(dir, 'in.mp4');
    const overlayFile = path.join(dir, 'text.png');
    const output = path.join(dir, 'out.mp4');
    fs.writeFileSync(input, rawVideo);
    const { width, height } = await videoSize(input);
    const overlay = await renderOverlay({
      formatId, layoutId: state.layout, width, height, styleId: job.brief.style,
      copy: job.brief.copy, brand: files.brand, palette: job.brief.palette, tone: files.tones[formatId],
    });
    fs.writeFileSync(overlayFile, overlay);
    await run(FFMPEG, [
      '-y', '-i', input, '-loop', '1', '-i', overlayFile,
      '-filter_complex', '[1:v]format=rgba,fade=in:st=0.5:d=0.7:alpha=1[t];[0:v][t]overlay=0:0:shortest=1,format=yuv420p',
      '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-movflags', '+faststart', '-an', output,
    ]);
    return fs.readFileSync(output);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Waits for the AI video in the background, then adds the text.
export function followVideo(job, formatId) {
  const video = job.videos[formatId];
  const poll = async () => {
    try {
      const result = await videoResult(video.requestId);
      if (result.status !== 'COMPLETED') {
        if (Date.now() - video.startedAt > GIVE_UP_MS) throw new Error('Video took too long');
        setTimeout(poll, POLL_MS);
        return;
      }
      video.status = 'finishing';
      saveFile(job.id, `video-${formatId}-clean.mp4`, result.video);
      const finished = await addText(job, formatId, result.video);
      video.url = saveFile(job.id, `video-${formatId}-v${job.version}.mp4`, finished);
      video.status = 'done';
    } catch (err) {
      console.error(`[${job.id}] video ${formatId} failed:`, err.message);
      video.status = 'error';
      video.error = 'The video could not be made. Please try again.';
    }
  };
  setTimeout(poll, POLL_MS);
}

/** Starts a video ad for one finished format and follows it in the background. */
export async function makeVideo(job, formatId) {
  const files = jobFiles(job.id);
  const image = await sharp(files.scenes[formatId]).jpeg({ quality: 92 }).toBuffer();
  const prompt = `${job.brief.video.motion} The ${job.brief.product.name} stays perfectly still, sharp and unchanged, with its label exactly as it is. No text appears.`;
  job.videos[formatId] = { status: 'starting', startedAt: Date.now() };
  job.videos[formatId].requestId = await startVideo({ image, prompt });
  job.videos[formatId].status = 'rendering';
  followVideo(job, formatId);
}
