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

/** A blocky-but-readable hockey player: helmet, jersey, pants, socks, skates,
 *  arms and a stick, posed mid-stride leaning forward (forward = +Z). */
function buildSkaterFigure(jerseyHex: string): THREE.Group {
  const fig = new THREE.Group();
  const jersey = new THREE.MeshStandardMaterial({ color: jerseyHex, roughness: 0.7 });
  const pants = new THREE.MeshStandardMaterial({ color: '#1a1f2b', roughness: 0.8 });
  const sock = new THREE.MeshStandardMaterial({ color: jerseyHex, roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: '#e8b98c', roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: '#15181f', roughness: 0.6 });

  const part = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number, y: number, z: number,
    rx = 0, ry = 0, rz = 0,
  ): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    fig.add(m);
    return m;
  };

  // Legs in a stride: one trailing (-z), one leading (+z), with socks + skates
  const legGeo = new THREE.CapsuleGeometry(0.11, 0.55, 3, 8);
  const skateBoot = new THREE.BoxGeometry(0.16, 0.16, 0.34);
  const blade = new THREE.BoxGeometry(0.03, 0.06, 0.36);
  for (const dir of [-1, 1] as const) {
    const lx = dir * 0.14;
    part(legGeo, sock, lx, 0.5, dir * 0.18, dir * 0.32);
    part(skateBoot, dark, lx, 0.13, dir * 0.42);
    part(blade, dark, lx, 0.02, dir * 0.42);
  }

  // Hips / breezers
  part(new THREE.BoxGeometry(0.46, 0.3, 0.5), pants, 0, 0.92, 0.02);

  // Torso (jersey), hunched forward a touch
  part(new THREE.CapsuleGeometry(0.27, 0.5, 4, 10), jersey, 0, 1.28, 0.04, 0.25);

  // Shoulders + arms, the lead arm reaching forward to the stick
  part(new THREE.BoxGeometry(0.62, 0.2, 0.34), jersey, 0, 1.5, 0.06);
  const armGeo = new THREE.CapsuleGeometry(0.08, 0.42, 3, 8);
  part(armGeo, jersey, -0.34, 1.32, 0.16, 0.7); // trailing arm
  part(armGeo, jersey, 0.34, 1.28, 0.34, 1.0); // lead arm forward
  const gloveGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
  part(gloveGeo, dark, -0.36, 1.06, 0.34);
  part(gloveGeo, dark, 0.38, 1.04, 0.62);

  // Neck + head + helmet
  part(new THREE.SphereGeometry(0.15, 12, 12), skin, 0, 1.74, 0.08);
  part(new THREE.SphereGeometry(0.17, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), jersey, 0, 1.78, 0.07);

  // Stick: from the lead glove down and forward to the ice
  const shaft = part(new THREE.BoxGeometry(0.04, 0.04, 1.5), dark, 0.4, 0.55, 1.0, 0.62);
  shaft.castShadow = false;
  part(new THREE.BoxGeometry(0.05, 0.14, 0.34), dark, 0.4, 0.08, 1.66, 0.2);

  return fig;
}

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
      // Detailed procedural player (shown until the GLB model loads). Wrapped
      // in `lean` so the whole figure can tilt into turns.
      const lean = new THREE.Group();
      lean.add(buildSkaterFigure(JERSEYS[i % JERSEYS.length]));
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
