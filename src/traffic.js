import * as THREE from 'three';
import { CELL } from './city.js';

const LANES = [1.8, 1.8, 24, 40, 62, 95]; // altitudes; street level appears twice for more ground traffic
const ACCENTS = [0xcfe6ff, 0xffd9a8, 0xf6c8ff, 0xbff0e0];
const BODIES = [0xf4f1f6, 0xf6ece8, 0xe9ecf6, 0xd9d2e6];

const shared = {};
function geos() {
  if (!shared.body) {
    shared.body = new THREE.CapsuleGeometry(1.1, 3.2, 6, 16);
    shared.body.rotateX(Math.PI / 2);
    shared.canopy = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    shared.glow = new THREE.BoxGeometry(1.6, 0.1, 3.8);
    shared.lamp = new THREE.BoxGeometry(1.2, 0.18, 0.1);
    shared.fin = new THREE.BoxGeometry(0.12, 0.7, 1.2);
  }
  return shared;
}

// Pearl hover-pod; forward is -Z.
export function makeCarMesh(accent = ACCENTS[0], bodyColor = BODIES[0]) {
  const g = geos();
  const car = new THREE.Group();
  const body = new THREE.Mesh(g.body, new THREE.MeshStandardMaterial({ color: bodyColor, metalness: 0.55, roughness: 0.18 }));
  body.scale.set(1, 0.62, 1);
  const canopy = new THREE.Mesh(g.canopy, new THREE.MeshStandardMaterial({ color: 0x5d6c9c, metalness: 1, roughness: 0.04 }));
  canopy.scale.set(0.9, 0.75, 1.5);
  canopy.position.set(0, 0.4, -0.4);
  const glow = new THREE.Mesh(g.glow, new THREE.MeshBasicMaterial({ color: accent, toneMapped: false }));
  glow.position.y = -0.62;
  const head = new THREE.Mesh(g.lamp, new THREE.MeshBasicMaterial({ color: 0xfff6e6, toneMapped: false }));
  head.position.set(0, 0.05, -2.72);
  const tail = new THREE.Mesh(g.lamp, new THREE.MeshBasicMaterial({ color: 0xff8a9a, toneMapped: false }));
  tail.position.set(0, 0.05, 2.72);
  const fin = new THREE.Mesh(g.fin, body.material);
  fin.position.set(0, 0.8, 2);
  car.add(body, canopy, glow, head, tail, fin);
  for (const o of car.children) o.castShadow = true;
  return car;
}

export class Traffic {
  constructor(scene, count = 70) {
    this.cars = [];
    this.range = CELL * 5;
    for (let i = 0; i < count; i++) {
      const mesh = makeCarMesh(ACCENTS[i % ACCENTS.length], BODIES[i % BODIES.length]);
      scene.add(mesh);
      this.cars.push({ mesh, axis: 'x', dir: 1, speed: 20, fixed: 0, alt: 0, pos: 0 });
    }
    this.initialized = false;
  }

  spawn(car, px, pz, anywhere) {
    car.axis = Math.random() < 0.5 ? 'x' : 'z';
    car.dir = Math.random() < 0.5 ? 1 : -1;
    car.alt = LANES[(Math.random() * LANES.length) | 0];
    car.speed = car.alt < 5 ? 12 + Math.random() * 8 : 20 + Math.random() * 25;
    // Roads run along multiples of CELL; keep to one side of the road.
    const other = car.axis === 'x' ? pz : px;
    const road = Math.round(other / CELL + (Math.random() * 8 - 4)) * CELL;
    car.fixed = road + car.dir * (car.axis === 'x' ? 3.5 : -3.5);
    const along = car.axis === 'x' ? px : pz;
    car.pos = anywhere
      ? along + (Math.random() * 2 - 1) * this.range
      : along - car.dir * this.range * (0.8 + Math.random() * 0.2);
    car.bob = Math.random() * 6;
  }

  update(dt, px, pz, time) {
    if (!this.initialized) {
      for (const c of this.cars) this.spawn(c, px, pz, true);
      this.initialized = true;
    }
    for (const c of this.cars) {
      c.pos += c.dir * c.speed * dt;
      const along = c.axis === 'x' ? px : pz;
      const other = c.axis === 'x' ? pz : px;
      if (Math.abs(c.pos - along) > this.range * 1.05 || Math.abs(c.fixed - other) > this.range * 1.2) {
        this.spawn(c, px, pz, false);
      }
      const y = c.alt + Math.sin(time * 2 + c.bob) * 0.25;
      if (c.axis === 'x') {
        c.mesh.position.set(c.pos, y, c.fixed);
        c.mesh.rotation.y = c.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
      } else {
        c.mesh.position.set(c.fixed, y, c.pos);
        c.mesh.rotation.y = c.dir > 0 ? Math.PI : 0;
      }
    }
  }
}
