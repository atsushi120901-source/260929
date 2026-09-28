import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, hash2, valueNoise } from './rng.js';
import {
  makeFacadeTextures, makeDomeTexture, makeDomeEmissive, makeGroundTexture, FACADE_W, FACADE_H,
} from './textures.js';

export const CELL = 100; // chunk size (one city block + half of each surrounding road)
export const ROAD = 10; // half road width inside a chunk edge
export const WATER_Y = -0.5; // sea surface
export const WATER_FLOOR = -1.2; // where you stand when wading (low enough to climb the sea wall)
export const SPIRE_TOP = 362; // observation deck of the Celestia Spire
export const SPIRE_POS = new THREE.Vector3(-50, 0, -50);
export const DOME_POS = new THREE.Vector3(50, 0, 50);

export const DISTRICTS = {
  core: { name: 'オーレリア中枢区', sub: 'AURELIA CORE', h: [50, 190], lots: [1, 2], types: { tower: 3, tiered: 2, saucer: 1.2, capsule: 1.2 } },
  domes: { name: 'ドーム街', sub: 'DOME QUARTER', h: [25, 90], lots: [2], types: { dome: 2.2, tower: 1, tiered: 1, capsule: 1, saucer: 0.5 } },
  residential: { name: '丘の住宅地', sub: 'HILLSIDE HOMES', h: [5, 13], lots: [2], types: { houses: 1 } },
  park: { name: '桜の庭園', sub: 'SAKURA GARDENS', h: [0, 0], lots: [1], types: {} },
  plaza: { name: 'ウォーターフロント広場', sub: 'WATERFRONT PLAZA', h: [0, 0], lots: [1], types: {} },
  bay: { name: 'オーレリア湾', sub: 'AURELIA BAY', h: [0, 0], lots: [1], types: {} },
};

const TINTS = [0xffffff, 0xfff4f8, 0xf4f0ff, 0xf0f6ff, 0xfff8ee];
const BLOSSOMS = [0xf6b3cf, 0xeea0c4, 0xd9b0e8, 0xfbd3e0, 0xf2a7bd];
const GREENS = [0x7aa36a, 0x5e8c5e, 0x8fb07a];

export function isWater(cx, cz) {
  if (Math.abs(cx) <= 1 && cz >= -1 && cz <= 1) return false; // the city core is always land
  // Southern bay with an uneven shoreline (straight in front of the Grand Dome).
  const shore = Math.abs(cx) <= 1 ? 2 : 2 + Math.floor(valueNoise(cx / 3.5, 0.5, 11) * 2.6);
  if (cz >= shore) {
    // scattered islands further out
    return !(cz > shore + 1 && valueNoise(cx / 2.2, cz / 2.2, 31) > 0.78);
  }
  // inland lakes
  return Math.hypot(cx, cz) > 3 && valueNoise(cx / 4, cz / 4, 23) < 0.17;
}

export function districtAt(cx, cz) {
  if (isWater(cx, cz)) return 'bay';
  if (cx === 0 && cz === 1) return 'plaza';
  if (Math.abs(cx) <= 1 && Math.abs(cz) <= 1) return 'core';
  const n = valueNoise(cx / 5 + 100, cz / 5 + 100, 7);
  const d = Math.hypot(cx, cz);
  if (d < 4 && n > 0.6) return 'core';
  if (n < 0.28) return 'park';
  if (n < 0.52) return 'residential';
  if (n < 0.8 || d > 9) return 'domes';
  return 'core';
}

function pick(rand, weights) {
  const entries = Object.entries(weights);
  let total = 0;
  for (const [, w] of entries) total += w;
  let r = rand() * total;
  for (const [k, w] of entries) if ((r -= w) <= 0) return k;
  return entries[0][0];
}

function scaleUV(geo, su, sv, offset = 0) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su + offset, uv.getY(i) * sv);
  return geo;
}

