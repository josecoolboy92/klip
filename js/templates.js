// Ready-made starting designs (like Canva templates). Add your own videos and photos to them.
import { newProject, newText, newSticker, colorClip } from './engine.js';

export const TEMPLATES = [
  {
    id: 'intro', name: 'Bold intro', format: 'youtube', card: { bg: '#1e1b4b', color: '#fff', font: 'Bebas Neue', text: 'YOUR TITLE' },
    build(p) {
      p.clips.push({ ...colorClip('#1e1b4b', 4), fadeOut: 0.5 });
      p.overlays.push(newText(0.2, { text: 'YOUR TITLE', font: 'Bebas Neue', weight: 400, size: 0.2, y: 0.45, anim: 'pop', end: 4 }));
      p.overlays.push(newText(0.8, { text: 'Subscribe for more', font: 'Poppins', weight: 400, size: 0.05, y: 0.65, color: '#c4b5fd', anim: 'fade', end: 4 }));
    },
  },
  {
    id: 'story', name: 'Story highlight', format: 'story', card: { bg: 'linear-gradient(160deg,#db2777,#7c3aed)', color: '#fff', font: 'Poppins', text: 'NEW ✨' },
    build(p) {
      p.background = { type: 'blur', color: '#000' };
      p.overlays.push(newText(0, { text: 'NEW ✨', size: 0.05, y: 0.12, bg: '#ffffff', color: '#7c3aed', anim: 'pop', end: 5 }));
      p.overlays.push(newText(0.5, { text: 'Tap to add your caption', size: 0.035, y: 0.82, bg: 'rgba(0,0,0,0.55)', weight: 600, anim: 'slide', end: 5 }));
    },
  },
  {
    id: 'slideshow', name: 'Photo slideshow', format: 'square', card: { bg: 'linear-gradient(160deg,#f59e0b,#ef4444)', color: '#fff', font: 'Pacifico', text: 'Memories' },
    build(p) {
      p.slideshow = true; // photos added to this project get Ken Burns zoom and cross fades
      p.overlays.push(newText(0.3, { text: 'Our memories', font: 'Pacifico', weight: 400, size: 0.09, y: 0.82, anim: 'fade', end: 4 }));
    },
  },
  {
    id: 'quote', name: 'Quote', format: 'post', card: { bg: '#0f172a', color: '#fde68a', font: 'Playfair Display', text: '“Dream big”' },
    build(p) {
      p.clips.push({ ...colorClip('#0f172a', 6), fadeIn: 0.4, fadeOut: 0.6 });
      p.overlays.push(newText(0.3, { text: '“The best time to start\nis now.”', font: 'Playfair Display', weight: 900, size: 0.065, y: 0.45, color: '#fde68a', anim: 'type', end: 6 }));
      p.overlays.push(newText(2.2, { text: '— Your name', font: 'Inter', weight: 400, size: 0.035, y: 0.66, color: '#cbd5e1', anim: 'fade', end: 6 }));
    },
  },
  {
    id: 'holiday', name: 'Ethiopian holiday', format: 'story', card: { bg: 'linear-gradient(160deg,#166534,#ca8a04)', color: '#fff', font: 'Noto Serif Ethiopic', text: 'እንኳን አደረሳችሁ!' },
    build(p) {
      p.clips.push({ ...colorClip('#14532d', 6), fadeOut: 0.6 });
      p.overlays.push(newText(0.3, { text: 'እንኳን አደረሳችሁ!', font: 'Noto Serif Ethiopic', weight: 700, size: 0.065, y: 0.42, color: '#fde047', anim: 'pop', end: 6 }));
      p.overlays.push(newText(1.2, { text: 'Happy holidays from our family', font: 'Poppins', weight: 400, size: 0.03, y: 0.52, anim: 'fade', end: 6 }));
      p.overlays.push(newSticker('🌼', 0.6));
      p.overlays[p.overlays.length - 1].end = 6;
    },
  },
  {
    id: 'promo', name: 'Sale promo', format: 'square', card: { bg: '#facc15', color: '#111', font: 'Bebas Neue', text: 'SALE 50%' },
    build(p) {
      p.clips.push(colorClip('#facc15', 5));
      p.overlays.push(newText(0.2, { text: 'BIG SALE', font: 'Bebas Neue', weight: 400, size: 0.2, y: 0.4, color: '#111111', anim: 'pop', end: 5 }));
      p.overlays.push(newText(0.8, { text: '50% OFF THIS WEEK', font: 'Oswald', weight: 700, size: 0.07, y: 0.58, color: '#ffffff', bg: '#111111', anim: 'slide', end: 5 }));
      p.overlays.push({ ...newSticker('🔥', 0.4), x: 0.8, y: 0.2, end: 5 });
    },
  },
  {
    id: 'vlog', name: 'Vlog title', format: 'youtube', card: { bg: 'linear-gradient(160deg,#0891b2,#1e3a8a)', color: '#fff', font: 'Permanent Marker', text: 'Day 1' },
    build(p) {
      p.overlays.push(newText(0.5, { text: 'Day 1 in Addis', font: 'Permanent Marker', weight: 400, size: 0.08, x: 0.3, y: 0.82, bg: 'rgba(0,0,0,0.5)', anim: 'slide', end: 5 }));
    },
  },
];

export function fromTemplate(t) {
  const p = newProject(t.format, t.name);
  t.build(p);
  p.template = t.id;
  return p;
}
