import * as THREE from 'three';
import { RINK_LENGTH, RINK_WIDTH, ZAM_COLLISION_RADIUS } from './constants';
import { rinkSignedDistance, rinkBoundaryNormal } from './rink';
import { loadModelInto } from './assets';
import type { Obstacles } from './obstacles';

const SKATER_RADIUS = 0.55;
const MAX_SPEED = 6.5;
const ACCEL = 9;
const SKATER_HEIGHT = 1.85; // metres, for normalising the GLB
const MODEL_YAW = Math.PI; // align the model's facing with travel (+Z)
const JERSEYS = ['#d32f2f', '#1565c0', '#2e7d32', '#f9a825', '#6a1b9a', '#00838f'];

interface SkaterRig {
  fig: THREE.Group;
  /** Hip pivots – swung back/forth for the skating stride. */
  hips: [THREE.Group, THREE.Group];
  torso: THREE.Group;
}

/** Jersey texture: team colour with hem stripes, shoulder yoke, a chest crest
 *  and a big back number – wrapped around the torso cylinder. */
function jerseyTexture(jerseyHex: string, num: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = jerseyHex;
  ctx.fillRect(0, 0, 256, 256);
  // Darker shoulder yoke
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, 256, 34);
  // Hem stripes
  ctx.fillStyle = '#f4f4f4';
  ctx.fillRect(0, 196, 256, 22);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 222, 256, 10);
  // Back number (u≈0.75) and a simple chest crest (u≈0.25)
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 5;
  ctx.font = '900 92px "Arial Black", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeText(String(num), 192, 96);
  ctx.fillText(String(num), 192, 96);
  ctx.save();
  ctx.translate(64, 100);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = '#f4f4f4';
  ctx.fillRect(-26, -26, 52, 52);
  ctx.fillStyle = jerseyHex;
  ctx.fillRect(-16, -16, 32, 32);
  ctx.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A properly kitted hockey player facing +Z: textured jersey with back number,
 * shoulder/elbow bulk, breezers with side stripes, striped socks, helmet with
 * visor, and both gloves on a diagonal stick. The hip pivots are returned so
 * the legs can swing in a skating stride while moving.
 */
