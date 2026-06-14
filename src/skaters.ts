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

interface Skater {
  group: THREE.Group;
  lean: THREE.Object3D; // the figure root, tilted into turns
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
      // Procedural figure (fallback / shown until the GLB model loads). Wrapped
      // in `lean` so the whole figure can tilt into turns.
      const lean = new THREE.Group();
      const jersey = new THREE.MeshStandardMaterial({
        color: JERSEYS[i % JERSEYS.length],
        roughness: 0.7,
      });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.7, 4, 10), jersey);
      body.position.y = 0.95;
      body.castShadow = true;
      lean.add(body);
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.17, 12, 12),
        new THREE.MeshStandardMaterial({ color: '#e8b98c', roughness: 0.8 }),
      );
      head.position.y = 1.5;
      lean.add(head);
      const stick = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.05, 1.3),
        new THREE.MeshStandardMaterial({ color: '#5b3a1e', roughness: 0.7 }),
      );
      stick.position.set(0.28, 0.25, 0.5);
      stick.rotation.x = 0.5;
      lean.add(stick);
      g.add(lean);
      this.group.add(g);
      this.skaters.push({
        group: g,
        lean,
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
    }
    return impact;
  }
}
