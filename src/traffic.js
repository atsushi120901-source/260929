import * as THREE from 'three';
import { CELL } from './city.js';

const LANES = [1.6, 1.6, 22, 38, 60, 90]; // altitudes; ground level appears twice for more street traffic
const COLORS = [0x00f0ff, 0xff2bd6, 0xffcc33, 0x7dff9a, 0xff4d6d];

export function makeCarMesh(color = 0x00f0ff, bodyColor = 0x1b1d2a) {
  const car = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 0.9, 5),
    new THREE.MeshStandardMaterial({ color: bodyColor, metalness: 0.9, roughness: 0.25 }),
  );
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 0.7, 2.4),
    new THREE.MeshStandardMaterial({ color: 0x0a0f1a, metalness: 1, roughness: 0.05, emissive: color, emissiveIntensity: 0.15 }),
  );
  cabin.position.set(0, 0.75, -0.2);
  const glow = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  const under = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 4.6), glow);
  under.position.y = -0.5;
  const head = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.18, 0.1), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
  head.position.set(0, 0.1, -2.55);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.18, 0.1), new THREE.MeshBasicMaterial({ color: 0xff2040, toneMapped: false }));
  tail.position.set(0, 0.1, 2.55);
  car.add(body, cabin, under, head, tail);
  return car;
}

export class Traffic {
  constructor(scene, count = 70) {
    this.scene = scene;
    this.cars = [];
    this.range = CELL * 5;
    for (let i = 0; i < count; i++) {
      const mesh = makeCarMesh(COLORS[i % COLORS.length], [0x1b1d2a, 0x2a1b2a, 0x1b2a2a, 0xdddde8][i % 4]);
      scene.add(mesh);
      this.cars.push({ mesh, axis: 'x', dir: 1, speed: 20, lane: 0, fixed: 0, alt: 0 });
    }
    this.initialized = false;
  }

  spawn(car, px, pz, anywhere) {
    car.axis = Math.random() < 0.5 ? 'x' : 'z';
    car.dir = Math.random() < 0.5 ? 1 : -1;
    car.alt = LANES[(Math.random() * LANES.length) | 0];
    car.speed = car.alt < 5 ? 14 + Math.random() * 10 : 25 + Math.random() * 30;
    // Roads run along multiples of CELL; keep to the right-hand side of the road.
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
