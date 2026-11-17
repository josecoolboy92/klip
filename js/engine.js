// The editing engine: what a project is, where each clip sits on the timeline,
// and how one frame of the video is drawn (used by the live preview AND the export,
// so what you see is what you get).
import { uid, clamp } from './util.js';
import { sharedFX, effectParams, isNeutral } from './fx.js';
import { mediaUrl } from './db.js';

/* ================================================================ project */

export const FORMATS = {
  story: { label: 'Story · Reel · TikTok', ratio: '9:16', w: 1080, h: 1920 },
  post: { label: 'Portrait post', ratio: '4:5', w: 1080, h: 1350 },
  square: { label: 'Square post', ratio: '1:1', w: 1080, h: 1080 },
  youtube: { label: 'YouTube · TV', ratio: '16:9', w: 1920, h: 1080 },
  cinema: { label: 'Cinema', ratio: '21:9', w: 2520, h: 1080 },
};

export const FONTS = [
  'Poppins', 'Inter', 'Bebas Neue', 'Oswald', 'Playfair Display', 'Lobster', 'Pacifico',
  'Permanent Marker', 'Noto Sans Ethiopic', 'Noto Serif Ethiopic',
];

export const TRANSITIONS = {
  none: 'None', fade: 'Cross fade', black: 'Dip to black', white: 'Flash', slideleft: 'Slide', slideup: 'Slide up',
  zoom: 'Zoom', wipe: 'Wipe', circle: 'Circle',
};

export const TEXT_ANIMS = { none: 'None', fade: 'Fade', pop: 'Pop', slide: 'Slide up', type: 'Typewriter', bounce: 'Bounce' };

export function newProject(formatKey = 'story', name = 'Untitled design') {
  const f = FORMATS[formatKey] || FORMATS.story;
  return {
    id: uid(), name, format: formatKey, w: f.w, h: f.h,
    created: Date.now(), updated: Date.now(),
    background: { type: 'blur', color: '#000000' },
    clips: [], overlays: [], music: null, thumb: '',
  };
}

export function newClip(media) {
  const isVideo = media.kind === 'video';
  return {
    id: uid(), mediaId: media.id, kind: media.kind, name: media.name,
    in: 0, out: isVideo ? media.duration : 0, duration: isVideo ? 0 : 4,
    speed: 1, volume: 1, muted: false,
    fit: 'fit', scale: 1, x: 0, y: 0, rotate: 0, flip: false,
    filter: 'none', adjust: {},
    fadeIn: 0, fadeOut: 0, kenBurns: media.kind === 'image',
    transition: { type: 'none', dur: 0.6 },
  };
}

export function colorClip(color = '#1d1b2f', duration = 3) {
  return { ...newClip({ id: '', kind: 'color', name: 'Color' }), mediaId: '', color, duration };
}

export function newText(t0, props = {}) {
  return {
    id: uid(), type: 'text', text: 'Your text', start: t0, end: t0 + 3,
    x: 0.5, y: 0.5, size: 0.06, font: 'Poppins', weight: 700, color: '#ffffff',
    bg: '', stroke: '', shadow: true, align: 'center', anim: 'pop', rotation: 0,
    ...props,
  };
}

export function newSticker(emoji, t0) {
  return { ...newText(t0, { type: 'sticker', text: emoji, size: 0.12, shadow: false, anim: 'bounce', y: 0.35 }) };
}

/* ================================================================ timeline math */

export const clipLength = (c) => (c.kind === 'video' ? Math.max(0.05, (c.out - c.in) / (c.speed || 1)) : c.duration);

// Where each clip starts on the timeline. A transition makes two clips overlap.
export function layout(project) {
  let t = 0;
  const items = project.clips.map((c, i) => {
    const len = clipLength(c);
    const next = project.clips[i + 1];
    let trans = 0;
    if (next && c.transition && c.transition.type !== 'none') {
      trans = Math.min(c.transition.dur, len / 2, clipLength(next) / 2);
    }
    const item = { clip: c, index: i, start: t, len, end: t + len, transOut: trans, transIn: 0 };
    t += len - trans;
    return item;
  });
  items.forEach((it, i) => { if (i > 0) it.transIn = items[i - 1].transOut; });
  const clipsEnd = items.length ? items[items.length - 1].end : 0;
  const overlaysEnd = project.overlays.reduce((m, o) => Math.max(m, o.end), 0);
  return { items, duration: Math.max(clipsEnd, overlaysEnd, 0.1) };
}

