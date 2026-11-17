// Making real video files on the phone:
//   exportProject() – renders an edited project to MP4 (up to 4K)
//   enhanceVideo()  – "4K mode": upscales and cleans up an existing video
// Uses Mediabunny (MPL-2.0, https://mediabunny.dev) on top of the phone's
// built-in video encoder (WebCodecs). Nothing is uploaded.
import { Compositor, layout, sourceTime, loadFonts } from './engine.js';
import { sharedFX, FX } from './fx.js';
import { mediaUrl } from './db.js';
import { even, clamp } from './util.js';

const MB_URL = 'https://cdn.jsdelivr.net/npm/mediabunny@1.66.0/dist/bundles/mediabunny.min.mjs';
let MB = null;
export async function mediabunny() {
  if (!MB) MB = await import(MB_URL);
  return MB;
}

export const RESOLUTIONS = { 720: '720p (HD)', 1080: '1080p (Full HD)', 1440: '1440p (2K)', 2160: '2160p (4K)' };

// Pick the best video codec this phone can encode at this size
async function pickVideoCodec(width, height, bitrate) {
  const M = await mediabunny();
  for (const codec of ['avc', 'hevc', 'vp9', 'av1']) {
    if (await M.canEncodeVideo(codec, { width, height, bitrate })) return codec;
  }
  return null;
}
async function pickAudioCodec() {
  const M = await mediabunny();
  if (await M.canEncodeAudio('aac')) return 'aac';
  if (await M.canEncodeAudio('opus')) return 'opus';
  return null;
}

export function outputSize(project, shortSide) {
  const s = shortSide / Math.min(project.w, project.h);
  return { width: even(project.w * s), height: even(project.h * s) };
}

const bitrateFor = (w, h, fps) => Math.round(w * h * fps * 0.12); // ~12 Mbps at 1080p30, ~50 Mbps at 4K30

/* ================================================================ export a project */

