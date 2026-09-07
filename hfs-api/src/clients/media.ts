/**
 * Stills and clips on Vertex AI, and the ffmpeg glue between them.
 *
 * Stills: Gemini's image models (gemini-3.1-flash-image, global) draw the
 * characters in a stylised look in about ten seconds. Clips: Veo 3.1 in
 * us-central1 makes eight-second shots with its own sound in about a minute.
 * Both are Google Cloud AI, which is the only kind the rules allow.
 */
import { execFile } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';
import { GoogleGenAI } from '@google/genai';
import { Storage } from '@google-cloud/storage';
import { localRunDir } from '../output-folder.js';

const run = promisify(execFile);
/** ffmpeg-static is CommonJS and exports the binary path as module.exports. */
const ffmpegPath = createRequire(import.meta.url)('ffmpeg-static') as string | null;

export const STILL_MODEL = process.env.STILL_MODEL ?? 'gemini-3.1-flash-image';
/** A second image model with its own quota, used when the first is rate-limited. */
export const STILL_FALLBACK_MODEL = process.env.STILL_FALLBACK_MODEL ?? 'gemini-2.5-flash-image';
export const CLIP_MODEL = process.env.CLIP_MODEL ?? 'veo-3.1-generate-001';
export const CLIP_SECONDS = 8;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isRateLimit = (err: unknown): boolean => /429|RESOURCE_EXHAUSTED|exhausted/i.test(err instanceof Error ? err.message : String(err));

/** One sentence that keeps every still and clip in the same visual world. */
export const STYLE =
  'Stylised 3D animation in the look of a modern family feature film, soft rounded character design, ' +
  'consistent character design across shots, not photorealistic, 16:9 film frame, no text, no captions, no watermark.';

const project = process.env.GOOGLE_CLOUD_PROJECT;
let stillClient: GoogleGenAI | undefined;
let clipClient: GoogleGenAI | undefined;
const stills = () => (stillClient ??= new GoogleGenAI({ vertexai: true, project, location: 'global' }));
const clips = () => (clipClient ??= new GoogleGenAI({ vertexai: true, project, location: 'us-central1' }));

async function stillOnce(model: string, prompt: string): Promise<Buffer> {
  const res = await stills().models.generateContent({
    model,
    contents: prompt,
    config: { responseModalities: ['IMAGE', 'TEXT'] as never, httpOptions: { timeout: 120_000 } },
  });
  const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) throw new Error(`no image returned: ${(res.text ?? '').slice(0, 120)}`);
  return Buffer.from(part.inlineData.data, 'base64');
}

/**
 * A PNG of one shot. Image quotas on a fresh project are a few requests a
 * minute, so a 429 waits and retries with growing pauses, and after two the
 * fallback model, which has its own quota, takes over. Returns the model used.
 */