export class City {
  constructor(scene, { radius = 6, collected = new Set() } = {}) {
    this.scene = scene;
    this.radius = radius;
    this.chunks = new Map();
    this.collected = collected;
    this.time = 0;

    this.facades = makeFacadeTextures();
    this.facadeMats = new Map();
    const std = (o) => new THREE.MeshStandardMaterial(o);
    this.mat = {
      pearl: std({ color: 0xf3eff6, metalness: 0.45, roughness: 0.22 }),
      pearlWarm: std({ color: 0xf6ece8, metalness: 0.4, roughness: 0.3 }),
      glass: std({ color: 0xffffff, map: makeDomeTexture(), emissive: 0xffffff, emissiveMap: makeDomeEmissive(), emissiveIntensity: 0.4, metalness: 0.85, roughness: 0.08 }),
      darkGlass: std({ color: 0x7482b4, metalness: 1, roughness: 0.06 }),
      stone: std({ color: 0xcfc6cc, roughness: 0.8, metalness: 0.05 }),
      ground: std({ map: makeGroundTexture(CELL, ROAD), roughness: 0.75, metalness: 0.05 }),
      grass: std({ color: 0x86a071, roughness: 0.95 }),
      path: std({ color: 0xe8e0e6, roughness: 0.8 }),
      trunk: std({ color: 0x6d5c60, roughness: 0.9 }),
      pond: std({ color: 0x8a9ccc, metalness: 1, roughness: 0.05 }),
      hull: std({ color: 0xf6f4f8, metalness: 0.3, roughness: 0.3 }),
      hullStripe: std({ color: 0x6f86c8, metalness: 0.3, roughness: 0.3 }),
    };
    this.blossomMats = BLOSSOMS.map((c) => std({ color: c, roughness: 0.85, flatShading: true, emissive: c, emissiveIntensity: 0.05 }));
    this.greenMats = GREENS.map((c) => std({ color: c, roughness: 0.9, flatShading: true }));
    const light = (c) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
    this.light = { warm: light(0xffe2b8), blue: light(0xcfe6ff), portal: light(0xc4c8ff), red: light(0xff8a9a), pink: light(0xffc8e6) };
    this.solidMats = new Set([this.mat.pearl, this.mat.pearlWarm, this.mat.glass, this.mat.darkGlass, this.mat.stone]);

    this.geo = {
      box: new THREE.BoxGeometry(1, 1, 1),
      chip: new THREE.OctahedronGeometry(1.1, 0),
      beam: new THREE.CylinderGeometry(0.3, 0.3, 1, 6, 1, true),
      lampPole: new THREE.CylinderGeometry(0.12, 0.18, 7, 8),
      lampOrb: new THREE.SphereGeometry(0.45, 12, 8),
      trunk: new THREE.CylinderGeometry(0.3, 0.5, 4, 6),
      crown: new THREE.IcosahedronGeometry(2.4, 1),
      orb: new THREE.SphereGeometry(1, 16, 10),
    };
    this.chipMat = new THREE.MeshBasicMaterial({ color: 0xfff0b0, toneMapped: false });
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });

    this.chips = [];
    this.animated = [];
    this.nightFactor = 0.5;
  }

  facadeMat(variant, tint) {
    const key = variant + '_' + tint;
    let m = this.facadeMats.get(key);
    if (!m) {
      const f = this.facades[variant];
      m = new THREE.MeshStandardMaterial({
        color: tint, map: f.map, emissive: 0xffffff, emissiveMap: f.emissive,
        emissiveIntensity: this.nightFactor, metalness: 0.35, roughness: 0.28,
      });
      this.facadeMats.set(key, m);
      this.solidMats.add(m);
    }
    return m;
  }

  setNightFactor(f) {
    this.nightFactor = f;
    for (const m of this.facadeMats.values()) m.emissiveIntensity = 0.05 + 1.1 * f;
    this.mat.glass.emissiveIntensity = 0.1 + 0.9 * f;
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
      if (!this.chunks.has(this.key(pcx + dx, pcz + dz))) wanted.push([dx * dx + dz * dz, pcx + dx, pcz + dz]);
    }
    wanted.sort((a, b) => a[0] - b[0]);
    for (const [, cx, cz] of wanted) {
      if (budget-- <= 0) break;
      this.buildChunk(cx, cz);
    }
    for (const [k, ch] of this.chunks) {
      const dx = ch.cx - pcx, dz = ch.cz - pcz;
      if (dx * dx + dz * dz > (r + 2) * (r + 2)) this.disposeChunk(k, ch);
    }

    for (const c of this.chips) {
      c.mesh.rotation.y += dt * 2;
      c.mesh.position.y = c.baseY + Math.sin(this.time * 2 + c.phase) * 0.4;
    }
    for (const m of this.animated) {
      const u = m.userData;
      if (u.spin) m.rotation[u.axis] += dt * u.spin;
      if (u.bob !== undefined) {
        m.position.y = u.baseY + Math.sin(this.time * 1.3 + u.bob) * 0.15;
        m.rotation.z = Math.sin(this.time * 1.1 + u.bob) * 0.04;
        if (u.speed) {
          u.t += dt * u.speed;
          m.position.x = u.cx + Math.cos(u.t) * u.r;
          m.position.z = u.cz + Math.sin(u.t) * u.r;
          m.rotation.y = -u.t + (u.speed > 0 ? Math.PI : 0);
        }
      }
    }
  }

  // ---------------------------------------------------------------- chunks
  buildChunk(cx, cz) {
    const rand = mulberry32(hash2(cx, cz, 42));
    const dKey = districtAt(cx, cz);
    const D = DISTRICTS[dKey];
    const group = new THREE.Group();
    const chunk = {
      cx, cz, group, ownGeos: [], colliders: [], spots: [], chips: [], anim: [], solids: [],
      district: dKey, water: dKey === 'bay',
    };
    const ox = cx * CELL, oz = cz * CELL;
    const x0 = ox + ROAD, z0 = oz + ROAD, B = CELL - 2 * ROAD;

    if (chunk.water) {
      this.buildBay(chunk, rand, ox, oz);
    } else {
      // Ground slab: its sides form a sea wall where land meets water.
      const ground = new THREE.Mesh(this.geo.box, [this.mat.stone, this.mat.stone, this.mat.ground, this.mat.stone, this.mat.stone, this.mat.stone]);
      ground.scale.set(CELL, 4, CELL);
      ground.position.set(ox + CELL / 2, -2, oz + CELL / 2);
      group.add(ground);
      for (const [lx, lz] of [[ROAD - 2, ROAD - 2], [CELL - ROAD + 2, ROAD - 2], [ROAD - 2, CELL - ROAD + 2], [CELL - ROAD + 2, CELL - ROAD + 2]]) {
        this.addLamp(chunk, ox + lx, oz + lz);
      }

      if (cx === 0 && cz === 0) this.buildGrandDome(chunk);
      else if (cx === -1 && cz === -1) this.buildSpire(chunk);
      else if (cx === 1 && cz === -1) this.buildSaucer(chunk, rand, 150, -50, 7, 170, 34);
      else if (dKey === 'plaza') this.buildPlaza(chunk, rand, x0, z0, B);
      else if (dKey === 'park') this.buildPark(chunk, rand, x0, z0, B);
      else if (dKey === 'residential') this.buildHomes(chunk, rand, x0, z0, B);
      else {
        const n = D.lots[(rand() * D.lots.length) | 0];
        const lot = B / n;
        const boost = Math.max(0, 1 - Math.hypot(cx, cz) / 8);
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
          const bx = x0 + lot * (i + 0.5), bz = z0 + lot * (j + 0.5);
          if (dKey !== 'core' && rand() < 0.12) { this.addTree(chunk, rand, bx, bz, 1.2); continue; }
          let h = D.h[0] + Math.pow(rand(), 1.5) * (D.h[1] - D.h[0]);
          h *= 1 + boost * 0.5;
          const type = pick(rand, D.types);
          const L = lot - 4;
          if (type === 'tower') this.buildTower(chunk, rand, bx, bz, Math.min(L * 0.36, 7 + rand() * 9), h);
          else if (type === 'tiered') this.buildTiered(chunk, rand, bx, bz, Math.min(L * 0.36, 9 + rand() * 8), h);
          else if (type === 'capsule') this.buildCapsule(chunk, rand, bx, bz, Math.min(L * 0.3, 6 + rand() * 6), h);
          else if (type === 'saucer') this.buildSaucer(chunk, rand, bx, bz, 3 + rand() * 3, h, Math.min(L * 0.48, 13 + rand() * 12));
          else if (type === 'dome') this.buildDome(chunk, rand, bx, bz, Math.min(L * 0.42, 10 + rand() * 10));
        }
        // blossoms along the sidewalk
        for (let t = 0; t < 4; t++) {
          const s = rand() < 0.5 ? 1 : -1;
          const along = x0 + 6 + rand() * (B - 12);
          if (rand() < 0.5) this.addTree(chunk, rand, along, s > 0 ? z0 + 2 : z0 + B - 2, 0.8);
          else this.addTree(chunk, rand, s > 0 ? x0 + 2 : x0 + B - 2, along - x0 + z0, 0.8);
        }
      }

      // Data chip — about half of the land chunks hold one.
      const chipId = this.key(cx, cz);
      if (cx === -1 && cz === -1) {
        if (!this.collected.has('spire')) this.addChip(chunk, 'spire', new THREE.Vector3(SPIRE_POS.x + 11, SPIRE_TOP + 2.2, SPIRE_POS.z));
      } else if (rand() < 0.55 && !this.collected.has(chipId)) {
        let pos;
        if (chunk.spots.length && rand() < 0.5) {
          const s = chunk.spots[(rand() * chunk.spots.length) | 0];
          pos = new THREE.Vector3(s.x, s.y + 2.2, s.z);
        } else {
          pos = rand() < 0.5
            ? new THREE.Vector3(ox + 2 + rand() * (CELL - 4), 1.8, oz + (rand() < 0.5 ? 3 : CELL - 3))
            : new THREE.Vector3(ox + (rand() < 0.5 ? 3 : CELL - 3), 1.8, oz + 2 + rand() * (CELL - 4));
        }
        this.addChip(chunk, chipId, pos);
      }
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
      const isLight = mat instanceof THREE.MeshBasicMaterial;
      mesh.castShadow = !isLight && mat !== this.mat.ground && mat !== this.mat.grass;
      mesh.receiveShadow = !isLight;
      group.add(mesh);
      chunk.ownGeos.push(merged);
      if (this.solidMats.has(mat)) chunk.solids.push(mesh);
    }
  }

  disposeChunk(k, ch) {
    this.scene.remove(ch.group);
    for (const g of ch.ownGeos) g.dispose();
    if (ch.chips.length) this.chips = this.chips.filter((c) => c.chunk !== ch);
    if (ch.anim.length) this.animated = this.animated.filter((m) => !ch.anim.includes(m));
    this.chunks.delete(k);
  }

  // ---------------------------------------------------------------- helpers
  add(chunk, geo, mat, x, y, z, own = true) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (own) chunk.ownGeos.push(geo);
    chunk.group.add(m);
    return m;
  }

  addDynamic(chunk, obj) {
    obj.userData.dynamic = true;
    obj.traverse((o) => { o.userData.dynamic = true; });
    chunk.group.add(obj);
    chunk.anim.push(obj);
    this.animated.push(obj);
  }

  box(chunk, x, z, hx, hz, bottom, top) {
    chunk.colliders.push({ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz, top, bottom });
  }

  // Approximate a vertical cylinder with three overlapping boxes.
  circle(chunk, x, z, r, bottom, top) {
    this.box(chunk, x, z, r * 0.92, r * 0.38, bottom, top);
    this.box(chunk, x, z, r * 0.38, r * 0.92, bottom, top);
    this.box(chunk, x, z, r * 0.72, r * 0.72, bottom, top);
  }

  // Hemisphere / dome collider as stacked circles.
  domeCollider(chunk, x, z, r, base, height) {
    for (const [f, t] of [[0.95, 0.4], [0.78, 0.7], [0.5, 0.92]]) this.circle(chunk, x, z, r * f, base, base + height * t);
  }

  facadeCylinder(chunk, rand, rTop, rBottom, h, x, y, z) {
    const variant = (rand() * this.facades.length) | 0;
    const tint = TINTS[(rand() * TINTS.length) | 0];
    const geo = new THREE.CylinderGeometry(rTop, rBottom, h, 20, 1, true);
    scaleUV(geo, (Math.PI * 2 * Math.max(rTop, rBottom)) / FACADE_W, h / FACADE_H, ((rand() * 4) | 0) * 0.25);
    return this.add(chunk, geo, this.facadeMat(variant, tint), x, y + h / 2, z);
  }

  disc(chunk, r, thick, x, y, z, mat = this.mat.pearl) {
    return this.add(chunk, new THREE.CylinderGeometry(r, r * 0.96, thick, 36), mat, x, y + thick / 2, z);
  }

  glassDome(chunk, r, x, y, z, squash = 1, mat = this.mat.glass) {
    const g = new THREE.SphereGeometry(r, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    const m = this.add(chunk, g, mat, x, y, z);
    m.scale.y = squash;
    return m;
  }

  ribs(chunk, r, x, y, z, count = 6, squash = 1, tube = 0.35) {
    const g = new THREE.TorusGeometry(r * 1.01, tube, 5, 24, Math.PI);
    chunk.ownGeos.push(g);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(g, this.mat.pearl);
      m.position.set(x, y, z);
      m.rotation.y = (i / count) * Math.PI;
      m.scale.y = squash;
      chunk.group.add(m);
    }
  }

  tipLight(chunk, x, y, z, s = 0.8, mat = this.light.red) {
    const m = this.add(chunk, this.geo.orb, mat, x, y, z, false);
    m.scale.setScalar(s);
  }

  addLamp(chunk, x, z) {
    this.add(chunk, this.geo.lampPole, this.mat.pearl, x, 3.5, z, false);
    this.add(chunk, this.geo.lampOrb, this.light.warm, x, 7.2, z, false);
  }

  addTree(chunk, rand, x, z, s = 1) {
    s *= 0.8 + rand() * 0.5;
    const t = this.add(chunk, this.geo.trunk, this.mat.trunk, x, 2 * s, z, false);
    t.scale.setScalar(s);
    const mats = rand() < 0.7 ? this.blossomMats : this.greenMats;
    for (let i = 0; i < 2; i++) {
      const c = this.add(chunk, this.geo.crown, mats[(rand() * mats.length) | 0], x + (rand() - 0.5) * 2.4 * s, (4.2 + rand() * 1.6) * s, z + (rand() - 0.5) * 2.4 * s, false);
      c.scale.setScalar(s * (0.75 + rand() * 0.4));
      c.rotation.set(rand() * 3, rand() * 3, 0);
    }
  }

  // ---------------------------------------------------------------- buildings
  buildTower(chunk, rand, x, z, r, h) {
    if (rand() < 0.4) {
      // Smooth pearl shaft wrapped in glass ribbons.
      this.add(chunk, new THREE.CylinderGeometry(r * 0.88, r, h, 20, 1, true), this.mat.pearl, x, h / 2, z);
      const gap = 7 + rand() * 6;
      for (let y = gap; y < h - 4; y += gap) {
        const rr = r - (y / h) * r * 0.12 + 0.15;
        this.add(chunk, new THREE.CylinderGeometry(rr, rr, 2.4, 20, 1, true), this.mat.darkGlass, x, y, z);
      }
    } else {
      this.facadeCylinder(chunk, rand, r * 0.88, r, h, x, 0, z);
    }
    // pearl bands
    for (let y = 18 + rand() * 12; y < h - 6; y += 22 + rand() * 20) this.disc(chunk, r * 1.06, 1, x, y, z);
    this.disc(chunk, r * 1.08, 1.6, x, h, z);
    this.circle(chunk, x, z, r * 0.95, 0, h + 1.6);
    if (rand() < 0.55) {
      this.glassDome(chunk, r * 0.86, x, h + 1.6, z, 0.6);
      this.domeCollider(chunk, x, z, r * 0.86, h + 1.6, r * 0.86 * 0.6);
      chunk.spots.push({ x, z, y: h + 1.6 + r * 0.86 * 0.6 * 0.92 });
      if (rand() < 0.5) {
        const ah = 8 + rand() * 20;
        this.add(chunk, new THREE.CylinderGeometry(0.15, 0.4, ah, 6), this.mat.pearl, x, h + r * 0.5 + ah / 2, z);
        this.tipLight(chunk, x, h + r * 0.5 + ah, z, 0.6);
      }
    } else {
      const ch = r * (1.4 + rand() * 1.5);
      this.add(chunk, new THREE.ConeGeometry(r * 0.9, ch, 28), this.mat.pearl, x, h + 1.6 + ch / 2, z);
      this.circle(chunk, x, z, r * 0.45, h + 1.6, h + 1.6 + ch * 0.5);
      this.tipLight(chunk, x, h + 1.6 + ch + 0.4, z, 0.5);
    }
  }

  buildTiered(chunk, rand, x, z, r, h) {
    const tiers = 3 + ((rand() * 2) | 0);
    let y = 0, rr = r;
    for (let t = 0; t < tiers; t++) {
      const th = (h / tiers) * (t === 0 ? 1.3 : 0.9);
      this.facadeCylinder(chunk, rand, rr * 0.95, rr, th, x, y, z);
      this.circle(chunk, x, z, rr * 0.97, y, y + th + 1.4);
      y += th;
      this.disc(chunk, rr * 1.25, 1.4, x, y, z);
      this.box(chunk, x, z, rr * 0.88, rr * 0.88, y, y + 1.4); // ledge you can land on
      y += 1.4;
      rr *= 0.72;
    }
    this.glassDome(chunk, rr * 1.1, x, y, z, 1);
    this.ribs(chunk, rr * 1.1, x, y, z, 4);
    this.domeCollider(chunk, x, z, rr * 1.1, y, rr * 1.1);
    const sh = 10 + rand() * 18;
    this.add(chunk, new THREE.ConeGeometry(0.6, sh, 8), this.mat.pearl, x, y + rr * 1.05 + sh / 2, z);
    this.tipLight(chunk, x, y + rr * 1.05 + sh, z, 0.5, this.light.blue);
    chunk.spots.push({ x: x + r * 0.95, z, y: h * (1.3 / tiers) + 1.4 }); // first ledge
  }

  buildCapsule(chunk, rand, x, z, r, h) {
    h = Math.max(h, r * 3);
    const variant = (rand() * this.facades.length) | 0;
    const geo = new THREE.CapsuleGeometry(r, h - 2 * r, 8, 28);
    scaleUV(geo, (Math.PI * 2 * r) / FACADE_W, h / FACADE_H);
    this.add(chunk, geo, this.facadeMat(variant, TINTS[(rand() * TINTS.length) | 0]), x, h / 2, z);
    // vertical pearl fins
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + rand();
      const fin = this.add(chunk, this.geo.box, this.mat.pearl, x + Math.cos(a) * r, h * 0.45, z + Math.sin(a) * r, false);
      fin.scale.set(1.2, h * 0.8, 1.2);
    }
    this.circle(chunk, x, z, r * 1.02, 0, h - r * 0.5);
    this.circle(chunk, x, z, r * 0.6, 0, h - r * 0.15);
    chunk.spots.push({ x, z, y: h - r * 0.15 });
    const ah = 6 + rand() * 14;
    this.add(chunk, new THREE.CylinderGeometry(0.1, 0.3, ah, 6), this.mat.pearl, x, h + ah / 2 - 0.3, z);
    this.tipLight(chunk, x, h + ah, z, 0.45);
  }

  buildSaucer(chunk, rand, x, z, stemR, h, R) {
    this.facadeCylinder(chunk, rand, stemR, stemR * 1.5, h - 3, x, 0, z);
    // struts from the stem to the disc underside
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const from = new THREE.Vector3(x + Math.cos(a) * stemR, h - 28, z + Math.sin(a) * stemR);
      const to = new THREE.Vector3(x + Math.cos(a) * R * 0.55, h - 3, z + Math.sin(a) * R * 0.55);
      const mid = from.clone().lerp(to, 0.5).add(new THREE.Vector3(Math.cos(a) * 2, -3, Math.sin(a) * 2));
      const tube = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(from, mid, to), 12, 0.7, 6);
      this.add(chunk, tube, this.mat.pearl, 0, 0, 0);
    }
    const prof = [[0, -4], [R * 0.45, -3.6], [R * 0.85, -1.8], [R, 0], [R * 0.97, 1.6], [R * 0.8, 2.6], [0, 2.8]].map(([a, b]) => new THREE.Vector2(a, b));
    this.add(chunk, new THREE.LatheGeometry(prof, 48), this.mat.pearl, x, h, z);
    this.add(chunk, new THREE.CylinderGeometry(R * 0.985, R * 0.985, 0.9, 48, 1, true), this.light.warm, x, h + 0.4, z);
    this.circle(chunk, x, z, stemR * 1.4, 0, h - 4);
    this.circle(chunk, x, z, R * 0.92, h - 3, h + 2.7);
    const dr = R * 0.58;
    this.glassDome(chunk, dr, x, h + 2.6, z, 0.62);
    this.ribs(chunk, dr, x, h + 2.6, z, 6, 0.62, 0.3);
    this.domeCollider(chunk, x, z, dr, h + 2.6, dr * 0.62);
    chunk.spots.push({ x: x + R * 0.78, z, y: h + 2.7 });
    const sh = 12 + rand() * 20;
    this.add(chunk, new THREE.ConeGeometry(0.7, sh, 8), this.mat.pearl, x, h + 2.6 + dr * 0.6 + sh / 2, z);
    this.tipLight(chunk, x, h + 2.6 + dr * 0.6 + sh, z, 0.6);
  }

  buildDome(chunk, rand, x, z, r) {
    this.disc(chunk, r * 1.06, 2.5, x, 0, z, this.mat.pearlWarm);
    this.glassDome(chunk, r, x, 2.5, z, 0.9);
    this.ribs(chunk, r, x, 2.5, z, 6, 0.9, 0.4);
    this.domeCollider(chunk, x, z, r, 2.5, r * 0.9);
    this.circle(chunk, x, z, r * 1.02, 0, 2.5);
    chunk.spots.push({ x, z, y: 2.5 + r * 0.9 * 0.92 });
    // entrance arch
    const arch = new THREE.TorusGeometry(3.4, 0.5, 8, 20, Math.PI);
    const a = rand() * Math.PI * 2;
    const m = this.add(chunk, arch, this.mat.pearl, x + Math.cos(a) * r * 0.98, 2.5, z + Math.sin(a) * r * 0.98);
    m.rotation.y = -a + Math.PI / 2;
    const glow = this.add(chunk, new THREE.CircleGeometry(3, 16, 0, Math.PI), this.light.warm, x + Math.cos(a) * r, 2.5, z + Math.sin(a) * r);
    glow.rotation.y = -a + Math.PI / 2;
  }

  buildHomes(chunk, rand, x0, z0, B) {
    const n = 3;
    const lot = B / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const cx = x0 + lot * (i + 0.5), cz = z0 + lot * (j + 0.5);
      if (rand() < 0.3) { this.addTree(chunk, rand, cx, cz, 1.1); continue; }
      const w = 9 + rand() * 7, d = 9 + rand() * 7, h = 5 + rand() * 9;
      const variant = rand() < 0.5 ? 1 : 4; // arched-window façades
      const geo = new THREE.BoxGeometry(w, h, d);
      const uv = geo.attributes.uv;
      for (let f = 0; f < 6; f++) {
        const span = f < 2 ? d : w;
        for (let v = 0; v < 4; v++) uv.setXY(f * 4 + v, uv.getX(f * 4 + v) * (span / FACADE_W), uv.getY(f * 4 + v) * (h / FACADE_H));
      }
      const fm = this.facadeMat(variant, TINTS[(rand() * TINTS.length) | 0]);
      this.add(chunk, geo, [fm, fm, this.mat.pearl, this.mat.pearl, fm, fm], cx, h / 2, cz);
      // barrel-vault roof
      const alongX = w > d;
      const rr = (alongX ? d : w) / 2;
      // Half-cylinder: Rz turns its axis horizontal with the curve up, Ry aligns it with the long side.
      const roof = this.add(chunk, new THREE.CylinderGeometry(rr, rr, alongX ? w : d, 16, 1, false, 0, Math.PI), this.mat.pearl, cx, h, cz);
      roof.rotation.set(0, alongX ? 0 : Math.PI / 2, Math.PI / 2, 'YXZ');
      this.box(chunk, cx, cz, w / 2, d / 2, 0, h + rr * 0.6);
      chunk.spots.push({ x: cx, z: cz, y: h + rr * 0.6 });
      if (rand() < 0.6) this.addTree(chunk, rand, cx + w / 2 + 2, cz + d / 2 + 1, 0.8);
    }
  }

  buildPark(chunk, rand, x0, z0, B) {
    const lawn = this.add(chunk, this.geo.box, this.mat.grass, x0 + B / 2, 0.1, z0 + B / 2, false);
    lawn.scale.set(B, 0.2, B);
    // curved footpath ring + cross paths
    const ring = this.add(chunk, new THREE.RingGeometry(B * 0.28, B * 0.28 + 3, 48), this.mat.path, x0 + B / 2, 0.22, z0 + B / 2);
    ring.rotation.x = -Math.PI / 2;
    for (const [sx, sz] of [[B, 3], [3, B]]) {
      const p = this.add(chunk, this.geo.box, this.mat.path, x0 + B / 2, 0.21, z0 + B / 2, false);
      p.scale.set(sx, 0.02, sz);
    }
    const pond = this.add(chunk, new THREE.CircleGeometry(B * 0.16, 32), this.mat.pond, x0 + B / 2, 0.23, z0 + B / 2);
    pond.rotation.x = -Math.PI / 2;
    // pavilion
    if (rand() < 0.6) {
      const px = x0 + B * (rand() < 0.5 ? 0.18 : 0.82), pz = z0 + B * (rand() < 0.5 ? 0.18 : 0.82);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const c = this.add(chunk, this.geo.box, this.mat.pearl, px + Math.cos(a) * 5, 2.5, pz + Math.sin(a) * 5, false);
        c.scale.set(0.5, 5, 0.5);
      }
      this.disc(chunk, 5.8, 0.6, px, 5, pz);
      this.glassDome(chunk, 5.4, px, 5.6, pz, 0.7);
      this.box(chunk, px, pz, 4.6, 4.6, 5, 8.8);
      chunk.spots.push({ x: px, z: pz, y: 8.8 });
    }
    const trees = 16 + ((rand() * 14) | 0);
    for (let i = 0; i < trees; i++) {
      const tx = x0 + 4 + rand() * (B - 8), tz = z0 + 4 + rand() * (B - 8);
      const d = Math.hypot(tx - (x0 + B / 2), tz - (z0 + B / 2));
      if (d < B * 0.2 || Math.abs(d - B * 0.28 - 1.5) < 3) continue;
      this.addTree(chunk, rand, tx, tz, 1.1);
    }
  }

  buildPlaza(chunk, rand, x0, z0, B) {
    const cx = x0 + B / 2, cz = z0 + B / 2;
    // fountain
    this.disc(chunk, 9, 1.2, cx, 0, cz, this.mat.pearlWarm);
    const water = this.add(chunk, new THREE.CircleGeometry(8.2, 32), this.mat.pond, cx, 1.25, cz);
    water.rotation.x = -Math.PI / 2;
    this.add(chunk, new THREE.CylinderGeometry(0.6, 1.2, 6, 12), this.mat.pearl, cx, 3, cz);
    this.disc(chunk, 3, 0.5, cx, 4.5, cz);
    this.tipLight(chunk, cx, 6.4, cz, 0.9, this.light.blue);
    this.circle(chunk, cx, cz, 9, 0, 1.2);
    // avenues of cherry trees
    // (kept to the sides so the view from the waterfront to the Grand Dome stays open)
    for (let i = 0; i < 8; i++) {
      const t = z0 + 6 + (i / 7) * (B - 12);
      this.addTree(chunk, rand, x0 + 6, t, 1.1);
      this.addTree(chunk, rand, x0 + B - 6, t, 1.1);
    }
    // benches
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.26;
      const b = this.add(chunk, this.geo.box, this.mat.pearl, cx + Math.cos(a) * 16, 0.5, cz + Math.sin(a) * 16, false);
      b.scale.set(3.4, 0.4, 1.1);
      b.rotation.y = -a + Math.PI / 2;
    }
  }

  buildBay(chunk, rand, ox, oz) {
    // Boats: dynamic so they can bob and a few can cruise in slow circles.
    const boats = (rand() * 3.2) | 0;
    for (let i = 0; i < boats; i++) {
      const boat = this.makeBoat(rand);
      const bx = ox + 15 + rand() * 70, bz = oz + 15 + rand() * 70;
      boat.position.set(bx, WATER_Y + 0.35, bz);
      boat.rotation.y = rand() * Math.PI * 2;
      const moving = rand() < 0.4;
      boat.userData = { bob: rand() * 6, baseY: WATER_Y + 0.35, speed: moving ? (rand() < 0.5 ? 0.08 : -0.08) : 0, t: rand() * 6, cx: bx, cz: bz, r: 12 };
      this.addDynamic(chunk, boat);
    }
    // occasional floating dock with a light buoy
    if (rand() < 0.3) {
      const d = this.add(chunk, this.geo.box, this.mat.pearlWarm, ox + 50, WATER_Y + 0.3, oz + 50, false);
      d.scale.set(18, 0.8, 5);
      this.box(chunk, ox + 50, oz + 50, 9, 2.5, WATER_FLOOR, WATER_Y + 0.7);
      this.tipLight(chunk, ox + 58, WATER_Y + 1.4, oz + 50, 0.5, this.light.warm);
    }
    if (rand() < 0.25) {
      const bx = ox + 20 + rand() * 60, bz = oz + 20 + rand() * 60;
      this.add(chunk, new THREE.CylinderGeometry(0.5, 0.9, 3, 10), this.mat.pearl, bx, WATER_Y + 1.2, bz);
      this.tipLight(chunk, bx, WATER_Y + 3, bz, 0.4, this.light.pink);
    }
  }

  makeBoat(rand) {
    const g = new THREE.Group();
    const L = 6 + rand() * 6;
    const hull = new THREE.Mesh(this.boatGeo || (this.boatGeo = new THREE.CapsuleGeometry(1, 4, 4, 12)), this.mat.hull);
    hull.rotation.x = Math.PI / 2;
    hull.scale.set(1.2, L / 6, 0.5);
    const stripe = new THREE.Mesh(this.geo.box, this.mat.hullStripe);
    stripe.scale.set(2.5, 0.12, L * 0.8);
    stripe.position.y = 0.2;
    const cabin = new THREE.Mesh(this.geo.orb, this.mat.darkGlass);
    cabin.scale.set(0.9, 0.6, L * 0.18);
    cabin.position.set(0, 0.5, -L * 0.05);
    g.add(hull, stripe, cabin);
    if (rand() < 0.4) {
      const mast = new THREE.Mesh(this.geo.box, this.mat.pearl);
      mast.scale.set(0.12, 6, 0.12);
      mast.position.y = 3;
      g.add(mast);
    }
    for (const o of g.children) o.castShadow = true;
    return g;
  }

  // ---------------------------------------------------------------- landmarks
  buildGrandDome(chunk) {
    const { x, z } = DOME_POS;
    const R = 30, base = 6;
    this.disc(chunk, 38, base, x, 0, z, this.mat.pearlWarm);
    this.circle(chunk, x, z, 38, 0, base);
    // front steps toward the waterfront (+z)
    for (let k = 1; k <= 6; k++) {
      const s = this.add(chunk, this.geo.box, this.mat.pearlWarm, x, (k * 1) / 2, z + 38 + (6 - k) * 1.5 + 0.2, false);
      s.scale.set(18, k * 1, 1.6);
      this.box(chunk, x, z + 38 + (6 - k) * 1.5 + 0.2, 9, 0.8, 0, k * 1);
    }
    this.box(chunk, x, z + 36, 9, 3, 0, base); // landing between the top step and the round podium
    this.add(chunk, new THREE.TorusGeometry(38.2, 0.25, 6, 96), this.light.blue, x, base, z).rotation.x = Math.PI / 2;

    this.glassDome(chunk, R, x, base, z, 0.95);
    this.ribs(chunk, R, x, base, z, 8, 0.95, 0.5);
    this.domeCollider(chunk, x, z, R, base, R * 0.95);
    // central spine running front to back, with twin spires
    const spine = this.add(chunk, new THREE.TorusGeometry(R * 1.03, 1.8, 10, 48, Math.PI), this.mat.pearl, x, base, z);
    spine.rotation.y = Math.PI / 2;
    spine.scale.y = 0.95;
    for (const dx of [-3.2, 3.2]) {
      this.add(chunk, new THREE.ConeGeometry(1.4, 46, 10), this.mat.pearl, x + dx, base + R * 0.9 + 23, z + 2);
      this.tipLight(chunk, x + dx, base + R * 0.9 + 46.5, z + 2, 0.7, this.light.blue);
    }
    this.add(chunk, new THREE.ConeGeometry(0.8, 30, 8), this.mat.pearl, x, base + R * 0.9 + 15, z - 6);

    // The portal: a glowing ring on the front face of the dome.
    // Sits just outside the glass so the flat disc doesn't cut into the curved dome.
    const el = 0.42, pr = R + 1.6;
    const px = x, py = base + pr * 0.95 * Math.sin(el), pz = z + pr * Math.cos(el);
    const ring = this.add(chunk, new THREE.TorusGeometry(8.5, 1.2, 12, 48), this.mat.pearl, px, py, pz);
    ring.rotation.x = -el;
    const disc = this.add(chunk, new THREE.CircleGeometry(7.6, 40), this.light.portal, px, py + Math.sin(el) * 0.1, pz + Math.cos(el) * 0.1);
    disc.rotation.x = -el;
    for (const s of [-1, 1]) {
      const a = s * 0.62;
      const wx = x + Math.sin(a) * R * 0.97, wz = z + Math.cos(a) * R * 0.97, wy = base + 11;
      const w = this.add(chunk, new THREE.TorusGeometry(3.4, 0.6, 8, 24), this.mat.pearl, wx, wy, wz);
      w.rotation.y = a;
      const g = this.add(chunk, new THREE.CircleGeometry(3, 20), this.light.warm, wx, wy, wz - Math.cos(a) * 0.1);
      g.rotation.y = a;
    }
    // Arched legs sweeping from the dome down to the plaza.
    for (const a of [-0.95, -0.45, 0.45, 0.95]) {
      const out = (rad, y) => new THREE.Vector3(x + Math.sin(a) * rad, y, z + Math.cos(a) * rad);
      const curve = new THREE.CatmullRomCurve3([out(R * 0.8, base + 18), out(R + 4, base + 12), out(R + 7, base + 4), out(R + 7.5, base)]);
      this.add(chunk, new THREE.TubeGeometry(curve, 24, 1.1, 8), this.mat.pearl, 0, 0, 0);
    }
  }

  buildSpire(chunk) {
    const { x, z } = SPIRE_POS;
    const prof = [[11, 0], [9.5, 20], [8, 80], [7, 160], [6.2, 240], [5.6, 300], [7, 330], [5.4, 350], [4.6, 358]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    const geo = new THREE.LatheGeometry(prof, 32);
    scaleUV(geo, (Math.PI * 2 * 8) / FACADE_W, 358 / FACADE_H);
    this.add(chunk, geo, this.facadeMat(2, 0xf6f2ff), x, 0, z);
    for (let y = 40; y < 340; y += 50) this.disc(chunk, 9 - y / 80, 1.2, x, y, z);
    this.circle(chunk, x, z, 10, 0, SPIRE_TOP - 6);
    // observation deck
    const deck = [[0, -3], [9, -3], [15, -1], [16.5, 1.5], [16, 3], [0, 3]].map(([a, b]) => new THREE.Vector2(a, b));
    this.add(chunk, new THREE.LatheGeometry(deck, 48), this.mat.pearl, x, SPIRE_TOP - 3, z);
    this.add(chunk, new THREE.TorusGeometry(16.6, 0.2, 6, 64), this.light.warm, x, SPIRE_TOP - 1.2, z).rotation.x = Math.PI / 2;
    this.circle(chunk, x, z, 16, SPIRE_TOP - 6, SPIRE_TOP);
    this.glassDome(chunk, 7, x, SPIRE_TOP, z, 0.9);
    this.domeCollider(chunk, x, z, 7, SPIRE_TOP, 6.3);
    this.add(chunk, new THREE.ConeGeometry(1.4, 80, 10), this.mat.pearl, x, SPIRE_TOP + 5 + 40, z);
    this.tipLight(chunk, x, SPIRE_TOP + 86, z, 1, this.light.red);
  }

  // ---------------------------------------------------------------- chips
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

  // ---------------------------------------------------------------- queries
  *collidersNear(x, z, range = 1) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let dz = -range; dz <= range; dz++) for (let dx = -range; dx <= range; dx++) {
      const ch = this.chunks.get(this.key(cx + dx, cz + dz));
      if (ch) yield* ch.colliders;
    }
  }

  isWaterAt(x, z) {
    return isWater(Math.floor(x / CELL), Math.floor(z / CELL));
  }

  // Highest surface under (x,z) that is not above y + step.
  groundHeight(x, z, y, radius = 0, step = 1.3) {
    let h = this.isWaterAt(x, z) ? WATER_FLOOR : 0;
    for (const c of this.collidersNear(x, z)) {
      if (x + radius > c.minX && x - radius < c.maxX && z + radius > c.minZ && z - radius < c.maxZ) {
        if (c.top <= y + step && c.top > h) h = c.top;
      }
    }
    return h;
  }

  // Push a cylinder (x,z,radius) spanning [y, y+height] out of collider boxes.
  // Boxes whose top is within `step` of the feet are left for groundHeight to climb.
  resolve(pos, radius, height, step = 0) {
    let hit = false;
    for (const c of this.collidersNear(pos.x, pos.z)) {
      if (pos.y + step >= c.top - 0.05 || pos.y + height <= c.bottom) continue;
      const nx = Math.max(c.minX, Math.min(pos.x, c.maxX));
      const nz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
      const dx = pos.x - nx, dz = pos.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      hit = true;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        pos.x = nx + (dx / d) * radius;
        pos.z = nz + (dz / d) * radius;
      } else {
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
