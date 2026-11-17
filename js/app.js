// Klip Studio — screens: Create (home), Library + player, 4K Enhance. The editor is in editor.js.
import { $, el, fmtTime, fmtBytes, toast, sheet, confirmBox, slider, pickFiles, downloadBlob, shareBlob, enterFullscreen, busy, uid, storage } from './util.js';
import { db, mediaUrl, forgetUrl, storageEstimate } from './db.js';
import { importFile } from './media.js';
import { FORMATS, newProject, layout } from './engine.js';
import { TEMPLATES, fromTemplate } from './templates.js';
import { sharedFX, ENHANCE_DEFAULT } from './fx.js';
import { enhanceVideo, enhanceStill, ENHANCE_TARGETS } from './export.js';
import { openEditor } from './editor.js';

/* ================================================================ navigation */

const screens = { home: $('#screen-home'), library: $('#screen-library'), enhance: $('#screen-enhance') };
let tab = 'home';
const overlays = []; // open full-screen layers (editor, viewer), newest last

function showTab(name) {
  tab = name;
  for (const [k, s] of Object.entries(screens)) s.hidden = k !== name;
  document.querySelectorAll('#tabs button').forEach((b) => {
    if (b.dataset.tab === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  history.replaceState(history.state, '', '#' + name);
  if (name === 'home') renderHome();
  if (name === 'library') renderLibrary();
  if (name === 'enhance') renderEnhance();
  window.scrollTo(0, 0);
}
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

// Full-screen layers (editor, viewer) are closed by the phone's back button
export function pushLayer(name, close) {
  overlays.push({ name, close });
  document.body.classList.add('fullscreen-screen');
  history.pushState({ layer: overlays.length }, '');
}
export function popLayer() { history.back(); }
window.addEventListener('popstate', () => {
  if (!$('#sheet').hidden) { $('#sheet .sheet-backdrop')?.click(); history.pushState({ layer: overlays.length }, ''); return; }
  if (!$('#busy').hidden) { history.pushState({ layer: overlays.length }, ''); return; } // don't leave during a long job
  const top = overlays.pop();
  if (top) top.close();
  if (!overlays.length) {
    document.body.classList.remove('fullscreen-screen');
    if (tab === 'home') renderHome();
    if (tab === 'library') renderLibrary();
  }
});

/* ================================================================ data */

async function allMedia() {
  return (await db.all('media')).sort((a, b) => b.added - a.added);
}
async function mediaMap() {
  return new Map((await db.all('media')).map((m) => [m.id, m]));
}

export async function importMany(files) {
  const added = [];
  for (const f of files) {
    try { added.push(await importFile(f)); } catch (e) { toast(e.message); }
  }
  if (added.length) toast(`Added ${added.length} file${added.length === 1 ? '' : 's'}`);
  return added;
}

// A video added by link only has a web address. Some tools need the file itself.
async function ensureBlob(m) {
  if (m.blob) return m;
  try {
    const res = await fetch(m.url);
    if (!res.ok) throw new Error();
    m.blob = await res.blob();
    m.size = m.blob.size;
    await db.put('media', m);
    return m;
  } catch {
    throw new Error("That website doesn't let apps download its video. Save the video to your phone first, then import it.");
  }
}

/* ================================================================ CREATE (home) */

async function renderHome() {
  $('#formats').replaceChildren(...Object.entries(FORMATS).map(([key, f]) => {
    const s = 46 / Math.max(f.w, f.h);
    return el('button', { class: 'format', type: 'button', role: 'listitem', onclick: () => startProject(newProject(key)) },
      el('div', { class: 'shape', style: { width: Math.round(f.w * s) + 'px', height: Math.round(f.h * s) + 'px' } }),
      el('b', {}, f.ratio), el('span', { class: 'muted' }, f.label));
  }));
  $('#templates').replaceChildren(...TEMPLATES.map((t) => el('button', { class: 'template', type: 'button', onclick: () => startProject(fromTemplate(t)) },
    el('div', { class: 'card', style: { background: t.card.bg, color: t.card.color, fontFamily: `"${t.card.font}"`, fontSize: '1.15rem', fontWeight: 700 } }, t.card.text),
    el('span', {}, t.name))));

  const projects = (await db.all('projects')).sort((a, b) => b.updated - a.updated);
  const grid = $('#projects');
  if (!projects.length) {
    grid.replaceChildren(el('p', { class: 'empty' }, 'Your designs will show up here. Pick a size or a template above to start.'));
    return;
  }
  grid.replaceChildren(...projects.map((p) => {
    const dur = layout(p).duration;
    return el('div', { class: 'tile' },
      el('button', { type: 'button', class: 'tile-open', style: { all: 'unset', display: 'block', width: '100%', cursor: 'pointer' }, onclick: () => openProject(p) },
        p.thumb ? el('img', { class: 'thumb', src: p.thumb, alt: '' }) : el('div', { class: 'thumb' }),
        el('div', { class: 'meta' }, el('div', { class: 'name' }, p.name),
          el('div', { class: 'sub' }, `${FORMATS[p.format]?.ratio || ''} · ${fmtTime(dur)} · ${new Date(p.updated).toLocaleDateString()}`))),
      el('button', { class: 'more', type: 'button', 'aria-label': 'More options', onclick: () => projectMenu(p) }, '⋯'));
  }));
}

async function startProject(p) {
  await db.put('projects', p);
  openProject(p);
}

async function openProject(p) {
  openEditor(p, await mediaMap(), { pushLayer, popLayer, importMany, askText });
}

function projectMenu(p) {
  const close = sheet(p.name, el('div', { class: 'menu' },
    el('button', { type: 'button', onclick: () => { close(); openProject(p); } }, el('span', { class: 'i' }, '✎'), 'Open'),
    el('button', { type: 'button', onclick: async () => { close(); const name = await askText('Rename design', p.name); if (name) { p.name = name; await db.put('projects', p); renderHome(); } } }, el('span', { class: 'i' }, 'Aa'), 'Rename'),
    el('button', { type: 'button', onclick: async () => { close(); const copy = { ...structuredClone(p), id: uid(), name: p.name + ' (copy)', updated: Date.now() }; await db.put('projects', copy); renderHome(); } }, el('span', { class: 'i' }, '⧉'), 'Duplicate'),
    el('button', { type: 'button', class: 'danger', onclick: async () => { close(); if (await confirmBox(`Delete "${p.name}"? Your videos stay in the Library.`, 'Delete')) { await db.del('projects', p.id); renderHome(); } } }, el('span', { class: 'i' }, '🗑'), 'Delete')));
}

export function askText(title, value = '', placeholder = '') {
  return new Promise((resolve) => {
    const input = el('input', { value, placeholder, maxlength: 120 });
    const done = (v) => { close(); resolve(v); };
    const close = sheet(title, el('form', { onsubmit: (e) => { e.preventDefault(); done(input.value.trim()); } },
      el('label', { class: 'field' }, input),
      el('div', { class: 'row end' },
        el('button', { class: 'btn', type: 'button', onclick: () => done('') }, 'Cancel'),
        el('button', { class: 'btn primary', type: 'submit' }, 'Save'))), { onClose: () => resolve('') });
    setTimeout(() => input.focus(), 50);
  });
}

/* ================================================================ LIBRARY */

let libFilter = 'all';
const FILTERS = { all: 'All', video: 'Videos', image: 'Photos', audio: 'Music', made: 'Made here' };

$('#lib-import').addEventListener('click', async () => {
  const files = await pickFiles('video/*,image/*,audio/*');
  if (files.length) { await importMany(files); renderLibrary(); }
});
$('#lib-link').addEventListener('click', async () => {
  const url = await askText('Add a video from a link', '', 'https://…/video.mp4');
  if (!url) return;
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new Error();
    const m = { id: uid(), kind: 'video', name: decodeURIComponent(u.pathname.split('/').pop() || u.hostname), url, blob: null, added: Date.now(), origin: 'link' };
    const v = document.createElement('video');
    v.preload = 'metadata';
    await new Promise((resolve, reject) => { v.onloadedmetadata = resolve; v.onerror = reject; v.src = url; });
    m.duration = v.duration; m.width = v.videoWidth; m.height = v.videoHeight;
    await db.put('media', m);
    toast('Video added');
    renderLibrary();
  } catch {
    toast("That link doesn't open as a video. It must be a direct link to a video file.");
  }
});

async function renderLibrary() {
  $('#lib-filters').replaceChildren(...Object.entries(FILTERS).map(([k, label]) => el('button', {
    type: 'button', 'aria-pressed': String(libFilter === k), onclick: () => { libFilter = k; renderLibrary(); },
  }, label)));
  const items = (await allMedia()).filter((m) => libFilter === 'all' || (libFilter === 'made' ? !!m.origin && m.origin !== 'link' : m.kind === libFilter));
  const grid = $('#lib-grid');
  if (!items.length) {
    grid.replaceChildren(el('p', { class: 'empty' }, libFilter === 'all'
      ? 'Tap "+ Import" to bring in videos, photos and music from your phone. They stay on this phone.'
      : 'Nothing here yet.'));
  } else {
    grid.replaceChildren(...items.map((m) => mediaTile(m, () => openMedia(m, items))));
  }
  const est = await storageEstimate();
  $('#lib-storage').textContent = est ? `Using ${fmtBytes(est.used)} of space on this phone` : '';
}

function mediaTile(m, onOpen) {
  return el('div', { class: 'tile' },
    el('button', { type: 'button', style: { all: 'unset', display: 'block', width: '100%', cursor: 'pointer' }, onclick: onOpen, 'aria-label': m.name },
      m.thumb ? el('img', { class: 'thumb', src: m.thumb, alt: '', loading: 'lazy' })
        : el('div', { class: 'thumb', style: { display: 'grid', placeItems: 'center', fontSize: '2rem' } }, m.kind === 'audio' ? '♫' : '▶'),
      m.duration ? el('span', { class: 'badge' }, fmtTime(m.duration)) : null,
      el('div', { class: 'meta' }, el('div', { class: 'name' }, m.name),
        el('div', { class: 'sub' }, [m.width ? `${m.width}×${m.height}` : m.kind === 'audio' ? 'Music' : '', m.origin === 'enhanced' ? '4K Enhanced' : m.origin === 'export' ? 'Made in editor' : m.origin === 'link' ? 'From link' : '', m.size ? fmtBytes(m.size) : ''].filter(Boolean).join(' · ')))),
    el('button', { class: 'more', type: 'button', 'aria-label': 'More options', onclick: () => mediaMenu(m) }, '⋯'));
}

function openMedia(m, list) {
  if (m.kind === 'video') openViewer(m, list.filter((x) => x.kind === 'video'));
  else if (m.kind === 'image') openPhoto(m);
  else openAudio(m);
}

function mediaMenu(m) {
  const item = (icon, label, fn, cls) => el('button', { type: 'button', class: cls, onclick: () => { close(); fn(); } }, el('span', { class: 'i' }, icon), label);
  const close = sheet(m.name, el('div', { class: 'menu' },
    m.kind === 'video' ? item('▶', 'Play', () => openMedia(m, [m])) : null,
    m.kind !== 'audio' ? item('✂', 'Edit in a new design', () => editMedia(m)) : null,
    m.kind === 'video' ? item('4K', 'Enhance to 4K', () => { enhancePick = m; showTab('enhance'); }) : null,
    m.blob ? item('↗', 'Share', async () => { if (!(await shareBlob(m.blob, fileName(m)))) toast("Sharing isn't available here. Use Save to phone."); }) : null,
    m.blob ? item('⤓', 'Save to phone', () => downloadBlob(m.blob, fileName(m))) : null,
    !m.blob && m.url ? item('⤓', 'Keep a copy in the app', async () => { try { await ensureBlob(m); toast('Saved in the app'); renderLibrary(); } catch (e) { toast(e.message); } }) : null,
    item('Aa', 'Rename', async () => { const n = await askText('Rename', m.name); if (n) { m.name = n; await db.put('media', m); renderLibrary(); } }),
    item('🗑', 'Delete', async () => { if (await confirmBox(`Delete "${m.name}" from Klip Studio? Designs that use it will show an empty spot.`, 'Delete')) { await db.del('media', m.id); forgetUrl(m.id); renderLibrary(); } }, 'danger')));
}

const fileName = (m) => m.name.replace(/[\\/:*?"<>|]+/g, '_') + (m.kind === 'video' ? '.mp4' : m.kind === 'image' ? '.' + ((m.blob && m.blob.type.split('/')[1]) || 'jpg') : '.' + ((m.blob && m.blob.type.split('/')[1]) || 'mp3'));

async function editMedia(m) {
  try { await ensureBlob(m); } catch (e) { toast(e.message); return; }
  const tall = (m.height || 1) > (m.width || 1);
  const p = newProject(tall ? 'story' : 'youtube', m.name);
  const { newClip } = await import('./engine.js');
  p.clips.push(newClip(m));
  await db.put('projects', p);
  openProject(p);
}

function openPhoto(m) {
  const img = el('img', { src: mediaUrl(m), alt: m.name, style: { maxWidth: '100%', maxHeight: '60dvh', display: 'block', margin: '0 auto', borderRadius: '12px' } });
  const close = sheet(m.name, [img, el('div', { class: 'row end', style: { marginTop: '12px' } },
    el('button', { class: 'btn', type: 'button', onclick: () => { close(); editMedia(m); } }, '✂ Edit'),
    el('button', { class: 'btn primary', type: 'button', onclick: () => downloadBlob(m.blob, fileName(m)) }, '⤓ Save'))]);
}

function openAudio(m) {
  sheet(m.name, el('audio', { src: mediaUrl(m), controls: true, autoplay: true, style: { width: '100%' } }));
}

/* ================================================================ VIEWER (player) */

const viewerPrefs = Object.assign({ speed: 1, loop: false, enhance: false }, storage.get('klip.viewer', {}));

function openViewer(m, list) {
  const host = $('#screen-viewer');
  let index = Math.max(0, list.findIndex((x) => x.id === m.id));
  const video = el('video', { playsinline: true, preload: 'auto', autoplay: true });
  const enh = el('canvas', { class: 'v-enh', hidden: true });
  const title = el('div', { class: 'v-title' });
  const seekBar = el('input', { type: 'range', class: 'v-seek', min: 0, max: 1000, value: 0, 'aria-label': 'Seek' });
  const time = el('span', { class: 'v-time' }, '0:00 / 0:00');
  const playBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Play or pause' }, '❚❚');
  const speedBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Speed', style: { width: '52px', fontSize: '.85rem' } }, viewerPrefs.speed + '×');
  const loopBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Repeat', 'aria-pressed': String(viewerPrefs.loop) }, '↻');
  const enhBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Live enhance', 'aria-pressed': String(viewerPrefs.enhance) }, '✨');
  const hint = el('div', { class: 'v-hint', hidden: true });
  const stage = el('div', { class: 'v-stage' }, video, enh, hint);

  const load = () => {
    const cur = list[index];
    title.textContent = cur.name;
    video.src = mediaUrl(cur);
    video.playbackRate = viewerPrefs.speed;
    video.loop = viewerPrefs.loop;
    video.play().catch(() => {});
  };

  // live enhance: sharper, cleaner picture drawn on the graphics chip
  let rafId = 0;
  const drawEnhanced = () => {
    if (!viewerPrefs.enhance || !video.videoWidth) return;
    const fx = sharedFX();
    const rect = stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const s = Math.min((rect.width * dpr) / video.videoWidth, (rect.height * dpr) / video.videoHeight, 2.5);
    const w = Math.max(2, Math.round(video.videoWidth * s));
    const h = Math.max(2, Math.round(video.videoHeight * s));
    try {
      const out = fx.render(video, video.videoWidth, video.videoHeight, w, h, ENHANCE_DEFAULT);
      if (enh.width !== w || enh.height !== h) { enh.width = w; enh.height = h; }
      enh.getContext('2d').drawImage(out, 0, 0);
    } catch { /* video from another website can't be enhanced */ }
  };
  const loop = () => {
    drawEnhanced();
    if (viewerPrefs.enhance) rafId = video.requestVideoFrameCallback ? video.requestVideoFrameCallback(loop) : requestAnimationFrame(loop);
  };
  const setEnhance = (on) => {
    viewerPrefs.enhance = on;
    storage.set('klip.viewer', viewerPrefs);
    enhBtn.setAttribute('aria-pressed', String(on));
    enh.hidden = !on;
    video.style.visibility = on ? 'hidden' : '';
    if (on) { loop(); flash('Enhanced ✨'); } else flash('Original');
  };

  const flash = (text) => {
    hint.textContent = text;
    hint.hidden = false;
    clearTimeout(flash.t);
    flash.t = setTimeout(() => { hint.hidden = true; }, 900);
  };

  // controls auto-hide while playing
  let hideT = 0;
  const showUI = () => {
    host.classList.remove('hide-ui');
    clearTimeout(hideT);
    hideT = setTimeout(() => { if (!video.paused) host.classList.add('hide-ui'); }, 3200);
  };

  // tap: show/hide controls · double tap left/right: back/forward 10 s
  let lastTap = 0;
  stage.addEventListener('click', (e) => {
    const now = Date.now();
    const rect = stage.getBoundingClientRect();
    if (now - lastTap < 300) {
      const fwd = e.clientX > rect.left + rect.width / 2;
      video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + (fwd ? 10 : -10)));
      flash(fwd ? '+10 s' : '−10 s');
      lastTap = 0;
      return;
    }
    lastTap = now;
    setTimeout(() => { if (lastTap === now) { if (host.classList.contains('hide-ui')) showUI(); else host.classList.add('hide-ui'); } }, 280);
  });

  video.addEventListener('timeupdate', () => {
    if (!seekBar.matches(':active')) seekBar.value = String(Math.round((video.currentTime / (video.duration || 1)) * 1000));
    time.textContent = `${fmtTime(video.currentTime)} / ${fmtTime(video.duration)}`;
  });
  video.addEventListener('play', () => { playBtn.textContent = '❚❚'; showUI(); if (viewerPrefs.enhance) loop(); });
  video.addEventListener('pause', () => { playBtn.textContent = '▶'; showUI(); drawEnhanced(); });
  video.addEventListener('seeked', drawEnhanced);
  video.addEventListener('loadeddata', () => { if (viewerPrefs.enhance) setEnhance(true); });
  video.addEventListener('ended', () => { if (!viewerPrefs.loop && index < list.length - 1) { index++; load(); } });
  video.addEventListener('error', () => toast("This video can't be played on this phone."));
  seekBar.addEventListener('input', () => { video.currentTime = (Number(seekBar.value) / 1000) * (video.duration || 0); showUI(); });
  playBtn.addEventListener('click', () => (video.paused ? video.play() : video.pause()));
  speedBtn.addEventListener('click', () => {
    const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
    viewerPrefs.speed = speeds[(speeds.indexOf(viewerPrefs.speed) + 1) % speeds.length];
    video.playbackRate = viewerPrefs.speed;
    speedBtn.textContent = viewerPrefs.speed + '×';
    storage.set('klip.viewer', viewerPrefs);
  });
  loopBtn.addEventListener('click', () => {
    viewerPrefs.loop = !viewerPrefs.loop;
    video.loop = viewerPrefs.loop;
    loopBtn.setAttribute('aria-pressed', String(viewerPrefs.loop));
    storage.set('klip.viewer', viewerPrefs);
    flash(viewerPrefs.loop ? 'Repeat on' : 'Repeat off');
  });
  enhBtn.addEventListener('click', () => setEnhance(!viewerPrefs.enhance));

  const onKey = (e) => {
    if (e.target.matches('input, textarea')) return;
    if (e.key === ' ') { e.preventDefault(); video.paused ? video.play() : video.pause(); }
    if (e.key === 'ArrowRight') video.currentTime += 5;
    if (e.key === 'ArrowLeft') video.currentTime -= 5;
    if (e.key === 'f') enterFullscreen(host);
  };
  document.addEventListener('keydown', onKey);

  const top = el('div', { class: 'v-top' },
    el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Back', onclick: popLayer }, '‹'),
    title,
    el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Cast to TV', onclick: () => castVideo(video, list[index]) }, '📺'),
    'pictureInPictureEnabled' in document && document.pictureInPictureEnabled
      ? el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Picture in picture', onclick: () => video.requestPictureInPicture().catch(() => toast("Picture-in-picture isn't available."))  }, '⧉') : null,
    el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'More', onclick: () => viewerMenu(video, list[index]) }, '⋯'));
  const bottom = el('div', { class: 'v-bottom' },
    seekBar,
    el('div', { class: 'v-row' },
      el('div', { class: 'row' },
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Previous video', onclick: () => { if (index > 0) { index--; load(); } } }, '⏮'),
        playBtn,
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Next video', onclick: () => { if (index < list.length - 1) { index++; load(); } } }, '⏭'),
        time),
      el('div', { class: 'row' }, speedBtn, loopBtn, enhBtn,
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'TV mode (full screen)', onclick: () => enterFullscreen(host) }, '⛶'))));

  host.replaceChildren(top, stage, bottom);
  host.hidden = false;
  host.classList.remove('hide-ui');
  load();
  pushLayer('viewer', () => {
    cancelAnimationFrame(rafId);
    document.removeEventListener('keydown', onKey);
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    host.hidden = true;
    host.replaceChildren();
  });
}

