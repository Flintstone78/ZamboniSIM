import * as THREE from 'three';
import {
  MAX_SPEED_FWD,
  MAX_SPEED_REV,
  ENGINE_ACCEL,
  BRAKE_DECEL,
  ROLL_DRAG,
  WHEELBASE,
  MAX_STEER,
  LATERAL_GRIP,
  ZAM_COLLISION_RADIUS,
  BOOST_SPEED_MULT,
  BOOST_ACCEL_MULT,
} from './constants';
import { rinkSignedDistance, rinkBoundaryNormal } from './rink';

export interface VehicleEvents {
  onCollision: (impactSpeed: number) => void;
}

/** Drivable-area boundary: signed distance (negative inside) + outward normal. */
export interface Boundary {
  sdf: (x: number, z: number) => number;
  normal: (x: number, z: number) => THREE.Vector2;
}

const RINK_BOUNDARY: Boundary = {
  sdf: rinkSignedDistance,
  normal: rinkBoundaryNormal,
};

/**
 * Kinematic bicycle model with icy lateral slip. Heading 0 faces +Z and the
 * forward vector is (sin heading, cos heading) in the XZ plane, matching a
 * mesh whose nose points along local +Z with rotation.y = heading.
 */
export class Vehicle {
  position = new THREE.Vector2(0, 0); // (x, z)
  heading = 0;
  velocity = new THREE.Vector2(0, 0);
  steer = 0;
  /** The conditioner blade – only cleans while down. */
  bladeDown = false;

  private collisionCooldown = 0;

  constructor(
    private events: VehicleEvents,
    private boundary: Boundary = RINK_BOUNDARY,
  ) {}

  reset(x: number, z: number, heading: number): void {
    this.position.set(x, z);
    this.heading = heading;
    this.velocity.set(0, 0);
    this.steer = 0;
    this.bladeDown = false;
    this.collisionCooldown = 0;
  }

  get forward(): THREE.Vector2 {
    return new THREE.Vector2(Math.sin(this.heading), Math.cos(this.heading));
  }

  /** Signed speed along the vehicle's forward axis (m/s). */
  get forwardSpeed(): number {
    return this.velocity.dot(this.forward);
  }

  /** Report an impact, debounced so one scrape doesn't spam events. */
  registerHit(impactSpeed: number): void {
    if (this.collisionCooldown > 0) return;
    this.collisionCooldown = 1.2;
    this.events.onCollision(impactSpeed);
  }

  update(dt: number, throttle: number, steerInput: number, boost = 0): void {
    this.collisionCooldown = Math.max(0, this.collisionCooldown - dt);

    // Steering eases toward the input for a heavier, machine-like feel
    const targetSteer = steerInput * MAX_STEER;
    this.steer += (targetSteer - this.steer) * Math.min(1, dt * 6);

    const accel = ENGINE_ACCEL * (1 + boost * (BOOST_ACCEL_MULT - 1));
    const maxFwd = MAX_SPEED_FWD * (1 + boost * (BOOST_SPEED_MULT - 1));

    const fwd = this.forward;
    let vF = this.velocity.dot(fwd);
    const lateral = this.velocity.clone().addScaledVector(fwd, -vF);

    // Throttle / braking. Opposing input brakes before it reverses.
    if (throttle > 0) {
      vF += (vF < -0.05 ? BRAKE_DECEL : accel) * throttle * dt;
    } else if (throttle < 0) {
      vF += (vF > 0.05 ? BRAKE_DECEL : accel) * throttle * dt;
    } else {
      vF -= Math.sign(vF) * Math.min(Math.abs(vF), ROLL_DRAG * dt);
    }
    vF = THREE.MathUtils.clamp(vF, -MAX_SPEED_REV, maxFwd);

    // Yaw from the bicycle model; sideways slide bleeds off slowly (ice!).
    // Boosting trades grip for a looser, faster, more skiddy feel.
    this.heading += (vF / WHEELBASE) * Math.tan(this.steer) * dt;
    lateral.multiplyScalar(Math.max(0, 1 - LATERAL_GRIP * (1 - boost * 0.4) * dt));

    const newFwd = this.forward;
    this.velocity.copy(lateral).addScaledVector(newFwd, vF);
    this.position.addScaledVector(this.velocity, dt);

    this.resolveBoundaryCollision();
  }

