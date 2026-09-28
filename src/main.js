import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { City, CELL, DISTRICTS, SPIRE_POS } from './city.js';
import { Traffic } from './traffic.js';
import { Player, Hovercar } from './player.js';

// ---------- persistence ----------
const SAVE_KEY = 'neocity.save.v1';
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

const scene = new THREE.Scene();
// Soft reflections so metallic surfaces (cars, glass) don't render pitch black.
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.fog = new THREE.Fog(0x0a0418, 120, 620);
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 3000);

const hemi = new THREE.HemisphereLight(0x6a5cff, 0x100818, 0.8);
const sun = new THREE.DirectionalLight(0xaab8ff, 0.6);
sun.position.set(-200, 400, 100);
scene.add(hemi, sun);

// Sky dome with gradient + stars
const skyUniforms = { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } };
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(1500, 32, 16),
  new THREE.ShaderMaterial({
    uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y*1.6+0.1,0.,1.); gl_FragColor = vec4(mix(bottom, top, pow(h,0.7)),1.); }',
  }),
);
scene.add(sky);
const starGeo = new THREE.BufferGeometry();
{
  const pts = [];
  for (let i = 0; i < 1500; i++) {
    const v = new THREE.Vector3().randomDirection();
    if (v.y < 0.08) v.y = Math.abs(v.y) + 0.08;
    v.normalize().multiplyScalar(1400);
    pts.push(v.x, v.y, v.z);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
}
const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, fog: false });
const stars = new THREE.Points(starGeo, starMat);
scene.add(stars);

// Rain
const RAIN_COUNT = 5000, RAIN_BOX = 80;
const rainPos = new Float32Array(RAIN_COUNT * 6);
for (let i = 0; i < RAIN_COUNT; i++) {
  const x = (Math.random() - 0.5) * RAIN_BOX * 2, y = Math.random() * RAIN_BOX, z = (Math.random() - 0.5) * RAIN_BOX * 2;
  rainPos.set([x, y, z, x + 0.1, y - 1.2, z], i * 6);
}
const rainGeo = new THREE.BufferGeometry();
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0x88aaff, transparent: true, opacity: 0.35 }));
rain.frustumCulled = false;
rain.visible = !!save.rain;
scene.add(rain);

// Post-processing
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.8, 0.4, 0.6);
composer.addPass(bloom);
composer.addPass(new OutputPass());
let bloomOn = save.bloom !== false;

// ---------- world ----------
const collected = new Set(save.chips || []);
const city = new City(scene, { radius: 6, collected });
const traffic = new Traffic(scene, 80);
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