function viewerMenu(video, m) {
  const item = (icon, label, fn) => el('button', { type: 'button', onclick: () => { close(); fn(); } }, el('span', { class: 'i' }, icon), label);
  const close = sheet(m.name, el('div', { class: 'menu' },
    item('✂', 'Edit this video', () => { popLayer(); setTimeout(() => editMedia(m), 50); }),
    item('4K', 'Enhance to 4K', () => { enhancePick = m; popLayer(); setTimeout(() => showTab('enhance'), 50); }),
    item('📷', 'Save this frame as a photo', () => saveFrame(video, m)),
    item('CC', 'Add subtitles (.srt / .vtt)', () => addSubtitles(video)),
    item('⟳', 'Rotate the picture', () => { const r = ((Number(video.dataset.rot) || 0) + 90) % 360; video.dataset.rot = r; video.style.transform = `rotate(${r}deg)`; }),
    m.blob ? item('↗', 'Share', async () => { if (!(await shareBlob(m.blob, fileName(m)))) toast("Sharing isn't available here."); }) : null,
    item('ℹ', 'Details', () => sheet('Details', el('p', { class: 'muted' }, `${m.width}×${m.height} · ${fmtTime(m.duration)}${m.size ? ' · ' + fmtBytes(m.size) : ''}`)))));
}

