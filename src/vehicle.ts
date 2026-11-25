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
  ZAM_LENGTH,
  ZAM_WIDTH,
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

/** A rendered pose: position on the ice plane plus heading. */
export interface Pose {
  x: number;
  z: number;
  heading: number;
}

// Steering tapers off with speed so a flat-out (or boosting) zamboni doesn't
// twitch: full lock up to STEER_TAPER_START m/s, losing up to
// STEER_TAPER_AMOUNT of it over the next STEER_TAPER_RANGE m/s.
const STEER_TAPER_START = 2.5;
const STEER_TAPER_RANGE = 7;
const STEER_TAPER_AMOUNT = 0.32;
const STEER_RATE_IN = 6; // 1/s – how fast the wheel winds toward full lock
const STEER_RATE_OUT = 9.5; // 1/s – self-centring is a touch quicker

// Visual weight transfer: the body squats under throttle, dips under braking
// and leans out of turns on a slightly under-damped spring, so it settles
// with a small rock instead of snapping. Purely cosmetic – the physics stays
// a flat 2D model.
const PITCH_PER_ACCEL = 0.006; // rad per m/s² of longitudinal acceleration
const ROLL_PER_ACCEL = 0.0038; // rad per m/s² of lateral acceleration
const MAX_PITCH = 0.03;
const MAX_ROLL = 0.035;
const TILT_STIFFNESS = 55;
const TILT_DAMPING = 8;
const IMPACT_TILT = 0.045; // angular kick per m/s of impact speed

// Wall contact: above IMPACT_SPEED (m/s into the wall) it's a knock that
// scrubs speed once; below, the machine grinds along with this friction (1/s).
const IMPACT_SPEED = 0.8;
const GRIND_FRICTION = 1.6;
const MAX_PUSH_SPEED = 9; // m/s – fastest an obstacle may shove the machine out of an overlap

const clamp = THREE.MathUtils.clamp;

/**
 * The zamboni as a capsule for contacts with small things (pucks, skaters):
 * a centre segment along the heading plus a radius, matching the 4.6 × 1.9 m
 * body. The single 1.5 m circle let pucks sink 0.8 m into the nose and tail.
 */
export const BODY_RADIUS = ZAM_WIDTH / 2 + 0.05;
export const BODY_HALF_SEGMENT = ZAM_LENGTH / 2 - ZAM_WIDTH / 2;

/** Closest point to (px, pz) on the centre segment of a body at pos/heading. */
export function bodySegmentPoint(
  pos: THREE.Vector2,
  heading: number,
  px: number,
  pz: number,
  out: THREE.Vector2,
): THREE.Vector2 {
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  const t = clamp((px - pos.x) * fx + (pz - pos.y) * fz, -BODY_HALF_SEGMENT, BODY_HALF_SEGMENT);
  return out.set(pos.x + fx * t, pos.y + fz * t);
}

/** Frame-rate independent exponential approach of `a` toward `b`. */
export function damp(a: number, b: number, rate: number, dt: number): number {
  return b + (a - b) * Math.exp(-rate * dt);
}

/**
 * Kinematic bicycle model with icy lateral slip. Heading 0 faces +Z and the
 * forward vector is (sin heading, cos heading) in the XZ plane, matching a
 * mesh whose nose points along local +Z with rotation.y = heading.
 *
 * The game steps this at a fixed rate; `prevPosition`/`prevHeading` hold the
 * previous step so rendering can interpolate between the two (see lerpPose).
 */
export class Vehicle {
  position = new THREE.Vector2(0, 0); // (x, z)
  heading = 0;
  velocity = new THREE.Vector2(0, 0);
  steer = 0;
  /** The conditioner blade – only cleans while down. */
  bladeDown = false;

  /** Pose at the previous simulation step (for render interpolation). */
  readonly prevPosition = new THREE.Vector2(0, 0);
  prevHeading = 0;

  /** Cosmetic body tilt (radians): + pitch dips the nose, + roll drops the right side. */
  pitch = 0;
  roll = 0;
  private pitchVel = 0;
  private rollVel = 0;

