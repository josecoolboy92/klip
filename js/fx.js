// Visual effects on the phone's graphics chip (WebGL):
//   pass 1: resize with sharp "bicubic" scaling + optional noise reduction
//   pass 2: color (brightness, contrast, saturation, warmth, tint, hue, fade),
//           sharpening, vignette and film grain
// Used by the editor preview, the export, the viewer's live Enhance, and 4K mode.

// Filter presets (like Canva / CapCut filters). Values are -1..1.
export const FILTERS = {
  none: { label: 'Original' },
  vivid: { label: 'Vivid', saturation: 0.35, contrast: 0.15 },
  warm: { label: 'Warm', warmth: 0.5, saturation: 0.1 },
  cool: { label: 'Cool', warmth: -0.45, tint: -0.05 },
  golden: { label: 'Golden', warmth: 0.4, brightness: 0.05, saturation: 0.15 },
  sunset: { label: 'Sunset', warmth: 0.6, saturation: 0.2, hue: -0.02, vignette: 0.2 },
  cinema: { label: 'Cinema', contrast: 0.2, saturation: -0.12, warmth: -0.15, tint: -0.08, vignette: 0.35 },
  dramatic: { label: 'Dramatic', contrast: 0.4, saturation: 0.1, vignette: 0.45, sharpen: 0.3 },
  vintage: { label: 'Vintage', fade: 0.45, warmth: 0.35, saturation: -0.25, vignette: 0.3, grain: 0.25 },
  fade: { label: 'Faded', fade: 0.6, saturation: -0.1 },
  mono: { label: 'Mono', saturation: -1, contrast: 0.1 },
  noir: { label: 'Noir', saturation: -1, contrast: 0.45, vignette: 0.5, grain: 0.15 },
};

export const ADJUSTMENTS = [
  ['brightness', 'Brightness'], ['contrast', 'Contrast'], ['saturation', 'Saturation'],
  ['warmth', 'Warmth'], ['tint', 'Tint'], ['hue', 'Hue'], ['fade', 'Fade'],
  ['sharpen', 'Sharpen'], ['denoise', 'Reduce noise'], ['vignette', 'Vignette'], ['grain', 'Grain'],
];

// The settings used by "Fast Enhance" (4K mode). Users can change them.
export const ENHANCE_DEFAULT = { sharpen: 0.8, denoise: 0.35, contrast: 0.06, saturation: 0.12, brightness: 0.02 };

// Combine a filter preset with the user's own adjustments
export function effectParams(filter, adjust) {
  const base = FILTERS[filter] || FILTERS.none;
  const p = {};
  for (const [key] of ADJUSTMENTS) p[key] = (base[key] || 0) + ((adjust && adjust[key]) || 0);
  return p;
}

export function isNeutral(p) {
  return !p || ADJUSTMENTS.every(([key]) => !p[key]);
}

const VERT = `
attribute vec2 pos;
varying vec2 uv;
void main() {
  uv = pos * 0.5 + 0.5;
  uv.y = 1.0 - uv.y;
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

// Pass 1: Catmull-Rom bicubic resize + edge-preserving noise reduction
const SCALE_FRAG = `
precision highp float;
uniform sampler2D tex;
uniform vec2 srcSize;
uniform float denoise;
varying vec2 uv;

vec4 cubic(float v) {
  vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
  vec4 s = n * n * n;
  float x = s.x;
  float y = s.y - 4.0 * s.x;
  float z = s.z - 4.0 * s.y + 6.0 * s.x;
  float w = 6.0 - x - y - z;
  return vec4(x, y, z, w) * (1.0 / 6.0);
}

vec3 bicubic(vec2 coord) {
  vec2 texel = 1.0 / srcSize;
  coord = coord * srcSize - 0.5;
  vec2 fxy = fract(coord);
  coord -= fxy;
  vec4 xc = cubic(fxy.x);
  vec4 yc = cubic(fxy.y);
  vec4 c = coord.xxyy + vec2(-0.5, 1.5).xyxy;
  vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
  vec4 off = c + vec4(xc.yw, yc.yw) / s;
  off *= texel.xxyy;
  vec3 s0 = texture2D(tex, off.xz).rgb;
  vec3 s1 = texture2D(tex, off.yz).rgb;
  vec3 s2 = texture2D(tex, off.xw).rgb;
  vec3 s3 = texture2D(tex, off.yw).rgb;
  float sx = s.x / (s.x + s.y);
  float sy = s.z / (s.z + s.w);
  return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy);
}

