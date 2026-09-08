/**
 * Stills, clips, narration, and the ffmpeg glue between them.
 *
 * Stills: Gemini's image models (gemini-3.1-flash-image, global) draw the
 * characters in a stylized look in about ten seconds. Clips: Veo 3.1 in
 * us-central1 makes eight-second shots with its own sound in about a minute.
 * Narration: Cloud Text-to-Speech. All Google Cloud AI, which is the only
 * kind the rules allow.
 */
import { execFile } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { GoogleGenAI } from '@google/genai';
import { Storage } from '@google-cloud/storage';
import textToSpeech from '@google-cloud/text-to-speech';
import { localRunDir } from '../output-folder.js';

const execFileP = promisify(execFile);
/** Run a command; on failure, surface the tail of stderr, which is where ffmpeg explains itself. */
async function run(cmd: string, args: string[], opts: { maxBuffer?: number } = {}): Promise<void> {
  try {
    await execFileP(cmd, args, { maxBuffer: opts.maxBuffer ?? 16 * 1024 * 1024 });
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const tail = String(e.stderr ?? '').trim().split('\n').slice(-6).join(' | ');
    throw new Error(`${path.basename(cmd)} failed: ${tail || e.message || String(err)}`.slice(0, 600));
  }
}
/** ffmpeg-static is CommonJS and exports the binary path as module.exports. */
const ffmpegPath = createRequire(import.meta.url)('ffmpeg-static') as string | null;

export const STILL_MODEL = process.env.STILL_MODEL ?? 'gemini-3.1-flash-image';
/** A second image model with its own quota, used when the first is rate-limited. */
export const STILL_FALLBACK_MODEL = process.env.STILL_FALLBACK_MODEL ?? 'gemini-2.5-flash-image';
export const CLIP_MODEL = process.env.CLIP_MODEL ?? 'veo-3.1-generate-001';
export const CLIP_SECONDS = 8;
export const NARRATOR_VOICES = (process.env.NARRATOR_VOICES ?? 'en-US-Chirp3-HD-Aoede,en-US-Neural2-F').split(',');

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');
const FONT_BOLD = path.join(ASSETS, 'IBMPlexSans-Bold.ttf');
const FONT_REGULAR = path.join(ASSETS, 'IBMPlexSans-Regular.ttf');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isRateLimit = (err: unknown): boolean => /429|RESOURCE_EXHAUSTED|exhausted/i.test(err instanceof Error ? err.message : String(err));

/** One sentence that keeps every still and clip in the same visual world. */
export const STYLE =
  'Stylized 3D animation in the look of a modern family feature film, soft rounded character design, ' +
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

/** An MP4 of one eight-second shot, with Veo's own sound. Polls until done. Waits out rate limits. */
export async function generateClip(prompt: string, timeoutMs = 6 * 60_000): Promise<Buffer> {
  const client = clips();
  const waits = [15_000, 30_000, 60_000, 90_000];
  let op: Awaited<ReturnType<typeof client.models.generateVideos>> | undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      op = await client.models.generateVideos({
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
      break;
    } catch (err) {
      if (!isRateLimit(err) || attempt >= waits.length) throw err;
      await sleep(waits[attempt]!);
    }
  }
  const started = Date.now();
  while (!op.done) {
    if (Date.now() - started > timeoutMs) throw new Error('clip generation timed out');
    await sleep(10_000);
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

let tts: InstanceType<typeof textToSpeech.TextToSpeechClient> | undefined;

/** Race a step against a clock, so a stalled call fails the film instead of freezing it. */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const clock = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} took longer than ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([p, clock]).finally(() => clearTimeout(timer));
}

