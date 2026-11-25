import * as THREE from 'three';

const MAX = 420; // pool size: comfortably above peak rate × LIFE
const LIFE = 0.9; // seconds – long enough for the highest arcs to land
const DEAD_Y = -1000; // where retired flakes are parked (frustum culling is off)

/** A soft round flake, so points read as snow rather than square pixels. */
function flakeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Lightweight ice-spray burst thrown up behind the conditioner blade while
 * resurfacing. A single THREE.Points pool recycled round-robin, with simple
 * ballistic motion and a per-flake fade-out – cheap but juicy.
 *
 * Emission is a rate (flakes per second) integrated over dt, so the amount of
 * spray doesn't depend on how often the simulation steps.
 */
export class IceSpray {
  readonly points: THREE.Points;
  private positions: Float32Array;
  private colors: Float32Array; // rgba; alpha drives the fade
  private velocities: Float32Array;
  private ages: Float32Array;
  private cursor = 0;
  private carry = 0; // fractional flakes owed from previous emits

  constructor() {
    this.positions = new Float32Array(MAX * 3);
    this.colors = new Float32Array(MAX * 4).fill(1);
    this.velocities = new Float32Array(MAX * 3);
    this.ages = new Float32Array(MAX);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 4));
    const mat = new THREE.PointsMaterial({
      color: '#eaf4ff',
      size: 0.2,
      map: flakeTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.reset();
  }

  /** Retire every flake (level start/restart – nothing carries over). */
  reset(): void {
    this.ages.fill(LIFE + 1);
    for (let k = 0; k < MAX; k++) {
      this.positions[k * 3 + 1] = DEAD_Y;
      this.colors[k * 4 + 3] = 0;
    }
    this.carry = 0;
    this.markDirty();
  }

  /**
   * Spray at `rate` flakes/second for `dt` seconds from world point (x,z),
   * thrown back along heading.
   */
  emit(x: number, z: number, heading: number, rate: number, dt: number): void {
    this.carry += rate * dt;
    const count = Math.floor(this.carry);
    this.carry -= count;
    const backX = -Math.sin(heading);
    const backZ = -Math.cos(heading);
    const sideUnitX = Math.cos(heading);
    const sideUnitZ = -Math.sin(heading);
    for (let i = 0; i < count; i++) {
      const k = this.cursor;
      this.cursor = (this.cursor + 1) % MAX;
      const across = (Math.random() - 0.5) * 2.1; // spread along the blade
      const spread = (Math.random() - 0.5) * 1.4;
      this.positions[k * 3] = x + sideUnitX * across;
      this.positions[k * 3 + 1] = 0.1;
      this.positions[k * 3 + 2] = z + sideUnitZ * across;
      const sp = 1.5 + Math.random() * 2.5;
      this.velocities[k * 3] = backX * sp + sideUnitX * spread;
      this.velocities[k * 3 + 1] = 1.8 + Math.random() * 1.8;
      this.velocities[k * 3 + 2] = backZ * sp + sideUnitZ * spread;
      this.ages[k] = 0;
      this.colors[k * 4 + 3] = 1;
    }
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const drag = Math.exp(-1.2 * dt); // air slows the throw a touch
    for (let k = 0; k < MAX; k++) {
      if (this.ages[k] > LIFE) continue;
      this.ages[k] += dt;
      const life = this.ages[k] / LIFE;
      if (life > 1) {
        // Expired mid-flight – hide it instead of leaving it frozen in the air
        this.positions[k * 3 + 1] = DEAD_Y;
        this.colors[k * 4 + 3] = 0;
        continue;
      }
      this.velocities[k * 3] *= drag;
      this.velocities[k * 3 + 2] *= drag;
      this.velocities[k * 3 + 1] -= 9 * dt; // gravity
      this.positions[k * 3] += this.velocities[k * 3] * dt;
      this.positions[k * 3 + 1] += this.velocities[k * 3 + 1] * dt;
      this.positions[k * 3 + 2] += this.velocities[k * 3 + 2] * dt;
      if (this.positions[k * 3 + 1] < 0.02) {
        // Landed: it melts into the fresh water film
        this.ages[k] = LIFE + 1;
        this.positions[k * 3 + 1] = DEAD_Y;
        this.colors[k * 4 + 3] = 0;
        continue;
      }
      this.colors[k * 4 + 3] = 1 - life * life; // ease out
    }
    this.markDirty();
  }

  private markDirty(): void {
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}