function buildSkaterFigure(jerseyHex: string, num: number): SkaterRig {
  const fig = new THREE.Group();
  const jersey = new THREE.MeshStandardMaterial({ color: jerseyHex, roughness: 0.75 });
  const jerseyTex = new THREE.MeshStandardMaterial({
    map: jerseyTexture(jerseyHex, num),
    roughness: 0.75,
  });
  const white = new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.8 });
  const pants = new THREE.MeshStandardMaterial({ color: '#161b26', roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: '#e8b98c', roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: '#15181f', roughness: 0.6 });
  const steel = new THREE.MeshStandardMaterial({ color: '#cfd6dd', roughness: 0.3, metalness: 0.7 });
  const visorMat = new THREE.MeshPhysicalMaterial({
    color: '#2a3340', roughness: 0.1, transparent: true, opacity: 0.55,
  });

  const part = (
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number, y: number, z: number,
    rx = 0, ry = 0, rz = 0,
  ): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  // --- Legs: hip pivot → bent thigh → shin (sock) → skate. Swinging the hip
  // pivot animates a stride with the knee bend preserved.
  const hips: THREE.Group[] = [];
  for (const side of [-1, 1] as const) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.16, 0.98, 0);
    part(hip, new THREE.CapsuleGeometry(0.115, 0.34, 3, 8), pants, 0, -0.2, 0.09, 0.5); // thigh
    part(hip, new THREE.CapsuleGeometry(0.1, 0.36, 3, 8), jersey, 0, -0.58, 0.1, -0.25); // shin/sock
    part(hip, new THREE.CylinderGeometry(0.105, 0.105, 0.09, 10), white, 0, -0.5, 0.12, -0.25); // sock stripe
    part(hip, new THREE.BoxGeometry(0.15, 0.17, 0.36), dark, 0, -0.85, 0.06); // boot
    part(hip, new THREE.BoxGeometry(0.025, 0.07, 0.34), steel, 0, -0.95, 0.06); // blade
    fig.add(hip);
    hips.push(hip);
  }

  // --- Hips/breezers with team-colour side stripes
  part(fig, new THREE.BoxGeometry(0.48, 0.32, 0.46), pants, 0, 1.08, 0.02);
  for (const side of [-1, 1] as const) {
    part(fig, new THREE.BoxGeometry(0.02, 0.3, 0.4), jersey, side * 0.25, 1.08, 0.02);
  }

  // --- Torso: textured jersey cylinder (number on the back), padded shoulders
  const torso = new THREE.Group();
  torso.position.set(0, 1.42, 0.02);
  torso.rotation.x = 0.2; // forward lean
  const chest = part(torso, new THREE.CylinderGeometry(0.245, 0.31, 0.62, 14), jerseyTex, 0, 0, 0);
  chest.rotation.y = Math.PI / 2; // crest to the chest (+Z), number to the back
  const dome = part(torso, new THREE.SphereGeometry(0.26, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), jersey, 0, 0.26, 0);
  dome.scale.y = 0.55; // flat shoulder-pad dome that stays below the chin

  // Arms: both reaching forward-down to the stick, elbow pads at the joint
  for (const side of [-1, 1] as const) {
    const armLift = side > 0 ? 0.1 : 0;
    part(torso, new THREE.CapsuleGeometry(0.085, 0.3, 3, 8), jersey, side * 0.32, 0.06 - armLift, 0.1, 1.0);
    part(torso, new THREE.SphereGeometry(0.09, 8, 8), dark, side * 0.33, -0.08 - armLift, 0.22); // elbow
    part(torso, new THREE.CapsuleGeometry(0.075, 0.26, 3, 8), jersey, side * 0.3, -0.2 - armLift, 0.36, 1.25);
    part(torso, new THREE.CylinderGeometry(0.08, 0.08, 0.07, 10), white, side * 0.31, -0.13 - armLift, 0.29, 1.25); // cuff stripe
  }
  fig.add(torso);

  // Gloves on the stick (team colour, dark cuffs)
  const glove = (x: number, y: number, z: number): void => {
    part(fig, new THREE.BoxGeometry(0.15, 0.13, 0.17), jersey, x, y, z);
    part(fig, new THREE.BoxGeometry(0.16, 0.06, 0.1), dark, x, y + 0.07, z - 0.08);
  };
  glove(-0.28, 1.2, 0.42); // top hand
  glove(0.22, 0.95, 0.62); // lower hand

  // Stick: diagonal shaft meeting a taped blade on the ice
  const stick = new THREE.Group();
  const shaft = part(stick, new THREE.BoxGeometry(0.035, 0.035, 1.45), dark, 0, 0, 0);
  shaft.castShadow = false;
  stick.position.set(0.0, 0.64, 0.6);
  stick.rotation.set(0.78, -0.1, 0.1);
  fig.add(stick);
  part(fig, new THREE.BoxGeometry(0.045, 0.11, 0.35), dark, 0.08, 0.05, 1.28, 0, -0.22);

  // --- Head: face + helmet shell + visor + chin strap
  const head = new THREE.Group();
  head.position.set(0, 1.86, 0.1);
  part(head, new THREE.SphereGeometry(0.145, 14, 12), skin, 0, 0, 0.01);
  part(head, new THREE.SphereGeometry(0.165, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.58), dark, 0, 0.03, -0.01);
  part(head, new THREE.BoxGeometry(0.24, 0.09, 0.02), visorMat, 0, 0.02, 0.15, -0.15);
  part(head, new THREE.BoxGeometry(0.02, 0.12, 0.02), dark, -0.13, -0.04, 0.08);
  part(head, new THREE.BoxGeometry(0.02, 0.12, 0.02), dark, 0.13, -0.04, 0.08);
  fig.add(head);

  return { fig, hips: [hips[0], hips[1]] as [THREE.Group, THREE.Group], torso };
}

