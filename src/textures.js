import * as THREE from 'three';
import { mulberry32 } from './rng.js';

function makeCanvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}

function toTexture(canvas, { repeat = true, srgb = true } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

// One façade tile covers FACADE_W x FACADE_H metres.
export const FACADE_W = 12;
export const FACADE_H = 16;

// Pearl-white façades with glass bands. Each variant is a pair:
// `map` (daytime colour) and `emissive` (windows that light up at dusk).
export function makeFacadeTextures() {
  const list = [];
  const glass = ['#7f93c4', '#8aa3cf', '#9a92c8', '#7ea0c0'];
  const lights = ['#ffd9a8', '#ffe8c8', '#cfe4ff', '#f6c8ff'];
  for (let v = 0; v < 6; v++) {
    const rand = mulberry32(2000 + v);
    const style = v % 3; // 0: horizontal ribbons, 1: tall arched windows, 2: dense grid
    const cells = [];
    const W = 128, H = 170;
    if (style === 0) {
      for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) cells.push([x * 16, y * 42 + 12, 16, 22]);
    } else if (style === 1) {
      for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) cells.push([x * 32 + 7, y * 85 + 10, 18, 64]);
    } else {
      // tall slender slits with wide pearl piers
      for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) cells.push([x * 43 + 16, y * 57 + 8, 10, 42]);
    }
    const lit = cells.map(() => rand() < 0.45);
    const tint = cells.map(() => lights[(rand() * lights.length) | 0]);
    const g = glass[v % glass.length];

    const albedo = makeCanvas(W, H, (c) => {
      const grad = c.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, '#e9e6ee');
      grad.addColorStop(0.5, '#f7f5fa');
      grad.addColorStop(1, '#e4e1ea');
      c.fillStyle = grad;
      c.fillRect(0, 0, W, H);
      if (style === 0) {
        c.fillStyle = g;
        for (let y = 0; y < 4; y++) c.fillRect(0, y * 42 + 12, W, 22);
      }
      cells.forEach(([x, y, w, h]) => {
        c.fillStyle = style === 0 ? 'rgba(255,255,255,0.18)' : g;
        if (style === 1) {
          c.beginPath();
          c.moveTo(x, y + h);
          c.lineTo(x, y + w / 2);
          c.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
          c.lineTo(x + w, y + h);
          c.fill();
        } else {
          c.fillRect(x + 1, y, w - 2, h);
        }
      });
      // thin panel seams
      c.fillStyle = 'rgba(120,110,140,0.25)';
      c.fillRect(0, H - 2, W, 2);
    });
    const emissive = makeCanvas(W, H, (c) => {
      c.fillStyle = '#000';
      c.fillRect(0, 0, W, H);
      cells.forEach(([x, y, w, h], i) => {
        if (!lit[i]) return;
        c.fillStyle = tint[i];
        c.globalAlpha = 0.55 + rand() * 0.45;
        c.fillRect(x + 1, y, w - 2, h);
      });
      c.globalAlpha = 1;
    });
    list.push({ map: toTexture(albedo), emissive: toTexture(emissive) });
  }
  return list;
}

// Geodesic glass for domes: blue-lavender panes with pale ribs.
export function makeDomeTexture() {
  return toTexture(makeCanvas(256, 128, (c, w, h) => {
    const grad = c.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#9fb0e0');
    grad.addColorStop(1, '#5a6aa0');
    c.fillStyle = grad;
    c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(240,236,250,0.85)';
    c.lineWidth = 2;
    for (let x = 0; x <= w; x += 16) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
    for (let y = 0; y <= h; y += 12) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    c.lineWidth = 1;
    for (let x = 0; x <= w; x += 16) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 16, 12 * 8); c.stroke(); }
  }));
}

export function makeDomeEmissive() {
  const rand = mulberry32(77);
  return toTexture(makeCanvas(256, 128, (c, w, h) => {
    c.fillStyle = '#000';
    c.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) for (let y = 0; y < h; y += 12) {
      if (rand() < 0.3) {
        c.fillStyle = rand() < 0.5 ? '#ffd9a8' : '#c8d8ff';
        c.globalAlpha = 0.3 + rand() * 0.5;
        c.fillRect(x + 2, y + 2, 12, 8);
      }
    }
  }));
}

// Ground covering exactly one chunk (CELL x CELL); roads on the edges.
export function makeGroundTexture(cell, road) {
  return toTexture(makeCanvas(512, 512, (g, w) => {
    const s = w / cell;
    const r = road * s;
    g.fillStyle = '#6f6a7e';
    g.fillRect(0, 0, w, w);
    // pale stone paving
    g.fillStyle = '#d9d2d8';
    g.fillRect(r - 6, r - 6, w - 2 * r + 12, w - 2 * r + 12);
    g.strokeStyle = 'rgba(150,140,160,0.35)';
    g.lineWidth = 1;
    for (let p = r; p < w - r; p += 14) {
      g.beginPath(); g.moveTo(p, r); g.lineTo(p, w - r); g.stroke();
      g.beginPath(); g.moveTo(r, p); g.lineTo(w - r, p); g.stroke();
    }
    // curb
    g.strokeStyle = '#f4f0f4';
    g.lineWidth = 3;
    g.strokeRect(r - 6, r - 6, w - 2 * r + 12, w - 2 * r + 12);
    // centre lines on the chunk edge
    g.strokeStyle = 'rgba(245,240,250,0.75)';
    g.lineWidth = 2;
    g.setLineDash([20, 16]);
    for (const p of [1, w - 1]) {
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, w); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(w, p); g.stroke();
    }
    g.setLineDash([]);
    // crosswalks
    g.fillStyle = 'rgba(245,240,250,0.4)';
    for (let i = 0; i < 5; i++) {
      const o = r + 6 + i * 10;
      g.fillRect(o, 4, 5, r - 14);
      g.fillRect(o, w - r + 10, 5, r - 14);
      g.fillRect(4, o, r - 14, 5);
      g.fillRect(w - r + 10, o, r - 14, 5);
    }
  }), { repeat: false });
}

// Tileable normal map for water ripples.
export function makeWaterNormal() {
  const N = 256;
  const rand = mulberry32(9);
  const waves = Array.from({ length: 14 }, () => ({
    kx: ((rand() * 10) | 0) - 5 || 1, ky: ((rand() * 10) | 0) - 5 || 2, a: 0.3 + rand(), p: rand() * 6.28,
  }));
  const canvas = makeCanvas(N, N, (c) => {
    const img = c.createImageData(N, N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let dx = 0, dy = 0;
      for (const w of waves) {
        const ph = ((w.kx * x + w.ky * y) / N) * Math.PI * 2 + w.p;
        const d = Math.cos(ph) * w.a;
        dx += d * w.kx;
        dy += d * w.ky;
      }
      const nx = -dx * 0.03, ny = -dy * 0.03;
      const l = Math.hypot(nx, ny, 1);
      const i = (y * N + x) * 4;
      img.data[i] = ((nx / l) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
  });
  return toTexture(canvas, { srgb: false });
}