export async function exportProject(project, mediaMap, { shortSide = 1080, fps = 30, onProgress = () => {}, signal } = {}) {
  const M = await mediabunny();
  const lay = layout(project);
  const duration = lay.duration;
  const { width, height } = outputSize(project, shortSide);
  const bitrate = bitrateFor(width, height, fps);
  const vCodec = await pickVideoCodec(width, height, bitrate);
  if (!vCodec) throw new Error(`This phone can't make ${height > width ? width : height}p video. Try a lower quality.`);
  await loadFonts(project);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const comp = new Compositor(canvas);

  const output = new M.Output({ format: new M.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new M.BufferTarget() });
  const videoSource = new M.CanvasSource(canvas, { codec: vCodec, bitrate, keyFrameInterval: 2 });
  output.addVideoTrack(videoSource, { frameRate: fps });

  const audio = await planAudio(project, mediaMap, lay);
  const aCodec = audio.length ? await pickAudioCodec() : null;
  const audioSource = aCodec ? new M.AudioBufferSource({ codec: aCodec, bitrate: 192e3 }) : null;
  if (audioSource) output.addAudioTrack(audioSource);
  await output.start();

  try {
    // ---- video: decode the frames each clip needs, in order, then draw and encode
    const frames = Math.max(1, Math.ceil(duration * fps));
    const readers = new Map();
    for (const it of lay.items) {
      const c = it.clip;
      const m = mediaMap.get(c.mediaId);
      if (c.kind === 'video' && m) {
        const times = [];
        for (let i = 0; i < frames; i++) {
          const t = i / fps;
          if (t >= it.start && t < it.end) times.push(clamp(sourceTime(it, t), c.in, Math.max(c.in, c.out - 0.001)));
        }
        if (!times.length) continue;
        const input = new M.Input({ source: new M.BlobSource(m.blob), formats: M.ALL_FORMATS });
        const track = await input.getPrimaryVideoTrack();
        if (!track) continue;
        const sink = new M.VideoSampleSink(track);
        const w = track.displayWidth;
        const h = track.displayHeight;
        // decode at the size we need, not bigger (saves a lot of work at 4K)
        const need = Math.min(1, Math.max(width / w, height / h) * (c.scale || 1) * 1.15);
        const cw = even(w * need);
        const ch = even(h * need);
        const frameCanvas = document.createElement('canvas');
        frameCanvas.width = cw;
        frameCanvas.height = ch;
        readers.set(c.id, {
          iter: sink.samplesAtTimestamps(times)[Symbol.asyncIterator](), canvas: frameCanvas, ctx: frameCanvas.getContext('2d'), w: cw, h: ch, input,
        });
      } else if (c.kind === 'image' && m && !readers.has('img:' + m.id)) {
        const img = await new Promise((resolve, reject) => {
          const im = new Image();
          im.onload = () => resolve(im);
          im.onerror = () => reject(new Error(`Couldn't open the photo "${m.name}".`));
          im.src = mediaUrl(m);
        });
        readers.set('img:' + m.id, { img, w: img.naturalWidth, h: img.naturalHeight });
      }
    }

    const current = new Map(); // clip id → this frame's picture
    const getSource = (it) => {
      if (it.clip.kind === 'image') {
        const r = readers.get('img:' + it.clip.mediaId);
        return r ? { img: r.img, w: r.w, h: r.h } : null;
      }
      return current.get(it.clip.id) || null;
    };

    for (let i = 0; i < frames; i++) {
      if (signal && signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const t = i / fps;
      for (const it of lay.items) {
        if (!(t >= it.start && t < it.end)) continue;
        const r = readers.get(it.clip.id);
        if (!r) continue;
        const { value: sample } = await r.iter.next();
        if (sample) {
          r.ctx.clearRect(0, 0, r.w, r.h);
          sample.draw(r.ctx, 0, 0, r.w, r.h);
          sample.close();
          current.set(it.clip.id, { img: r.canvas, w: r.w, h: r.h });
        }
      }
      comp.draw(project, t, getSource, lay);
      await videoSource.add(t, 1 / fps);
      if (i % 5 === 0) onProgress((i / frames) * (audioSource ? 0.9 : 0.98), `Frame ${i + 1} of ${frames}`);
    }
    for (const r of readers.values()) if (r.iter) await r.iter.return?.();

    // ---- audio: mix every clip's sound and the music, a piece at a time
    if (audioSource) {
      onProgress(0.9, 'Mixing sound');
      await renderAudio(audio, duration, audioSource, signal);
    }
    onProgress(0.98, 'Finishing the file');
    await output.finalize();
  } catch (err) {
    await output.cancel().catch(() => {});
    throw err;
  }
  onProgress(1, 'Done');
  return new Blob([output.target.buffer], { type: 'video/mp4' });
}

/* ---- audio planning and mixing ---- */

// Every sound that plays, with where it comes from and where it goes on the timeline
async function planAudio(project, mediaMap, lay) {
  const M = await mediabunny();
  const parts = [];
  for (const it of lay.items) {
    const c = it.clip;
    const m = mediaMap.get(c.mediaId);
    if (c.kind !== 'video' || c.muted || !c.volume || !m) continue;
    const input = new M.Input({ source: new M.BlobSource(m.blob), formats: M.ALL_FORMATS });
    const track = await input.getPrimaryAudioTrack().catch(() => null);
    if (!track || !(await track.canDecode())) continue;
    parts.push({
      track, from: c.in, to: c.out, start: it.start, end: it.end, speed: c.speed || 1,
      gain: (t) => {
        let v = c.volume;
        const local = t - it.start;
        if (c.fadeIn > 0 && local < c.fadeIn) v *= local / c.fadeIn;
        if (c.fadeOut > 0 && it.len - local < c.fadeOut) v *= (it.len - local) / c.fadeOut;
        if (it.transIn > 0 && local < it.transIn) v *= local / it.transIn;
        if (it.transOut > 0 && it.len - local < it.transOut) v *= (it.len - local) / it.transOut;
        return clamp(v, 0, 2);
      },
    });
  }
  const mus = project.music;
  const mm = mus && mediaMap.get(mus.mediaId);
  if (mm && mus.volume > 0) {
    const input = new M.Input({ source: new M.BlobSource(mm.blob), formats: M.ALL_FORMATS });
    const track = await input.getPrimaryAudioTrack().catch(() => null);
    if (track && (await track.canDecode())) {
      const total = lay.duration;
      const from = mus.start || 0;
      parts.push({
        track, from, to: from + total, start: 0, end: total, speed: 1,
        gain: (t) => {
          let v = mus.volume;
          if (mus.fadeIn > 0 && t < mus.fadeIn) v *= t / mus.fadeIn;
          if (mus.fadeOut > 0 && total - t < mus.fadeOut) v *= (total - t) / mus.fadeOut;
          return clamp(v, 0, 2);
        },
      });
    }
  }
  return parts;
}

async function renderAudio(parts, duration, audioSource, signal) {
  const M = await mediabunny();
  const rate = 48000;
  const SEG = 15; // seconds of sound mixed at a time (keeps memory low)
  for (let segStart = 0; segStart < duration; segStart += SEG) {
    if (signal && signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const segLen = Math.min(SEG, duration - segStart);
    const ctx = new OfflineAudioContext(2, Math.max(1, Math.round(segLen * rate)), rate);
    for (const p of parts) {
      const a = Math.max(segStart, p.start);
      const b = Math.min(segStart + segLen, p.end);
      if (b <= a) continue;
      const srcA = p.from + (a - p.start) * p.speed;
      const srcB = Math.min(p.to, p.from + (b - p.start) * p.speed);
      const sink = new M.AudioBufferSink(p.track);
      for await (const { buffer, timestamp } of sink.buffers(Math.max(0, srcA - 0.05), srcB + 0.05)) {
        const node = ctx.createBufferSource();
        node.buffer = buffer;
        node.playbackRate.value = p.speed;
        const g = ctx.createGain();
        node.connect(g).connect(ctx.destination);
        // where this piece lands in the segment
        let when = p.start + (timestamp - p.from) / p.speed - segStart;
        let offset = 0;
        if (when < 0) { offset = -when * p.speed; when = 0; }
        if (offset >= buffer.duration) continue;
        // volume over time (fades and transitions)
        const steps = 8;
        const len = (buffer.duration - offset) / p.speed;
        for (let k = 0; k <= steps; k++) {
          const lt = when + (len * k) / steps;
          g.gain.setValueAtTime(p.gain(segStart + lt), Math.max(0, lt));
        }
        const maxLen = segLen - when;
        if (maxLen <= 0) continue;
        node.start(when, offset, Math.min(buffer.duration - offset, maxLen * p.speed));
      }
    }
    const rendered = await ctx.startRendering();
    await audioSource.add(rendered);
  }
}

/* ================================================================ 4K mode: enhance an existing video */

export const ENHANCE_TARGETS = { 2160: '4K (2160p)', 1440: '2K (1440p)', 1080: 'Full HD (1080p)' };

// mode: 'fast' (sharpen + clean up + upscale on the graphics chip) or 'ai' (AI upscaler, then 'fast')
export async function enhanceVideo(media, { target = 2160, mode = 'fast', params = {}, onProgress = () => {}, signal } = {}) {
  const M = await mediabunny();
  const input = new M.Input({ source: new M.BlobSource(media.blob), formats: M.ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error("This file has no video in it.");
  const dw = track.displayWidth;
  const dh = track.displayHeight;
  const s = target / Math.min(dw, dh);
  const width = even(dw * s);
  const height = even(dh * s);
  const fps = 30;
  const bitrate = bitrateFor(width, height, fps);
  const codec = await pickVideoCodec(width, height, bitrate);
  if (!codec) throw new Error(`This phone can't make ${target}p video. Try a lower size.`);

  const fx = new FX();
  if (!fx.ok) throw new Error("This phone's browser doesn't support graphics effects (WebGL).");
  const frame = document.createElement('canvas');
  frame.width = dw;
  frame.height = dh;
  const fctx = frame.getContext('2d');
  const ai = mode === 'ai' ? await loadAI(onProgress) : null;
  // The AI doubles the size, so it only needs frames half as big as the target. Smaller = much faster.
  const aiScale = Math.min(1, (target / 2) / Math.min(dw, dh));
  const aiIn = document.createElement('canvas');
  aiIn.width = even(dw * aiScale);
  aiIn.height = even(dh * aiScale);

  const output = new M.Output({ format: new M.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new M.BufferTarget() });
  const conversion = await M.Conversion.init({
    input,
    output,
    video: {
      codec, bitrate, forceTranscode: true, allowTransformationMetadata: false,
      processedWidth: width, processedHeight: height,
      process: async (sample) => {
        if (signal && signal.aborted) return null;
        sample.draw(fctx, 0, 0, dw, dh);
        let src = frame;
        let sw = dw;
        let sh = dh;
        if (ai) {
          let input = frame;
          if (aiScale < 1) { aiIn.getContext('2d').drawImage(frame, 0, 0, aiIn.width, aiIn.height); input = aiIn; }
          const up = await ai.upscale(input);
          src = up;
          sw = up.width;
          sh = up.height;
        }
        return fx.render(src, sw, sh, width, height, params);
      },
    },
    audio: {}, // keep the original sound as it is
  });
  if (!conversion.isValid) throw new Error("This video can't be converted on this phone.");
  conversion.onProgress = (p) => onProgress(p, mode === 'ai' ? 'AI upscaling' : 'Enhancing');
  const onAbort = () => conversion.cancel();
  if (signal) signal.addEventListener('abort', onAbort);
  try {
    await conversion.execute();
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
  }
  if (signal && signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  return { blob: new Blob([output.target.buffer], { type: 'video/mp4' }), width, height };
}

/* ---- AI upscaler (UpscalerJS + ESRGAN-slim 2×, MIT) ---- */

let aiPromise = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Couldn't download the AI upscaler. Check your internet."));
    document.head.append(s);
  });
}

export function loadAI(onProgress = () => {}) {
  if (!aiPromise) {
    aiPromise = (async () => {
      onProgress(0, 'Downloading the AI model (about 2 MB)');
      await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js');
      await loadScript('https://cdn.jsdelivr.net/npm/upscaler@1.0.0/dist/browser/umd/upscaler.min.js');
      await loadScript('https://cdn.jsdelivr.net/npm/@upscalerjs/esrgan-slim@1.0.0/dist/umd/models/esrgan-slim/src/x2/index.min.js');
      const tf = window.tf;
      try { await tf.setBackend('webgl'); } catch { /* keep the default */ }
      const upscaler = new window.Upscaler({ model: window.ESRGANSlim2x });
      await upscaler.ready;
      const out = document.createElement('canvas');
      return {
        async upscale(canvas) {
          const tensor = await upscaler.upscale(canvas, { output: 'tensor', patchSize: 96, padding: 6 });
          const clipped = tf.tidy(() => tensor.clipByValue(0, 255).toInt());
          out.width = clipped.shape[1];
          out.height = clipped.shape[0];
          await tf.browser.toPixels(clipped, out);
          tensor.dispose();
          clipped.dispose();
          return out;
        },
      };
    })();
    aiPromise.catch(() => { aiPromise = null; });
  }
  return aiPromise;
}

// One enhanced still frame, for the before/after preview
export async function enhanceStill(source, sw, sh, target, params, mode) {
  let src = source;
  let w = sw;
  let h = sh;
  if (mode === 'ai') {
    const ai = await loadAI();
    const k = Math.min(1, (target / 2) / Math.min(sw, sh));
    const c = document.createElement('canvas');
    c.width = even(sw * k);
    c.height = even(sh * k);
    c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
    src = await ai.upscale(c);
    w = src.width;
    h = src.height;
  }
  const s = target / Math.min(sw, sh);
  const fx = sharedFX();
  const out = fx.render(src, w, h, even(sw * s), even(sh * s), params);
  const copy = document.createElement('canvas');
  copy.width = out.width;
  copy.height = out.height;
  copy.getContext('2d').drawImage(out, 0, 0);
  return copy;
}
