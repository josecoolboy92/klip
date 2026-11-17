// Bringing videos, photos and music into Klip Studio, with a thumbnail and length for each.
import { db, mediaUrl } from './db.js';
import { uid } from './util.js';

export const kindOf = (file) => file.type.startsWith('video/') ? 'video'
  : file.type.startsWith('image/') ? 'image'
  : file.type.startsWith('audio/') ? 'audio'
  : /\.(mp4|mov|m4v|webm|mkv|3gp)$/i.test(file.name) ? 'video'
  : /\.(jpe?g|png|webp|gif|heic)$/i.test(file.name) ? 'image'
  : /\.(mp3|m4a|aac|wav|ogg|opus|flac)$/i.test(file.name) ? 'audio' : '';

function loadVideo(url) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.onloadeddata = () => resolve(v);
    v.onerror = () => reject(new Error("This video can't be opened on this phone."));
    v.src = url;
  });
}

function seek(v, t) {
  return new Promise((resolve) => {
    const done = () => { v.removeEventListener('seeked', done); resolve(); };
    v.addEventListener('seeked', done);
    v.currentTime = t;
    setTimeout(done, 3000);
  });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("This photo can't be opened."));
    img.src = url;
  });
}

function thumbOf(source, w, h, max = 320) {
  const scale = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}

// Read a file's details and save it on the phone. Returns the media record.
export async function importFile(file, extra = {}) {
  const kind = kindOf(file);
  if (!kind) throw new Error(`"${file.name}" isn't a video, photo or music file.`);
  const media = { id: uid(), name: file.name.replace(/\.[^.]+$/, ''), kind, blob: file, size: file.size, added: Date.now(), ...extra };
  const url = mediaUrl(media);

  if (kind === 'video') {
    const v = await loadVideo(url);
    media.duration = v.duration;
    media.width = v.videoWidth;
    media.height = v.videoHeight;
    await seek(v, Math.min(1, v.duration * 0.1));
    media.thumb = thumbOf(v, v.videoWidth, v.videoHeight);
    v.removeAttribute('src');
    v.load();
  } else if (kind === 'image') {
    const img = await loadImage(url);
    media.width = img.naturalWidth;
    media.height = img.naturalHeight;
    media.duration = 0;
    media.thumb = thumbOf(img, img.naturalWidth, img.naturalHeight);
  } else {
    const a = new Audio();
    a.preload = 'metadata';
    await new Promise((resolve) => { a.onloadedmetadata = resolve; a.onerror = resolve; a.src = url; });
    media.duration = isFinite(a.duration) ? a.duration : 0;
  }
  await db.put('media', media);
  return media;
}

// Thumbnails along a clip, for the timeline (cached per media + time)
const stripCache = new Map();
export async function frameThumbs(media, times, height = 56) {
  if (media.kind === 'image') return times.map(() => media.thumb);
  const key = media.id + ':' + height;
  const cache = stripCache.get(key) || new Map();
  stripCache.set(key, cache);
  const missing = times.filter((t) => !cache.has(t.toFixed(1)));
  if (missing.length) {
    const v = await loadVideo(mediaUrl(media));
    for (const t of missing) {
      await seek(v, Math.min(t, Math.max(0, v.duration - 0.05)));
      const w = Math.round(height * (v.videoWidth / v.videoHeight || 16 / 9));
      cache.set(t.toFixed(1), thumbOf(v, v.videoWidth, v.videoHeight, Math.max(w, height) * 2));
    }
    v.removeAttribute('src');
    v.load();
  }
  return times.map((t) => cache.get(t.toFixed(1)));
}
