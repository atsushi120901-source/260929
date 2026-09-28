import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { City, CELL, DISTRICTS, SPIRE_POS, isWater } from './city.js';
import { Traffic } from './traffic.js';
import { Player, Hovercar } from './player.js';
import { Sky, Water, Skyships } from './sky.js';

// ---------- persistence ----------
const SAVE_KEY = 'aurelia.save.v1';
function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch { return {}; }
}
function writeSave(data) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* storage unavailable */ }
}
const save = loadSave();

// ---------- renderer / scene ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = save.shadows !== false;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xd4b4c8, 80, 640);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 6000);

const hemi = new THREE.HemisphereLight(0xe8d0f0, 0x7a6a80, 1.2);
const sun = new THREE.DirectionalLight(0xffc4a0, 1.8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -140, right: 140, top: 140, bottom: -140, near: 10, far: 900 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
scene.add(hemi, sun, sun.target);

const sky = new Sky(scene, renderer);
const water = new Water(scene);
const skyships = new Skyships(scene, 9);

// Rain
const RAIN_COUNT = 5000, RAIN_BOX = 80;
const rainPos = new Float32Array(RAIN_COUNT * 6);
for (let i = 0; i < RAIN_COUNT; i++) {
  const x = (Math.random() - 0.5) * RAIN_BOX * 2, y = Math.random() * RAIN_BOX, z = (Math.random() - 0.5) * RAIN_BOX * 2;
  rainPos.set([x, y, z, x + 0.1, y - 1.2, z], i * 6);
}
const rainGeo = new THREE.BufferGeometry();
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xc8cce8, transparent: true, opacity: 0.35 }));
rain.frustumCulled = false;
rain.visible = !!save.rain;
scene.add(rain);

// Post-processing: a gentle bloom so windows, lamps and the portal glow softly.
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.6, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());
let bloomOn = save.bloom !== false;

// ---------- world ----------
const collected = new Set(save.chips || []);
const city = new City(scene, { radius: 6, collected });
const traffic = new Traffic(scene, 70);
const player = new Player(scene, city);
const car = new Hovercar(scene, city);
let driving = false;

if (save.pos) {
  player.pos.fromArray(save.pos);
  car.placeAt(new THREE.Vector3(player.pos.x + 6, player.pos.y, player.pos.z), 0);
}

// ---------- input ----------
const input = {
  keys: new Set(), justPressed: new Set(),
  down(c) { return this.keys.has(c); },
  pressed(c) { return this.justPressed.has(c); },
};
addEventListener('keydown', (e) => {
  if (!input.keys.has(e.code)) input.justPressed.add(e.code);
  input.keys.add(e.code);
  if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => input.keys.delete(e.code));
addEventListener('blur', () => input.keys.clear());

let camYaw = 0, camPitch = -0.12, camZoom = 1;
const startEl = document.getElementById('start');
const hudEl = document.getElementById('hud');
let started = false;
const lockPointer = () => { try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* unsupported */ } };

document.getElementById('startBtn').addEventListener('click', () => {
  started = true;
  startEl.classList.add('hidden');
  hudEl.classList.remove('hidden');
  lockPointer();
});
canvas.addEventListener('click', () => { if (started) lockPointer(); });
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && started) showPrompt('クリックで視点操作を再開', 2);
});
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  camYaw -= e.movementX * 0.0025;
  camPitch = THREE.MathUtils.clamp(camPitch - e.movementY * 0.0025, -1.3, 0.9);
});
addEventListener('wheel', (e) => {
  camZoom = THREE.MathUtils.clamp(camZoom * (e.deltaY > 0 ? 1.1 : 0.9), 0.4, 3);
}, { passive: true });