/** Narration as MP3. REST transport, not gRPC, which is the safer choice from a container. Tries the voices in order. */
export async function synthesizeNarration(text: string, outFile: string): Promise<string> {
  tts ??= new textToSpeech.TextToSpeechClient({ fallback: true });
  let lastErr: unknown;
  for (const name of NARRATOR_VOICES) {
    try {
      const [res] = await withTimeout(tts.synthesizeSpeech({
        input: { text },
        voice: { languageCode: 'en-US', name },
        audioConfig: { audioEncoding: 'MP3', speakingRate: 1.02 },
      }), 60_000, `speech for "${text.slice(0, 30)}"`);
      // gRPC hands back bytes; the REST transport hands back base64 text. Both must land as MP3 bytes.
      const audio = res.audioContent as unknown;
      const bytes = typeof audio === 'string' ? Buffer.from(audio, 'base64') : Buffer.from(audio as Uint8Array);
      if (bytes.length < 500) throw new Error(`speech returned ${bytes.length} bytes`);
      await mkdir(path.dirname(outFile), { recursive: true });
      await writeFile(outFile, bytes);
      return name;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
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
  await run(ffmpeg(), ['-y', '-nostdin', '-loglevel', 'error', '-i', tmp, '-vf', 'scale=1280:-2', '-q:v', '4', outFile]);
  await run('rm', ['-f', tmp]);
}

/**
 * Does the clip carry an audio stream? ffmpeg with an input and no output exits
 * non-zero after printing the stream list, so the answer lives in stderr. This
 * uses the raw exec on purpose: the friendly `run` wrapper drops stderr.
 */
async function hasAudio(file: string): Promise<boolean> {
  try {
    await execFileP(ffmpeg(), ['-hide_banner', '-nostdin', '-i', file]);
  } catch (err) {
    return /Audio:/.test(String((err as { stderr?: string }).stderr ?? ''));
  }
  return false;
}

/**
 * Lay the narration over a clip, with the clip's own sound ducked underneath.
 * Every branch has a bounded duration: `apad` without a limit plus `-shortest`
 * on a copied video stream is an encode that never ends.
 */
export async function mixNarration(clip: string, narration: string, outFile: string): Promise<void> {
  const common = ['-map', '0:v', '-c:v', 'copy', '-c:a', 'aac', '-ar', '48000', '-b:a', '128k', '-t', String(CLIP_SECONDS), outFile];
  if (await hasAudio(clip)) {
    await run(ffmpeg(), [
      '-y', '-nostdin', '-loglevel', 'error', '-i', clip, '-i', narration,
      '-filter_complex', `[0:a]volume=0.28[bg];[1:a]adelay=450|450,apad=whole_dur=${CLIP_SECONDS}[vo];[bg][vo]amix=inputs=2:duration=first:normalize=0[a]`,
      '-map', '[a]', ...common,
    ]);
  } else {
    await run(ffmpeg(), [
      '-y', '-nostdin', '-loglevel', 'error', '-i', clip, '-i', narration,
      '-filter_complex', `[1:a]adelay=450|450,apad=whole_dur=${CLIP_SECONDS}[a]`, '-map', '[a]', ...common,
    ]);
  }
}

/** Break a line into rows that fit a 1280px frame at the given size. drawtext does not wrap on its own. */
function wrap(text: string, maxChars: number): string {
  const words = text.split(/\s+/);
  const rows: string[] = [];
  let row = '';
  for (const w of words) {
    if ((row + ' ' + w).trim().length > maxChars && row) {
      rows.push(row);
      row = w;
    } else {
      row = (row + ' ' + w).trim();
    }
  }
  if (row) rows.push(row);
  return rows.join('\n');
}

/** Draw a card as a PNG with the bundled font. No ffmpeg text filters, which the Linux static build lacks. */
async function cardPng(headline: string, line: string, outPng: string): Promise<void> {
  const { createCanvas, GlobalFonts } = await import('@napi-rs/canvas');
  if (!GlobalFonts.has('Hidden Force Bold')) GlobalFonts.registerFromPath(FONT_BOLD, 'Hidden Force Bold');
  if (!GlobalFonts.has('Hidden Force Regular')) GlobalFonts.registerFromPath(FONT_REGULAR, 'Hidden Force Regular');
  const canvas = createCanvas(1280, 720);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1B1F26';
  ctx.fillRect(0, 0, 1280, 720);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const heads = wrap(headline, 30).split('\n');
  const lines = wrap(line, 62).split('\n');
  const headSize = 62;
  const lineSize = 30;
  const gap = 34;
  const total = heads.length * (headSize + 10) + gap + lines.length * (lineSize + 8);
  let y = 360 - total / 2 + headSize / 2;
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `${headSize}px "Hidden Force Bold"`;
  for (const h of heads) { ctx.fillText(h, 640, y); y += headSize + 10; }
  y += gap;
  ctx.fillStyle = '#C9CFD8';
  ctx.font = `${lineSize}px "Hidden Force Regular"`;
  for (const l of lines) { ctx.fillText(l, 640, y); y += lineSize + 8; }
  await mkdir(path.dirname(outPng), { recursive: true });
  await writeFile(outPng, canvas.toBuffer('image/png'));
}

/**
 * A card with a headline and a smaller line under it, silent, on the studio's
 * dark ground. If drawing the text fails for any reason, the card is a plain
 * dark frame, so a film never dies over a caption.
 */
export async function textCard(headline: string, line: string, outFile: string, seconds = 3): Promise<void> {
  await mkdir(path.dirname(outFile), { recursive: true });
  const png = `${outFile}.png`;
  let videoInput: string[];
  try {
    await cardPng(headline, line, png);
    videoInput = ['-loop', '1', '-framerate', '24', '-t', String(seconds), '-i', png];
  } catch (err) {
    console.warn(`card text failed, using a plain card: ${err instanceof Error ? err.message : String(err)}`);
    videoInput = ['-f', 'lavfi', '-i', `color=c=0x1B1F26:s=1280x720:r=24:d=${seconds}`];
  }
  await run(ffmpeg(), [
    '-y', '-nostdin', '-loglevel', 'error',
    ...videoInput,
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
    '-t', String(seconds), '-vf', 'scale=1280:720,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-r', '24',
    '-c:a', 'aac', '-ar', '48000', '-b:a', '128k', '-shortest', outFile,
  ]);
  await run('rm', ['-f', png]);
}

/** Cut the parts into one film, normalizing size, frame rate and audio so the joins are clean. */
export async function concatFilm(parts: string[], outFile: string): Promise<void> {
  await mkdir(path.dirname(outFile), { recursive: true });
  const inputs = parts.flatMap((p) => ['-i', p]);
  const pre = parts.map((_, i) =>
    `[${i}:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24[v${i}];` +
    `[${i}:a]aformat=sample_rates=48000:channel_layouts=stereo[a${i}]`).join(';');
  const cat = parts.map((_, i) => `[v${i}][a${i}]`).join('') + `concat=n=${parts.length}:v=1:a=1[v][a]`;
  await run(ffmpeg(), [
    '-y', '-nostdin', '-loglevel', 'error', ...inputs,
    '-filter_complex', `${pre};${cat}`, '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outFile,
  ], { maxBuffer: 64 * 1024 * 1024 });
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

export interface ShotLike { number: number; beat: number; prompt: string }

/** Draw one storyboard frame and store it. Never throws; a failure is recorded on the frame. */
export async function drawFrame(folder: string, shot: ShotLike, palette: string[]): Promise<StoryboardFrame> {
  const file = `storyboard/shot_${String(shot.number).padStart(2, '0')}.jpg`;
  const prompt = `${STYLE} ${shot.prompt} Color palette: ${palette.join(', ')}.`;
  try {
    const { png, model } = await generateStill(prompt);
    const local = path.join(localRunDir(folder), file);
    await toJpeg(png, local);
    await saveRunFile(folder, file, await readFile(local), 'image/jpeg');
    return { shot: shot.number, beat: shot.beat, file, prompt, model };
  } catch (err) {
    return { shot: shot.number, beat: shot.beat, file, prompt, error: err instanceof Error ? err.message.slice(0, 200) : String(err) };
  }
}

export async function writeStoryboard(folder: string, frames: StoryboardFrame[]): Promise<Storyboard> {
  const board: Storyboard = { model: STILL_MODEL, style: STYLE, frames };
  await saveRunFile(folder, 'storyboard.json', JSON.stringify(board, null, 2), 'application/json');
  return board;
}

/**
 * Draw the frames a storyboard is missing. Sequential, with a pause between
 * calls, because that is what the image quota allows. Frames that already
 * succeeded are kept; frames that failed before are retried.
 */
export async function drawStoryboard(
  folder: string,
  shots: ShotLike[],
  palette: string[],
  existing?: Storyboard,
  onFrame?: (done: number, total: number) => void,
): Promise<Storyboard> {
  const keep = new Map((existing?.frames ?? []).filter((f) => !f.error).map((f) => [f.shot, f]));
  const frames: StoryboardFrame[] = [];
  let done = 0;
  for (const shot of shots) {
    const kept = keep.get(shot.number);
    if (kept) frames.push(kept);
    else {
      frames.push(await drawFrame(folder, shot, palette));
      await sleep(4_000);
    }
    done += 1;
    onFrame?.(done, shots.length);
  }
  return writeStoryboard(folder, frames);
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
