// The video editor: preview, timeline, tools, undo/redo, autosave and export.
// Phone-first, like CapCut / Canva on mobile.
import { $, el, fmtTime, fmtBytes, toast, sheet, confirmBox, slider, pickFiles, downloadBlob, shareBlob, enterFullscreen, busy, clamp } from './util.js';
import { db, mediaUrl } from './db.js';
import { importFile, frameThumbs } from './media.js';
import {
  FORMATS, FONTS, TRANSITIONS, TEXT_ANIMS, Preview, layout, clipLength, newClip, colorClip, newText, newSticker, loadFonts,
} from './engine.js';
import { FILTERS, ADJUSTMENTS, ENHANCE_DEFAULT, sharedFX, effectParams } from './fx.js';
import { exportProject, RESOLUTIONS, outputSize } from './export.js';

const COLORS = ['#ffffff', '#000000', '#f43f5e', '#f97316', '#facc15', '#22c55e', '#22d3ee', '#3b82f6', '#8b5cf6', '#ec4899', '#a16207', '#14532d', '#1e1b4b', '#0f172a', '#fde68a', '#fecaca'];
const STICKERS = {
  'Faces': '😀 😂 🥹 😍 😎 🤩 🥳 😮 😭 😡 🤔 🙌 👏 👍 🙏 💪'.split(' '),
  'Love & fun': '❤️ 💛 💚 💙 💜 🔥 ✨ ⭐ 🌟 💯 🎉 🎊 🎁 🎂 🎵 📸'.split(' '),
  'Ethiopia': '🇪🇹 🌼 ☕ 🦁 🌄 🕊️ ⛪ 🕌 🥁 🌾 🍲 🏔️'.split(' '),
  'Arrows & signs': '👉 👈 👆 👇 ➡️ ⬅️ ⬆️ ⬇️ ✅ ❌ ⚠️ ❓ ❗ 🆕 🆓 🔴'.split(' '),
  'Nature & travel': '☀️ 🌙 🌈 🌊 🌸 🌴 🍀 ✈️ 🚗 🏠 🌍 ⛰️ 🐾 🦋 🌻 🍃'.split(' '),
};
const TEXT_STYLES = [
  { label: 'Heading', props: { font: 'Poppins', weight: 900, size: 0.075, text: 'Add a heading' } },
  { label: 'Subheading', props: { font: 'Poppins', weight: 600, size: 0.045, text: 'Add a subheading' } },
  { label: 'Body', props: { font: 'Inter', weight: 400, size: 0.032, text: 'Add some text', anim: 'fade' } },
  { label: 'Caption box', props: { font: 'Inter', weight: 600, size: 0.035, bg: 'rgba(0,0,0,0.6)', shadow: false, y: 0.82, text: 'Your caption', anim: 'slide' } },
  { label: 'Outline', props: { font: 'Bebas Neue', weight: 400, size: 0.11, stroke: '#000000', color: '#facc15', text: 'WOW!' } },
  { label: 'Neon', props: { font: 'Pacifico', weight: 400, size: 0.07, color: '#f0abfc', stroke: '#7e22ce', text: 'Glow' } },
  { label: 'Label', props: { font: 'Oswald', weight: 700, size: 0.045, bg: '#facc15', color: '#111111', shadow: false, text: 'NEW' } },
  { label: 'Amharic', props: { font: 'Noto Serif Ethiopic', weight: 700, size: 0.06, color: '#fde047', text: 'ሰላም' } },
];

