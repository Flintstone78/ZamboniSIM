import * as THREE from 'three';

const MAX = 160; // particle pool size
const LIFE = 0.6; // seconds

/**
 * Lightweight ice-spray burst thrown up behind the conditioner blade while
 * resurfacing. A single THREE.Points pool recycled round-robin, with simple
 * ballistic motion and a fade-out – cheap but juicy.
 */
export class IceSpray {
  readonly points: THREE.Points;
  private positions: Float32Array;
  private velocities: Float32Array;
  private ages: Float32Array;
  private cursor = 0;

  constructor() {
    this.positions = new Float32Array(MAX * 3);
    this.velocities = new Float32Array(MAX * 3);
    this.ages = new Float32Array(MAX).fill(LIFE + 1); // start dead

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const mat = new THREE.PointsMaterial({
      color: '#eaf4ff',
      size: 0.16,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  /** Spray `count` flakes from world point (x,z), thrown back along heading. */
  emit(x: number, z: number, heading: number, count: number): void {
    const backX = -Math.sin(heading);
    const backZ = -Math.cos(heading);
    for (let i = 0; i < count; i++) {
      const k = this.cursor;
      this.cursor = (this.cursor + 1) % MAX;
      const spread = (Math.random() - 0.5) * 1.4;
      const sideX = Math.cos(heading) * spread;
      const sideZ = -Math.sin(heading) * spread;
      this.positions[k * 3] = x;
      this.positions[k * 3 + 1] = 0.1;
      this.positions[k * 3 + 2] = z;
      const sp = 1.5 + Math.random() * 2.5;
      this.velocities[k * 3] = backX * sp + sideX;
      this.velocities[k * 3 + 1] = 1.8 + Math.random() * 1.8;
      this.velocities[k * 3 + 2] = backZ * sp + sideZ;
      this.ages[k] = 0;
    }
  }

  update(dt: number): void {
    for (let k = 0; k < MAX; k++) {
      if (this.ages[k] > LIFE) continue;
      this.ages[k] += dt;
      this.velocities[k * 3 + 1] -= 9 * dt; // gravity
      this.positions[k * 3] += this.velocities[k * 3] * dt;
      this.positions[k * 3 + 1] += this.velocities[k * 3 + 1] * dt;
      this.positions[k * 3 + 2] += this.velocities[k * 3 + 2] * dt;
      if (this.positions[k * 3 + 1] < 0.02) {
        this.positions[k * 3 + 1] = 0.02;
        this.ages[k] = LIFE + 1; // settle and retire
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