  private resolveBoundaryCollision(): void {
    const d = this.boundary.sdf(this.position.x, this.position.y);
    const overlap = d + ZAM_COLLISION_RADIUS;
    if (overlap <= 0) return;

    const n = this.boundary.normal(this.position.x, this.position.y);
    this.position.addScaledVector(n, -overlap);

    const vAlongN = this.velocity.dot(n);
    if (vAlongN > 0) {
      // Kill the outward velocity and most of the rest – boards are not bouncy
      this.velocity.addScaledVector(n, -vAlongN * 1.1);
      this.velocity.multiplyScalar(0.4);
      if (vAlongN > 0.8) this.registerHit(vAlongN);
    }
  }

  /** Push out of a circular obstacle (a parked car). Returns the impact speed
   *  of a fresh hit (debounced), else 0. */
  collideCircle(cx: number, cz: number, radius: number): number {
    const offset = new THREE.Vector2(this.position.x - cx, this.position.y - cz);
    const dist = offset.length();
    const minDist = radius + ZAM_COLLISION_RADIUS;
    if (dist >= minDist) return 0;
    const n = dist > 1e-4 ? offset.divideScalar(dist) : new THREE.Vector2(1, 0);
    this.position.set(cx + n.x * minDist, cz + n.y * minDist);
    const vAlongN = -this.velocity.dot(n);
    if (vAlongN > 0) {
      this.velocity.addScaledVector(n, vAlongN * 1.1);
      this.velocity.multiplyScalar(0.5);
      if (vAlongN > 0.8 && this.collisionCooldown <= 0) {
        this.collisionCooldown = 1.2;
        return vAlongN;
      }
    }
    return 0;
  }
}

/** Push two vehicles apart when they collide; returns impact speed or 0. */
export function resolveVehicleCollision(a: Vehicle, b: Vehicle): number {
  const offset = b.position.clone().sub(a.position);
  const dist = offset.length();
  const minDist = ZAM_COLLISION_RADIUS * 2;
  if (dist >= minDist || dist < 1e-4) return 0;
  const n = offset.divideScalar(dist);
  const push = (minDist - dist) / 2;
  a.position.addScaledVector(n, -push);
  b.position.addScaledVector(n, push);
  const closing = a.velocity.dot(n) - b.velocity.dot(n);
  if (closing > 0) {
    a.velocity.addScaledVector(n, -closing * 0.6);
    b.velocity.addScaledVector(n, closing * 0.6);
    return closing;
  }
  return 0;
}

interface PlayerKeys {
  fwd: string[];
  back: string[];
  left: string[];
  right: string[];
  blade: string[];
}

const PLAYER_KEYS: PlayerKeys[] = [
  {
    fwd: ['KeyW'],
    back: ['KeyS'],
    left: ['KeyA'],
    right: ['KeyD'],
    blade: ['Space'],
  },
  {
    fwd: ['ArrowUp'],
    back: ['ArrowDown'],
    left: ['ArrowLeft'],
    right: ['ArrowRight'],
    blade: ['Enter'],
  },
];

/**
 * Tracks pressed keys (by physical key code, layout-independent) and exposes
 * per-player throttle/steer axes. In single-player mode player 0 also gets
 * player 1's keys, so both WASD and the arrows work.
 */
export class Input {
  private keys = new Set<string>();
  /** Single-player merges both key sets onto player 0. */
  shareKeys = true;
  onTap: Record<string, () => void> = {};

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (!e.repeat) this.onTap[e.code]?.();
      this.keys.add(e.code);
      if (
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)
      ) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private has(codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  private keysFor(player: number): PlayerKeys[] {
    if (player === 0 && this.shareKeys) return PLAYER_KEYS;
    return [PLAYER_KEYS[player]];
  }

  throttle(player: number): number {
    let t = 0;
    for (const k of this.keysFor(player)) {
      if (this.has(k.fwd)) t = 1;
      if (this.has(k.back)) t = t === 1 ? 0 : -1;
    }
    return t;
  }

  steer(player: number): number {
    let s = 0;
    for (const k of this.keysFor(player)) {
      if (this.has(k.left)) s = 1;
      if (this.has(k.right)) s = s === 1 ? 0 : -1;
    }
    return s;
  }

  /** Key codes that toggle the given player's blade. */
  bladeCodes(player: number): string[] {
    return this.keysFor(player).flatMap((k) => k.blade);
  }

  /** Turbo held (Shift). Player 1 in co-op uses the right control key. */
  boosting(player: number): boolean {
    return player === 1
      ? this.has(['ControlRight', 'ShiftRight'])
      : this.has(['ShiftLeft', 'ShiftRight']);
  }
}
