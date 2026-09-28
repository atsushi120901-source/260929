import * as THREE from 'three';
import { makeCarMesh } from './traffic.js';

const GRAVITY = 32;
const tmp = new THREE.Vector3();

function makeCharacter() {
  const g = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: 0x3a3d5c, metalness: 0.5, roughness: 0.4, emissive: 0x1a1c3a });
  const glow = new THREE.MeshBasicMaterial({ color: 0x00f0ff, toneMapped: false });
  const pink = new THREE.MeshBasicMaterial({ color: 0xff2bd6, toneMapped: false });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, 0.45), suit);
  torso.position.y = 1.25;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.08, 0.47), glow);
  stripe.position.y = 1.35;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), suit);
  head.position.y = 1.95;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.1), glow);
  visor.position.set(0, 1.98, -0.24);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.25), suit);
  pack.position.set(0, 1.3, 0.32);
  const packLight = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.02), pink);
  packLight.position.set(0, 1.4, 0.46);

  const limb = (w, h, mat) => {
    const pivot = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat);
    m.position.y = -h / 2;
    pivot.add(m);
    return pivot;
  };
  const legL = limb(0.28, 0.8, suit), legR = limb(0.28, 0.8, suit);
  legL.position.set(-0.2, 0.8, 0);
  legR.position.set(0.2, 0.8, 0);
  const armL = limb(0.2, 0.75, suit), armR = limb(0.2, 0.75, suit);
  armL.position.set(-0.52, 1.65, 0);
  armR.position.set(0.52, 1.65, 0);
  for (const l of [legL, legR]) {
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.34), glow);
    sole.position.y = -0.78;
    l.add(sole);
  }
  g.add(torso, stripe, head, visor, pack, packLight, legL, legR, armL, armR);
  g.userData = { legL, legR, armL, armR };
  return g;
}

export class Player {
  constructor(scene, city) {
    this.city = city;
    this.pos = new THREE.Vector3(50, 0, 104);
    this.vel = new THREE.Vector3();
    this.yaw = 0; // facing
    this.onGround = false;
    this.mesh = makeCharacter();
    scene.add(this.mesh);
    this.walkPhase = 0;
    this.radius = 0.5;
    this.height = 2.1;
  }

  update(dt, input, camYaw) {
    const fwd = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    const side = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
    const sprint = input.down('ShiftLeft') || input.down('ShiftRight');
    const speed = sprint ? 16 : 7;

    // Camera-relative movement; forward is -Z at yaw 0.
    tmp.set(side, 0, -fwd);
    const moving = tmp.lengthSq() > 0;
    if (moving) tmp.normalize().applyAxisAngle(THREE.Object3D.DEFAULT_UP, camYaw).multiplyScalar(speed);
    const accel = this.onGround ? 14 : 3;
    const k = 1 - Math.exp(-accel * dt);
    this.vel.x += (tmp.x - this.vel.x) * k;
    this.vel.z += (tmp.z - this.vel.z) * k;

    if (this.onGround && input.pressed('Space')) {
      this.vel.y = 12;
      this.onGround = false;
    }
    this.vel.y -= GRAVITY * dt;

    // Horizontal move + wall push-out first (at the previous height), then vertical.
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.city.resolve(this.pos, this.radius, this.height);
    this.pos.y += this.vel.y * dt;

    const ground = this.city.groundHeight(this.pos.x, this.pos.z, this.pos.y, this.radius * 0.6);
    if (this.pos.y <= ground) {
      this.pos.y = ground;
      if (this.vel.y < 0) this.vel.y = 0;
      this.onGround = true;
    } else {
      this.onGround = this.pos.y - ground < 0.05;
    }

    // Visuals
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > 0.5) {
      const target = Math.atan2(-this.vel.x, -this.vel.z);
      let d = target - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * (1 - Math.exp(-12 * dt));
    }
    this.walkPhase += dt * hs * 1.3;
    const swing = this.onGround ? Math.sin(this.walkPhase) * Math.min(1, hs / 7) * 0.8 : 0.5;
    const u = this.mesh.userData;
    u.legL.rotation.x = swing;
    u.legR.rotation.x = -swing;
    u.armL.rotation.x = -swing * 0.8;
    u.armR.rotation.x = swing * 0.8;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
  }

  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
}

export class Hovercar {
  constructor(scene, city) {
    this.city = city;
    this.mesh = makeCarMesh(0xff2bd6, 0xe8e8f0);
    this.mesh.scale.setScalar(1.1);
    scene.add(this.mesh);
    this.pos = new THREE.Vector3(62, 1.4, 104);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.roll = 0;
    this.pitch = 0;
    this.radius = 2.4;
    this.mesh.position.copy(this.pos);
  }

  placeAt(p, yaw) {
    this.pos.copy(p);
    this.pos.y = Math.max(this.pos.y, this.city.groundHeight(p.x, p.z, p.y + 2) + 1.4);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.syncMesh();
  }

  update(dt, input, camYaw, driving) {
    let fwd = 0, side = 0, up = 0, boost = false;
    if (driving) {
      fwd = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
      side = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
      up = (input.down('Space') ? 1 : 0) - (input.down('KeyC') || input.down('ControlLeft') ? 1 : 0);
      boost = input.down('ShiftLeft') || input.down('ShiftRight');
      // Nose follows the camera.
      let d = camYaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * (1 - Math.exp(-4 * dt));
    }
    const thrust = boost ? 110 : 55;
    tmp.set(side * 0.6, 0, -fwd).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw).multiplyScalar(thrust);
    this.vel.x += tmp.x * dt;
    this.vel.z += tmp.z * dt;
    this.vel.y += up * 40 * dt;

    const drag = Math.exp(-(boost ? 0.6 : 1.1) * dt);
    this.vel.x *= drag;
    this.vel.z *= drag;
    this.vel.y *= Math.exp(-2.5 * dt);
    if (!driving) this.vel.multiplyScalar(Math.exp(-3 * dt));

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    const bx = this.pos.x, bz = this.pos.z;
    const hit = this.city.resolve(this.pos, this.radius, 1.6);
    this.pos.y += this.vel.y * dt;
    if (hit) {
      // Kill velocity into the wall.
      const nx = this.pos.x - bx, nz = this.pos.z - bz;
      const n = Math.hypot(nx, nz);
      if (n > 1e-6) {
        const vn = (this.vel.x * nx + this.vel.z * nz) / n;
        if (vn < 0) {
          this.vel.x -= (vn * nx) / n * 1.3;
          this.vel.z -= (vn * nz) / n * 1.3;
        }
      }
    }
    const ground = this.city.groundHeight(this.pos.x, this.pos.z, this.pos.y, 1.2, 1.5) + 1.4;
    if (this.pos.y < ground) {
      this.pos.y = ground;
      if (this.vel.y < 0) this.vel.y = 0;
    }
    if (this.pos.y > 800) { this.pos.y = 800; this.vel.y = Math.min(this.vel.y, 0); }

    // Bank and pitch for feel.
    const localSide = this.vel.x * Math.cos(this.yaw) - this.vel.z * Math.sin(this.yaw);
    this.roll += (-localSide * 0.012 - this.roll) * (1 - Math.exp(-5 * dt));
    this.pitch += (this.vel.y * 0.012 - this.pitch) * (1 - Math.exp(-5 * dt));
    this.syncMesh(driving ? performance.now() / 1000 : 0);
  }

  syncMesh(t = 0) {
    this.mesh.position.copy(this.pos);
    this.mesh.position.y += Math.sin(t * 3) * 0.08;
    this.mesh.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
  }

  get speed() { return this.vel.length(); }
}