async function saveFrame(video, m) {
  const c = el('canvas', { width: video.videoWidth, height: video.videoHeight });
  try {
    c.getContext('2d').drawImage(video, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
    const file = new File([blob], `${m.name} frame.jpg`, { type: 'image/jpeg' });
    await importFile(file, { origin: 'export' });
    toast('Frame saved to your Library');
  } catch {
    toast("This frame can't be saved.");
  }
}

async function addSubtitles(video) {
  const [file] = await pickFiles('.srt,.vtt', false);
  if (!file) return;
  let text = (await file.text()).replace(/\r/g, '');
  if (!/^WEBVTT/.test(text)) {
    text = 'WEBVTT\n\n' + text.replace(/(\d{1,2}:\d{2}:\d{2}),(\d{1,3})/g, (_m, t, ms) => `${t.padStart(8, '0')}.${ms.padEnd(3, '0')}`);
  }
  video.querySelectorAll('track').forEach((t) => t.remove());
  const track = el('track', { kind: 'subtitles', label: file.name, default: true, src: URL.createObjectURL(new Blob([text], { type: 'text/vtt' })) });
  video.append(track);
  track.addEventListener('load', () => { track.track.mode = 'showing'; });
  toast('Subtitles added');
}

/* ---- cast to TV ---- */

async function castVideo(video, m) {
  // 1) Chromecast / Google TV: the browser can send a video that has a web address
  if (video.remote && typeof video.remote.prompt === 'function' && /^https?:/.test(video.currentSrc)) {
    try { await video.remote.prompt(); return; } catch (e) { if (e.name === 'NotAllowedError') return; }
  }
  // 2) Videos stored on the phone: mirror the phone's screen to the TV
  const close = sheet('Watch on your TV', [
    el('p', { class: 'muted' }, 'Videos saved on your phone are shown on the TV by mirroring your screen:'),
    el('ol', { style: { paddingLeft: '20px', lineHeight: 1.6 } },
      el('li', {}, 'Make sure the TV and phone are on the same Wi-Fi.'),
      el('li', {}, 'Swipe down from the top of your phone and tap ', el('b', {}, 'Cast'), ', ', el('b', {}, 'Smart View'), ' or ', el('b', {}, 'Screen cast'), ' (the name depends on your phone).'),
      el('li', {}, 'Pick your TV, then come back here and tap ', el('b', {}, 'TV mode'), '.')),
    el('p', { class: 'muted tiny' }, video.remote ? 'Tip: videos added with "Add link" can be sent straight to a Chromecast or Google TV with this button.' : ''),
    el('button', { class: 'btn primary wide', type: 'button', onclick: () => { close(); enterFullscreen($('#screen-viewer')); video.play().catch(() => {}); } }, '⛶ Start TV mode'),
  ]);
}

/* ================================================================ 4K ENHANCE */

let enhancePick = null;
const enhanceState = Object.assign({ mode: 'fast', target: 2160, ...ENHANCE_DEFAULT }, storage.get('klip.enhance', {}));
const ENH_KEYS = ['sharpen', 'denoise', 'saturation', 'contrast', 'brightness'];

async function renderEnhance() {
  const body = $('#enhance-body');
  if (!enhancePick) {
    const videos = (await allMedia()).filter((m) => m.kind === 'video');
    body.replaceChildren(
      el('p', { class: 'muted' }, 'Make an existing video sharper, cleaner and bigger — up to 4K. Pick a video to start.'),
      el('div', { class: 'row', style: { margin: '10px 0 16px' } },
        el('button', { class: 'btn primary', type: 'button', onclick: async () => { const files = await pickFiles('video/*', false); const [m] = await importMany(files); if (m) { enhancePick = m; renderEnhance(); } } }, '+ Pick from phone')),
      videos.length ? el('h3', { class: 'section' }, 'Or from your Library') : null,
      el('div', { class: 'media-grid' }, videos.map((m) => mediaTile(m, () => { enhancePick = m; renderEnhance(); }))));
    return;
  }

  const m = enhancePick;
  try { await ensureBlob(m); } catch (e) { toast(e.message); enhancePick = null; renderEnhance(); return; }
  const before = el('canvas');
  const afterBox = el('div', { class: 'after' });
  const divider = el('div', { class: 'divider' });
  const compare = el('div', { class: 'compare' }, before, afterBox, divider,
    el('span', { class: 'lbl', style: { left: '8px' } }, 'Before'), el('span', { class: 'lbl', style: { right: '8px' } }, 'After'));
  const info = el('p', { class: 'muted tiny' });
  const status = el('p', { class: 'muted tiny' });

  // drag the divider to compare
  const setSplit = (clientX) => {
    const r = compare.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    afterBox.style.clipPath = `inset(0 0 0 ${f * 100}%)`;
    divider.style.left = f * 100 + '%';
  };
  compare.addEventListener('pointerdown', (e) => { compare.setPointerCapture(e.pointerId); setSplit(e.clientX); });
  compare.addEventListener('pointermove', (e) => { if (e.buttons) setSplit(e.clientX); });

  // a frame from the video for the preview
  const v = el('video', { muted: true, playsinline: true, preload: 'auto', src: mediaUrl(m) });
  const frameAt = el('input', { type: 'range', min: 0, max: 100, value: 30, 'aria-label': 'Preview moment' });
  let zoom = false;
  let timer = 0;
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!v.videoWidth) return;
      const vw = v.videoWidth;
      const vh = v.videoHeight;
      // the preview shows the middle of the picture at real size when zoomed
      const cw = zoom ? Math.round(vw / 3) : vw;
      const ch = zoom ? Math.round(vh / 3) : vh;
      const crop = el('canvas', { width: cw, height: ch });
      crop.getContext('2d').drawImage(v, (vw - cw) / 2, (vh - ch) / 2, cw, ch, 0, 0, cw, ch);
      const scale = enhanceState.target / Math.min(vw, vh);
      const shown = Math.min(1600, Math.round(cw * scale));
      before.width = shown;
      before.height = Math.round(shown * (ch / cw));
      const bctx = before.getContext('2d');
      bctx.imageSmoothingEnabled = false; // show the real pixels of the original
      bctx.drawImage(crop, 0, 0, before.width, before.height);
      status.textContent = enhanceState.mode === 'ai' ? 'Running the AI on this frame…' : '';
      try {
        const params = Object.fromEntries(ENH_KEYS.map((k) => [k, enhanceState[k]]));
        const out = await enhanceStill(crop, cw, ch, Math.min(cw, ch) * scale, params, enhanceState.mode);
        const a = el('canvas', { width: before.width, height: before.height });
        a.getContext('2d').drawImage(out, 0, 0, a.width, a.height);
        afterBox.replaceChildren(a);
        status.textContent = '';
      } catch (e) {
        status.textContent = e.message || "Couldn't make the preview.";
      }
    }, 120);
  };
  v.addEventListener('loadeddata', () => {
    v.currentTime = (Number(frameAt.value) / 100) * v.duration;
    const s = enhanceState.target / Math.min(v.videoWidth, v.videoHeight);
    info.textContent = `${v.videoWidth}×${v.videoHeight} → ${Math.round(v.videoWidth * s / 2) * 2}×${Math.round(v.videoHeight * s / 2) * 2} · ${fmtTime(v.duration)}`;
  });
  v.addEventListener('seeked', refresh);
  frameAt.addEventListener('input', () => { v.currentTime = (Number(frameAt.value) / 100) * (v.duration || 0); });

  const save = () => storage.set('klip.enhance', enhanceState);
  const seg = (options, key, after) => el('div', { class: 'seg', role: 'group' }, Object.entries(options).map(([val, label]) => el('button', {
    type: 'button', 'aria-pressed': String(String(enhanceState[key]) === val),
    onclick: (e) => {
      enhanceState[key] = isNaN(Number(val)) ? val : Number(val);
      save();
      e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
      if (after) after();
      const go = $('#enhance-go');
      if (go) go.textContent = `Enhance to ${ENHANCE_TARGETS[enhanceState.target]}`;
      refresh();
      v.dispatchEvent(new Event('loadeddata'));
    },
  }, label)));
  const sl = (label, key, min, max) => slider(label, enhanceState[key], min, max, 0.01, (val) => { enhanceState[key] = val; save(); refresh(); }, (x) => Math.round(x * 100));
  const aiNote = el('p', { class: 'muted tiny' });
  const updateAiNote = () => {
    aiNote.textContent = enhanceState.mode === 'ai'
      ? `AI Upscale adds real detail but is slow: roughly ${Math.max(1, Math.round((m.duration || 10) * 30 * 0.4 / 60))}+ minutes for this video on a fast phone. Best for short clips. The AI model (2 MB) downloads the first time.`
      : 'Fast Enhance sharpens, removes noise and boosts color while upscaling. It works on any phone.';
  };
  updateAiNote();

  body.replaceChildren(
    el('div', { class: 'picked' },
      m.thumb ? el('img', { src: m.thumb, alt: '' }) : null,
      el('div', { class: 'grow' }, el('b', {}, m.name), info),
      el('button', { class: 'btn small', type: 'button', onclick: () => { enhancePick = null; renderEnhance(); } }, 'Change')),
    el('div', { style: { marginTop: '12px' } }, compare),
    el('div', { class: 'row-between', style: { marginTop: '8px' } },
      el('label', { class: 'grow row', style: { fontSize: '.82rem', color: 'var(--muted)' } }, 'Moment ', frameAt),
      el('button', { class: 'btn small', type: 'button', onclick: (e) => { zoom = !zoom; e.currentTarget.textContent = zoom ? 'Whole picture' : 'Zoom in'; refresh(); } }, 'Zoom in')),
    status,
    el('div', { class: 'card-box' },
      el('h3', { style: { fontSize: '.95rem', marginBottom: '8px' } }, 'Mode'),
      seg({ fast: '⚡ Fast Enhance', ai: '🧠 AI Upscale' }, 'mode', updateAiNote),
      aiNote,
      el('h3', { style: { fontSize: '.95rem', margin: '12px 0 8px' } }, 'Size'),
      seg(ENHANCE_TARGETS, 'target'),
      el('h3', { style: { fontSize: '.95rem', margin: '14px 0 2px' } }, 'Fine-tune'),
      sl('Sharpness', 'sharpen', 0, 1.5), sl('Noise removal', 'denoise', 0, 1), sl('Color boost', 'saturation', -0.3, 0.6),
      sl('Contrast', 'contrast', -0.3, 0.4), sl('Brightness', 'brightness', -0.3, 0.3),
      el('button', { class: 'btn small', type: 'button', onclick: () => { Object.assign(enhanceState, ENHANCE_DEFAULT); save(); renderEnhance(); } }, 'Reset')),
    el('button', { id: 'enhance-go', class: 'btn primary wide', type: 'button', style: { marginTop: '16px', padding: '14px' }, onclick: () => runEnhance(m) }, `Enhance to ${ENHANCE_TARGETS[enhanceState.target]}`));
}