export function openEditor(project, mediaMap, opts) {
  const host = $('#screen-editor');
  const S = {
    project, media: mediaMap, sel: null, pps: 60, // pixels per second on the timeline
    undo: [], redo: [], lastKey: '', lastTime: 0, saveT: 0, scrolling: false, closed: false,
  };

  /* ------------------------------------------------ layout */
  const canvas = el('canvas', { 'aria-label': 'Preview' });
  const selBox = el('div', { class: 'sel', hidden: true });
  const stage = el('div', { class: 'e-stage' }, canvas, selBox);
  const nameBtn = el('button', { class: 'e-name', type: 'button', 'aria-label': 'Rename design' });
  const undoBtn = el('button', { class: 'icon-btn ghost', type: 'button', 'aria-label': 'Undo' }, '↶');
  const redoBtn = el('button', { class: 'icon-btn ghost', type: 'button', 'aria-label': 'Redo' }, '↷');
  const top = el('div', { class: 'e-top' },
    el('button', { class: 'icon-btn ghost', type: 'button', 'aria-label': 'Back', onclick: () => opts.popLayer() }, '‹'),
    nameBtn, undoBtn, redoBtn,
    el('button', { class: 'btn small primary', type: 'button', onclick: () => exportPanel() }, 'Export'));
  const playBtn = el('button', { class: 'e-play', type: 'button', 'aria-label': 'Play' }, '▶');
  const timeLbl = el('span', { class: 'e-time' }, '0:00.0 / 0:00.0');
  const transport = el('div', { class: 'e-transport' },
    playBtn, timeLbl,
    el('button', { class: 'icon-btn ghost', type: 'button', 'aria-label': 'Zoom timeline out', onclick: () => zoomTimeline(0.7) }, '－'),
    el('button', { class: 'icon-btn ghost', type: 'button', 'aria-label': 'Zoom timeline in', onclick: () => zoomTimeline(1.4) }, '＋'),
    el('button', { class: 'icon-btn ghost', type: 'button', 'aria-label': 'Full screen preview', onclick: () => enterFullscreen(canvas, S.project.w > S.project.h) }, '⛶'));
  const tlInner = el('div', { class: 'tl-inner' });
  const timeline = el('div', { class: 'timeline' }, tlInner);
  const tlWrap = el('div', { style: { position: 'relative' } }, timeline, el('div', { class: 'tl-head' }));
  const tools = el('div', { class: 'e-tools', role: 'toolbar', 'aria-label': 'Tools' });
  host.replaceChildren(top, stage, transport, tlWrap, tools);
  host.hidden = false;

  const preview = new Preview(canvas, S.media);
  preview.onTime = (t) => { updateTime(t); if (preview.playing) scrollToTime(t); placeSelBox(); };
  preview.onEnd = () => { playBtn.textContent = '▶'; };

  /* ------------------------------------------------ project changes, undo, autosave */
  const snapshot = () => JSON.stringify(S.project);
  function commit(key = '') {
    const now = Date.now();
    // slider moves within a short time count as one step for undo
    if (!(key && key === S.lastKey && now - S.lastTime < 800)) {
      S.undo.push(S.before);
      if (S.undo.length > 80) S.undo.shift();
      S.redo = [];
    }
    S.lastKey = key;
    S.lastTime = now;
    S.before = snapshot();
    refresh();
    scheduleSave();
  }
  function refresh() {
    preview.setProject(S.project);
    renderTimeline();
    renderTools();
    undoBtn.disabled = !S.undo.length;
    redoBtn.disabled = !S.redo.length;
    nameBtn.textContent = S.project.name;
    updateTime(preview.time);
    placeSelBox();
  }
  undoBtn.addEventListener('click', () => {
    if (!S.undo.length) return;
    S.redo.push(snapshot());
    S.project = JSON.parse(S.undo.pop());
    S.before = snapshot();
    S.lastKey = '';
    validateSel();
    refresh();
    scheduleSave();
  });
  redoBtn.addEventListener('click', () => {
    if (!S.redo.length) return;
    S.undo.push(snapshot());
    S.project = JSON.parse(S.redo.pop());
    S.before = snapshot();
    S.lastKey = '';
    validateSel();
    refresh();
    scheduleSave();
  });
  function scheduleSave() {
    clearTimeout(S.saveT);
    S.saveT = setTimeout(save, 700);
  }
  async function save() {
    clearTimeout(S.saveT);
    S.project.updated = Date.now();
    try {
      const c = el('canvas', { width: 320, height: Math.round(320 * (S.project.h / S.project.w)) });
      c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
      S.project.thumb = c.toDataURL('image/jpeg', 0.6);
    } catch { /* keep the old picture */ }
    await db.put('projects', S.project);
  }
  nameBtn.addEventListener('click', async () => {
    const name = await opts.askText('Rename design', S.project.name);
    if (name) { S.project.name = name; commit(); }
  });

  /* ------------------------------------------------ selection */
  const selected = () => {
    if (!S.sel) return null;
    if (S.sel.type === 'clip') return S.project.clips.find((c) => c.id === S.sel.id) || null;
    if (S.sel.type === 'overlay') return S.project.overlays.find((o) => o.id === S.sel.id) || null;
    if (S.sel.type === 'music') return S.project.music;
    return null;
  };
  function select(type, id) {
    S.sel = type ? { type, id } : null;
    renderTimeline();
    renderTools();
    placeSelBox();
  }
  function validateSel() { if (S.sel && !selected()) S.sel = null; }

  /* ------------------------------------------------ preview canvas size */
  function sizeCanvas() {
    const maxSide = 720 * Math.min(2, window.devicePixelRatio || 1) / 1.5;
    const s = maxSide / Math.max(S.project.w, S.project.h);
    canvas.width = Math.round(S.project.w * s);
    canvas.height = Math.round(S.project.h * s);
    preview.render();
  }

  /* ------------------------------------------------ play / time */
  playBtn.addEventListener('click', togglePlay);
  function togglePlay() {
    if (preview.playing) { preview.pause(); playBtn.textContent = '▶'; } else { preview.play(); playBtn.textContent = '❚❚'; }
  }
  function updateTime(t) {
    timeLbl.textContent = `${fmtTime(t, true)} / ${fmtTime(layout(S.project).duration, true)}`;
  }
  const pad = () => timeline.clientWidth / 2;
  function scrollToTime(t) {
    S.scrolling = true;
    timeline.scrollLeft = t * S.pps;
    requestAnimationFrame(() => { S.scrolling = false; });
  }
  timeline.addEventListener('scroll', () => {
    if (S.scrolling || preview.playing) return;
    preview.seek(timeline.scrollLeft / S.pps);
  });
  function zoomTimeline(f) {
    const t = preview.time;
    S.pps = clamp(S.pps * f, 12, 400);
    renderTimeline();
    scrollToTime(t);
  }

  /* ------------------------------------------------ timeline */
  const stripCache = new Map();
  function renderTimeline() {
    const lay = layout(S.project);
    const P = pad();
    const width = lay.duration * S.pps;
    tlInner.style.width = width + P * 2 + 80 + 'px';
    const parts = [];

    // ruler
    const step = S.pps > 120 ? 1 : S.pps > 40 ? 2 : S.pps > 20 ? 5 : 10;
    const ruler = el('div', { class: 'tl-ruler' });
    for (let s = 0; s <= lay.duration + step; s += step) ruler.append(el('span', { style: { left: P + s * S.pps + 'px' } }, fmtTime(s)));
    parts.push(ruler);

    // video track
    const vt = el('div', { class: 'tl-track tl-video', style: { width: tlInner.style.width } });
    lay.items.forEach((it) => {
      const c = it.clip;
      const isSel = S.sel && S.sel.type === 'clip' && S.sel.id === c.id;
      const m = S.media.get(c.mediaId);
      const block = el('div', {
        class: 'tl-clip' + (isSel ? ' sel' : ''),
        style: { left: P + it.start * S.pps + 'px', width: Math.max(8, it.len * S.pps - 2) + 'px', background: c.kind === 'color' ? c.color : '' },
        onclick: (e) => { e.stopPropagation(); select('clip', c.id); },
      }, el('span', { class: 'lbl' }, `${c.kind === 'video' ? '▶' : c.kind === 'image' ? '▣' : '■'} ${fmtTime(it.len, true)}${c.speed !== 1 ? ' · ' + c.speed + '×' : ''}`));
      if (m && c.kind !== 'color') stripFor(c, m, it.len * S.pps).then((url) => { if (url) block.style.backgroundImage = `url(${url})`; });
      else if (!m && c.kind !== 'color') block.append(el('span', { class: 'lbl' }, 'Missing file'));
      if (isSel) {
        block.append(handle('l', (dt) => trimClip(c, 'start', dt)), handle('r', (dt) => trimClip(c, 'end', dt)));
      }
      vt.append(block);
    });
    // transition buttons between clips
    lay.items.slice(0, -1).forEach((it) => {
      const on = it.clip.transition.type !== 'none';
      vt.append(el('button', {
        class: 'tl-trans' + (on ? ' on' : ''), type: 'button', 'aria-label': 'Transition',
        style: { left: P + (it.end - it.transOut / 2) * S.pps + 'px' },
        onclick: (e) => { e.stopPropagation(); select('clip', it.clip.id); transitionPanel(it.clip); },
      }, on ? '⇄' : '+'));
    });
    vt.append(el('button', {
      class: 'tl-add', type: 'button', 'aria-label': 'Add media', style: { left: P + (lay.items.length ? lay.items[lay.items.length - 1].end : 0) * S.pps + 6 + 'px' },
      onclick: (e) => { e.stopPropagation(); addMediaPanel(); },
    }, '+'));
    parts.push(vt);

    // text & sticker track
    const tt = el('div', { class: 'tl-track tl-text', style: { width: tlInner.style.width } });
    for (const o of S.project.overlays) {
      const isSel = S.sel && S.sel.type === 'overlay' && S.sel.id === o.id;
      const b = el('div', {
        class: 'tl-ov' + (o.type === 'sticker' ? ' sticker' : '') + (isSel ? ' sel' : ''),
        style: { left: P + o.start * S.pps + 'px', width: Math.max(14, (o.end - o.start) * S.pps) + 'px' },
        onclick: (e) => { e.stopPropagation(); select('overlay', o.id); },
      }, (o.type === 'sticker' ? '' : 'T  ') + o.text.split('\n')[0]);
      if (isSel) {
        dragBody(b, (dt) => { const len = o.end - o.start; o.start = clamp(o.start + dt, 0, 3600); o.end = o.start + len; });
        b.append(handle('l', (dt) => { o.start = clamp(o.start + dt, 0, o.end - 0.2); }), handle('r', (dt) => { o.end = Math.max(o.start + 0.2, o.end + dt); }));
      }
      tt.append(b);
    }
    parts.push(tt);

    // music track
    const at = el('div', { class: 'tl-track tl-audio', style: { width: tlInner.style.width } });
    const mus = S.project.music;
    if (mus) {
      const m = S.media.get(mus.mediaId);
      const isSel = S.sel && S.sel.type === 'music';
      at.append(el('div', {
        class: 'tl-music' + (isSel ? ' sel' : ''), style: { left: P + 'px', width: Math.max(20, lay.duration * S.pps) + 'px' },
        onclick: (e) => { e.stopPropagation(); select('music', 'music'); },
      }, '♫ ' + (m ? m.name : 'Missing music')));
    } else {
      at.append(el('button', { class: 'tl-music', type: 'button', style: { left: P + 'px', background: 'transparent', border: '2px dashed var(--line)', color: 'var(--muted)' }, onclick: (e) => { e.stopPropagation(); musicPanel(); } }, '+ Add music'));
    }
    parts.push(at);
    tlInner.replaceChildren(...parts);
  }
  tlInner.addEventListener('click', () => select(null));

  // a draggable trim handle; reports the change in seconds
  function handle(side, onDelta) {
    const h = el('div', { class: 'handle ' + side, 'aria-label': side === 'l' ? 'Trim start' : 'Trim end' }, side === 'l' ? '‹' : '›');
    let lastX = 0;
    h.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      h.setPointerCapture(e.pointerId);
      lastX = e.clientX;
      S.dragBefore = snapshot();
    });
    h.addEventListener('pointermove', (e) => {
      if (!h.hasPointerCapture(e.pointerId)) return;
      const dx = e.clientX - lastX;
      if (Math.abs(dx) < 1) return;
      lastX = e.clientX;
      onDelta(dx / S.pps);
      preview.setProject(S.project);
      updateTime(preview.time);
      // live redraw of just the blocks (cheap enough)
      renderTimeline();
    });
    h.addEventListener('pointerup', (e) => {
      if (!h.hasPointerCapture(e.pointerId)) return;
      h.releasePointerCapture(e.pointerId);
      S.before = S.dragBefore;
      commit();
    });
    h.addEventListener('click', (e) => e.stopPropagation());
    return h;
  }
  function dragBody(node, onDelta) {
    let lastX = 0;
    let moved = false;
    node.style.touchAction = 'none';
    node.addEventListener('pointerdown', (e) => {
      if (e.target.classList.contains('handle')) return;
      node.setPointerCapture(e.pointerId);
      lastX = e.clientX;
      moved = false;
      S.dragBefore = snapshot();
    });
    node.addEventListener('pointermove', (e) => {
      if (!node.hasPointerCapture(e.pointerId)) return;
      const dx = e.clientX - lastX;
      if (Math.abs(dx) < 2) return;
      moved = true;
      lastX = e.clientX;
      onDelta(dx / S.pps);
      node.style.left = pad() + selected().start * S.pps + 'px';
      preview.setProject(S.project);
    });
    node.addEventListener('pointerup', (e) => {
      if (!node.hasPointerCapture(e.pointerId)) return;
      node.releasePointerCapture(e.pointerId);
      if (moved) { S.before = S.dragBefore; commit(); }
    });
  }

  function trimClip(c, edge, dt) {
    const m = S.media.get(c.mediaId);
    if (c.kind === 'video') {
      const ds = dt * (c.speed || 1);
      if (edge === 'start') c.in = clamp(c.in + ds, 0, c.out - 0.2);
      else c.out = clamp(c.out + ds, c.in + 0.2, m ? m.duration : c.out);
    } else {
      c.duration = clamp(c.duration + (edge === 'start' ? -dt : dt), 0.3, 600);
    }
  }

  // thumbnail strip for a clip on the timeline
  async function stripFor(c, m, widthPx) {
    const n = clamp(Math.round(widthPx / 50), 1, 12);
    const key = `${c.id}|${c.in.toFixed(2)}|${c.out.toFixed(2)}|${n}`;
    if (stripCache.has(key)) return stripCache.get(key);
    let urls;
    if (c.kind === 'image') urls = Array(n).fill(m.thumb);
    else {
      const times = Array.from({ length: n }, (_, i) => c.in + ((c.out - c.in) * (i + 0.5)) / n);
      urls = await frameThumbs(m, times, 56).catch(() => [m.thumb]);
    }
    const imgs = await Promise.all(urls.map((u) => new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => resolve(null); i.src = u; })));
    const h = 56;
    const cell = Math.round(widthPx / n) || 50;
    const cv = el('canvas', { width: Math.max(1, Math.round(cell * n)), height: h });
    const g = cv.getContext('2d');
    imgs.forEach((im, i) => {
      if (!im) return;
      const s = Math.max(cell / im.width, h / im.height);
      g.drawImage(im, i * cell + (cell - im.width * s) / 2, (h - im.height * s) / 2, im.width * s, im.height * s);
    });
    const url = cv.toDataURL('image/jpeg', 0.6);
    stripCache.set(key, url);
    return url;
  }

  /* ------------------------------------------------ dragging and pinching on the preview */
  const pointers = new Map();
  let gesture = null;
  const toCanvas = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height, r };
  };
  let lastTapAt = 0;
  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      const p = toCanvas(e);
      const hit = [...preview.comp.boxes].reverse().find((b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
      const now = Date.now();
      if (hit) {
        if (S.sel && S.sel.id === hit.id && now - lastTapAt < 350) { textPanel(selected()); return; }
        if (!S.sel || S.sel.id !== hit.id) select('overlay', hit.id);
      }
      lastTapAt = now;
      const target = selected();
      gesture = target && (S.sel.type === 'overlay' || S.sel.type === 'clip') ? { type: S.sel.type, target, start: { ...target }, p0: p, before: snapshot(), moved: false } : null;
    } else if (pointers.size === 2 && gesture) {
      const [a, b] = [...pointers.values()];
      gesture.dist0 = Math.hypot(a.x - b.x, a.y - b.y);
      gesture.start = { ...gesture.target };
    }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!gesture) return;
    const t = gesture.target;
    if (pointers.size === 2 && gesture.dist0) {
      const [a, b] = [...pointers.values()];
      const f = Math.hypot(a.x - b.x, a.y - b.y) / gesture.dist0;
      if (gesture.type === 'overlay') t.size = clamp(gesture.start.size * f, 0.015, 0.6);
      else t.scale = clamp((gesture.start.scale || 1) * f, 0.2, 5);
      gesture.moved = true;
    } else if (pointers.size === 1) {
      const p = toCanvas(e);
      const dx = (p.x - gesture.p0.x) / canvas.width;
      const dy = (p.y - gesture.p0.y) / canvas.height;
      if (Math.abs(dx) + Math.abs(dy) < 0.004 && !gesture.moved) return;
      gesture.moved = true;
      if (gesture.type === 'overlay') { t.x = clamp(gesture.start.x + dx, 0, 1); t.y = clamp(gesture.start.y + dy, 0, 1); }
      else { t.x = clamp((gesture.start.x || 0) + dx, -1, 1); t.y = clamp((gesture.start.y || 0) + dy, -1, 1); }
    }
    preview.render();
    placeSelBox();
  });
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      if (gesture && gesture.moved) { S.before = gesture.before; commit(); }
      gesture = null;
    }
  };
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);

  function placeSelBox() {
    const o = S.sel && S.sel.type === 'overlay' ? selected() : null;
    const box = o && preview.comp.boxes.find((b) => b.id === o.id);
    if (!box) { selBox.hidden = true; return; }
    const r = canvas.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    const k = r.width / canvas.width;
    Object.assign(selBox.style, { left: r.left - sr.left + box.x * k + 'px', top: r.top - sr.top + box.y * k + 'px', width: box.w * k + 'px', height: box.h * k + 'px' });
    selBox.hidden = false;
  }

  /* ------------------------------------------------ tool bar */
  function tool(icon, label, fn) {
    return el('button', { type: 'button', onclick: fn }, el('span', {}, icon), label);
  }
  function renderTools() {
    const s = selected();
    let list;
    if (!s) {
      list = [
        tool('＋', 'Media', addMediaPanel), tool('T', 'Text', addTextPanel), tool('☺', 'Stickers', stickerPanel),
        tool('♫', 'Music', musicPanel), tool('▭', 'Size', formatPanel), tool('◐', 'Background', backgroundPanel),
        tool('✨', 'Enhance all', enhanceAll), tool('⤓', 'Export', exportPanel),
      ];
    } else if (S.sel.type === 'clip') {
      const c = s;
      list = [el('span', { class: 'ctx-label' }, c.kind === 'video' ? 'VIDEO' : c.kind === 'image' ? 'PHOTO' : 'COLOR')];
      if (c.kind !== 'color') list.push(tool('✂', 'Split', () => splitClip(c)));
      if (c.kind === 'video') list.push(tool('⏩', 'Speed', () => speedPanel(c)), tool('🔊', 'Volume', () => volumePanel(c)));
      if (c.kind !== 'video') list.push(tool('⏱', 'Duration', () => durationPanel(c)));
      if (c.kind === 'color') list.push(tool('🎨', 'Color', () => colorPanel(c)));
      if (c.kind !== 'color') {
        list.push(tool('◑', 'Filters', () => filterPanel(c)), tool('☀', 'Adjust', () => adjustPanel(c)), tool('✨', 'Enhance', () => enhanceClip(c)),
          tool('⤢', 'Position', () => positionPanel(c)));
      }
      list.push(tool('◐', 'Fade', () => fadePanel(c)), tool('⇄', 'Transition', () => transitionPanel(c)),
        tool('◀', 'Move left', () => moveClip(c, -1)), tool('▶', 'Move right', () => moveClip(c, 1)),
        tool('⧉', 'Copy', () => duplicateClip(c)), tool('🗑', 'Delete', () => deleteSel()));
    } else if (S.sel.type === 'overlay') {
      const o = s;
      list = [el('span', { class: 'ctx-label' }, o.type === 'sticker' ? 'STICKER' : 'TEXT'),
        tool('✎', 'Edit', () => textPanel(o))];
      if (o.type === 'text') list.push(tool('Aa', 'Font', () => fontPanel(o)), tool('🎨', 'Color', () => textColorPanel(o)), tool('▤', 'Style', () => textStylePanel(o)));
      list.push(tool('↕', 'Size', () => sizePanel(o)), tool('✦', 'Animate', () => animPanel(o)), tool('⏱', 'Timing', () => timingPanel(o)),
        tool('⧉', 'Copy', () => { const copy = { ...structuredClone(o), id: crypto.randomUUID(), y: clamp(o.y + 0.06, 0, 1) }; S.project.overlays.push(copy); S.sel = { type: 'overlay', id: copy.id }; commit(); }),
        tool('🗑', 'Delete', () => deleteSel()));
    } else {
      list = [el('span', { class: 'ctx-label' }, 'MUSIC'), tool('🔊', 'Volume', () => musicSettings()), tool('↻', 'Replace', () => musicPanel()), tool('🗑', 'Remove', () => deleteSel())];
    }
    tools.replaceChildren(...list);
  }

  /* ------------------------------------------------ clip actions */
  function itemOf(c) { return layout(S.project).items.find((it) => it.clip.id === c.id); }
  function splitClip(c) {
    const it = itemOf(c);
    const t = preview.time;
    if (!it || t <= it.start + 0.1 || t >= it.end - 0.1) { toast('Move the white line inside the clip to split it.'); return; }
    const i = S.project.clips.indexOf(c);
    const second = { ...structuredClone(c), id: crypto.randomUUID() };
    if (c.kind === 'video') {
      const st = c.in + (t - it.start) * (c.speed || 1);
      c.out = st;
      second.in = st;
    } else {
      const first = t - it.start;
      second.duration = c.duration - first;
      c.duration = first;
    }
    second.fadeIn = 0;
    c.fadeOut = 0;
    c.transition = { type: 'none', dur: 0.6 };
    S.project.clips.splice(i + 1, 0, second);
    S.sel = { type: 'clip', id: second.id };
    commit();
    toast('Split');
  }
  function moveClip(c, dir) {
    const i = S.project.clips.indexOf(c);
    const j = i + dir;
    if (j < 0 || j >= S.project.clips.length) return;
    const list = S.project.clips;
    [list[i], list[j]] = [list[j], list[i]];
    commit();
  }
  function duplicateClip(c) {
    const i = S.project.clips.indexOf(c);
    const copy = { ...structuredClone(c), id: crypto.randomUUID() };
    S.project.clips.splice(i + 1, 0, copy);
    S.sel = { type: 'clip', id: copy.id };
    commit();
  }
  async function deleteSel() {
    if (!S.sel) return;
    if (S.sel.type === 'clip') S.project.clips = S.project.clips.filter((c) => c.id !== S.sel.id);
    else if (S.sel.type === 'overlay') S.project.overlays = S.project.overlays.filter((o) => o.id !== S.sel.id);
    else S.project.music = null;
    S.sel = null;
    commit();
  }
  function enhanceClip(c) {
    c.adjust = { ...ENHANCE_DEFAULT };
    commit();
    toast('Enhanced: sharper, cleaner, more color. Fine-tune it in Adjust.');
  }
  function enhanceAll() {
    if (!S.project.clips.some((c) => c.kind !== 'color')) { toast('Add a video or photo first.'); return; }
    for (const c of S.project.clips) if (c.kind !== 'color') c.adjust = { ...(c.adjust || {}), ...ENHANCE_DEFAULT };
    commit();
    toast('Every clip enhanced. Export in 4K for the sharpest result.');
  }

  /* ------------------------------------------------ panels (bottom sheets) */
  const live = (key, fn) => (v) => { fn(v); commit(key); };

  async function addMediaPanel() {
    const all = [...S.media.values()].filter((m) => m.kind === 'video' || m.kind === 'image').sort((a, b) => b.added - a.added);
    const chosen = new Set();
    const grid = el('div', { class: 'pick-grid' }, all.map((m) => el('button', {
      type: 'button', 'aria-pressed': 'false',
      onclick: (e) => {
        if (chosen.has(m)) chosen.delete(m); else chosen.add(m);
        e.currentTarget.setAttribute('aria-pressed', String(chosen.has(m)));
        addBtn.textContent = chosen.size ? `Add ${chosen.size}` : 'Add';
      },
    }, m.thumb ? el('img', { src: m.thumb, alt: '' }) : el('span', {}, '▶'), el('span', {}, (m.kind === 'video' ? fmtTime(m.duration) : 'Photo')))));
    const addBtn = el('button', { class: 'btn primary', type: 'button', onclick: () => { close(); insertMedia([...chosen]); } }, 'Add');
    const close = sheet('Add videos and photos', [
      el('div', { class: 'row', style: { marginBottom: '12px' } },
        el('button', { class: 'btn primary', type: 'button', onclick: async () => {
          const files = await pickFiles('video/*,image/*');
          if (!files.length) return;
          close();
          const added = [];
          for (const f of files) { try { const m = await importFile(f); S.media.set(m.id, m); added.push(m); } catch (e) { toast(e.message); } }
          insertMedia(added);
        } }, '+ From phone'),
        el('button', { class: 'btn', type: 'button', onclick: () => { close(); insertClip(colorClip(S.project.background.color === '#000000' ? '#1e1b4b' : S.project.background.color)); } }, '■ Color card')),
      all.length ? el('p', { class: 'muted tiny' }, 'Or pick from your Library:') : null,
      grid,
      all.length ? el('div', { class: 'row end', style: { marginTop: '12px' } }, addBtn) : null,
    ]);
  }
  function insertMedia(list) {
    if (!list.length) return;
    const clips = list.map((m) => {
      const c = newClip(m);
      if (S.project.slideshow && m.kind === 'image') { c.transition = { type: 'fade', dur: 0.8 }; c.duration = 3.5; }
      return c;
    });
    // new media goes after the selected clip (or at the end)
    const sel = S.sel && S.sel.type === 'clip' ? S.project.clips.findIndex((c) => c.id === S.sel.id) : -1;
    const at = sel >= 0 ? sel + 1 : S.project.clips.length;
    S.project.clips.splice(at, 0, ...clips);
    S.sel = { type: 'clip', id: clips[clips.length - 1].id };
    commit();
    toast(`Added ${clips.length}`);
  }
  function insertClip(c) {
    const sel = S.sel && S.sel.type === 'clip' ? S.project.clips.findIndex((x) => x.id === S.sel.id) : -1;
    S.project.clips.splice(sel >= 0 ? sel + 1 : S.project.clips.length, 0, c);
    S.sel = { type: 'clip', id: c.id };
    commit();
  }

  function addTextPanel() {
    const close = sheet('Add text', el('div', { class: 'pick-grid' }, TEXT_STYLES.map((st) => el('button', {
      type: 'button',
      onclick: async () => {
        close();
        const o = newText(preview.time, structuredClone(st.props));
        o.end = Math.min(o.start + 3, Math.max(o.start + 1, layout(S.project).duration > o.start + 0.5 ? layout(S.project).duration : o.start + 3));
        if (o.end - o.start < 1) o.end = o.start + 3;
        S.project.overlays.push(o);
        S.sel = { type: 'overlay', id: o.id };
        await loadFonts(S.project);
        commit();
        textPanel(o);
      },
    }, el('span', { style: { fontFamily: `"${st.props.font}"`, fontWeight: st.props.weight, fontSize: '1.2rem', color: st.props.color || '#fff', background: st.props.bg || 'none', padding: '2px 6px', borderRadius: '6px', WebkitTextStroke: st.props.stroke ? '1px ' + st.props.stroke : '' } }, st.label === 'Amharic' ? 'ሰላም' : 'Aa'), st.label))));
  }
  function textPanel(o) {
    const ta = el('textarea', { rows: 3, 'aria-label': 'Text' }, o.text);
    ta.addEventListener('input', () => { o.text = ta.value || ' '; commit('text:' + o.id); });
    sheet(o.type === 'sticker' ? 'Edit sticker' : 'Edit text', [
      el('label', { class: 'field' }, o.type === 'sticker' ? 'Emoji or text' : 'Type your text (press Enter for a new line)', ta),
      el('p', { class: 'muted tiny' }, 'Drag the text on the video to move it. Pinch with two fingers to resize.'),
    ]);
    setTimeout(() => ta.focus(), 80);
  }
  function fontPanel(o) {
    sheet('Font', el('div', { class: 'menu' }, FONTS.map((f) => el('button', {
      type: 'button', style: { fontFamily: `"${f}"`, fontSize: '1.15rem', background: o.font === f ? 'var(--panel-2)' : '' },
      onclick: async (e) => {
        o.font = f;
        await document.fonts.load(`${o.weight || 700} 40px "${f}"`).catch(() => {});
        commit();
        e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => { b.style.background = b === e.currentTarget ? 'var(--panel-2)' : ''; });
      },
    }, f.includes('Ethiopic') ? `${f} · ሰላም` : f))));
  }
  function swatches(current, onPick, allowNone = false) {
    const box = el('div', { class: 'swatches' });
    const all = allowNone ? ['', ...COLORS] : COLORS;
    for (const c of all) {
      box.append(el('button', {
        type: 'button', 'aria-label': c || 'None', 'aria-pressed': String(current === c),
        style: { background: c || 'repeating-conic-gradient(#555 0 25%, #222 0 50%) 50% / 10px 10px' },
        onclick: (e) => { onPick(c); box.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); },
      }));
    }
    const custom = el('input', { type: 'color', value: current && current.startsWith('#') ? current : '#ffffff', 'aria-label': 'Any color', style: { width: '40px', height: '34px', border: 0, background: 'none', padding: 0 } });
    custom.addEventListener('input', () => onPick(custom.value));
    box.append(custom);
    return box;
  }
  function textColorPanel(o) {
    sheet('Color', [
      el('p', { class: 'muted tiny' }, 'Text'), swatches(o.color, (c) => { o.color = c; commit('color'); }),
      el('p', { class: 'muted tiny' }, 'Box behind the text'), swatches(o.bg, (c) => { o.bg = c; commit('bg'); }, true),
      el('p', { class: 'muted tiny' }, 'Outline'), swatches(o.stroke, (c) => { o.stroke = c; commit('stroke'); }, true),
    ]);
  }
  function textStylePanel(o) {
    const seg = (options, get, set) => el('div', { class: 'seg', style: { margin: '8px 0' } }, options.map(([v, label]) => el('button', {
      type: 'button', 'aria-pressed': String(get() === v),
      onclick: (e) => { set(v); commit(); e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); },
    }, label)));
    sheet('Style', [
      el('p', { class: 'muted tiny' }, 'Alignment'),
      seg([['left', 'Left'], ['center', 'Center'], ['right', 'Right']], () => o.align, (v) => { o.align = v; }),
      el('p', { class: 'muted tiny' }, 'Thickness'),
      seg([[400, 'Regular'], [700, 'Bold'], [900, 'Black']], () => o.weight, (v) => { o.weight = v; }),
      el('p', { class: 'muted tiny' }, 'Shadow'),
      seg([[true, 'On'], [false, 'Off']], () => !!o.shadow, (v) => { o.shadow = v; }),
      slider('Rotate', o.rotation || 0, -45, 45, 1, live('rot', (v) => { o.rotation = v; }), (v) => v + '°'),
    ]);
  }
  function sizePanel(o) {
    sheet('Size', [
      slider('Size', o.size, 0.015, 0.4, 0.001, live('size', (v) => { o.size = v; }), (v) => Math.round(v * 1000)),
      el('p', { class: 'muted tiny' }, 'You can also pinch with two fingers on the video.'),
    ]);
  }
  function animPanel(o) {
    sheet('Animation', el('div', { class: 'pick-grid' }, Object.entries(TEXT_ANIMS).map(([k, label]) => el('button', {
      type: 'button', 'aria-pressed': String(o.anim === k),
      onclick: (e) => {
        o.anim = k;
        commit();
        e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
        preview.seek(o.start);
        preview.play();
        playBtn.textContent = '❚❚';
      },
    }, label))));
  }
  function timingPanel(o) {
    const dur = layout(S.project).duration;
    sheet('When it shows', [
      slider('Starts at', o.start, 0, Math.max(dur, o.end), 0.1, live('start', (v) => { o.start = Math.min(v, o.end - 0.2); }), (v) => fmtTime(v, true)),
      slider('Ends at', o.end, 0.2, Math.max(dur, o.end) + 5, 0.1, live('end', (v) => { o.end = Math.max(v, o.start + 0.2); }), (v) => fmtTime(v, true)),
      el('div', { class: 'row', style: { marginTop: '8px' } },
        el('button', { class: 'btn small', type: 'button', onclick: () => { o.start = 0; o.end = Math.max(1, dur); commit(); } }, 'Whole video'),
        el('button', { class: 'btn small', type: 'button', onclick: () => { o.start = preview.time; if (o.end <= o.start) o.end = o.start + 3; commit(); } }, 'Start here')),
    ]);
  }

  function stickerPanel() {
    sheet('Stickers', Object.entries(STICKERS).map(([group, list]) => [
      el('p', { class: 'muted tiny', style: { margin: '12px 0 6px' } }, group),
      el('div', { class: 'emoji-grid' }, list.map((emo) => el('button', {
        type: 'button', 'aria-label': emo,
        onclick: () => {
          const s = newSticker(emo, preview.time);
          S.project.overlays.push(s);
          S.sel = { type: 'overlay', id: s.id };
          commit();
          toast('Drag the sticker to place it');
        },
      }, emo))),
    ]));
  }

  async function musicPanel() {
    const songs = [...S.media.values()].filter((m) => m.kind === 'audio');
    const use = (m) => {
      S.project.music = { mediaId: m.id, start: 0, volume: 0.8, fadeIn: 1, fadeOut: 2 };
      S.sel = { type: 'music', id: 'music' };
      commit();
      close();
      toast('Music added');
    };
    const close = sheet('Music', [
      el('button', { class: 'btn primary', type: 'button', onclick: async () => {
        const [f] = await pickFiles('audio/*', false);
        if (!f) return;
        try { const m = await importFile(f); S.media.set(m.id, m); use(m); } catch (e) { toast(e.message); }
      } }, '+ Music from phone'),
      songs.length ? el('p', { class: 'muted tiny', style: { marginTop: '12px' } }, 'From your Library:') : null,
      el('div', { class: 'menu' }, songs.map((m) => el('button', { type: 'button', onclick: () => use(m) }, el('span', { class: 'i' }, '♫'), `${m.name} · ${fmtTime(m.duration)}`))),
      el('p', { class: 'muted tiny' }, 'Only use music you have the right to use, especially if you post the video online.'),
    ]);
  }
  function musicSettings() {
    const m = S.project.music;
    if (!m) return;
    const src = S.media.get(m.mediaId);
    sheet('Music', [
      slider('Volume', m.volume, 0, 1.5, 0.01, live('mvol', (v) => { m.volume = v; }), (v) => Math.round(v * 100) + '%'),
      slider('Start from', m.start || 0, 0, Math.max(0, (src && src.duration) || 0), 0.5, live('mstart', (v) => { m.start = v; }), (v) => fmtTime(v)),
      slider('Fade in', m.fadeIn, 0, 5, 0.1, live('mfi', (v) => { m.fadeIn = v; }), (v) => v.toFixed(1) + 's'),
      slider('Fade out', m.fadeOut, 0, 8, 0.1, live('mfo', (v) => { m.fadeOut = v; }), (v) => v.toFixed(1) + 's'),
      el('button', { class: 'btn small', type: 'button', onclick: () => { S.project.clips.forEach((c) => { c.muted = true; }); commit(); toast('Original sound of all clips muted'); } }, 'Mute the videos’ own sound'),
    ]);
  }

  function speedPanel(c) {
    const m = S.media.get(c.mediaId);
    sheet('Speed', [
      el('div', { class: 'chips' }, [0.25, 0.5, 1, 1.5, 2, 3, 4].map((v) => el('button', {
        type: 'button', 'aria-pressed': String(c.speed === v),
        onclick: (e) => { c.speed = v; commit(); e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); },
      }, v + '×'))),
      slider('Custom', c.speed, 0.1, 8, 0.05, live('speed', (v) => { c.speed = v; }), (v) => v.toFixed(2) + '×'),
      el('p', { class: 'muted tiny' }, `New length: ${fmtTime(clipLength(c), true)}${m ? '' : ''}. Sound pitch changes with speed.`),
    ]);
  }
  function volumePanel(c) {
    sheet('Volume', [
      slider('Volume', c.volume, 0, 2, 0.01, live('vol', (v) => { c.volume = v; }), (v) => Math.round(v * 100) + '%'),
      el('div', { class: 'seg', style: { marginTop: '8px' } },
        el('button', { type: 'button', 'aria-pressed': String(!c.muted), onclick: (e) => { c.muted = false; commit(); e.currentTarget.nextSibling.setAttribute('aria-pressed', 'false'); e.currentTarget.setAttribute('aria-pressed', 'true'); } }, 'Sound on'),
        el('button', { type: 'button', 'aria-pressed': String(!!c.muted), onclick: (e) => { c.muted = true; commit(); e.currentTarget.previousSibling.setAttribute('aria-pressed', 'false'); e.currentTarget.setAttribute('aria-pressed', 'true'); } }, 'Mute')),
    ]);
  }
  function durationPanel(c) {
    sheet('How long it shows', [
      slider('Duration', c.duration, 0.5, 30, 0.1, live('dur', (v) => { c.duration = v; }), (v) => v.toFixed(1) + 's'),
      c.kind === 'image' ? el('label', { class: 'row', style: { marginTop: '10px' } },
        el('input', { type: 'checkbox', checked: c.kenBurns, onchange: (e) => { c.kenBurns = e.target.checked; commit(); } }), 'Slow zoom (Ken Burns)') : null,
    ]);
  }
  function colorPanel(c) {
    sheet('Color card', swatches(c.color, (col) => { c.color = col; commit('ccolor'); }));
  }

  function filterPanel(c) {
    const m = S.media.get(c.mediaId);
    const grid = el('div', { class: 'pick-grid' });
    // small previews of each filter on this clip's picture
    const base = new Image();
    base.src = m ? m.thumb : '';
    const build = () => {
      grid.replaceChildren(...Object.entries(FILTERS).map(([key, f]) => {
        const cv = el('canvas', { width: 128, height: 128 });
        try {
          if (base.naturalWidth) {
            const fx = sharedFX();
            const out = fx.render(base, base.naturalWidth, base.naturalHeight, 128, 128, effectParams(key, {}));
            cv.getContext('2d').drawImage(out, 0, 0);
          }
        } catch { /* preview not available */ }
        return el('button', {
          type: 'button', 'aria-pressed': String(c.filter === key),
          onclick: (e) => { c.filter = key; commit(); grid.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); },
        }, cv, f.label);
      }));
    };
    if (base.complete) build(); else base.onload = build;
    build();
    sheet('Filters', [grid, el('button', { class: 'btn small', type: 'button', style: { marginTop: '10px' }, onclick: () => { for (const x of S.project.clips) if (x.kind !== 'color') x.filter = c.filter; commit(); toast('Filter applied to every clip'); } }, 'Use on all clips')]);
  }
  function adjustPanel(c) {
    c.adjust = c.adjust || {};
    const ranges = { sharpen: [0, 1.5], denoise: [0, 1], vignette: [0, 1], grain: [0, 1], fade: [0, 1], hue: [-0.5, 0.5] };
    sheet('Adjust', [
      ADJUSTMENTS.map(([key, label]) => {
        const [min, max] = ranges[key] || [-1, 1];
        return slider(label, c.adjust[key] || 0, min, max, 0.01, live('adj:' + key, (v) => { c.adjust[key] = v; }), (v) => Math.round(v * 100));
      }),
      el('div', { class: 'row', style: { marginTop: '8px' } },
        el('button', { class: 'btn small', type: 'button', onclick: () => { c.adjust = {}; commit(); toast('Adjustments reset'); } }, 'Reset'),
        el('button', { class: 'btn small', type: 'button', onclick: () => { for (const x of S.project.clips) if (x.kind !== 'color') x.adjust = { ...c.adjust }; commit(); toast('Copied to every clip'); } }, 'Use on all clips')),
    ]);
  }
  function positionPanel(c) {
    const seg = (options, get, set) => el('div', { class: 'seg', style: { margin: '8px 0' } }, options.map(([v, label]) => el('button', {
      type: 'button', 'aria-pressed': String(get() === v),
      onclick: (e) => { set(v); commit(); e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); },
    }, label)));
    sheet('Position', [
      el('p', { class: 'muted tiny' }, 'Fit: show the whole picture · Fill: cover the whole frame'),
      seg([['fit', 'Fit'], ['fill', 'Fill']], () => c.fit, (v) => { c.fit = v; c.scale = 1; c.x = 0; c.y = 0; }),
      slider('Zoom', c.scale || 1, 0.3, 4, 0.01, live('scale', (v) => { c.scale = v; }), (v) => Math.round(v * 100) + '%'),
      el('div', { class: 'row', style: { marginTop: '6px' } },
        el('button', { class: 'btn small', type: 'button', onclick: () => { c.rotate = ((c.rotate || 0) + 90) % 360; commit(); } }, '⟳ Rotate'),
        el('button', { class: 'btn small', type: 'button', onclick: () => { c.flip = !c.flip; commit(); } }, '⇋ Mirror'),
        el('button', { class: 'btn small', type: 'button', onclick: () => { c.x = 0; c.y = 0; c.scale = 1; commit(); } }, 'Center')),
      el('p', { class: 'muted tiny' }, 'Tip: drag the video on the preview to move it, pinch to zoom.'),
    ]);
  }
  function fadePanel(c) {
    sheet('Fade', [
      slider('Fade in', c.fadeIn, 0, 3, 0.1, live('fi', (v) => { c.fadeIn = v; }), (v) => v.toFixed(1) + 's'),
      slider('Fade out', c.fadeOut, 0, 3, 0.1, live('fo', (v) => { c.fadeOut = v; }), (v) => v.toFixed(1) + 's'),
    ]);
  }
  function transitionPanel(c) {
    const i = S.project.clips.indexOf(c);
    if (i >= S.project.clips.length - 1) { toast('Transitions go between two clips. Add another clip after this one.'); return; }
    sheet('Transition to the next clip', [
      el('div', { class: 'pick-grid' }, Object.entries(TRANSITIONS).map(([k, label]) => el('button', {
        type: 'button', 'aria-pressed': String(c.transition.type === k),
        onclick: (e) => {
          c.transition.type = k;
          commit();
          e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
          const it = itemOf(c);
          if (it && k !== 'none') { preview.seek(Math.max(0, it.end - it.transOut - 0.6)); preview.play(); playBtn.textContent = '❚❚'; }
        },
      }, label))),
      slider('Length', c.transition.dur, 0.2, 2, 0.05, live('tdur', (v) => { c.transition.dur = v; }), (v) => v.toFixed(2) + 's'),
      el('button', { class: 'btn small', type: 'button', style: { marginTop: '6px' }, onclick: () => { S.project.clips.slice(0, -1).forEach((x) => { x.transition = { ...c.transition }; }); commit(); toast('Used between every clip'); } }, 'Use between all clips'),
    ]);
  }

  function setFormat(key, doCommit = true) {
    const f = FORMATS[key];
    S.project.format = key;
    S.project.w = f.w;
    S.project.h = f.h;
    sizeCanvas();
    if (doCommit) commit();
  }
  function formatPanel() {
    sheet('Size', el('div', { class: 'menu' }, Object.entries(FORMATS).map(([k, f]) => el('button', {
      type: 'button', style: { background: S.project.format === k ? 'var(--panel-2)' : '' },
      onclick: (e) => { setFormat(k); e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => { b.style.background = b === e.currentTarget ? 'var(--panel-2)' : ''; }); },
    }, el('span', { class: 'i' }, f.ratio), f.label))));
  }
  function backgroundPanel() {
    const bg = S.project.background;
    const seg = el('div', { class: 'seg', style: { margin: '8px 0' } },
      el('button', { type: 'button', 'aria-pressed': String(bg.type === 'blur'), onclick: (e) => { bg.type = 'blur'; commit(); mark(e); } }, 'Blurred video'),
      el('button', { type: 'button', 'aria-pressed': String(bg.type === 'color'), onclick: (e) => { bg.type = 'color'; commit(); mark(e); } }, 'Plain color'));
    const mark = (e) => seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
    sheet('Background', [
      el('p', { class: 'muted tiny' }, 'What fills the empty space around a video that doesn’t fill the frame'),
      seg, swatches(bg.color, (c) => { bg.color = c; commit('bgc'); }),
    ]);
  }

  /* ------------------------------------------------ export */
  function exportPanel() {
    if (preview.playing) togglePlay();
    const lay = layout(S.project);
    if (!S.project.clips.length && !S.project.overlays.length) { toast('Add something to your design first.'); return; }
    const st = { res: 1080, fps: 30 };
    const info = el('p', { class: 'muted tiny' });
    const upd = () => {
      const { width, height } = outputSize(S.project, st.res);
      const mb = (width * height * st.fps * 0.12 * lay.duration) / 8 / 1e6;
      info.textContent = `${width}×${height} · ${st.fps} fps · ${fmtTime(lay.duration)} · about ${fmtBytes(mb * 1e6)}`;
    };
    const seg = (options, key) => el('div', { class: 'seg', style: { margin: '8px 0 12px' } }, Object.entries(options).map(([v, label]) => el('button', {
      type: 'button', 'aria-pressed': String(String(st[key]) === v),
      onclick: (e) => { st[key] = Number(v); upd(); e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); },
    }, label)));
    upd();
    const close = sheet('Export video', [
      el('p', { class: 'muted tiny' }, 'Quality'),
      seg({ 720: '720p', 1080: '1080p', 1440: '2K', 2160: '4K' }, 'res'),
      el('p', { class: 'muted tiny' }, 'Smoothness'),
      seg({ 24: '24 fps', 30: '30 fps', 60: '60 fps' }, 'fps'),
      info,
      el('p', { class: 'muted tiny' }, '4K takes longer and makes a bigger file. Turn on Enhance (✨) for the sharpest 4K result.'),
      el('button', { class: 'btn primary wide', type: 'button', style: { padding: '14px' }, onclick: () => { close(); runExport(st); } }, 'Export MP4'),
    ]);
  }
  async function runExport(st) {
    await save();
    const job = busy(`Exporting in ${RESOLUTIONS[st.res] || st.res + 'p'}`);
    try {
      const blob = await exportProject(S.project, S.media, { shortSide: st.res, fps: st.fps, onProgress: job.update, signal: job.signal });
      job.update(1, 'Saving to your Library');
      const name = `${S.project.name} ${st.res === 2160 ? '4K' : st.res + 'p'}.mp4`;
      const file = new File([blob], name, { type: 'video/mp4' });
      const made = await importFile(file, { origin: 'export' });
      S.media.set(made.id, made);
      job.close();
      const close = sheet('Your video is ready 🎉', [
        el('video', { src: mediaUrl(made), controls: true, playsinline: true, style: { width: '100%', maxHeight: '40dvh', borderRadius: '12px', background: '#000' } }),
        el('p', { class: 'muted tiny' }, `${fmtBytes(blob.size)} · saved in your Library`),
        el('div', { class: 'menu' },
          el('button', { type: 'button', onclick: async () => { if (!(await shareBlob(blob, name))) toast("Sharing isn't available here. Use Save to phone."); } }, el('span', { class: 'i' }, '↗'), 'Share (WhatsApp, Telegram, TikTok…)'),
          el('button', { type: 'button', onclick: () => downloadBlob(blob, name) }, el('span', { class: 'i' }, '⤓'), 'Save to phone'),
          el('button', { type: 'button', onclick: () => close() }, el('span', { class: 'i' }, '✎'), 'Keep editing')),
      ]);
    } catch (e) {
      job.close();
      if (e.name === 'AbortError') toast('Export cancelled');
      else sheet("Couldn't export", [el('p', { class: 'muted' }, e.message || String(e)), el('p', { class: 'muted tiny' }, 'Try a lower quality, or close other apps and try again.')]);
    }
  }

  /* ------------------------------------------------ keyboard (for computers) */
  const onKey = (e) => {
    if (e.target.matches('input, textarea, select') || !$('#sheet').hidden) return;
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); (e.shiftKey ? redoBtn : undoBtn).click(); }
    if (e.key === 'Delete' || e.key === 'Backspace') { if (S.sel) { e.preventDefault(); deleteSel(); } }
    if (e.key.toLowerCase() === 's' && S.sel && S.sel.type === 'clip') splitClip(selected());
  };
  document.addEventListener('keydown', onKey);
  const onResize = () => { renderTimeline(); scrollToTime(preview.time); placeSelBox(); };
  window.addEventListener('resize', onResize);

  /* ------------------------------------------------ start */
  S.before = snapshot();
  sizeCanvas();
  loadFonts(S.project).then(() => preview.render());
  refresh();
  scrollToTime(0);
  opts.pushLayer('editor', async () => {
    S.closed = true;
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    preview.destroy();
    await save();
    host.hidden = true;
    host.replaceChildren();
  });
  // a new design from a template or size: offer to add media right away
  if (!S.project.clips.some((c) => c.kind !== 'color') && !S.project.overlays.length) setTimeout(addMediaPanel, 250);
  else if (S.project.template && !S.project.clips.some((c) => c.kind !== 'color')) setTimeout(() => toast('Tap ＋ Media to add your videos and photos'), 400);
}