export const sourceTime = (item, t) => item.clip.in + (t - item.start) * (item.clip.speed || 1);

/* ================================================================ drawing one frame */

export class Compositor {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.boxes = []; // where each text/sticker was drawn (to tap and drag them)
  }

  // getSource(item, sourceTime) → { img, w, h } or null
  draw(project, t, getSource, lay = layout(project)) {
    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.fillStyle = project.background.color || '#000';
    ctx.fillRect(0, 0, W, H);

    const active = lay.items.filter((it) => t >= it.start && t < it.end + 1e-6 && t < lay.duration);
    if (!active.length && lay.items.length && t >= lay.items[lay.items.length - 1].end) {
      // after the last clip (only text left): keep showing the background
    }
    active.forEach((it, k) => {
      const src = this.sourceFor(it, t, getSource);
      if (k === 0 && project.background.type === 'blur' && src) this.drawBlur(src);
      this.drawClip(project, it, t, src, active.length > 1 ? k : -1);
    });

    this.boxes = [];
    for (const o of project.overlays) {
      if (t >= o.start && t < o.end) this.drawOverlay(o, t);
    }
    ctx.restore();
  }

  sourceFor(it, t, getSource) {
    if (it.clip.kind === 'color') return { color: it.clip.color };
    const st = clamp(sourceTime(it, t), it.clip.in, Math.max(it.clip.in, it.clip.out - 0.001));
    return getSource(it, st);
  }

  drawBlur(src) {
    if (!src.img) return;
    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    const s = Math.max(W / src.w, H / src.h) * 1.1;
    ctx.save();
    ctx.filter = `blur(${Math.round(Math.max(W, H) / 40)}px) brightness(0.65)`;
    ctx.drawImage(src.img, (W - src.w * s) / 2, (H - src.h * s) / 2, src.w * s, src.h * s);
    ctx.restore();
  }

  drawClip(project, it, t, src, transitionRole) {
    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    const c = it.clip;
    const local = t - it.start;
    let alpha = 1;
    let dx = 0;
    let dy = 0;
    let zoom = 1;
    let clipShape = null;

    // fades on the clip itself
    if (c.fadeIn > 0 && local < c.fadeIn) alpha *= local / c.fadeIn;
    if (c.fadeOut > 0 && it.len - local < c.fadeOut) alpha *= Math.max(0, (it.len - local) / c.fadeOut);

    // transitions: role 1 = the incoming clip, role 0 = the outgoing clip
    if (transitionRole === 1 && it.transIn > 0) {
      const p = clamp(local / it.transIn, 0, 1);
      const type = project.clips[it.index - 1].transition.type;
      if (type === 'fade') alpha *= p;
      else if (type === 'black' || type === 'white') alpha *= clamp((p - 0.5) * 2, 0, 1);
      else if (type === 'slideleft') dx = (1 - ease(p)) * W;
      else if (type === 'slideup') dy = (1 - ease(p)) * H;
      else if (type === 'zoom') { zoom = 1.25 - 0.25 * ease(p); alpha *= p; }
      else if (type === 'wipe') clipShape = (g) => g.rect(0, 0, W * ease(p), H);
      else if (type === 'circle') clipShape = (g) => g.arc(W / 2, H / 2, Math.hypot(W, H) / 2 * ease(p), 0, Math.PI * 2);
    } else if (transitionRole === 0 && it.transOut > 0) {
      const p = clamp((local - (it.len - it.transOut)) / it.transOut, 0, 1);
      const type = c.transition.type;
      if (type === 'black' || type === 'white') alpha *= clamp(1 - p * 2, 0, 1);
      else if (type === 'slideleft') dx = -ease(p) * W;
      else if (type === 'slideup') dy = -ease(p) * H;
    }
    if (alpha <= 0) return;

    // a "flash" or "dip to black" shows a solid color in the middle of the transition
    if ((transitionRole === 0 || transitionRole === 1)) {
      const lead = transitionRole === 0 ? c : project.clips[it.index - 1];
      if (lead && (lead.transition.type === 'black' || lead.transition.type === 'white')) {
        ctx.save();
        ctx.fillStyle = lead.transition.type === 'white' ? '#fff' : '#000';
        ctx.globalAlpha = 1 - alpha;
        if (transitionRole === 1) ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    if (clipShape) { ctx.beginPath(); clipShape(ctx); ctx.clip(); }

    if (src && src.color) {
      ctx.fillStyle = src.color;
      ctx.fillRect(dx, dy, W, H);
      ctx.restore();
      return;
    }
    if (!src || !src.img) { ctx.restore(); return; }

    const rot = ((c.rotate || 0) % 360 + 360) % 360;
    const sideways = rot === 90 || rot === 270;
    const mw = sideways ? src.h : src.w;
    const mh = sideways ? src.w : src.h;
    let s = c.fit === 'fill' ? Math.max(W / mw, H / mh) : Math.min(W / mw, H / mh);
    s *= (c.scale || 1) * zoom;
    if (c.kenBurns) s *= 1 + 0.12 * clamp(local / it.len, 0, 1);
    const drawW = src.w * s;
    const drawH = src.h * s;

    // color effects on the graphics chip
    let img = src.img;
    const p = effectParams(c.filter, c.adjust);
    if (!isNeutral(p)) {
      const fx = sharedFX();
      if (fx.ok) {
        const ow = Math.max(2, Math.round(Math.min(drawW, W * 1.5)));
        const oh = Math.max(2, Math.round(Math.min(drawH, H * 1.5)));
        try { img = fx.render(src.img, src.w, src.h, ow, oh, p); } catch { img = src.img; }
      }
    }

    ctx.translate(W / 2 + (c.x || 0) * W + dx, H / 2 + (c.y || 0) * H + dy);
    ctx.rotate((rot * Math.PI) / 180);
    if (c.flip) ctx.scale(-1, 1);
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
  }

  drawOverlay(o, t) {
    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    const local = t - o.start;
    const outLeft = o.end - t;
    let alpha = 1;
    let scale = 1;
    let oy = 0;
    let text = o.text;
    const inP = clamp(local / 0.5, 0, 1);
    switch (o.anim) {
      case 'fade': alpha = inP; break;
      case 'pop': scale = inP < 1 ? 0.6 + 0.4 * easeBack(inP) : 1; alpha = clamp(inP * 2, 0, 1); break;
      case 'slide': oy = (1 - ease(inP)) * H * 0.05; alpha = inP; break;
      case 'bounce': scale = 1 + Math.sin(local * 4) * 0.06; alpha = clamp(inP * 2, 0, 1); break;
      case 'type': text = o.text.slice(0, Math.ceil(o.text.length * clamp(local / Math.max(0.6, o.text.length * 0.05), 0, 1))); break;
      default: break;
    }
    if (o.anim !== 'none' && outLeft < 0.3) alpha *= clamp(outLeft / 0.3, 0, 1);

    const size = Math.max(6, o.size * H);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `${o.type === 'sticker' ? 400 : o.weight || 700} ${size}px "${o.type === 'sticker' ? 'Noto Color Emoji' : o.font}", system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const lines = wrap(ctx, text, W * 0.88);
    const lineH = size * 1.2;
    const widths = lines.map((l) => ctx.measureText(l).width);
    const boxW = Math.max(...widths, size * 0.5);
    const boxH = lineH * lines.length;
    const cx = o.x * W;
    const cy = o.y * H + oy;
    ctx.translate(cx, cy);
    ctx.rotate(((o.rotation || 0) * Math.PI) / 180);
    ctx.scale(scale, scale);

    const pad = size * 0.35;
    const alignX = o.align === 'left' ? -boxW / 2 : o.align === 'right' ? boxW / 2 : 0;
    if (o.bg) {
      ctx.fillStyle = o.bg;
      roundRect(ctx, -boxW / 2 - pad, -boxH / 2 - pad * 0.6, boxW + pad * 2, boxH + pad * 1.2, size * 0.3);
      ctx.fill();
    }
    ctx.textAlign = o.align || 'center';
    if (o.shadow) { ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = size * 0.25; ctx.shadowOffsetY = size * 0.05; }
    lines.forEach((line, i) => {
      const y = -boxH / 2 + lineH * (i + 0.5);
      if (o.stroke) {
        ctx.lineWidth = Math.max(2, size * 0.09);
        ctx.strokeStyle = o.stroke;
        ctx.lineJoin = 'round';
        ctx.strokeText(line, alignX, y);
      }
      ctx.fillStyle = o.color || '#fff';
      ctx.fillText(line, alignX, y);
    });
    ctx.restore();
    this.boxes.push({ id: o.id, x: cx - boxW / 2 - pad, y: cy - boxH / 2 - pad, w: boxW + pad * 2, h: boxH + pad * 2 });
  }
}

function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(' ');
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { out.push(line); line = w; } else line = test;
    }
    out.push(line);
  }
  return out;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const ease = (p) => 1 - Math.pow(1 - p, 3);
const easeBack = (p) => { const c1 = 1.70158; const c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); };

/* ================================================================ live preview player */

export class Preview {
  constructor(canvas, mediaMap) {
    this.canvas = canvas;
    this.comp = new Compositor(canvas);
    this.media = mediaMap; // id → media record
    this.videos = new Map(); // clip id → <video>
    this.images = new Map(); // media id → <img>
    this.music = new Audio();
    this.music.preload = 'auto';
    this.project = null;
    this.time = 0;
    this.playing = false;
    this.last = 0;
    this.onTime = () => {};
    this.onEnd = () => {};
    this.raf = 0;
    this.tick = this.tick.bind(this);
  }

  setProject(project) {
    this.project = project;
    this.lay = layout(project);
    // drop players for removed clips
    const ids = new Set(project.clips.map((c) => c.id));
    for (const [id, v] of this.videos) if (!ids.has(id)) { v.pause(); v.removeAttribute('src'); v.load(); this.videos.delete(id); }
    for (const c of project.clips) this.ensure(c);
    const m = project.music && this.media.get(project.music.mediaId);
    const url = m ? mediaUrl(m) : '';
    if (this.music.dataset.src !== url) { this.music.dataset.src = url; if (url) this.music.src = url; else this.music.removeAttribute('src'); }
    if (this.time > this.lay.duration) this.time = this.lay.duration;
    this.render();
  }

  ensure(c) {
    const m = this.media.get(c.mediaId);
    if (!m) return;
    if (c.kind === 'video' && !this.videos.has(c.id)) {
      const v = document.createElement('video');
      v.playsInline = true;
      v.preload = 'auto';
      v.src = mediaUrl(m);
      v.addEventListener('seeked', () => { if (!this.playing) this.render(); });
      v.addEventListener('loadeddata', () => { if (!this.playing) this.syncPaused(); });
      this.videos.set(c.id, v);
    }
    if (c.kind === 'image' && !this.images.has(m.id)) {
      const img = new Image();
      img.onload = () => this.render();
      img.src = mediaUrl(m);
      this.images.set(m.id, img);
    }
  }

  getSource = (it, st) => {
    const c = it.clip;
    if (c.kind === 'video') {
      const v = this.videos.get(c.id);
      if (!v || v.readyState < 2) return null;
      return { img: v, w: v.videoWidth, h: v.videoHeight };
    }
    if (c.kind === 'image') {
      const img = this.images.get(c.mediaId);
      if (!img || !img.complete || !img.naturalWidth) return null;
      return { img, w: img.naturalWidth, h: img.naturalHeight };
    }
    return null;
  };

  render() {
    if (!this.project) return;
    this.comp.draw(this.project, this.time, this.getSource, this.lay);
  }

  volumeAt(it, t) {
    const c = it.clip;
    if (c.muted) return 0;
    let v = c.volume;
    const local = t - it.start;
    if (c.fadeIn > 0 && local < c.fadeIn) v *= local / c.fadeIn;
    if (c.fadeOut > 0 && it.len - local < c.fadeOut) v *= (it.len - local) / c.fadeOut;
    if (it.transIn > 0 && local < it.transIn) v *= local / it.transIn;
    if (it.transOut > 0 && it.len - local < it.transOut) v *= (it.len - local) / it.transOut;
    return clamp(v, 0, 1);
  }

  musicVolume(t) {
    const m = this.project.music;
    if (!m) return 0;
    let v = m.volume;
    if (m.fadeIn > 0 && t < m.fadeIn) v *= t / m.fadeIn;
    const left = this.lay.duration - t;
    if (m.fadeOut > 0 && left < m.fadeOut) v *= left / m.fadeOut;
    return clamp(v, 0, 1);
  }

  // Keep every video at the right moment
  syncPaused() {
    for (const it of this.lay.items) {
      const v = this.videos.get(it.clip.id);
      if (!v) continue;
      if (!v.paused) v.pause();
      if (this.time >= it.start && this.time < it.end) {
        const st = clamp(sourceTime(it, this.time), it.clip.in, it.clip.out - 0.01);
        if (Math.abs(v.currentTime - st) > 0.02 && v.readyState >= 1) v.currentTime = st;
      }
    }
    if (!this.music.paused) this.music.pause();
    this.render();
  }

  play() {
    if (!this.project || !this.lay.items.length && !this.project.overlays.length) return;
    if (this.time >= this.lay.duration - 0.05) this.time = 0;
    this.playing = true;
    this.last = performance.now();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  pause() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.syncPaused();
    this.onTime(this.time);
  }

  seek(t) {
    this.time = clamp(t, 0, this.lay ? this.lay.duration : 0);
    if (this.playing) {
      for (const v of this.videos.values()) v.pause();
      this.music.pause();
    } else this.syncPaused();
    this.onTime(this.time);
  }

  tick(now) {
    if (!this.playing) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    if (this.time >= this.lay.duration) {
      this.time = this.lay.duration;
      this.pause();
      this.onEnd();
      return;
    }
    const t = this.time;
    for (const it of this.lay.items) {
      const v = this.videos.get(it.clip.id);
      if (!v) continue;
      const active = t >= it.start && t < it.end;
      if (active) {
        const st = sourceTime(it, t);
        v.playbackRate = it.clip.speed || 1;
        v.volume = this.volumeAt(it, t);
        v.muted = v.volume === 0;
        if (v.paused) { if (Math.abs(v.currentTime - st) > 0.05) v.currentTime = st; v.play().catch(() => {}); }
        else if (Math.abs(v.currentTime - st) > 0.35) v.currentTime = st;
      } else {
        if (!v.paused) v.pause();
        // get the next clip ready just before it starts
        if (it.start > t && it.start - t < 1.5 && Math.abs(v.currentTime - it.clip.in) > 0.1) v.currentTime = it.clip.in;
      }
    }
    const m = this.project.music;
    if (m && this.music.src) {
      const want = (m.start || 0) + t;
      this.music.volume = this.musicVolume(t);
      if (this.music.duration && want >= this.music.duration) { if (!this.music.paused) this.music.pause(); }
      else if (this.music.paused) { this.music.currentTime = want; this.music.play().catch(() => {}); }
      else if (Math.abs(this.music.currentTime - want) > 0.35) this.music.currentTime = want;
    }
    this.render();
    this.onTime(t);
    this.raf = requestAnimationFrame(this.tick);
  }

  destroy() {
    this.pause();
    for (const v of this.videos.values()) { v.removeAttribute('src'); v.load(); }
    this.videos.clear();
    this.music.removeAttribute('src');
  }
}

// Make sure web fonts are loaded before drawing text into the video
export async function loadFonts(project) {
  if (!document.fonts) return;
  const wanted = new Set(project.overlays.filter((o) => o.type === 'text').map((o) => `${o.weight || 700} 40px "${o.font}"`));
  await Promise.all([...wanted].map((f) => document.fonts.load(f).catch(() => {})));
}
