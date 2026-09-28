import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, hash2, valueNoise } from './rng.js';
import {
  makeWindowTextures, makeGroundTexture, makeSignTextures, WINDOW_TILE_W, WINDOW_TILE_H,
} from './textures.js';

export const CELL = 100; // chunk size (one city block + half of each surrounding road)
export const ROAD = 10; // half road width inside a chunk edge
export const SPIRE_TOP = 420;
export const SPIRE_POS = new THREE.Vector3(CELL / 2, 0, CELL / 2);

export const DISTRICTS = {
  central: { name: 'セントラル区', sub: 'CENTRAL DISTRICT', h: [90, 260], lots: [1, 2], neon: [0x00f0ff, 0xff2bd6, 0xffffff], tints: [0x9fb8ff, 0xd0e0ff, 0x88ccff], tex: [1, 3, 5, 7], sign: 0.35 },
  commercial: { name: 'ネオン商業区', sub: 'NEON MARKET', h: [30, 120], lots: [2, 3], neon: [0xff2bd6, 0xffcc33, 0x00f0ff, 0xff4d6d], tints: [0xffc0e8, 0xffe0b0, 0xc0f0ff], tex: [0, 2, 4, 6], sign: 0.8 },
  residential: { name: 'ハビタット住宅区', sub: 'HABITAT RESIDENCES', h: [20, 70], lots: [2, 3], neon: [0x7dff9a, 0x00f0ff, 0xffcc33], tints: [0xfff0d8, 0xe8e0ff, 0xd8fff0], tex: [0, 4, 3], sign: 0.2 },
  industrial: { name: 'ファクトリー区', sub: 'INDUSTRIAL ZONE', h: [14, 45], lots: [1, 2], neon: [0xff7b3a, 0xffcc33, 0xff4d6d], tints: [0xb0a090, 0xa0a8b0, 0xc0b0a0], tex: [2, 6, 5], sign: 0.15 },
  park: { name: 'グリーンドーム公園', sub: 'BIODOME PARK', h: [0, 0], lots: [1, 1], neon: [0x7dff9a, 0x00f0ff], tints: [0xffffff], tex: [0], sign: 0 },
};

export function districtAt(cx, cz) {
  if (Math.abs(cx) <= 1 && Math.abs(cz) <= 1) return 'central';
  const n = valueNoise(cx / 5 + 100, cz / 5 + 100, 7);
  const d = Math.hypot(cx, cz);
  if (d < 5 && n > 0.35) return 'central';
  if (n < 0.24) return 'park';
  if (n < 0.47) return 'residential';
  if (n < 0.72) return 'commercial';
  return 'industrial';
}