// ---------- time of day ----------
// Pastel presets; dusk is the signature look of Aurelia.
const TIMES = [
  { name: '夕暮れ', top: 0x6f7fb8, mid: 0xc9a2c6, horizon: 0xf7c3a8, sunColor: 0xffc89a, cloud: 0xe9b9c9, sunDir: [-0.8, 0.1, -0.35],
    fog: 0xd6b6c6, hemi: 1.15, sun: 1.8, sunLight: 0xffc4a0, env: 0.9, night: 0.45, stars: 0.04, bloom: 0.35, water: 0x7a7fae },
  { name: '夜', top: 0x0b1030, mid: 0x262a58, horizon: 0x584878, sunColor: 0x9aa8e0, cloud: 0x3c3c66, sunDir: [0.3, 0.45, -0.5],
    fog: 0x2a2a4a, hemi: 0.45, sun: 0.35, sunLight: 0x93a0d8, env: 0.55, night: 1, stars: 1, bloom: 0.6, water: 0x2e3358 },
  { name: '昼', top: 0x5f94dc, mid: 0xa6c6ee, horizon: 0xeae6f2, sunColor: 0xfff2dc, cloud: 0xffffff, sunDir: [0.4, 0.75, -0.3],
    fog: 0xcfdcf0, hemi: 1.5, sun: 2.6, sunLight: 0xfff4e6, env: 1.0, night: 0, stars: 0, bloom: 0.2, water: 0x6b8cc0 },
  { name: '夜明け', top: 0x5a6aa8, mid: 0xb2a2d2, horizon: 0xffd2b8, sunColor: 0xffdab0, cloud: 0xf2cad8, sunDir: [0.85, 0.1, 0.2],
    fog: 0xdac2d2, hemi: 1.1, sun: 1.5, sunLight: 0xffd8b8, env: 0.85, night: 0.3, stars: 0.1, bloom: 0.3, water: 0x8088b4 },
];
let timeIndex = TIMES[save.time] ? save.time : 0;
const COLOR_KEYS = ['top', 'mid', 'horizon', 'sunColor', 'cloud', 'fog', 'sunLight', 'water'];
const NUM_KEYS = ['hemi', 'sun', 'env', 'night', 'stars', 'bloom'];
const cur = { sunDir: new THREE.Vector3() };
for (const k of COLOR_KEYS) cur[k] = new THREE.Color();
let timeSettled = false;
const tmpColor = new THREE.Color();
const tmpDir = new THREE.Vector3();

function applyTime(dt) {
  const t = TIMES[timeIndex];
  const k = dt < 0 ? 1 : 1 - Math.exp(-1.2 * dt);
  let delta = 0;
  for (const key of COLOR_KEYS) {
    tmpColor.setHex(t[key]);
    delta += Math.abs(cur[key].r - tmpColor.r) + Math.abs(cur[key].g - tmpColor.g) + Math.abs(cur[key].b - tmpColor.b);
    cur[key].lerp(tmpColor, k);
  }
  for (const key of NUM_KEYS) cur[key] = cur[key] === undefined ? t[key] : cur[key] + (t[key] - cur[key]) * k;
  cur.sunDir.lerp(tmpDir.fromArray(t.sunDir).normalize(), k).normalize();
  timeSettled = delta < 0.01;

  const u = sky.uniforms;
  u.top.value.copy(cur.top);
  u.mid.value.copy(cur.mid);
  u.horizon.value.copy(cur.horizon);
  u.sunColor.value.copy(cur.sunColor);
  u.cloudColor.value.copy(cur.cloud);
  u.sunDir.value.copy(cur.sunDir);
  scene.fog.color.copy(cur.fog);
  hemi.intensity = cur.hemi;
  sun.intensity = cur.sun;
  sun.color.copy(cur.sunLight);
  scene.environmentIntensity = cur.env;
  water.material.color.copy(cur.water);
  sky.starMat.opacity = cur.stars;
  sky.stars.visible = cur.stars > 0.02;
  bloom.strength = cur.bloom;
  city.setNightFactor(cur.night);
}
applyTime(-1);

// ---------- HUD ----------
const districtEl = document.getElementById('district');
const statsEl = document.getElementById('stats');
const promptEl = document.getElementById('prompt');
const toastEl = document.getElementById('toast');
const helpEl = document.getElementById('help');
const mm = document.getElementById('minimap').getContext('2d');
let toastTimer = 0, promptTimer = 0, lastDistrict = '';

