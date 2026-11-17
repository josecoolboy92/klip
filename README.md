# Klip Studio

A free, open-source **video viewer and editor for your phone**, in the browser. Edit like Canva or CapCut, boost videos to **4K**, and **watch on your TV**. Everything happens on your phone: nothing is uploaded, and there's no account, no watermark and no ads.

Install it from the browser menu (**Add to Home screen**) and it works like a normal app, even offline.

## What it does

### ✦ Create (editor)
- **Sizes** for every platform: Story / Reel / TikTok (9:16), portrait post (4:5), square (1:1), YouTube / TV (16:9), cinema (21:9)
- **Templates**: bold intro, story highlight, photo slideshow, quote, Ethiopian holiday greeting (Amharic), sale promo, vlog title
- **Timeline** with thumbnails: drag the white line to scrub, trim handles, split, copy, move, delete, zoom
- **Videos, photos and color cards**, with a slow Ken Burns zoom on photos
- **Text** in 10 fonts, including Amharic (Noto Sans/Serif Ethiopic), with colors, a box behind the text, outline, shadow, alignment, rotation and 6 animations (fade, pop, slide, typewriter, bounce)
- **Stickers**: emoji sets, including an Ethiopia set 🇪🇹🌼☕
- **Drag and pinch on the preview** to move and resize text, stickers and videos
- **Filters** (12, like Instagram or Canva) and **adjustments**: brightness, contrast, saturation, warmth, tint, hue, fade, sharpen, noise reduction, vignette, grain
- **✨ Enhance**: one tap makes a clip (or every clip) sharper, cleaner and more colorful
- **Transitions**: cross fade, dip to black, flash, slide, slide up, zoom, wipe, circle
- **Speed** 0.1× to 8×, **volume and mute**, **fade in/out**
- **Music** track with volume, start point and fade in/out
- **Background** for videos that don't fill the frame: blurred video or a plain color
- **Undo / redo**, **autosave**
- **Export MP4** in 720p, 1080p, 2K or **4K**, at 24, 30 or 60 fps, then share straight to WhatsApp, Telegram or TikTok, or save to the phone

### ▤ Library and player
- Import videos, photos and music, or add a video from a web link
- Player with speed, repeat, double-tap ±10 s, picture-in-picture, subtitles (.srt / .vtt), rotate, and save a frame as a photo
- **✨ Live Enhance** while watching: sharper, cleaner picture in real time
- **📺 Cast to TV**: videos from a web link go straight to a Chromecast or Google TV. For videos stored on the phone, the app explains screen mirroring (Cast / Smart View), and **TV mode** fills the screen sideways.
- When installed, share a video from another app to Klip Studio, or open videos with it from the file manager

### 4K Enhance
Make an existing video bigger and sharper, up to **4K (3840×2160)**:
- **⚡ Fast Enhance**: high-quality (bicubic) upscaling, noise removal, sharpening and color boost on the phone's graphics chip. Works on any phone.
- **🧠 AI Upscale**: an AI model (ESRGAN) that adds real detail. It's slower, so it's best for short clips.
- A **before/after slider** with zoom, and fine-tune sliders
- The original sound is kept exactly as it was

## How it's built

Plain HTML, CSS and JavaScript modules, with no build step.

| File | What it does |
| --- | --- |
| `js/app.js` | Screens: Create, Library + player, 4K Enhance, casting |
| `js/editor.js` | The editor: preview, timeline, tools, undo, export |
| `js/engine.js` | Project format, timeline math, frame drawing (shared by preview and export), live preview |
| `js/fx.js` | WebGL effects: bicubic upscaling, noise removal, color, sharpen, vignette, grain, filters |
| `js/export.js` | MP4 export and 4K Enhance (Mediabunny + WebCodecs), audio mixing, AI upscaler |
| `js/media.js` | Importing files, thumbnails |
| `js/db.js` | On-device storage (IndexedDB) |
| `js/templates.js` | Templates |
| `sw.js` | Offline support and receiving shared videos |

Ideas and features were inspired by open-source browser editors such as [OpenReel Video](https://github.com/Augani/openreel-video), [Omniclip](https://github.com/omni-media/omniclip) and [FreeCut](https://github.com/walterlow/freecut) (all MIT). No code was copied from them.

## Run it on your computer

```bash
npx serve .
```

Then open the address it prints in Chrome or Edge. (Opening `index.html` straight from disk won't work.)

## Browser support

Best in **Chrome or Edge on Android** and on computers. It needs WebCodecs (for export and 4K) and WebGL (for effects). Safari on iPhone can view and edit, but exporting depends on the Safari version.

## Libraries used

- [Mediabunny](https://mediabunny.dev) (MPL-2.0): reading and writing MP4 files with the phone's video encoder
- [TensorFlow.js](https://www.tensorflow.org/js) (Apache-2.0), [UpscalerJS](https://upscalerjs.com) and [ESRGAN-slim](https://github.com/thekevinscott/UpscalerJS) (MIT): AI upscaling, loaded only when you use it
- Fonts from Google Fonts (SIL Open Font License)

## License

[MIT](LICENSE). Free to use, change and share.