interface Skater {
  group: THREE.Group;
  lean: THREE.Object3D; // the figure root, tilted into turns
  rig: SkaterRig | null; // hip pivots for the stride (null once a GLB loads)
  phase: number; // stride phase
  pos: THREE.Vector2;
  vel: THREE.Vector2;
  target: THREE.Vector2;
  retarget: number; // seconds until picking a new wander point
  shoveCd: number; // debounce stick-handling a puck
  hitCd: number; // debounce bumping the zamboni
  active: boolean;
}

/**
 * Impatient players who trickle onto the ice as the clock winds down, chasing
 * the loose pucks and stick-handling them around. They are moving hazards:
 * bumping one costs points and shoves you, but they actively dodge the zamboni
 * so a clean run is always possible. More of them appear the longer you take.
 */
export class Skaters {
  readonly group = new THREE.Group();
  private skaters: Skater[] = [];

  constructor(count = 6) {
    for (let i = 0; i < count; i++) {
      const g = new THREE.Group();
      // Detailed procedural player (shown until the GLB model loads). Wrapped
      // in `lean` so the whole figure can tilt into turns.
      const lean = new THREE.Group();
      const rig = buildSkaterFigure(JERSEYS[i % JERSEYS.length], 4 + i * 13);
      lean.add(rig.fig);
      g.add(lean);
      this.group.add(g);
      this.skaters.push({
        group: g,
        lean,
        rig,
        phase: i * 1.7, // desynchronised strides
        pos: new THREE.Vector2(),
        vel: new THREE.Vector2(),
        target: new THREE.Vector2(),
        retarget: 0,
        shoveCd: 0,
        hitCd: 0,
        active: false,
      });
    }

    // Upgrade to the generated 3D player model when available (one normalised
    // clone per skater); the procedural figures stay if the asset is missing.
    loadModelInto('/assets/skater.glb', (model) => {
      model.rotation.y = MODEL_YAW;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      model.scale.setScalar(SKATER_HEIGHT / Math.max(size.y, 0.001));
      box.setFromObject(model);
      const c = box.getCenter(new THREE.Vector3());
      model.position.set(-c.x, -box.min.y, -c.z);
      model.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = true;
      });
      for (const s of this.skaters) {
        const clone = model.clone(true);
        s.lean.clear();
        s.lean.add(clone);
        s.rig = null; // the procedural stride rig is gone with the old figure
      }
    });
    this.reset();
  }

  get activeCount(): number {
    let n = 0;
    for (const s of this.skaters) if (s.active) n++;
    return n;
  }

  reset(): void {
    for (const s of this.skaters) {
      s.active = false;
      s.group.visible = false;
    }
  }

  /** Make sure at least `n` players are on the ice; returns how many were just
   *  sent on (so Game can announce the first one). New ones hop the boards. */
  ensureActive(n: number): number {
    let added = 0;
    for (let i = 0; i < this.skaters.length && this.activeCount < n; i++) {
      const s = this.skaters[i];
      if (s.active) continue;
      s.active = true;
      s.group.visible = true;
      s.pos.set(((i + 0.5) / this.skaters.length - 0.5) * (RINK_LENGTH - 10), -RINK_WIDTH / 2 + 2);
      s.vel.set(0, 0);
      s.retarget = 0;
      s.shoveCd = 0;
      s.hitCd = 0;
      added++;
    }
    return added;
  }

  /**
   * Advance the skaters, let them stick-handle pucks, and resolve collisions
   * with the zamboni. Returns the impact speed of a fresh bump, else 0.
   */
  update(dt: number, vehiclePos: THREE.Vector2, obstacles: Obstacles): number {
    let impact = 0;
    for (const s of this.skaters) {
      if (!s.active) continue;
      s.shoveCd = Math.max(0, s.shoveCd - dt);
      s.hitCd = Math.max(0, s.hitCd - dt);
      s.retarget -= dt;

      // Aim for the nearest loose puck; otherwise wander
      const puck = obstacles.nearestPuck(s.pos);
      if (puck && s.shoveCd === 0) {
        s.target.copy(puck);
      } else if (s.retarget <= 0) {
        s.target.set(
          (Math.random() - 0.5) * (RINK_LENGTH - 10),
          (Math.random() - 0.5) * (RINK_WIDTH - 8),
        );
        s.retarget = 1.5 + Math.random() * 2;
      }

      const desired = s.target.clone().sub(s.pos);
      if (desired.lengthSq() > 1e-4) desired.normalize().multiplyScalar(MAX_SPEED);
      // Politely swerve around the zamboni so a clean run stays possible
      const away = s.pos.clone().sub(vehiclePos);
      const near = away.length();
      if (near < 4 && near > 1e-4) desired.addScaledVector(away.divideScalar(near), MAX_SPEED * (4 - near) * 0.5);

      s.vel.addScaledVector(desired.sub(s.vel), Math.min(1, (ACCEL / MAX_SPEED) * dt));
      if (s.vel.length() > MAX_SPEED) s.vel.setLength(MAX_SPEED);
      s.pos.addScaledVector(s.vel, dt);

      // Stick-handle: nudge a puck along when close
      if (s.shoveCd === 0 && puck && s.pos.distanceTo(puck) < 1.1) {
        obstacles.shovePucks(s.pos, 1.3, 3.5);
        s.shoveCd = 0.6;
        s.retarget = 0;
      }

      // Stay on the ice
      const over = rinkSignedDistance(s.pos.x, s.pos.y) + SKATER_RADIUS;
      if (over > 0) {
        const n = rinkBoundaryNormal(s.pos.x, s.pos.y);
        s.pos.addScaledVector(n, -over);
        const vN = s.vel.dot(n);
        if (vN > 0) s.vel.addScaledVector(n, -1.5 * vN);
      }

      // Bump the zamboni
      const off = s.pos.clone().sub(vehiclePos);
      const d = off.length();
      const minD = ZAM_COLLISION_RADIUS + SKATER_RADIUS;
      if (d < minD && d > 1e-4) {
        const n = off.divideScalar(d);
        s.pos.copy(vehiclePos).addScaledVector(n, minD);
        s.vel.addScaledVector(n, MAX_SPEED); // knocked back
        if (s.hitCd === 0) {
          s.hitCd = 1.5;
          impact = Math.max(impact, 1);
        }
      }

      // Render: stand on the ice, face travel direction, lean into the turn
      s.group.position.set(s.pos.x, 0, s.pos.y);
      if (s.vel.lengthSq() > 0.05) s.group.rotation.y = Math.atan2(s.vel.x, s.vel.y);
      s.lean.rotation.z = THREE.MathUtils.clamp(-s.vel.length() * 0.04, -0.3, 0.3);

      // Skating stride: swing the hip pivots with speed, settle when gliding
      if (s.rig) {
        const speed = s.vel.length();
        s.phase += dt * (2.2 + speed * 1.6);
        const amp = Math.min(0.55, speed * 0.12);
        const swing = Math.sin(s.phase) * amp;
        s.rig.hips[0].rotation.x = swing;
        s.rig.hips[1].rotation.x = -swing;
        // A touch of counter-rotation and bob sells the push-off
        s.rig.torso.rotation.y = Math.sin(s.phase) * amp * 0.18;
        s.rig.fig.position.y = Math.abs(Math.cos(s.phase)) * amp * 0.05;
      }
    }
    return impact;
  }
}