function toast(text, secs = 2.5) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  toastTimer = secs;
}
function showPrompt(text, secs = 0.1) {
  promptEl.textContent = text;
  promptTimer = secs;
}

function drawMinimap(px, pz, heading) {
  const W = 200, S = 0.28; // pixels per metre
  mm.clearRect(0, 0, W, W);
  mm.save();
  mm.beginPath();
  mm.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2);
  mm.clip();
  mm.fillStyle = '#9aa6d4';
  mm.fillRect(0, 0, W, W);
  mm.translate(W / 2, W / 2);
  mm.rotate(heading);
  const range = 400;
  const c0x = Math.floor((px - range) / CELL), c1x = Math.floor((px + range) / CELL);
  const c0z = Math.floor((pz - range) / CELL), c1z = Math.floor((pz + range) / CELL);
  for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
    if (isWater(cx, cz)) continue;
    const x = (cx * CELL - px) * S, z = (cz * CELL - pz) * S;
    mm.fillStyle = '#c9c0cf';
    mm.fillRect(x - 0.5, z - 0.5, CELL * S + 1, CELL * S + 1);
    mm.fillStyle = '#f1ebf0';
    mm.fillRect(x + 10 * S, z + 10 * S, 80 * S, 80 * S);
  }
  for (const c of city.collidersNear(px, pz, 4)) {
    if (c.bottom > 5) continue;
    mm.fillStyle = c.top > 60 ? '#8c86b8' : '#b3aed0';
    mm.fillRect((c.minX - px) * S, (c.minZ - pz) * S, (c.maxX - c.minX) * S, (c.maxZ - c.minZ) * S);
  }
  mm.fillStyle = '#e0a526';
  for (const ch of city.chips) {
    const x = (ch.pos.x - px) * S, z = (ch.pos.z - pz) * S;
    if (x * x + z * z < 110 * 110) { mm.beginPath(); mm.arc(x, z, 3.2, 0, Math.PI * 2); mm.fill(); }
  }
  if (!driving) {
    mm.fillStyle = '#6a5acd';
    mm.fillRect((car.pos.x - px) * S - 3, (car.pos.z - pz) * S - 3, 6, 6);
  }
  let sx = (SPIRE_POS.x - px) * S, sz = (SPIRE_POS.z - pz) * S;
  const sd = Math.hypot(sx, sz);
  if (sd > 90) { sx *= 90 / sd; sz *= 90 / sd; }
  mm.fillStyle = '#ffffff';
  mm.strokeStyle = '#6a5acd';
  mm.lineWidth = 2;
  mm.beginPath(); mm.arc(sx, sz, 4.5, 0, Math.PI * 2); mm.fill(); mm.stroke();
  mm.restore();
  mm.fillStyle = '#3b3566';
  mm.beginPath();
  mm.moveTo(W / 2, W / 2 - 8); mm.lineTo(W / 2 - 5, W / 2 + 6); mm.lineTo(W / 2 + 5, W / 2 + 6);
  mm.closePath(); mm.fill();
}

// ---------- main loop ----------
const timer = new THREE.Timer();
timer.connect(document);
const raycaster = new THREE.Raycaster();
const camTarget = new THREE.Vector3();
const camDesired = new THREE.Vector3();
const dir = new THREE.Vector3();
const tmpUp = new THREE.Vector3();
let elapsed = 0, saveTimer = 0, hudTimer = 0;
const noInput = { down: () => false, pressed: () => false };

