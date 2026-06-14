import * as THREE from 'three';
import {
  RINK_WIDTH,
  BOARD_HEIGHT,
  GLASS_HEIGHT,
  GATE_X_MIN,
  GATE_X_MAX,
  GARAGE_DEPTH,
} from './constants';
import { rinkSignedDistance } from './rink';

// The tunnel is sized to the board+glass opening so it reads as a clean portal
// from the rink, not an oversized garage box poking through the stands.
const TUNNEL_H = BOARD_HEIGHT + GLASS_HEIGHT;
const DOOR_TRAVEL = 2.4;
const DOOR_SPEED = 2.4; // metres per second (open in ~1s)

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
  private door: THREE.Group;
  private doorOpen = 0; // 0 = closed, 1 = fully open
  private opening = false;

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

    // Corridor floor (matches the opening width)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(width + 0.3, GARAGE_DEPTH), concrete);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, -0.01, cz);
    floor.receiveShadow = true;
    this.group.add(floor);

    // Clean rectangular tunnel flush with the opening: two side walls at the
    // jamb lines, a ceiling at the glass top, and a back wall.
    for (const side of [-1, 1] as const) {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, TUNNEL_H, GARAGE_DEPTH),
        wallMat,
      );
      wall.position.set(cx + side * (width / 2 + 0.1), TUNNEL_H / 2, cz);
      this.group.add(wall);
    }
    const back = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.4, TUNNEL_H, 0.3),
      wallMat,
    );
    back.position.set(cx, TUNNEL_H / 2, this.corridorZMin - 0.15);
    this.group.add(back);
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.4, 0.22, GARAGE_DEPTH),
      wallMat,
    );
    roof.position.set(cx, TUNNEL_H, cz);
    this.group.add(roof);

    // Cold strip lights in the tunnel ceiling
    const lampMat = new THREE.MeshStandardMaterial({
      color: '#fff',
      emissive: '#eaf4ff',
      emissiveIntensity: 2,
    });
    for (const lz of [this.boardZ - 2.5, this.boardZ - 6.5]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 1.6), lampMat);
      lamp.position.set(cx, TUNNEL_H - 0.16, lz);
      this.group.add(lamp);
    }

    // The sliding door itself: board-white with a yellow kick stripe
    const door = new THREE.Group();
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(width, BOARD_HEIGHT + 0.5, 0.14),
      new THREE.MeshStandardMaterial({ color: '#f5f5f5', roughness: 0.55 }),
    );
    panel.position.y = (BOARD_HEIGHT + 0.5) / 2;
    door.add(panel);
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(width, 0.2, 0.16),
      new THREE.MeshStandardMaterial({ color: '#f2c40f', roughness: 0.6 }),
    );
    stripe.position.y = 0.1;
    door.add(stripe);
    door.position.set(cx, 0, this.boardZ - 0.07);
    this.door = door;
    this.group.add(door);

    // The gate stands open for the whole resurfacing: the door starts rolled
    // fully up and out of sight, so there's never a closed/hovering panel.
    this.doorOpen = 1;
    this.opening = true;
    this.door.position.y = DOOR_TRAVEL;
    this.door.visible = false;

    // White jamb posts framing the opening up to the glass top
    const edgeMat = new THREE.MeshStandardMaterial({ color: '#e8e8e8', roughness: 0.6 });
    for (const x of [GATE_X_MIN, GATE_X_MAX]) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.1, TUNNEL_H, 0.3), edgeMat);
      cap.position.set(x, TUNNEL_H / 2, this.boardZ);
      this.group.add(cap);
    }
    // Red lintel across the top, matching the board cap
    const lintel = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.3, 0.12, 0.32),
      new THREE.MeshStandardMaterial({ color: '#b71c1c', roughness: 0.45 }),
    );
    lintel.position.set(cx, TUNNEL_H, this.boardZ);
    this.group.add(lintel);
  }

  /** Start the door animation (called when a level begins). */
  open(): void {
    this.opening = true;
  }

  get isOpen(): boolean {
    return this.doorOpen >= 0.95;
  }

  update(dt: number): void {
    if (this.opening && this.doorOpen < 1) {
      this.doorOpen = Math.min(1, this.doorOpen + (dt * DOOR_SPEED) / DOOR_TRAVEL);
      this.door.position.y = this.doorOpen * DOOR_TRAVEL;
    }
    // Hide the door once it's fully up – it's tucked away, gate open
    this.door.visible = this.doorOpen < 0.99;
  }

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
