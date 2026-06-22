import * as THREE from 'three';
import {
  RINK_WIDTH,
  BOARD_HEIGHT,
  GATE_X_MIN,
  GATE_X_MAX,
  GARAGE_DEPTH,
} from './constants';
import { rinkSignedDistance } from './rink';

/** Rectangle SDF for the garage corridor (negative inside). */
function rectSignedDistance(
  x: number,
  z: number,
  xMin: number,
  xMax: number,
  zMin: number,
  zMax: number,
): number {
  const cx = (xMin + xMax) / 2;
  const cz = (zMin + zMax) / 2;
  const qx = Math.abs(x - cx) - (xMax - xMin) / 2;
  const qz = Math.abs(z - cz) - (zMax - zMin) / 2;
  return Math.min(Math.max(qx, qz), 0) + Math.hypot(Math.max(qx, 0), Math.max(qz, 0));
}

/**
 * The equipment-room gate: a gap in the long (-Z) boards with a sliding door
 * and a garage corridor outside it. Owns the level's drivable boundary – the
 * union of the rink and (once the door has opened) the corridor. Rebuilt per
 * level because the board it attaches to moves with the rink width.
 */
export class Gate {
  readonly group = new THREE.Group();

  /** Inner face of the -Z boards for the current rink width. */
  private readonly boardZ = -RINK_WIDTH / 2;
  private readonly corridorZMin = -RINK_WIDTH / 2 - GARAGE_DEPTH;
  private readonly gateCenterX = (GATE_X_MIN + GATE_X_MAX) / 2;

  /** Where the zamboni parks at level start (corridor centre, facing +Z). */
  readonly spawn = {
    x: this.gateCenterX,
    z: -RINK_WIDTH / 2 - (GARAGE_DEPTH - 3),
    heading: 0, // forward = (sin0, cos0) = +Z, straight at the gate
  };

  /** Z of the gate plane and how far back the chase camera may sit inside the
   * garage (keeps it from peering over the low garage walls at the start). */
  readonly gateZ = this.boardZ;
  readonly cameraMinZ = this.corridorZMin + 1.5;

  constructor() {
    const concrete = new THREE.MeshStandardMaterial({ color: '#2b3036', roughness: 0.95 });
    const wallMat = new THREE.MeshStandardMaterial({ color: '#39424d', roughness: 0.9 });

    const width = GATE_X_MAX - GATE_X_MIN;
    const cx = this.gateCenterX;
    const cz = (this.boardZ + this.corridorZMin) / 2;

    // An OPEN bay – no roof, no door, only knee-high curbs – so from the start
    // the driver sees straight onto the ice and knows to drive out.
    const CURB_H = 0.85;

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(width + 0.3, GARAGE_DEPTH), concrete);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, -0.01, cz);
    floor.receiveShadow = true;
    this.group.add(floor);

    for (const side of [-1, 1] as const) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.2, CURB_H, GARAGE_DEPTH), wallMat);
      wall.position.set(cx + side * (width / 2 + 0.1), CURB_H / 2, cz);
      this.group.add(wall);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(width + 0.4, CURB_H, 0.3), wallMat);
    back.position.set(cx, CURB_H / 2, this.corridorZMin - 0.15);
    this.group.add(back);

    // Two floodlight poles light the open bay (no ceiling)
    const poleMat = new THREE.MeshStandardMaterial({ color: '#2b2f36', roughness: 0.6, metalness: 0.4 });
    const lampMat = new THREE.MeshStandardMaterial({ color: '#fff7e0', emissive: '#ffe8a8', emissiveIntensity: 2.2 });
    for (const side of [-1, 1] as const) {
      const px = cx + side * (width / 2 + 0.7);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 4.2), poleMat);
      pole.position.set(px, 2.1, this.corridorZMin + 1);
      this.group.add(pole);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.25, 0.6), lampMat);
      lamp.position.set(px - side * 0.3, 4.2, this.corridorZMin + 1.4);
      this.group.add(lamp);
      const light = new THREE.PointLight('#ffe9b8', 30, 26, 2);
      light.position.set(px, 4, this.corridorZMin + 1.4);
      this.group.add(light);
    }

    // Tidy board-height caps closing the cut ends of the rink boards
    const edgeMat = new THREE.MeshStandardMaterial({ color: '#e8e8e8', roughness: 0.6 });
    for (const x of [GATE_X_MIN, GATE_X_MAX]) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.1, BOARD_HEIGHT, 0.3), edgeMat);
      cap.position.set(x, BOARD_HEIGHT / 2, this.boardZ);
      this.group.add(cap);
    }

  }

  /** No-op: the bay is always open. */
  open(): void {}

  get isOpen(): boolean {
    return true;
  }

  /** The bay is always open; nothing to animate. */
  update(_dt: number): void {}

  /**
   * Signed distance to the drivable boundary: the rink joined with the
   * corridor. While the door is closed the corridor ends at the door; once
   * open it overlaps deep into the rink so the union has no narrow waist at
   * the gate (inside the rink the rink's own SDF dominates, so the corridor's
   * phantom walls never appear there).
   */
  boundarySignedDistance = (x: number, z: number): number => {
    const zMax = this.isOpen ? this.boardZ + 8 : this.boardZ - 0.25;
    return Math.min(
      rinkSignedDistance(x, z),
      rectSignedDistance(x, z, GATE_X_MIN, GATE_X_MAX, this.corridorZMin, zMax),
    );
  };

  boundaryNormal = (x: number, z: number): THREE.Vector2 => {
    const e = 0.01;
    const nx =
      this.boundarySignedDistance(x + e, z) - this.boundarySignedDistance(x - e, z);
    const nz =
      this.boundarySignedDistance(x, z + e) - this.boundarySignedDistance(x, z - e);
    return new THREE.Vector2(nx, nz).normalize();
  };
}
