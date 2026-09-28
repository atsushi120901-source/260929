import * as THREE from 'three';
import { WATER_Y } from './city.js';
import { makeWaterNormal } from './textures.js';

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// Three-stop gradient, a soft sun glow and drifting stratus clouds.
const SKY_FRAG = /* glsl */ `
uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 sunColor; uniform vec3 cloudColor;
uniform vec3 sunDir; uniform float time; uniform float cloudAmount;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = h > 0.0
    ? mix(mix(horizon, mid, smoothstep(0.0, 0.18, h)), top, smoothstep(0.15, 0.75, h))
    : mix(horizon, horizon * 0.8, smoothstep(0.0, -0.2, h));
  float s = max(dot(d, normalize(sunDir)), 0.0);
  col += sunColor * (pow(s, 8.0) * 0.18 + pow(s, 80.0) * 0.4 + pow(s, 1200.0) * 2.0);
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.12);
    float c = fbm(uv * vec2(0.9, 2.6) + vec2(time * 0.004, 0.0));
    c = smoothstep(0.52, 0.85, c) * cloudAmount * smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.35, 0.7, h));
    vec3 lit = mix(cloudColor, sunColor, pow(s, 3.0) * 0.6);
    col = mix(col, lit, c * 0.8);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Sky {
  constructor(scene, renderer) {
    this.renderer = renderer;
    this.uniforms = {
      top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, horizon: { value: new THREE.Color() },
      sunColor: { value: new THREE.Color() }, cloudColor: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(-0.6, 0.12, -0.4) }, time: { value: 0 }, cloudAmount: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(2500, 48, 24), mat);
    this.mesh.renderOrder = -1;
    scene.add(this.mesh);

    // A separate scene with just the sky, rendered into the environment map
    // so pearl and glass surfaces reflect the current sky colours.
    this.envScene = new THREE.Scene();
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), mat));
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this.envTimer = 0;
    this.scene = scene;

    // Stars for the night sky.
    const pts = [];
    for (let i = 0; i < 1500; i++) {
      const v = new THREE.Vector3().randomDirection();
      if (v.y < 0.1) v.y = Math.abs(v.y) + 0.1;
      v.normalize().multiplyScalar(2300);
      pts.push(v.x, v.y, v.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false });
    this.stars = new THREE.Points(g, this.starMat);
    scene.add(this.stars);
  }

  refreshEnvironment() {
    const old = this.envRT;
    this.envRT = this.pmrem.fromScene(this.envScene, 0.02);
    this.scene.environment = this.envRT.texture;
    if (old) old.dispose();
  }

  update(dt, camPos, changing) {
    this.uniforms.time.value += dt;
    this.mesh.position.copy(camPos);
    this.stars.position.copy(camPos);
    this.envTimer -= dt;
    if (!this.envRT || (changing && this.envTimer <= 0)) {
      this.envTimer = 0.25;
      this.refreshEnvironment();
    }
  }
}

// Large reflective water plane that follows the camera.
export class Water {
  constructor(scene) {
    this.normal = makeWaterNormal();
    this.normal.repeat.set(320, 320);
    this.material = new THREE.MeshStandardMaterial({
      color: 0x6f79a8, metalness: 0.95, roughness: 0.07, normalMap: this.normal, normalScale: new THREE.Vector2(0.25, 0.25),
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = WATER_Y;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    this.t = 0;
  }

  update(dt, camPos) {
    this.t += dt;
    // Snap to the texture period so the ripples don't slide with the camera.
    const period = 4000 / 320;
    this.mesh.position.x = Math.round(camPos.x / period) * period;
    this.mesh.position.z = Math.round(camPos.z / period) * period;
    this.normal.offset.set(this.t * 0.004, this.t * 0.0025);
  }
}

function makeAirship(rand) {
  const g = new THREE.Group();
  const pearl = new THREE.MeshStandardMaterial({ color: 0xf2eef4, metalness: 0.5, roughness: 0.25 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xc9b8a8, metalness: 0.7, roughness: 0.3 });
  const glow = new THREE.MeshBasicMaterial({ color: 0xffdcae, toneMapped: false });
  const len = 1.8 + rand() * 1.4;
  const body = new THREE.Mesh(new THREE.SphereGeometry(8, 32, 16), pearl);
  body.scale.set(1, 0.95, len);
  const belt = new THREE.Mesh(new THREE.TorusGeometry(8.05, 0.35, 8, 48), trim);
  belt.scale.set(1, 0.95, 1);
  const gondola = new THREE.Mesh(new THREE.CapsuleGeometry(1.8, 6, 6, 16), pearl);
  gondola.rotation.x = Math.PI / 2;
  gondola.position.y = -8.4;
  const windows = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.7, 6.5), glow);
  windows.position.y = -8.2;
  g.add(body, belt, gondola, windows);
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5, 5), pearl);
    const a = (i / 4) * Math.PI * 2;
    fin.position.set(Math.cos(a) * 4.5, Math.sin(a) * 4.5, 8 * len - 3);
    fin.rotation.z = a;
    g.add(fin);
  }
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff8a9a, toneMapped: false }));
  lamp.position.set(0, -10, 0);
  g.add(lamp);
  const s = 0.7 + rand() * 1.1;
  g.scale.setScalar(s);
  return g;
}

// Airships and small drifting orbs.
export class Skyships {
  constructor(scene, count = 9) {
    let seed = 5;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    this.ships = [];
    for (let i = 0; i < count; i++) {
      const mesh = makeAirship(rand);
      scene.add(mesh);
      this.ships.push({ mesh, heading: rand() * Math.PI * 2, speed: 3 + rand() * 5, alt: 110 + rand() * 220, x: 0, z: 0, init: false });
    }
    const orbMat = new THREE.MeshStandardMaterial({ color: 0xf4eef6, metalness: 0.6, roughness: 0.2 });
    const orbGeo = new THREE.SphereGeometry(1, 20, 12);
    this.orbs = [];
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(orbGeo, orbMat);
      m.scale.setScalar(2 + rand() * 4);
      scene.add(m);
      this.orbs.push({ mesh: m, dx: (rand() - 0.5) * 1600, dz: (rand() - 0.5) * 1600, alt: 160 + rand() * 300, ph: rand() * 6 });
    }
    this.range = 700;
  }

  update(dt, px, pz, time) {
    for (const s of this.ships) {
      if (!s.init) {
        s.x = px + (Math.random() - 0.5) * this.range * 2;
        s.z = pz + (Math.random() - 0.5) * this.range * 2;
        s.init = true;
      }
      s.x += Math.sin(s.heading) * -s.speed * dt;
      s.z += Math.cos(s.heading) * -s.speed * dt;
      // Wrap around the player so the sky never empties.
      if (s.x - px > this.range) s.x -= this.range * 2;
      if (px - s.x > this.range) s.x += this.range * 2;
      if (s.z - pz > this.range) s.z -= this.range * 2;
      if (pz - s.z > this.range) s.z += this.range * 2;
      s.mesh.position.set(s.x, s.alt + Math.sin(time * 0.3 + s.speed) * 2, s.z);
      s.mesh.rotation.y = s.heading;
    }
    for (const o of this.orbs) {
      let x = o.dx + time * 1.5, z = o.dz;
      x = ((((x - px) % 1600) + 2400) % 1600) - 800 + px;
      z = ((((z - pz) % 1600) + 2400) % 1600) - 800 + pz;
      o.mesh.position.set(x, o.alt + Math.sin(time * 0.4 + o.ph) * 4, z);
    }
  }
}