function frame(now) {
  timer.update(now);
  const dt = Math.min(timer.getDelta(), 0.05);
  elapsed += dt;

  if (started) handleKeys();

  const focus = driving ? car.pos : player.pos;
  city.update(focus.x, focus.z, dt);

  if (driving) {
    car.update(dt, input, camYaw, true);
    player.pos.copy(car.pos);
  } else {
    player.update(dt, started ? input : noInput, camYaw);
    car.update(dt, input, camYaw, false);
  }
  traffic.update(dt, focus.x, focus.z, elapsed);
  skyships.update(dt, focus.x, focus.z, elapsed);

  // chip pickup
  const pickR = driving ? 4.5 : 2.5;
  tmpUp.copy(focus).setY(focus.y + 1.5);
  for (const chip of city.chips) {
    if (chip.pos.distanceToSquared(focus) < pickR * pickR || chip.pos.distanceToSquared(tmpUp) < pickR * pickR) {
      city.collectChip(chip);
      toast(chip.id === 'spire' ? '✦ セレスティア・スパイア頂上に到達 ✦' : `ルミナ結晶を手に入れた  ×${collected.size}`);
      saveTimer = 999;
      break;
    }
  }

  // camera
  const dist = (driving ? 14 : 7) * camZoom;
  camTarget.copy(focus);
  camTarget.y += driving ? 2.5 : 1.8;
  dir.set(Math.sin(camYaw) * Math.cos(camPitch), -Math.sin(camPitch), Math.cos(camYaw) * Math.cos(camPitch));
  raycaster.set(camTarget, dir);
  raycaster.far = dist;
  const hits = raycaster.intersectObjects(city.meshesNear(focus.x, focus.z), false);
  camDesired.copy(camTarget).addScaledVector(dir, hits.length ? Math.max(0.5, hits[0].distance - 0.6) : dist);
  camDesired.y = Math.max(camDesired.y, 0.2);
  if (started) {
    camera.position.lerp(camDesired, 1 - Math.exp(-20 * dt));
    camera.lookAt(camTarget);
  } else {
    // Title screen: a slow drift over the bay, looking back at the Grand Dome.
    const t = elapsed * 0.05;
    camera.position.set(50 + Math.sin(t) * 110, 45 + Math.sin(t * 0.7) * 10, 330 + Math.cos(t) * 30);
    camera.lookAt(50 + Math.sin(t) * 30, 38, 40);
  }
  const fovTarget = driving ? 62 + Math.min(car.speed, 120) * 0.12 : 62;
  camera.fov += (fovTarget - camera.fov) * (1 - Math.exp(-3 * dt));
  camera.updateProjectionMatrix();

  applyTime(dt);
  sky.update(dt, camera.position, !timeSettled);
  water.update(dt, camera.position);
  // Keep the shadow frustum centred on the player, aligned to texels to avoid shimmering.
  const snap = 280 / 2048;
  sun.target.position.set(Math.round(focus.x / snap) * snap, 0, Math.round(focus.z / snap) * snap);
  sun.position.copy(sun.target.position).addScaledVector(cur.sunDir, 400);
  if (rain.visible) updateRain(dt);

  // HUD
  hudTimer -= dt;
  if (hudTimer <= 0 && started) {
    hudTimer = 0.1;
    const dKey = city.districtAtWorld(focus.x, focus.z);
    if (dKey !== lastDistrict) {
      lastDistrict = dKey;
      districtEl.innerHTML = `${DISTRICTS[dKey].name}<small>${DISTRICTS[dKey].sub}</small>`;
    }
    const spd = (driving ? car.speed : player.speed) * 3.6;
    const spireDist = Math.hypot(SPIRE_POS.x - focus.x, SPIRE_POS.z - focus.z);
    statsEl.innerHTML =
      `<div><span>ルミナ結晶</span><b class="gold">${collected.size}</b></div>` +
      `<div><span>速度</span><b>${spd.toFixed(0)} km/h</b></div>` +
      `<div><span>高度</span><b>${Math.max(0, focus.y).toFixed(0)} m</b></div>` +
      `<div><span>スパイアまで</span><b>${spireDist.toFixed(0)} m</b></div>` +
      `<div><span>時間帯</span><b>${TIMES[timeIndex].name}</b></div>`;
    drawMinimap(focus.x, focus.z, camYaw);
  }
  if (!driving && started && promptTimer <= 0) {
    promptEl.textContent = car.pos.distanceTo(player.pos) < 7 ? '[F] ホバーポッドに乗る' : '';
  }
  promptTimer -= dt;
  if (toastTimer > 0 && (toastTimer -= dt) <= 0) toastEl.classList.remove('show');

  saveTimer += dt;
  if (saveTimer > 5 && started) {
    saveTimer = 0;
    writeSave({ chips: [...collected], pos: player.pos.toArray(), time: timeIndex, rain: rain.visible, bloom: bloomOn, shadows: renderer.shadowMap.enabled });
  }

  if (bloomOn) composer.render(dt); else renderer.render(scene, camera);
  input.justPressed.clear();
  requestAnimationFrame(frame);
}

