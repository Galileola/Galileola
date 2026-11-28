import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ffmpeg, probe } from './tools.js';
import { writeScript } from './director.js';
import { speak, presenterImage, talkingAvatar, download } from './fal.js';
import { jobFiles, saveFile, persist, readFile } from './jobs.js';

// The presenter video: a person (an AI presenter, or a real person from a
// photo, with their permission) talks about the product for about 12
// seconds; the finished banner closes the video.

const VOICES = { female: 'Sarah', male: 'Brian' };

// Presenter clip, then a 3-second end card with the banner, cross-faded;
// the voice track runs under the clip and silence under the end card.
async function withEndCard(clip, voice, banner) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adstudio-avatar-'));
  try {
    const clipFile = path.join(dir, 'clip.mp4');
    const voiceFile = path.join(dir, 'voice.mp3');
    const endFile = path.join(dir, 'end.png');
    const out = path.join(dir, 'out.mp4');
    fs.writeFileSync(clipFile, clip);
    fs.writeFileSync(voiceFile, voice);
    const { width, height, duration } = await probe(clipFile);
    const W = width - (width % 2);
    const H = height - (height % 2);
    if (banner) {
      await sharp(banner).resize(W, H, { fit: 'contain', background: '#000000' }).png().toFile(endFile);
    } else {
      await sharp({ create: { width: W, height: H, channels: 3, background: '#000000' } }).png().toFile(endFile);
    }
    const fade = 0.5;
    await ffmpeg([
      '-y', '-i', clipFile, '-loop', '1', '-t', '3', '-i', endFile, '-i', voiceFile,
      '-filter_complex',
      `[0:v]fps=30,scale=${W}:${H},setsar=1,format=yuv420p[a];[1:v]fps=30,scale=${W}:${H},setsar=1,format=yuv420p[b];` +
      `[a][b]xfade=transition=fade:duration=${fade}:offset=${Math.max(0, duration - fade).toFixed(2)}[v];[2:a]apad=pad_dur=4[au]`,
      '-map', '[v]', '-map', '[au]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', out,
    ]);
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function presenterPrompt(script, gender) {
  return [
    'Photorealistic vertical photo for a smartphone video ad.',
    `${script.presenter}${gender === 'male' ? ' (a man)' : ' (a woman)'}.`,
    'The person holds the product from the reference image naturally in one hand at chest height, label towards the camera,',
    'and looks straight into the camera with a warm, natural expression, lips closed, about to speak.',
    'Upper body in frame, face in the upper half of the picture, some headroom.',
    'Soft natural light, shallow depth of field, authentic and premium.',
    'Keep the product exactly as in the reference: same shape, colours and label.',
    'No text, captions or logos other than the product’s own label.',
  ].join(' ');
}

/**
 * Starts a presenter video for a finished ad. options: { mode: 'ai' | 'photo',
 * gender: 'female' | 'male', photo (data URI, for mode 'photo') }.
 */
export function makeAvatar(job, { mode, gender, photo }) {
  const avatar = { status: 'working', step: 'script', mode, gender, startedAt: Date.now() };
  if (mode === 'photo') avatar.consent = { confirmed: true, at: new Date().toISOString() };
  job.avatar = avatar;
  persist(job);

  (async () => {
    try {
      const files = await jobFiles(job);
      const script = await writeScript({ brief: job.brief, request: job.request, presenter: mode === 'photo' ? 'the person in the photo the client supplied' : null });
      avatar.script = script.script;

      avatar.step = 'presenter';
      persist(job);
      let face;
      if (mode === 'photo') {
        face = await sharp(Buffer.from(photo.slice(photo.indexOf(',') + 1), 'base64')).rotate()
          .resize({ width: 1440, height: 1440, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
      } else {
        face = await presenterImage({ reference: files.cutout.buffer, prompt: presenterPrompt(script, gender) });
        face = await sharp(face).jpeg({ quality: 92 }).toBuffer();
      }
      avatar.presenter = saveFile(job.id, `presenter-${avatar.startedAt}.jpg`, face);

      avatar.step = 'voice';
      persist(job);
      const audioUrl = await speak({ text: script.script, voice: VOICES[gender] || VOICES.female, language: job.request.language });

      avatar.step = 'filming';
      persist(job);
      const { video } = await talkingAvatar({ image: face, audioUrl });

      avatar.step = 'finishing';
      persist(job);
      const bannerFormat = ['story', 'post', 'wide'].find((f) => job.formats[f]?.banner);
      const banner = bannerFormat ? readFile(job.id, path.basename(job.formats[bannerFormat].banner)) : null;
      const finished = await withEndCard(video, await download(audioUrl), banner);
      avatar.url = saveFile(job.id, `presenter-${avatar.startedAt}.mp4`, finished);
      avatar.status = 'done';
    } catch (err) {
      console.error(`[${job.id}] presenter video failed:`, err);
      avatar.status = 'error';
      avatar.error = err.userMessage || 'The presenter video could not be made. Please try again.';
    } finally {
      persist(job);
    }
  })();
}