export async function generateStill(prompt: string): Promise<{ png: Buffer; model: string }> {
  const waits = [8_000, 16_000, 32_000, 48_000, 64_000];
  let model = STILL_MODEL;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= waits.length; attempt++) {
    try {
      return { png: await stillOnce(model, prompt), model };
    } catch (err) {
      lastErr = err;
      if (!isRateLimit(err)) throw err;
      if (attempt >= 1 && model === STILL_MODEL) model = STILL_FALLBACK_MODEL;
      if (attempt < waits.length) await sleep(waits[attempt]!);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** An MP4 of one eight-second shot, with Veo's own sound. Polls until done. */
export async function generateClip(prompt: string, timeoutMs = 6 * 60_000): Promise<Buffer> {
  const client = clips();
  let op = await client.models.generateVideos({
    model: CLIP_MODEL,
    prompt,
    config: {
      aspectRatio: '16:9',
      durationSeconds: CLIP_SECONDS,
      personGeneration: 'allow_all' as never,
      resolution: '720p' as never,
      numberOfVideos: 1,
    },
  });
  const started = Date.now();
  while (!op.done) {
    if (Date.now() - started > timeoutMs) throw new Error('clip generation timed out');
    await new Promise((r) => setTimeout(r, 10_000));
    op = await client.operations.getVideosOperation({ operation: op });
  }
  if (op.error) throw new Error(`clip generation failed: ${JSON.stringify(op.error).slice(0, 200)}`);
  const video = op.response?.generatedVideos?.[0]?.video;
  if (video?.videoBytes) return Buffer.from(video.videoBytes, 'base64');
  if (video?.uri) {
    const [buf] = await new Storage().bucket(video.uri.split('/')[2]!).file(video.uri.split('/').slice(3).join('/')).download();
    return buf;
  }
  const filtered = op.response?.raiMediaFilteredReasons ?? [];
  throw new Error(`no video returned${filtered.length ? `: ${filtered.join('; ').slice(0, 200)}` : ''}`);
}

const ffmpeg = (): string => {
  if (!ffmpegPath) throw new Error('ffmpeg binary not available');
  return ffmpegPath;
};

/** PNG -> JPEG at 1280px wide, the size that is fine to commit and quick to load. */
export async function toJpeg(png: Buffer, outFile: string): Promise<void> {
  await mkdir(path.dirname(outFile), { recursive: true });
  const tmp = `${outFile}.png`;
  await writeFile(tmp, png);
  await run(ffmpeg(), ['-y', '-loglevel', 'error', '-i', tmp, '-vf', 'scale=1280:-2', '-q:v', '4', outFile]);
  await run('rm', ['-f', tmp]);
}

/** Concatenate clips into one film, re-encoded once so the result streams at a sane size. */
export async function concatClips(clipFiles: string[], outFile: string): Promise<void> {
  await mkdir(path.dirname(outFile), { recursive: true });
  const list = `${outFile}.txt`;
  await writeFile(list, clipFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
  await run(ffmpeg(), [
    '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outFile,
  ]);
  await run('rm', ['-f', list]);
}

let storage: Storage | undefined;

/** Write a file into the run folder locally and, when OUTPUT_BUCKET is set, into the bucket too. */
export async function saveRunFile(folder: string, relPath: string, body: Buffer | string, contentType?: string): Promise<string> {
  const local = path.join(localRunDir(folder), relPath);
  await mkdir(path.dirname(local), { recursive: true });
  await writeFile(local, body);
  const bucket = process.env.OUTPUT_BUCKET;
  if (bucket) {
    storage ??= new Storage();
    await storage.bucket(bucket).file(`${folder}/${relPath}`).save(body, contentType ? { contentType } : undefined);
  }
  return local;
}

export async function readRunFile(folder: string, relPath: string): Promise<Buffer | undefined> {
  const bucket = process.env.OUTPUT_BUCKET;
  try {
    if (bucket) {
      storage ??= new Storage();
      const [buf] = await storage.bucket(bucket).file(`${folder}/${relPath}`).download();
      return buf;
    }
    return await readFile(path.join(localRunDir(folder), relPath));
  } catch {
    return undefined;
  }
}

export interface StoryboardFrame {
  shot: number;
  beat: number;
  file: string;
  prompt: string;
  model?: string;
  error?: string;
}

export interface Storyboard {
  model: string;
  style: string;
  frames: StoryboardFrame[];
}

/**
 * Draw the frames a storyboard is missing. Sequential, with a pause between
 * calls, because that is what the image quota allows. Frames that already
 * succeeded are kept; frames that failed before are retried.
 */
export async function drawStoryboard(
  folder: string,
  shots: Array<{ number: number; beat: number; prompt: string }>,
  palette: string[],
  existing?: Storyboard,
  onFrame?: (done: number, total: number) => void,
): Promise<Storyboard> {
  const keep = new Map((existing?.frames ?? []).filter((f) => !f.error).map((f) => [f.shot, f]));
  const frames: StoryboardFrame[] = [];
  let done = 0;
  for (const shot of shots) {
    const file = `storyboard/shot_${String(shot.number).padStart(2, '0')}.jpg`;
    const prompt = `${STYLE} ${shot.prompt} Colour palette: ${palette.join(', ')}.`;
    const kept = keep.get(shot.number);
    if (kept) {
      frames.push(kept);
    } else {
      try {
        const { png, model } = await generateStill(prompt);
        const local = path.join(localRunDir(folder), file);
        await toJpeg(png, local);
        await saveRunFile(folder, file, await readFile(local), 'image/jpeg');
        frames.push({ shot: shot.number, beat: shot.beat, file, prompt, model });
      } catch (err) {
        frames.push({ shot: shot.number, beat: shot.beat, file, prompt, error: err instanceof Error ? err.message.slice(0, 200) : String(err) });
      }
      await sleep(4_000);
    }
    done += 1;
    onFrame?.(done, shots.length);
  }
  const board: Storyboard = { model: STILL_MODEL, style: STYLE, frames };
  await saveRunFile(folder, 'storyboard.json', JSON.stringify(board, null, 2), 'application/json');
  return board;
}

/** Run `n` async jobs at a time. Order of results matches order of inputs. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}