let camYaw = 0, camPitch = -0.15, camZoom = 1;
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
const TIMES = [
  { name: '夜', top: 0x05021a, bottom: 0x3a0f4a, fog: 0x14082a, hemi: 0.7, sun: 0.35, env: 0.25, night: 1, stars: 1, bloom: 0.8 },
  { name: '夕暮れ', top: 0x1a1850, bottom: 0xff6a4a, fog: 0x5a2a4a, hemi: 1.1, sun: 1.0, env: 0.5, night: 0.6, stars: 0.3, bloom: 0.7 },
  { name: '昼', top: 0x3a8ae0, bottom: 0xbfe4ff, fog: 0x9ec8e8, hemi: 1.8, sun: 2.2, env: 1.0, night: 0.05, stars: 0, bloom: 0.35 },
  { name: '夜明け', top: 0x243a80, bottom: 0xffb08a, fog: 0x8a7a9a, hemi: 1.3, sun: 1.4, env: 0.6, night: 0.4, stars: 0.15, bloom: 0.55 },
];
let timeIndex = save.time ?? 0;
const cur = { top: new THREE.Color(), bottom: new THREE.Color(), fog: new THREE.Color(), hemi: 0, sun: 0, env: 0.25, night: 1, stars: 1, bloom: 0.8 };
function applyTime(dt) {
  const t = TIMES[timeIndex];
  const k = dt < 0 ? 1 : 1 - Math.exp(-1.5 * dt);
  cur.top.lerp(new THREE.Color(t.top), k);
  cur.bottom.lerp(new THREE.Color(t.bottom), k);
  cur.fog.lerp(new THREE.Color(t.fog), k);
  for (const p of ['hemi', 'sun', 'env', 'night', 'stars', 'bloom']) cur[p] += (t[p] - cur[p]) * k;
  skyUniforms.top.value.copy(cur.top);
  skyUniforms.bottom.value.copy(cur.bottom);
  scene.fog.color.copy(cur.fog);
  hemi.intensity = cur.hemi;
  sun.intensity = cur.sun;
  scene.environmentIntensity = cur.env;
  starMat.opacity = cur.stars;
  stars.visible = cur.stars > 0.02;
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
  mm.fillStyle = 'rgba(8,4,24,0.85)';
  mm.fillRect(0, 0, W, W);
  mm.translate(W / 2, W / 2);
  mm.rotate(heading);
  // roads grid
  mm.strokeStyle = 'rgba(255,43,214,0.35)';
  mm.lineWidth = 20 * S;
  const range = 400;
  for (let g = Math.floor((px - range) / CELL) * CELL; g < px + range; g += CELL) {
    mm.beginPath(); mm.moveTo((g - px) * S, -range * S); mm.lineTo((g - px) * S, range * S); mm.stroke();
  }
  for (let g = Math.floor((pz - range) / CELL) * CELL; g < pz + range; g += CELL) {
    mm.beginPath(); mm.moveTo(-range * S, (g - pz) * S); mm.lineTo(range * S, (g - pz) * S); mm.stroke();
  }
  // buildings
  for (const c of city.collidersNear(px, pz, 4)) {
    const shade = Math.min(1, c.top / 200);
    mm.fillStyle = `rgba(0,${150 + shade * 100 | 0},255,${0.25 + shade * 0.5})`;
    mm.fillRect((c.minX - px) * S, (c.minZ - pz) * S, (c.maxX - c.minX) * S, (c.maxZ - c.minZ) * S);
  }
  // chips
  mm.fillStyle = '#ffd23a';
  for (const ch of city.chips) {
    const x = (ch.pos.x - px) * S, z = (ch.pos.z - pz) * S;
    if (x * x + z * z < 110 * 110) { mm.beginPath(); mm.arc(x, z, 3, 0, Math.PI * 2); mm.fill(); }
  }
  // parked car
  if (!driving) {
    mm.fillStyle = '#ff2bd6';
    mm.fillRect((car.pos.x - px) * S - 3, (car.pos.z - pz) * S - 3, 6, 6);
  }
  // spire direction marker (clamped to edge)
  let sx = (SPIRE_POS.x - px) * S, sz = (SPIRE_POS.z - pz) * S;
  const sd = Math.hypot(sx, sz);
  if (sd > 90) { sx *= 90 / sd; sz *= 90 / sd; }
  mm.fillStyle = '#ffffff';
  mm.beginPath(); mm.arc(sx, sz, 4, 0, Math.PI * 2); mm.fill();
  mm.restore();
  // player arrow (always up)
  mm.fillStyle = '#00f0ff';
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
let elapsed = 0, saveTimer = 0, hudTimer = 0;

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
    player.update(dt, started ? input : { down: () => false, pressed: () => false }, camYaw);
    car.update(dt, input, camYaw, false);
  }
  traffic.update(dt, focus.x, focus.z, elapsed);

  // chip pickup
  const pickR = driving ? 4.5 : 2.5;
  for (const chip of city.chips) {
    if (chip.pos.distanceToSquared(focus) < pickR * pickR || chip.pos.distanceToSquared(tmpUp.copy(focus).setY(focus.y + 1.5)) < pickR * pickR) {
      city.collectChip(chip);
      toast(chip.id === 'spire' ? '★ スパイア頂上に到達！ 特別チップ取得 ★' : `データチップ取得！  ×${collected.size}`);
      saveTimer = 999;
      break;
    }
  }

  // camera
  const dist = (driving ? 14 : 7) * camZoom;
  camTarget.copy(focus);
  camTarget.y += driving ? 2.5 : 1.8;
  dir.set(Math.sin(camYaw) * Math.cos(camPitch), -Math.sin(camPitch), Math.cos(camYaw) * Math.cos(camPitch));
  camDesired.copy(camTarget).addScaledVector(dir, dist);
  raycaster.set(camTarget, dir);
  raycaster.far = dist;
  const hits = raycaster.intersectObjects(city.meshesNear(focus.x, focus.z), false);
  if (hits.length) camDesired.copy(camTarget).addScaledVector(dir, Math.max(0.5, hits[0].distance - 0.6));
  camDesired.y = Math.max(camDesired.y, 0.4);
  camera.position.lerp(camDesired, 1 - Math.exp(-20 * dt));
  camera.lookAt(camTarget);
  const fovTarget = driving ? 65 + Math.min(car.speed, 120) * 0.12 : 65;
  camera.fov += (fovTarget - camera.fov) * (1 - Math.exp(-3 * dt));
  camera.updateProjectionMatrix();

  sky.position.copy(camera.position);
  stars.position.copy(camera.position);
  if (rain.visible) updateRain(dt);
  applyTime(dt);

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
      `データチップ <b style="color:#ffd23a">${collected.size}</b><br>` +
      `速度 ${spd.toFixed(0)} km/h<br>高度 ${focus.y.toFixed(0)} m<br>` +
      `スパイアまで ${spireDist.toFixed(0)} m<br>時間帯 ${TIMES[timeIndex].name}`;
    drawMinimap(focus.x, focus.z, camYaw);
  }
  if (!driving && started && promptTimer <= 0) {
    const near = car.pos.distanceTo(player.pos) < 7;
    promptEl.textContent = near ? '[F] ホバーカーに乗る' : '';
  }
  promptTimer -= dt;
  if (toastTimer > 0 && (toastTimer -= dt) <= 0) toastEl.classList.remove('show');

  saveTimer += dt;
  if (saveTimer > 5 && started) {
    saveTimer = 0;
    writeSave({ chips: [...collected], pos: player.pos.toArray(), time: timeIndex, rain: rain.visible, bloom: bloomOn });
  }

  if (bloomOn) composer.render(dt); else renderer.render(scene, camera);
  input.justPressed.clear();
  requestAnimationFrame(frame);
}
const tmpUp = new THREE.Vector3();

function handleKeys() {
  if (input.pressed('KeyF')) {
    if (driving) {
      driving = false;
      // Step out beside the car, landing on whatever is below.
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
        toast('ホバーカーを呼び出した', 1.5);
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
    toast(bloomOn ? 'ブルーム: ON' : 'ブルーム: OFF', 1.2);
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
window.__game = { renderer, scene, player, car, city, camera, get driving() { return driving; }, input, setCam(y, p) { camYaw = y; camPitch = p; }, setTime(i) { timeIndex = i; applyTime(-1); } };

requestAnimationFrame(frame);