void main() {
  vec3 c = bicubic(uv);
  if (denoise > 0.0) {
    vec2 t = 1.0 / srcSize;
    vec3 sum = c;
    float wsum = 1.0;
    for (int i = -1; i <= 1; i++) {
      for (int j = -1; j <= 1; j++) {
        if (i == 0 && j == 0) continue;
        vec3 n = texture2D(tex, uv + vec2(float(i), float(j)) * t).rgb;
        vec3 d = n - c;
        float w = exp(-dot(d, d) * 60.0);
        sum += n * w;
        wsum += w;
      }
    }
    c = mix(c, sum / wsum, clamp(denoise, 0.0, 1.0));
  }
  gl_FragColor = vec4(c, 1.0);
}`;

// Pass 2: color grading + sharpen + vignette + grain
const GRADE_FRAG = `
precision highp float;
uniform sampler2D tex;
uniform vec2 px;
uniform float bri, con, sat, warm, tint, hue, fade, sharp, vig, grain, seed;
varying vec2 uv;

vec3 hueShift(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233)) + seed) * 43758.5453); }

void main() {
  vec2 st = vec2(uv.x, 1.0 - uv.y); // the middle image is stored upside down
  vec3 c = texture2D(tex, st).rgb;
  if (sharp > 0.0) {
    vec3 n = texture2D(tex, st + vec2(px.x, 0.0)).rgb + texture2D(tex, st - vec2(px.x, 0.0)).rgb
           + texture2D(tex, st + vec2(0.0, px.y)).rgb + texture2D(tex, st - vec2(0.0, px.y)).rgb;
    c += (c - n * 0.25) * sharp * 1.6;
  }
  c += bri * 0.35;
  c = (c - 0.5) * (1.0 + con) + 0.5;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 1.0 + sat);
  c.r += warm * 0.08;
  c.b -= warm * 0.08;
  c.g += tint * 0.06;
  if (hue != 0.0) c = hueShift(c, hue * 3.14159);
  c = mix(c, c * 0.82 + 0.13, fade);
  float d = distance(uv, vec2(0.5));
  c *= 1.0 - vig * smoothstep(0.3, 0.85, d);
  if (grain > 0.0) c += (rand(uv * 1000.0) - 0.5) * grain * 0.18;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export class FX {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 2;
    this.canvas.height = 2;
    const gl = this.canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    this.ok = !!gl;
    if (!gl) return;
    this.gl = gl;
    this.maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.scaleProg = this.program(SCALE_FRAG);
    this.gradeProg = this.program(GRADE_FRAG);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.srcTex = this.texture();
    this.midTex = this.texture();
    this.fbo = gl.createFramebuffer();
    this.midW = 0;
    this.midH = 0;
  }

  program(frag) {
    const gl = this.gl;
    const make = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, make(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, make(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  texture() {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  use(prog) {
    const gl = this.gl;
    gl.useProgram(prog);
    const loc = gl.getAttribLocation(prog, 'pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  }

  // source: video, image, canvas or VideoFrame. Returns this.canvas holding the result (outW × outH).
  render(source, srcW, srcH, outW, outH, p = {}) {
    const gl = this.gl;
    outW = Math.min(outW, this.maxSize);
    outH = Math.min(outH, this.maxSize);
    if (this.canvas.width !== outW || this.canvas.height !== outH) {
      this.canvas.width = outW;
      this.canvas.height = outH;
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    // pass 1 → mid texture (output size)
    if (this.midW !== outW || this.midH !== outH) {
      gl.bindTexture(gl.TEXTURE_2D, this.midTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, outW, outH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      this.midW = outW;
      this.midH = outH;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.midTex, 0);
    gl.viewport(0, 0, outW, outH);
    this.use(this.scaleProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.uniform1i(gl.getUniformLocation(this.scaleProg, 'tex'), 0);
    gl.uniform2f(gl.getUniformLocation(this.scaleProg, 'srcSize'), srcW, srcH);
    gl.uniform1f(gl.getUniformLocation(this.scaleProg, 'denoise'), Math.max(0, p.denoise || 0));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // pass 2 → screen (this.canvas). The mid texture is upside down, so flip back with uv.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, outW, outH);
    this.use(this.gradeProg);
    gl.bindTexture(gl.TEXTURE_2D, this.midTex);
    const u = (name) => gl.getUniformLocation(this.gradeProg, name);
    gl.uniform1i(u('tex'), 0);
    gl.uniform2f(u('px'), 1 / outW, 1 / outH);
    gl.uniform1f(u('bri'), p.brightness || 0);
    gl.uniform1f(u('con'), p.contrast || 0);
    gl.uniform1f(u('sat'), p.saturation || 0);
    gl.uniform1f(u('warm'), p.warmth || 0);
    gl.uniform1f(u('tint'), p.tint || 0);
    gl.uniform1f(u('hue'), p.hue || 0);
    gl.uniform1f(u('fade'), Math.max(0, p.fade || 0));
    gl.uniform1f(u('sharp'), Math.max(0, p.sharpen || 0));
    gl.uniform1f(u('vig'), Math.max(0, p.vignette || 0));
    gl.uniform1f(u('grain'), Math.max(0, p.grain || 0));
    gl.uniform1f(u('seed'), Math.random() * 100);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }
}

let shared = null;
export function sharedFX() {
  if (!shared) shared = new FX();
  return shared;
}
