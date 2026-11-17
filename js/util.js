// Small shared helpers used everywhere in Klip Studio.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Build an element: el('p', {class: 'x', onclick: fn}, 'text', childEl)
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === '') continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const even = (n) => Math.max(2, Math.round(n / 2) * 2);

export function fmtTime(sec, withTenths = false) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const t = withTenths ? '.' + Math.floor((sec * 10) % 10) : '';
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0') + t;
}

export function fmtBytes(n) {
  if (n > 1e9) return (n / 1e9).toFixed(1) + ' GB';
  if (n > 1e6) return (n / 1e6).toFixed(1) + ' MB';
  return Math.max(1, Math.round(n / 1e3)) + ' KB';
}

export const storage = {
  get(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
  },
};

/* ---- toast messages ---- */
let toastTimer = 0;
export function toast(message, ms = 2600) {
  const t = $('#toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

/* ---- bottom sheet: a panel that slides up (used for menus and settings) ---- */
export function sheet(title, content, { onClose } = {}) {
  const host = $('#sheet');
  const close = () => {
    host.hidden = true;
    host.replaceChildren();
    if (onClose) onClose();
  };
  host.replaceChildren(
    el('div', { class: 'sheet-backdrop', onclick: close }),
    el('div', { class: 'sheet-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      el('div', { class: 'sheet-head' },
        el('h3', {}, title),
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: close }, '✕')),
      el('div', { class: 'sheet-body' }, content)));
  host.hidden = false;
  return close;
}

// Ask a yes/no question inside the app (the built-in confirm() is blocked in some places)
export function confirmBox(question, yesLabel = 'Yes') {
  return new Promise((resolve) => {
    const close = sheet('Are you sure?', [
      el('p', { class: 'muted' }, question),
      el('div', { class: 'row end' },
        el('button', { class: 'btn', type: 'button', onclick: () => { close(); resolve(false); } }, 'Cancel'),
        el('button', { class: 'btn danger', type: 'button', onclick: () => { close(); resolve(true); } }, yesLabel)),
    ], { onClose: () => resolve(false) });
  });
}

// A labelled slider row
export function slider(label, value, min, max, step, onInput, format = (v) => v) {
  const out = el('span', { class: 'slider-val' }, format(value));
  const input = el('input', { type: 'range', min, max, step, value, 'aria-label': label });
  input.addEventListener('input', () => { out.textContent = format(Number(input.value)); onInput(Number(input.value)); });
  return el('label', { class: 'slider' }, el('span', { class: 'slider-label' }, label), input, out);
}

// Pick files from the phone
export function pickFiles(accept, multiple = true) {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept, multiple, hidden: true });
    document.body.append(input);
    input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
    input.addEventListener('cancel', () => { resolve([]); input.remove(); });
    input.click();
  });
}

// Download a blob as a file
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Share a file with other apps (WhatsApp, Telegram, Gallery…) when the phone supports it
export async function shareBlob(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return true; } catch { return false; }
  }
  return false;
}

// Full screen, turning the phone sideways where allowed
export async function enterFullscreen(element, landscape = true) {
  try {
    if (element.requestFullscreen) await element.requestFullscreen({ navigationUI: 'hide' });
    else if (element.webkitRequestFullscreen) element.webkitRequestFullscreen();
    else if (element.webkitEnterFullscreen) element.webkitEnterFullscreen();
    if (landscape && screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape').catch(() => {});
  } catch { /* not allowed here */ }
}
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && screen.orientation && screen.orientation.unlock) {
    try { screen.orientation.unlock(); } catch { /* ignore */ }
  }
});

// A full-screen progress box with a Cancel button, for long jobs (export, 4K enhance)
export function busy(title) {
  const host = $('#busy');
  const controller = new AbortController();
  const bar = el('span');
  const text = el('p', { class: 'muted tiny' }, 'Starting…');
  const pct = el('b', {}, '0%');
  host.replaceChildren(el('div', { class: 'busy-box', role: 'alertdialog', 'aria-label': title },
    el('h3', {}, title),
    el('p', { class: 'muted tiny' }, 'Keep this screen open until it finishes.'),
    el('div', { class: 'bar' }, bar),
    el('div', { class: 'row-between' }, text, pct),
    el('button', { class: 'btn wide', type: 'button', style: { marginTop: '14px' }, onclick: () => controller.abort() }, 'Cancel')));
  host.hidden = false;
  let wakeLock = null;
  if (navigator.wakeLock) navigator.wakeLock.request('screen').then((w) => { wakeLock = w; }).catch(() => {});
  return {
    signal: controller.signal,
    update(p, message) {
      const v = Math.round(clamp(p, 0, 1) * 100);
      bar.style.width = v + '%';
      pct.textContent = v + '%';
      if (message) text.textContent = message;
    },
    close() {
      host.hidden = true;
      host.replaceChildren();
      if (wakeLock) wakeLock.release().catch(() => {});
    },
  };
}
