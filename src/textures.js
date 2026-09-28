import * as THREE from 'three';
import { mulberry32 } from './rng.js';

function canvasTexture(w, h, draw, { repeat = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

// One tile of façade = WINDOW_TILE_W x WINDOW_TILE_H metres.
export const WINDOW_TILE_W = 12;
export const WINDOW_TILE_H = 18;

const WINDOW_COLORS = [
  ['#ffd79a', '#ffe9c4', '#ffb86b'], // warm offices
  ['#7ff7ff', '#b8fbff', '#4fd8ff'], // cyan
  ['#ff8af0', '#ffc2f6', '#c77dff'], // magenta
  ['#c8d6ff', '#ffffff', '#9fb4ff'], // cool white
];

export function makeWindowTextures() {
  const list = [];
  for (let v = 0; v < 8; v++) {
    const rand = mulberry32(1000 + v);
    const palette = WINDOW_COLORS[v % WINDOW_COLORS.length];
    const litRatio = 0.25 + rand() * 0.45;
    const style = v % 3; // 0: grid windows, 1: horizontal bands, 2: vertical strips
    list.push(
      canvasTexture(128, 192, (g, w, h) => {
        g.fillStyle = '#07060e';
        g.fillRect(0, 0, w, h);
        if (style === 0) {
          const cols = 4, rows = 6;
          const cw = w / cols, ch = h / rows;
          for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
            const lit = rand() < litRatio;
            g.fillStyle = lit ? palette[(rand() * 3) | 0] : '#11131d';
            g.globalAlpha = lit ? 0.6 + rand() * 0.4 : 1;
            g.fillRect(x * cw + 4, y * ch + 5, cw - 8, ch - 12);
          }
        } else if (style === 1) {
          const rows = 6, ch = h / rows;
          for (let y = 0; y < rows; y++) {
            for (let x = 0; x < w; x += 16) {
              const lit = rand() < litRatio;
              g.fillStyle = lit ? palette[(rand() * 3) | 0] : '#10121b';
              g.globalAlpha = lit ? 0.5 + rand() * 0.5 : 1;
              g.fillRect(x, y * ch + 8, 16, ch - 18);
            }
          }
        } else {
          const cols = 8, cw = w / cols;
          for (let x = 0; x < cols; x++) {
            for (let y = 0; y < h; y += 24) {
              const lit = rand() < litRatio;
              g.fillStyle = lit ? palette[(rand() * 3) | 0] : '#0f111a';
              g.globalAlpha = lit ? 0.5 + rand() * 0.5 : 1;
              g.fillRect(x * cw + 3, y + 2, cw - 6, 20);
            }
          }
        }
        g.globalAlpha = 1;
      }),
    );
  }
  return list;
}

// Ground texture covering exactly one chunk (CELL x CELL); roads on the edges.
export function makeGroundTexture(cell, road) {
  return canvasTexture(512, 512, (g, w) => {
    const s = w / cell;
    const r = road * s;
    // asphalt
    g.fillStyle = '#15141c';
    g.fillRect(0, 0, w, w);
    // sidewalk / block
    g.fillStyle = '#23222e';
    g.fillRect(r, r, w - 2 * r, w - 2 * r);
    g.strokeStyle = '#00e5ff';
    g.globalAlpha = 0.55;
    g.lineWidth = 2;
    g.strokeRect(r + 1, r + 1, w - 2 * r - 2, w - 2 * r - 2);
    // lane markings (dashed centre line lies on the chunk edge)
    g.globalAlpha = 0.8;
    g.strokeStyle = '#ffcc33';
    g.lineWidth = 2;
    g.setLineDash([18, 14]);
    for (const p of [1, w - 1]) {
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, w); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(w, p); g.stroke();
    }
    g.setLineDash([]);
    // glowing road-edge strips
    g.strokeStyle = '#ff2bd6';
    g.globalAlpha = 0.5;
    g.lineWidth = 3;
    g.strokeRect(r - 4, r - 4, w - 2 * r + 8, w - 2 * r + 8);
    // crosswalks
    g.globalAlpha = 0.5;
    g.fillStyle = '#d8dcff';
    for (let i = 0; i < 5; i++) {
      const o = r + 6 + i * 10;
      g.fillRect(o, 2, 5, r - 8);            // top
      g.fillRect(o, w - r + 6, 5, r - 8);    // bottom
      g.fillRect(2, o, r - 8, 5);            // left
      g.fillRect(w - r + 6, o, r - 8, 5);    // right
    }
    g.globalAlpha = 1;
  }, { repeat: false });
}

const SIGN_TEXTS = [
  ['ネオ東京', '#ff2bd6'], ['CYBER', '#00f0ff'], ['ラーメン', '#ffcc33'], ['HOTEL', '#ff4d6d'],
  ['未来銀行', '#7dff9a'], ['NEXUS', '#b388ff'], ['電脳', '#00f0ff'], ['SKY TAXI', '#ffcc33'],
  ['OPEN 24H', '#ff2bd6'], ['寿司', '#ff7b3a'], ['AI CLINIC', '#7dff9a'], ['夢', '#ff4d6d'],
];

export function makeSignTextures() {
  return SIGN_TEXTS.map(([text, color]) =>
    canvasTexture(256, 96, (g, w, h) => {
      g.fillStyle = 'rgba(5,0,15,0.85)';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = color;
      g.lineWidth = 6;
      g.shadowColor = color;
      g.shadowBlur = 16;
      g.strokeRect(6, 6, w - 12, h - 12);
      g.fillStyle = '#ffffff';
      g.font = `bold ${text.length > 5 ? 40 : 56}px "Hiragino Sans","Noto Sans JP",sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, w / 2, h / 2 + 2);
      g.fillStyle = color;
      g.globalAlpha = 0.6;
      g.fillText(text, w / 2, h / 2 + 2);
    }, { repeat: false }),
  );
}