export class City {
  constructor(scene, { radius = 6, collected = new Set() } = {}) {
    this.scene = scene;
    this.radius = radius;
    this.chunks = new Map();
    this.collected = collected;
    this.time = 0;

    this.windowTex = makeWindowTextures();
    this.signTex = makeSignTextures();
    this.sideMats = new Map();
    this.roofMat = new THREE.MeshStandardMaterial({ color: 0x1a1a24, roughness: 0.8, metalness: 0.3 });
    this.groundMat = new THREE.MeshStandardMaterial({ map: makeGroundTexture(CELL, ROAD), roughness: 0.55, metalness: 0.4 });
    this.parkMat = new THREE.MeshStandardMaterial({ color: 0x0b2a1c, roughness: 0.9, emissive: 0x03140c });
    this.neonMats = new Map();
    this.signMats = this.signTex.map((t) => new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide, toneMapped: false }));

    this.geo = {
      plane: new THREE.PlaneGeometry(CELL, CELL),
      box: new THREE.BoxGeometry(1, 1, 1),
      sign: new THREE.PlaneGeometry(1, 1),
      chip: new THREE.OctahedronGeometry(1.1, 0),
      beam: new THREE.CylinderGeometry(0.35, 0.35, 1, 6, 1, true),
      lampPole: new THREE.CylinderGeometry(0.15, 0.2, 9, 6),
      lampHead: new THREE.BoxGeometry(2.4, 0.3, 0.6),
      trunk: new THREE.CylinderGeometry(0.4, 0.6, 5, 6),
      crown: new THREE.IcosahedronGeometry(3.2, 0),
    };
    this.chipMat = new THREE.MeshBasicMaterial({ color: 0xffd23a, toneMapped: false });
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.lampMat = new THREE.MeshStandardMaterial({ color: 0x333344, metalness: 0.8, roughness: 0.3 });
    this.crownMats = [0x00ffa0, 0x00d0ff, 0x7dff9a].map((c) => new THREE.MeshStandardMaterial({ color: 0x0b3b2a, emissive: c, emissiveIntensity: 0.9, flatShading: true }));

    this.chips = []; // live chip objects {id, mesh, beam, pos}
    this.animated = []; // meshes with userData.spin
    this.nightFactor = 1;
  }

  sideMat(texIndex, tint) {
    const key = texIndex + '_' + tint;
    let m = this.sideMats.get(key);
    if (!m) {
      const tex = this.windowTex[texIndex];
      m = new THREE.MeshStandardMaterial({
        color: new THREE.Color(tint).multiplyScalar(0.35), map: tex, emissive: new THREE.Color(tint), emissiveMap: tex,
        emissiveIntensity: 0.9, roughness: 0.35, metalness: 0.6,
      });
      this.sideMats.set(key, m);
    }
    return m;
  }

  neonMat(color) {
    let m = this.neonMats.get(color);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color, toneMapped: false });
      this.neonMats.set(color, m);
    }
    return m;
  }

  setNightFactor(f) {
    this.nightFactor = f;
    for (const m of this.sideMats.values()) m.emissiveIntensity = 0.1 + 0.8 * f;
    if (this.spireMat) this.spireMat.emissiveIntensity = 0.1 + 0.8 * f;
    for (const m of this.crownMats) m.emissiveIntensity = 0.3 + 0.8 * f;
  }

  key(cx, cz) { return cx + ',' + cz; }

  update(px, pz, dt) {
    this.time += dt;
    const pcx = Math.floor(px / CELL), pcz = Math.floor(pz / CELL);
    const r = this.radius;

    // Build missing chunks, nearest first, a few per frame to avoid hitches.
    let budget = this.chunks.size === 0 ? Infinity : 3;
    const wanted = [];
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dz * dz > r * r + 1) continue;
      const k = this.key(pcx + dx, pcz + dz);
      if (!this.chunks.has(k)) wanted.push([dx * dx + dz * dz, pcx + dx, pcz + dz]);
    }
    wanted.sort((a, b) => a[0] - b[0]);
    for (const [, cx, cz] of wanted) {
      if (budget-- <= 0) break;
      this.buildChunk(cx, cz);
    }

    // Unload far chunks.
    for (const [k, ch] of this.chunks) {
      const dx = ch.cx - pcx, dz = ch.cz - pcz;
      if (dx * dx + dz * dz > (r + 2) * (r + 2)) this.disposeChunk(k, ch);
    }

    // Animate chips / rings.
    for (const c of this.chips) {
      c.mesh.rotation.y += dt * 2;
      c.mesh.position.y = c.baseY + Math.sin(this.time * 2 + c.phase) * 0.4;
    }
    for (const m of this.animated) m.rotation[m.userData.axis] += dt * m.userData.spin;
  }

  buildChunk(cx, cz) {
    const rand = mulberry32(hash2(cx, cz, 42));
    const dKey = districtAt(cx, cz);
    const D = DISTRICTS[dKey];
    const group = new THREE.Group();
    const ownGeos = [];
    const colliders = [];
    const buildings = [];
    const chunk = { cx, cz, group, ownGeos, colliders, buildings, chips: [], anim: [], solids: [], district: dKey };

    const ox = cx * CELL, oz = cz * CELL;
    const ground = new THREE.Mesh(this.geo.plane, this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(ox + CELL / 2, 0, oz + CELL / 2);
    group.add(ground);

    // Street lamps at block corners.
    for (const [lx, lz] of [[ROAD - 1, ROAD - 1], [CELL - ROAD + 1, ROAD - 1], [ROAD - 1, CELL - ROAD + 1], [CELL - ROAD + 1, CELL - ROAD + 1]]) {
      const pole = new THREE.Mesh(this.geo.lampPole, this.lampMat);
      pole.position.set(ox + lx, 4.5, oz + lz);
      const head = new THREE.Mesh(this.geo.lampHead, this.neonMat(D.neon[0]));
      head.position.set(ox + lx, 9, oz + lz);
      head.rotation.y = Math.PI / 4;
      group.add(pole, head);
    }

    const x0 = ox + ROAD, z0 = oz + ROAD, B = CELL - 2 * ROAD;

    if (cx === 0 && cz === 0) {
      this.buildSpire(chunk);
    } else if (dKey === 'park') {
      this.buildPark(chunk, rand, x0, z0, B);
    } else {
      const n = D.lots[(rand() * D.lots.length) | 0];
      const lot = B / n;
      const distBoost = Math.max(0, 1 - Math.hypot(cx, cz) / 8);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        if (dKey !== 'central' && rand() < 0.1) continue; // empty plaza lot
        const margin = 2 + rand() * 3;
        const w = lot - margin * 2 - rand() * lot * 0.2;
        const d = lot - margin * 2 - rand() * lot * 0.2;
        let h = D.h[0] + Math.pow(rand(), 1.6) * (D.h[1] - D.h[0]);
        h *= 1 + distBoost * 0.6;
        const bx = x0 + lot * (i + 0.5), bz = z0 + lot * (j + 0.5);
        this.buildTower(chunk, rand, D, bx, bz, w, d, h);
      }
    }

    // Data chip — about half of the chunks hold one.
    const chipId = this.key(cx, cz);
    if (!(cx === 0 && cz === 0) && rand() < 0.55 && !this.collected.has(chipId)) {
      let pos;
      if (buildings.length && rand() < 0.5) {
        const b = buildings[(rand() * buildings.length) | 0];
        pos = new THREE.Vector3(b.x, b.top + 2.2, b.z);
      } else {
        // On the road next to this block.
        pos = rand() < 0.5
          ? new THREE.Vector3(ox + 2 + rand() * (CELL - 4), 1.8, oz + (rand() < 0.5 ? 3 : CELL - 3))
          : new THREE.Vector3(ox + (rand() < 0.5 ? 3 : CELL - 3), 1.8, oz + 2 + rand() * (CELL - 4));
      }
      this.addChip(chunk, chipId, pos);
    } else if (cx === 0 && cz === 0 && !this.collected.has('spire')) {
      this.addChip(chunk, 'spire', new THREE.Vector3(SPIRE_POS.x, SPIRE_TOP + 2.5, SPIRE_POS.z));
    }

    this.bake(chunk);
    this.scene.add(group);
    this.chunks.set(this.key(cx, cz), chunk);
  }

  // Merge every static mesh in the chunk into one mesh per material to keep draw calls low.
  bake(chunk) {
    const { group } = chunk;
    group.updateMatrixWorld(true);
    const buckets = new Map();
    const push = (mat, geo) => {
      if (!buckets.has(mat)) buckets.set(mat, []);
      buckets.get(mat).push(geo);
    };
    for (const m of [...group.children]) {
      if (m.userData.dynamic) continue;
      const src = m.geometry;
      const parts = [];
      if (Array.isArray(m.material)) {
        for (const grp of src.groups) {
          const sub = new THREE.BufferGeometry();
          for (const name of ['position', 'normal', 'uv']) sub.setAttribute(name, src.attributes[name]);
          sub.setIndex(Array.from(src.index.array.slice(grp.start, grp.start + grp.count)));
          parts.push([m.material[grp.materialIndex], sub]);
        }
      } else {
        parts.push([m.material, src]);
      }
      for (const [mat, g] of parts) {
        const flat = g.index ? g.toNonIndexed() : g.clone();
        for (const name of Object.keys(flat.attributes)) {
          if (!['position', 'normal', 'uv'].includes(name)) flat.deleteAttribute(name);
        }
        flat.clearGroups();
        flat.applyMatrix4(m.matrixWorld);
        push(mat, flat);
      }
      group.remove(m);
    }
    const keep = new Set(group.children.map((c) => c.geometry));
    for (const g of chunk.ownGeos) if (!keep.has(g)) g.dispose();
    chunk.ownGeos = chunk.ownGeos.filter((g) => keep.has(g));
    for (const [mat, geos] of buckets) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      chunk.ownGeos.push(merged);
      if (mat === this.roofMat || mat === this.spireMat || this.isSideMat(mat)) chunk.solids.push(mesh);
    }
  }

  isSideMat(mat) {
    for (const m of this.sideMats.values()) if (m === mat) return true;
    return false;
  }

  addChip(chunk, id, pos) {
    const mesh = new THREE.Mesh(this.geo.chip, this.chipMat);
    mesh.position.copy(pos);
    const beam = new THREE.Mesh(this.geo.beam, this.beamMat);
    beam.scale.set(1, 160, 1);
    beam.position.set(pos.x, pos.y + 81, pos.z);
    mesh.userData.dynamic = beam.userData.dynamic = true;
    chunk.group.add(mesh, beam);
    const chip = { id, mesh, beam, pos, baseY: pos.y, phase: Math.random() * 6, chunk };
    chunk.chips.push(chip);
    this.chips.push(chip);
  }

  collectChip(chip) {
    this.collected.add(chip.id);
    chip.chunk.group.remove(chip.mesh, chip.beam);
    chip.chunk.chips = chip.chunk.chips.filter((c) => c !== chip);
    this.chips = this.chips.filter((c) => c !== chip);
  }

  // Building with a box UV-mapped so windows keep real-world scale.
  addBox(chunk, mat, x, y, z, w, h, d, uvOffset = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    for (let f = 0; f < 6; f++) {
      if (f === 2 || f === 3) continue; // top/bottom use roof material
      const uSpan = f < 2 ? d : w;
      for (let v = 0; v < 4; v++) {
        const i = f * 4 + v;
        uv.setXY(i, uv.getX(i) * (uSpan / WINDOW_TILE_W) + uvOffset, uv.getY(i) * (h / WINDOW_TILE_H));
      }
    }
    chunk.ownGeos.push(g);
    const mesh = new THREE.Mesh(g, [mat, mat, this.roofMat, this.roofMat, mat, mat]);
    mesh.position.set(x, y + h / 2, z);
    chunk.group.add(mesh);
    chunk.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: y + h, bottom: y });
    return mesh;
  }

  addNeon(chunk, color, x, y, z, sx, sy, sz) {
    const m = new THREE.Mesh(this.geo.box, this.neonMat(color));
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    chunk.group.add(m);
    return m;
  }

  // Four thin bars outlining a w x d rectangle.
  addNeonRing(chunk, color, x, y, z, w, d, t = 0.4) {
    this.addNeon(chunk, color, x, y, z - d / 2, w, t, t);
    this.addNeon(chunk, color, x, y, z + d / 2, w, t, t);
    this.addNeon(chunk, color, x - w / 2, y, z, t, t, d);
    this.addNeon(chunk, color, x + w / 2, y, z, t, t, d);
  }

  buildTower(chunk, rand, D, x, z, w, d, h) {
    const texIndex = D.tex[(rand() * D.tex.length) | 0];
    const tint = D.tints[(rand() * D.tints.length) | 0];
    const mat = this.sideMat(texIndex, tint);
    const neon = D.neon[(rand() * D.neon.length) | 0];
    const uvOff = ((rand() * 4) | 0) * 0.25;

    this.addBox(chunk, mat, x, 0, z, w, h, d, uvOff);
    let top = h, tw = w, td = d;

    // Vertical neon edges.
    if (rand() < 0.7) {
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        this.addNeon(chunk, neon, x + sx * (w / 2 + 0.05), h / 2, z + sz * (d / 2 + 0.05), 0.35, h, 0.35);
      }
    }
    // Horizontal neon bands.
    const bands = rand() < 0.5 ? 1 + ((rand() * 3) | 0) : 0;
    for (let b = 0; b < bands; b++) {
      const by = h * (0.3 + 0.6 * rand());
      this.addNeon(chunk, neon, x, by, z, w + 0.4, 0.4, d + 0.4);
    }

    // Setback tiers for tall towers.
    if (h > 60 && rand() < 0.75) {
      const tiers = 1 + ((rand() * 2) | 0);
      for (let t = 0; t < tiers; t++) {
        tw *= 0.6 + rand() * 0.2;
        td *= 0.6 + rand() * 0.2;
        const th = h * (0.15 + rand() * 0.25);
        this.addBox(chunk, mat, x, top, z, tw, th, td, uvOff);
        this.addNeonRing(chunk, neon, x, top + 0.2, z, tw + 1.2, td + 1.2);
        top += th;
      }
    }
    // Rooftop neon ring.
    this.addNeonRing(chunk, neon, x, top + 0.25, z, tw + 0.5, td + 0.5, 0.5);

    // Antenna spire.
    if (top > 80 && rand() < 0.6) {
      const ah = 10 + rand() * 30;
      this.addNeon(chunk, 0xff3344, x, top + ah / 2, z, 0.5, ah, 0.5);
    }

    // Holographic signs on façades.
    if (rand() < D.sign) {
      const count = 1 + ((rand() * 2) | 0);
      for (let s = 0; s < count; s++) {
        const face = (rand() * 4) | 0;
        const sw = Math.min(face < 2 ? w : d, 16) * (0.6 + rand() * 0.3);
        const sh = sw * 0.375;
        const sy = Math.min(h - sh, 8 + rand() * Math.min(h, 60));
        const sign = new THREE.Mesh(this.geo.sign, this.signMats[(rand() * this.signMats.length) | 0]);
        sign.scale.set(sw, sh, 1);
        const off = 0.8;
        if (face === 0) { sign.position.set(x, sy, z + d / 2 + off); }
        else if (face === 1) { sign.position.set(x, sy, z - d / 2 - off); sign.rotation.y = Math.PI; }
        else if (face === 2) { sign.position.set(x + w / 2 + off, sy, z); sign.rotation.y = Math.PI / 2; }
        else { sign.position.set(x - w / 2 - off, sy, z); sign.rotation.y = -Math.PI / 2; }
        chunk.group.add(sign);
      }
    }
    chunk.buildings.push({ x, z, top, w: tw, d: td });
  }

  buildPark(chunk, rand, x0, z0, B) {
    const lawn = new THREE.Mesh(this.geo.box, this.parkMat);
    lawn.scale.set(B, 0.3, B);
    lawn.position.set(x0 + B / 2, 0.15, z0 + B / 2);
    chunk.group.add(lawn);
    // Glowing footpaths
    this.addNeon(chunk, 0x00f0ff, x0 + B / 2, 0.32, z0 + B / 2, B, 0.05, 0.3);
    this.addNeon(chunk, 0x00f0ff, x0 + B / 2, 0.32, z0 + B / 2, 0.3, 0.05, B);
    // Glowing trees
    const trees = 10 + ((rand() * 12) | 0);
    for (let i = 0; i < trees; i++) {
      const tx = x0 + 4 + rand() * (B - 8), tz = z0 + 4 + rand() * (B - 8);
      if (Math.abs(tx - (x0 + B / 2)) < 3 || Math.abs(tz - (z0 + B / 2)) < 3) continue;
      const s = 0.7 + rand() * 0.8;
      const trunk = new THREE.Mesh(this.geo.trunk, this.lampMat);
      trunk.position.set(tx, 2.5 * s, tz);
      trunk.scale.setScalar(s);
      const crown = new THREE.Mesh(this.geo.crown, this.crownMats[(rand() * 3) | 0]);
      crown.position.set(tx, 6 * s, tz);
      crown.scale.setScalar(s);
      crown.rotation.set(rand() * 3, rand() * 3, 0);
      chunk.group.add(trunk, crown);
    }
    // Floating holo-ring monument
    if (rand() < 0.5) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(6, 0.3, 8, 48), this.neonMat(0x7dff9a));
      chunk.ownGeos.push(ring.geometry);
      ring.position.set(x0 + B / 2, 12, z0 + B / 2);
      ring.userData = { spin: 0.6, axis: 'y', dynamic: true };
      chunk.group.add(ring);
      chunk.anim.push(ring);
      this.animated.push(ring);
    }
  }

  buildSpire(chunk) {
    const { x, z } = SPIRE_POS;
    const g = chunk.group;
    const plazaMat = this.sideMat(1, 0x88ccff);
    // Plaza base
    this.addBox(chunk, plazaMat, x, 0, z, 56, 8, 56);
    this.addNeonRing(chunk, 0x00f0ff, x, 8.2, z, 56.6, 56.6, 0.5);
    // Main shaft (visual cylinder + box collider)
    const shaftGeo = new THREE.CylinderGeometry(7, 15, SPIRE_TOP - 8, 12, 1, true);
    chunk.ownGeos.push(shaftGeo);
    if (!this.spireMat) {
      const tex = this.windowTex[7].clone();
      tex.repeat.set(6, 24);
      tex.needsUpdate = true;
      this.spireMat = new THREE.MeshStandardMaterial({ color: 0x223355, map: tex, emissive: 0x88ccff, emissiveMap: tex, emissiveIntensity: 0.9, metalness: 0.8, roughness: 0.25 });
    }
    const shaft = new THREE.Mesh(shaftGeo, this.spireMat);
    shaft.position.set(x, 8 + (SPIRE_TOP - 8) / 2, z);
    g.add(shaft);
    chunk.colliders.push({ minX: x - 11, maxX: x + 11, minZ: z - 11, maxZ: z + 11, top: SPIRE_TOP - 2, bottom: 8 });
    // Vertical light strips
    for (let i = 0; i < 6; i++) {
      // Follow the shaft's taper from r=15 at the base to r=7 at the top.
      const a = (i / 6) * Math.PI * 2;
      const bottom = new THREE.Vector3(x + Math.cos(a) * 15.3, 8, z + Math.sin(a) * 15.3);
      const top = new THREE.Vector3(x + Math.cos(a) * 7.3, SPIRE_TOP, z + Math.sin(a) * 7.3);
      const dir = top.clone().sub(bottom);
      const len = dir.length();
      const mid = bottom.clone().add(top).multiplyScalar(0.5);
      const strip = this.addNeon(chunk, i % 2 ? 0xff2bd6 : 0x00f0ff, mid.x, mid.y, mid.z, 0.5, len, 0.5);
      strip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    }
    // Rotating rings
    for (let i = 0; i < 5; i++) {
      const y = 80 + i * 70;
      const r = 15 + (4 - i) * 4 + 6;
      const tg = new THREE.TorusGeometry(r, 0.6, 8, 64);
      chunk.ownGeos.push(tg);
      const ring = new THREE.Mesh(tg, this.neonMat(i % 2 ? 0xff2bd6 : 0x00f0ff));
      ring.position.set(x, y, z);
      ring.rotation.x = Math.PI / 2 + (i % 2 ? 0.15 : -0.15);
      ring.userData = { spin: (i % 2 ? 1 : -1) * 0.3, axis: 'z', dynamic: true };
      g.add(ring);
      chunk.anim.push(ring);
      this.animated.push(ring);
    }
    // Observation deck on top
    const deckGeo = new THREE.CylinderGeometry(18, 12, 4, 24);
    chunk.ownGeos.push(deckGeo);
    const deck = new THREE.Mesh(deckGeo, this.roofMat);
    deck.position.set(x, SPIRE_TOP - 2, z);
    g.add(deck);
    chunk.colliders.push({ minX: x - 16, maxX: x + 16, minZ: z - 16, maxZ: z + 16, top: SPIRE_TOP, bottom: SPIRE_TOP - 4 });
    this.addNeon(chunk, 0xffcc33, x, SPIRE_TOP + 0.1, z, 30, 0.2, 0.4);
    this.addNeon(chunk, 0xffcc33, x, SPIRE_TOP + 0.1, z, 0.4, 0.2, 30);
    const beaconGeo = new THREE.SphereGeometry(3, 16, 12);
    chunk.ownGeos.push(beaconGeo);
    const beacon = new THREE.Mesh(beaconGeo, this.neonMat(0xff2bd6));
    beacon.position.set(x, SPIRE_TOP + 60, z);
    g.add(beacon);
    this.addNeon(chunk, 0xffffff, x, SPIRE_TOP + 30, z, 0.8, 60, 0.8);
  }

  disposeChunk(k, ch) {
    this.scene.remove(ch.group);
    for (const g of ch.ownGeos) g.dispose();
    if (ch.chips.length) this.chips = this.chips.filter((c) => c.chunk !== ch);
    if (ch.anim.length) this.animated = this.animated.filter((m) => !ch.anim.includes(m));
    this.chunks.delete(k);
  }

  // --- Queries ---------------------------------------------------------
  *collidersNear(x, z, range = 1) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let dz = -range; dz <= range; dz++) for (let dx = -range; dx <= range; dx++) {
      const ch = this.chunks.get(this.key(cx + dx, cz + dz));
      if (ch) yield* ch.colliders;
    }
  }

  // Highest surface under (x,z) that is not above y + step.
  groundHeight(x, z, y, radius = 0, step = 1.2) {
    let h = 0;
    for (const c of this.collidersNear(x, z)) {
      if (x + radius > c.minX && x - radius < c.maxX && z + radius > c.minZ && z - radius < c.maxZ) {
        if (c.top <= y + step && c.top > h) h = c.top;
      }
    }
    return h;
  }

  // Push a cylinder (x,z,radius) spanning [y0,y1] out of building boxes.
  resolve(pos, radius, height) {
    let hit = false;
    for (const c of this.collidersNear(pos.x, pos.z)) {
      if (pos.y >= c.top - 0.05 || pos.y + height <= c.bottom) continue;
      const nx = Math.max(c.minX, Math.min(pos.x, c.maxX));
      const nz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
      let dx = pos.x - nx, dz = pos.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      hit = true;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        pos.x = nx + (dx / d) * radius;
        pos.z = nz + (dz / d) * radius;
      } else {
        // Centre is inside the box: exit via the nearest face.
        const opts = [
          [c.minX - radius - pos.x, 0], [c.maxX + radius - pos.x, 0],
          [0, c.minZ - radius - pos.z], [0, c.maxZ + radius - pos.z],
        ];
        opts.sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]));
        pos.x += opts[0][0];
        pos.z += opts[0][1];
      }
    }
    return hit;
  }

  // Solid (building) meshes around a point — used for camera occlusion.
  meshesNear(x, z) {
    const out = [];
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const ch = this.chunks.get(this.key(cx + dx, cz + dz));
      if (ch) out.push(...ch.solids);
    }
    return out;
  }

  districtAtWorld(x, z) {
    return districtAt(Math.floor(x / CELL), Math.floor(z / CELL));
  }
}