async function runEnhance(m) {
  const job = busy(enhanceState.mode === 'ai' ? 'AI upscaling your video' : 'Enhancing your video');
  try {
    const params = Object.fromEntries(ENH_KEYS.map((k) => [k, enhanceState[k]]));
    const { blob, width, height } = await enhanceVideo(m, { target: enhanceState.target, mode: enhanceState.mode, params, onProgress: job.update, signal: job.signal });
    job.update(1, 'Saving');
    const file = new File([blob], `${m.name} (${enhanceState.target === 2160 ? '4K' : enhanceState.target + 'p'}).mp4`, { type: 'video/mp4' });
    const made = await importFile(file, { origin: 'enhanced' });
    job.close();
    const close = sheet('Your enhanced video is ready', [
      el('p', { class: 'muted' }, `${width}×${height} · ${fmtBytes(blob.size)} · saved in your Library.`),
      el('div', { class: 'menu' },
        el('button', { type: 'button', onclick: () => { close(); openViewer(made, [made]); } }, el('span', { class: 'i' }, '▶'), 'Play it'),
        el('button', { type: 'button', onclick: async () => { if (!(await shareBlob(blob, file.name))) toast("Sharing isn't available here."); } }, el('span', { class: 'i' }, '↗'), 'Share'),
        el('button', { type: 'button', onclick: () => downloadBlob(blob, file.name) }, el('span', { class: 'i' }, '⤓'), 'Save to phone')),
    ]);
  } catch (e) {
    job.close();
    if (e.name === 'AbortError') toast('Cancelled');
    else sheet("Couldn't enhance this video", el('p', { class: 'muted' }, e.message || String(e)));
  }
}

/* ================================================================ start */

history.replaceState({ layer: 0 }, '');
const start = location.hash.slice(1);
showTab(['home', 'library', 'enhance'].includes(start) ? start : 'home');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// Videos shared to Klip Studio from other apps (Android "Share" menu) wait in a cache
(async () => {
  if (!('caches' in window)) return;
  const cache = await caches.open('klip-shared');
  const keys = await cache.keys();
  if (!keys.length) return;
  const files = [];
  for (const k of keys) {
    const res = await cache.match(k);
    const blob = await res.blob();
    files.push(new File([blob], decodeURIComponent(res.headers.get('x-name') || 'Shared video.mp4'), { type: blob.type }));
    await cache.delete(k);
  }
  await importMany(files);
  showTab('library');
})().catch(() => {});

// Open videos with Klip Studio from the phone's file manager (when installed)
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (params) => {
    const files = await Promise.all((params.files || []).map((h) => h.getFile()));
    if (files.length) { await importMany(files); showTab('library'); }
  });
}
