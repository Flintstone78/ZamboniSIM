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
} from './constants';

export interface VehicleEvents {
  onCollision: (impactSpeed: number) => void;
}

/**
 * A static collision boundary the vehicle is confined to. Negative signed
 * distance means inside; the normal points outward (toward the wall). Each
 * level supplies its own – the rink boards, the parking-lot perimeter, etc.
 */
export interface Bounds {
  signedDistance(x: number, z: number): number;
  normal(x: number, z: number): THREE.Vector2;
}

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

  bounds: Bounds | null = null;
  private collisionCooldown = 0;

  constructor(private events: VehicleEvents) {}

  reset(x: number, z: number, heading: number): void {
    this.position.set(x, z);
    this.heading = heading;
    this.velocity.set(0, 0);
    this.steer = 0;
    this.collisionCooldown = 0;
  }

  get forward(): THREE.Vector2 {
    return new THREE.Vector2(Math.sin(this.heading), Math.cos(this.heading));
  }

  /** Signed speed along the vehicle's forward axis (m/s). */
  get forwardSpeed(): number {
    return this.velocity.dot(this.forward);
  }

  update(dt: number, throttle: number, steerInput: number): void {
    this.collisionCooldown = Math.max(0, this.collisionCooldown - dt);

    // Steering eases toward the input for a heavier, machine-like feel
    const targetSteer = steerInput * MAX_STEER;
    this.steer += (targetSteer - this.steer) * Math.min(1, dt * 6);

    const fwd = this.forward;
    let vF = this.velocity.dot(fwd);
    const lateral = this.velocity.clone().addScaledVector(fwd, -vF);

    // Throttle / braking. Opposing input brakes before it reverses.
    if (throttle > 0) {
      vF += (vF < -0.05 ? BRAKE_DECEL : ENGINE_ACCEL) * throttle * dt;
    } else if (throttle < 0) {
      vF += (vF > 0.05 ? BRAKE_DECEL : ENGINE_ACCEL) * throttle * dt;
    } else {
      vF -= Math.sign(vF) * Math.min(Math.abs(vF), ROLL_DRAG * dt);
    }
    vF = THREE.MathUtils.clamp(vF, -MAX_SPEED_REV, MAX_SPEED_FWD);

    // Yaw from the bicycle model; sideways slide bleeds off slowly (ice!)
    this.heading += (vF / WHEELBASE) * Math.tan(this.steer) * dt;
    lateral.multiplyScalar(Math.max(0, 1 - LATERAL_GRIP * dt));

    const newFwd = this.forward;
    this.velocity.copy(lateral).addScaledVector(newFwd, vF);
    this.position.addScaledVector(this.velocity, dt);

    this.resolveBounds();
  }

  private resolveBounds(): void {
    if (!this.bounds) return;
    const d = this.bounds.signedDistance(this.position.x, this.position.y);
    const overlap = d + ZAM_COLLISION_RADIUS;
    if (overlap <= 0) return;

    const n = this.bounds.normal(this.position.x, this.position.y);
    this.position.addScaledVector(n, -overlap);

    const vAlongN = this.velocity.dot(n);
    if (vAlongN > 0) {
      // Kill the outward velocity and most of the rest – walls are not bouncy
      this.velocity.addScaledVector(n, -vAlongN * 1.1);
      this.velocity.multiplyScalar(0.4);
      this.reportImpact(vAlongN);
    }
  }

  /**
   * Resolve a collision against a circular obstacle (e.g. a parked car),
   * pushing the vehicle out and reporting the impact. `radius` is the
   * obstacle's radius; the vehicle's own radius is added on top.
   */
  collideCircle(cx: number, cz: number, radius: number): void {
    const dx = this.position.x - cx;
    const dz = this.position.y - cz;
    const dist = Math.hypot(dx, dz);
    const minDist = radius + ZAM_COLLISION_RADIUS;
    if (dist >= minDist) return;

    const n = dist > 1e-4
      ? new THREE.Vector2(dx / dist, dz / dist)
      : new THREE.Vector2(0, 1);
    this.position.addScaledVector(n, minDist - dist);

    const vAlongN = this.velocity.dot(n);
    if (vAlongN < 0) {
      this.velocity.addScaledVector(n, -vAlongN * 1.1);
      this.velocity.multiplyScalar(0.5);
      this.reportImpact(-vAlongN);
    }
  }

  private reportImpact(speed: number): void {
    if (this.collisionCooldown === 0 && speed > 0.8) {
      this.collisionCooldown = 1.2;
      this.events.onCollision(speed);
    }
  }
}

/** Tracks pressed keys and exposes them as throttle/steer axes. */
export class Input {
  private keys = new Set<string>();
  onTap: Record<string, () => void> = {};

  constructor() {
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (!e.repeat) this.onTap[k]?.();
      this.keys.add(k);
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  get throttle(): number {
    let t = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) t += 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) t -= 1;
    return t;
  }

  get steer(): number {
    let s = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) s += 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) s -= 1;
    return s;
  }
}
