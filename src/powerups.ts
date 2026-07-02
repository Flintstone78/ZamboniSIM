import * as THREE from 'three';
import {
  RINK_LENGTH,
  RINK_WIDTH,
  ZAM_COLLISION_RADIUS,
  POWERUP_MAX,
  POWERUP_INTERVAL,
  POWERUP_RADIUS,
} from './constants';
import { rinkSignedDistance } from './rink';
import { inGoalZone } from './goals';

export type PowerType = 'time' | 'boost' | 'flow';

const TYPES: PowerType[] = ['time', 'boost', 'flow'];
const COLORS: Record<PowerType, string> = {
  time: '#4caf50',
  boost: '#ffca28',
  flow: '#26c6da',
};

interface Pickup {
  group: THREE.Group;
  type: PowerType;
  pos: THREE.Vector2;
  active: boolean;
  phase: number;
}

/**
 * Floating power-ups that pop up on the ice through the run – drive over one to
 * grab it. A glowing ring + coloured core marks each type; collection fires a
 * callback so Game can apply the effect (time, boost refill, flow surge).
 */
export class PowerUps {
  readonly group = new THREE.Group();
  private pool: Pickup[] = [];
  private spawnTimer = 2;

  constructor(private onPickup: (type: PowerType) => void) {
    for (let i = 0; i < POWERUP_MAX; i++) {
      const g = new THREE.Group();
      const type = TYPES[i % TYPES.length];
      const color = COLORS[type];
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(POWERUP_RADIUS, 0.09, 10, 24),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4 }),
      );
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
      const core = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.28),
        new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: color, emissiveIntensity: 1.8 }),
      );
      g.add(core);
      g.visible = false;
      this.group.add(g);
      this.pool.push({ group: g, type, pos: new THREE.Vector2(), active: false, phase: Math.random() * 6 });
    }
  }

  reset(): void {
    this.spawnTimer = 2;
    for (const p of this.pool) {
      p.active = false;
      p.group.visible = false;
    }
  }

  update(dt: number, vehiclePos: THREE.Vector2): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = POWERUP_INTERVAL;
      this.spawnOne(vehiclePos);
    }
    for (const p of this.pool) {
      if (!p.active) continue;
      p.phase += dt;
      p.group.position.y = 0.7 + Math.sin(p.phase * 2.5) * 0.12;
      p.group.rotation.y += dt * 1.8;
      if (p.pos.distanceTo(vehiclePos) < ZAM_COLLISION_RADIUS + POWERUP_RADIUS) {
        p.active = false;
        p.group.visible = false;
        this.onPickup(p.type);
      }
    }
  }

  private spawnOne(vehiclePos: THREE.Vector2): void {
    const slot = this.pool.find((p) => !p.active);
    if (!slot) return;
    for (let attempt = 0; attempt < 60; attempt++) {
      const x = (Math.random() - 0.5) * (RINK_LENGTH - 10);
      const z = (Math.random() - 0.5) * (RINK_WIDTH - 8);
      if (rinkSignedDistance(x, z) > -2) continue;
      if (inGoalZone(x, z, 1.5)) continue;
      // Not right under the zamboni – it would be consumed before it's seen
      if (Math.hypot(x - vehiclePos.x, z - vehiclePos.y) < 6) continue;
      slot.pos.set(x, z);
      slot.group.position.set(x, 0.7, z);
      slot.active = true;
      slot.group.visible = true;
      return;
    }
  }
}