function handleKeys() {
  if (input.pressed('KeyF')) {
    if (driving) {
      driving = false;
      // Step out beside the pod, landing on whatever is below.
      const side = new THREE.Vector3(Math.cos(car.yaw), 0, -Math.sin(car.yaw)).multiplyScalar(-3.2);
      player.pos.copy(car.pos).add(side);
      player.vel.set(0, 0, 0);
      player.mesh.visible = true;
      city.resolve(player.pos, player.radius, player.height);
      showPrompt('', 0.1);
    } else {
      if (car.pos.distanceTo(player.pos) > 7) {
        const offset = new THREE.Vector3(Math.sin(camYaw), 0, Math.cos(camYaw)).multiplyScalar(-4);
        car.placeAt(player.pos.clone().add(offset).setY(player.pos.y + 6), camYaw);
        toast('ホバーポッドを呼び出した', 1.5);
      }
      driving = true;
      player.mesh.visible = false;
      showPrompt('Space 上昇 / C 下降 / Shift ブースト / F 降りる', 4);
    }
  }
  if (input.pressed('KeyT')) {
    timeIndex = (timeIndex + 1) % TIMES.length;
    toast(`時間帯: ${TIMES[timeIndex].name}`, 1.5);
  }
  if (input.pressed('KeyR')) {
    rain.visible = !rain.visible;
    toast(rain.visible ? '雨: ON' : '雨: OFF', 1.2);
  }
  if (input.pressed('KeyB')) {
    bloomOn = !bloomOn;
    toast(bloomOn ? '発光エフェクト: ON' : '発光エフェクト: OFF', 1.2);
  }
  if (input.pressed('KeyG')) {
    renderer.shadowMap.enabled = !renderer.shadowMap.enabled;
    scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
    toast(renderer.shadowMap.enabled ? '影: ON' : '影: OFF', 1.2);
  }
  if (input.pressed('KeyH')) helpEl.classList.toggle('hidden');
}

function updateRain(dt) {
  const p = rainGeo.attributes.position.array;
  const c = camera.position;
  const fall = 60 * dt;
  for (let i = 0; i < RAIN_COUNT; i++) {
    const o = i * 6;
    p[o + 1] -= fall;
    p[o + 4] -= fall;
    let x = p[o], y = p[o + 1], z = p[o + 2];
    if (y < c.y - 20 || y < 0 || Math.abs(x - c.x) > RAIN_BOX || Math.abs(z - c.z) > RAIN_BOX) {
      x = c.x + (Math.random() - 0.5) * RAIN_BOX * 2;
      z = c.z + (Math.random() - 0.5) * RAIN_BOX * 2;
      y = c.y + 10 + Math.random() * RAIN_BOX * 0.8;
      p[o] = x; p[o + 1] = y; p[o + 2] = z;
      p[o + 3] = x + 0.1; p[o + 4] = y - 1.2; p[o + 5] = z;
    }
  }
  rainGeo.attributes.position.needsUpdate = true;
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// debug hook for automated checks
window.__game = {
  renderer, scene, player, car, city, camera, input,
  get driving() { return driving; },
  setCam(y, p) { camYaw = y; camPitch = p; },
  get cam() { return [camYaw, camPitch]; },
  setTime(i) { timeIndex = i; applyTime(-1); sky.refreshEnvironment(); },
};

requestAnimationFrame(frame);