  private collisionCooldown = 0;
  private lastDt = 1 / 120;

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
    this.pitch = this.roll = this.pitchVel = this.rollVel = 0;
    this.snapInterpolation();
  }

  /** Forget the previous step – call after teleporting so rendering doesn't
   *  interpolate across the jump. */
  snapInterpolation(): void {
    this.prevPosition.copy(this.position);
    this.prevHeading = this.heading;
  }

  /** The pose `alpha` (0..1) of the way from the previous step to this one. */
  lerpPose(alpha: number, out: Pose = { x: 0, z: 0, heading: 0 }): Pose {
    const a = clamp(alpha, 0, 1);
    out.x = this.prevPosition.x + (this.position.x - this.prevPosition.x) * a;
    out.z = this.prevPosition.y + (this.position.y - this.prevPosition.y) * a;
    out.heading = this.prevHeading + (this.heading - this.prevHeading) * a;
    return out;
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
    this.prevPosition.copy(this.position);
    this.prevHeading = this.heading;
    this.lastDt = dt;
    this.collisionCooldown = Math.max(0, this.collisionCooldown - dt);

    const fwd = this.forward;
    let vF = this.velocity.dot(fwd);
    const vFStart = vF;

    // Steering eases toward the input for a heavier, machine-like feel: it
    // winds on a little slower than it self-centres, and full lock tapers
    // off with speed.
    const taper =
      1 - clamp((Math.abs(vF) - STEER_TAPER_START) / STEER_TAPER_RANGE, 0, 1) * STEER_TAPER_AMOUNT;
    const targetSteer = steerInput * MAX_STEER * taper;
    const centring =
      Math.abs(targetSteer) < Math.abs(this.steer) ||
      Math.sign(targetSteer) !== Math.sign(this.steer);
    this.steer = damp(this.steer, targetSteer, centring ? STEER_RATE_OUT : STEER_RATE_IN, dt);

    const accel = ENGINE_ACCEL * (1 + boost * (BOOST_ACCEL_MULT - 1));
    const maxFwd = MAX_SPEED_FWD * (1 + boost * (BOOST_SPEED_MULT - 1));

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
    const yawRate = (vF / WHEELBASE) * Math.tan(this.steer);
    this.heading += yawRate * dt;
    lateral.multiplyScalar(Math.exp(-LATERAL_GRIP * (1 - boost * 0.4) * dt));

    const newFwd = this.forward;
    this.velocity.copy(lateral).addScaledVector(newFwd, vF);
    this.position.addScaledVector(this.velocity, dt);

    this.resolveBoundaryCollision();
    this.updateTilt(dt, vFStart, yawRate);
  }

  /** Spring the cosmetic body pitch/roll toward the current weight transfer. */
  private updateTilt(dt: number, vFStart: number, yawRate: number): void {
    const vF = this.forwardSpeed;
    const aLong = (vF - vFStart) / dt;
    const aLat = vF * yawRate; // centripetal: + when turning left (toward +X)
    const pitchTarget = clamp(-aLong * PITCH_PER_ACCEL, -MAX_PITCH, MAX_PITCH);
    const rollTarget = clamp(aLat * ROLL_PER_ACCEL, -MAX_ROLL, MAX_ROLL);
    this.pitchVel += ((pitchTarget - this.pitch) * TILT_STIFFNESS - this.pitchVel * TILT_DAMPING) * dt;
    this.rollVel += ((rollTarget - this.roll) * TILT_STIFFNESS - this.rollVel * TILT_DAMPING) * dt;
    this.pitch = clamp(this.pitch + this.pitchVel * dt, -MAX_PITCH * 1.6, MAX_PITCH * 1.6);
    this.roll = clamp(this.roll + this.rollVel * dt, -MAX_ROLL * 1.6, MAX_ROLL * 1.6);
  }

  /** Rock the body on an impact: momentum carries the top toward the wall. */
  private kickTilt(nx: number, nz: number, speed: number): void {
    const s = Math.min(speed, 6) * IMPACT_TILT;
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    // Local +X (the driver's left) in world space is (cos h, -sin h)
    this.pitchVel += (nx * fx + nz * fz) * s;
    this.rollVel -= (nx * fz - nz * fx) * s;
  }

  private resolveBoundaryCollision(): void {
    const d = this.boundary.sdf(this.position.x, this.position.y);
    const overlap = d + ZAM_COLLISION_RADIUS;
    if (overlap <= 0) return;

    const n = this.boundary.normal(this.position.x, this.position.y);
    this.position.addScaledVector(n, -overlap);

    const vAlongN = this.velocity.dot(n);
    if (vAlongN > 0 && this.respondToContact(n.x, n.y, vAlongN)) this.registerHit(vAlongN);
  }

  /**
   * Shared contact response for a wall whose outward normal is (nx, nz) and
   * which we're moving into at `into` m/s. The inward velocity is removed
   * (boards aren't bouncy). A real knock scrubs speed once and rocks the
   * body; a light lean against the wall just grinds along it with friction,
   * so hugging the boards to reach the edge ice feels smooth instead of
   * sticking. Returns true for a knock.
   */
  respondToContact(nx: number, nz: number, into: number): boolean {
    this.velocity.x -= nx * into * 1.1;
    this.velocity.y -= nz * into * 1.1;
    if (into > IMPACT_SPEED) {
      this.velocity.multiplyScalar(0.5);
      this.kickTilt(nx, nz, into);
      return true;
    }
    this.velocity.multiplyScalar(Math.exp(-GRIND_FRICTION * this.lastDt));
    return false;
  }

  /** Push out of a circular obstacle (a parked car). Returns the impact speed
   *  of a fresh hit (debounced), else 0. */
  collideCircle(cx: number, cz: number, radius: number): number {
    const offset = new THREE.Vector2(this.position.x - cx, this.position.y - cz);
    const dist = offset.length();
    const minDist = radius + ZAM_COLLISION_RADIUS;
    if (dist >= minDist) return 0;
    const n = dist > 1e-4 ? offset.divideScalar(dist) : new THREE.Vector2(1, 0);
    // Resolve a deep overlap (e.g. a car parking onto the machine) over a few
    // steps instead of teleporting metres in one.
    const push = Math.min(minDist - dist, MAX_PUSH_SPEED * this.lastDt);
    this.position.addScaledVector(n, push);
    const vAlongN = -this.velocity.dot(n);
    if (vAlongN > 0 && this.respondToContact(-n.x, -n.y, vAlongN) && this.collisionCooldown <= 0) {
      this.collisionCooldown = 1.2;
      return vAlongN;
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

// Gamepad button (standard mapping) → the key codes its press triggers.
// A = blade/dump + menu confirm, B = menu back, Y = camera, Back = restart,
// Start = pause, D-pad up/down = menu focus.
const PAD_TAPS: Record<number, string[]> = {
  0: ['Space', 'PadConfirm'],
  1: ['PadBack'],
  3: ['KeyC'],
  8: ['KeyR'],
  9: ['KeyP'],
  12: ['PadUp'],
  13: ['PadDown'],
};

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
  /** Touch overlay state (see touch.ts) – merged into the player-0 axes. */
  touchThrottle = 0;
  touchSteer = 0;
  touchBoost = false;
  /** Gamepad state, refreshed by poll() once per frame. */
  padThrottle = 0;
  padSteer = 0;
  padBoost = false;
  /** Fired on any gamepad button press (e.g. to dismiss the title splash). */
  onAnyPadButton: (() => void) | null = null;
  private padPrev: boolean[] = [];

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

  /**
   * Read the first connected gamepad (standard mapping): left stick or D-pad
   * steers, right/left triggers are throttle/reverse, RB or X boosts. Button
   * presses fire the same tap handlers as their keyboard equivalents, plus
   * Pad* codes used for menu navigation. Call once per frame.
   */
  poll(): void {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    let gp: Gamepad | null = null;
    for (const p of pads) {
      if (p && p.connected) {
        gp = p;
        break;
      }
    }
    if (!gp) {
      this.padThrottle = 0;
      this.padSteer = 0;
      this.padBoost = false;
      this.padPrev.length = 0;
      return;
    }
    const btn = (i: number): GamepadButton | undefined => gp.buttons[i];
    const pressed = (i: number): boolean => !!btn(i)?.pressed;

    // Stick with a dead zone, rescaled, and a gentle curve for fine control
    // around centre (left on the stick = steer left = positive)
    const raw = gp.axes[0] ?? 0;
    const dz = 0.14;
    const mag = Math.max(0, (Math.abs(raw) - dz) / (1 - dz));
    let steer = -Math.sign(raw) * Math.pow(mag, 1.4);
    if (pressed(14)) steer = 1;
    if (pressed(15)) steer = -1;
    this.padSteer = steer;

    let throttle = (btn(7)?.value ?? 0) - (btn(6)?.value ?? 0);
    if (pressed(12)) throttle = 1;
    if (pressed(13)) throttle = -1;
    this.padThrottle = Math.abs(throttle) < 0.05 ? 0 : throttle;
    this.padBoost = pressed(5) || pressed(2);

    for (let i = 0; i < gp.buttons.length; i++) {
      const down = pressed(i);
      if (down && !this.padPrev[i]) {
        for (const code of PAD_TAPS[i] ?? []) this.onTap[code]?.();
        this.onAnyPadButton?.();
      }
      this.padPrev[i] = down;
    }
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
    if (player === 0 && t === 0) t = this.touchThrottle;
    if (player === 0 && t === 0) t = this.padThrottle;
    return t;
  }

  steer(player: number): number {
    let s = 0;
    for (const k of this.keysFor(player)) {
      if (this.has(k.left)) s = 1;
      if (this.has(k.right)) s = s === 1 ? 0 : -1;
    }
    if (player === 0 && s === 0) s = this.touchSteer;
    if (player === 0 && s === 0) s = this.padSteer;
    return s;
  }

  /** Key codes that toggle the given player's blade. */
  bladeCodes(player: number): string[] {
    return this.keysFor(player).flatMap((k) => k.blade);
  }

  /** Turbo held (Shift). Player 1 in co-op uses the right control key. */
  boosting(player: number): boolean {
    if (player !== 1 && (this.touchBoost || this.padBoost)) return true;
    return player === 1
      ? this.has(['ControlRight', 'ShiftRight'])
      : this.has(['ShiftLeft', 'ShiftRight']);
  }
}
