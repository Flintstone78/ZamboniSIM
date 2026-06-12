import * as THREE from 'three';
import {
  PUCK_COUNT,
  CONE_COUNT,
  PUCK_RADIUS,
  CONE_RADIUS,
  ZAM_COLLISION_RADIUS,
  RINK_LENGTH,
  RINK_WIDTH,
} from './constants';
import { rinkSignedDistance, rinkBoundaryNormal } from './rink';

export interface ObstacleEvents {
  /** A standing cone was clipped and tips over. */
  onConeHit: () => void;
  /** A puck was shunted away (for sound effects). */
  onPuckHit: (speed: number) => void;
}

interface Puck {
  mesh: THREE.Mesh;
  pos: THREE.Vector2;
  vel: THREE.Vector2;
  hitCooldown: number;
}

interface Cone {
  mesh: THREE.Group;
  pos: THREE.Vector2;
  tipAxis: THREE.Vector3;
  tip: number; // 0 = standing, 1 = flat on the ice
  fallen: boolean;
}

/**
 * Forgotten pucks and maintenance cones on the ice. Pucks are harmless fun –
 * the zamboni shunts them sliding across the ice and they bounce off the
 * boards. Cones must be steered around: clipping one tips it over and costs
 * points (the penalty itself lives in Game).
 */
export class Obstacles {
  readonly group = new THREE.Group();
  private pucks: Puck[] = [];
  private cones: Cone[] = [];

  constructor(private events: ObstacleEvents) {
    const puckGeo = new THREE.CylinderGeometry(PUCK_RADIUS, PUCK_RADIUS, 0.05, 20);
    const puckMat = new THREE.MeshStandardMaterial({ color: '#16181c', roughness: 0.6 });
    for (let i = 0; i < PUCK_COUNT; i++) {
      const mesh = new THREE.Mesh(puckGeo, puckMat);
      mesh.position.y = 0.025;
      mesh.castShadow = true;
      this.group.add(mesh);
      this.pucks.push({
        mesh,
        pos: new THREE.Vector2(),
        vel: new THREE.Vector2(),
        hitCooldown: 0,
      });
    }

    for (let i = 0; i < CONE_COUNT; i++) {
      const mesh = this.buildCone();
      this.group.add(mesh);
      this.cones.push({
        mesh,
        pos: new THREE.Vector2(),
        tipAxis: new THREE.Vector3(1, 0, 0),
        tip: 0,
        fallen: false,
      });
    }
  }

  /** Re-randomise positions, keeping clear of the start point (clearX, clearZ). */
  reset(clearX: number, clearZ: number): void {
    const placed: THREE.Vector2[] = [];
    const place = (): THREE.Vector2 => {
      for (let attempt = 0; attempt < 200; attempt++) {
        const p = new THREE.Vector2(
          (Math.random() - 0.5) * (RINK_LENGTH - 6),
          (Math.random() - 0.5) * (RINK_WIDTH - 6),
        );
        if (rinkSignedDistance(p.x, p.y) > -2) continue;
        if (Math.hypot(p.x - clearX, p.y - clearZ) < 9) continue;
        if (placed.some((q) => q.distanceTo(p) < 3.5)) continue;
        placed.push(p);
        return p;
      }
      const fallback = new THREE.Vector2(0, 0);
      placed.push(fallback);
      return fallback;
    };

    for (const puck of this.pucks) {
      puck.pos.copy(place());
      puck.vel.set(0, 0);
      puck.hitCooldown = 0;
      puck.mesh.position.set(puck.pos.x, 0.025, puck.pos.y);
    }
    for (const cone of this.cones) {
      cone.pos.copy(place());
      cone.tip = 0;
      cone.fallen = false;
      cone.mesh.position.set(cone.pos.x, 0, cone.pos.y);
      cone.mesh.quaternion.identity();
    }
  }

  update(dt: number, vehiclePos: THREE.Vector2, vehicleVel: THREE.Vector2): void {
    this.updatePucks(dt, vehiclePos, vehicleVel);
    this.updateCones(dt, vehiclePos, vehicleVel);
  }

  private updatePucks(
    dt: number,
    vehiclePos: THREE.Vector2,
    vehicleVel: THREE.Vector2,
  ): void {
    const minDist = ZAM_COLLISION_RADIUS + PUCK_RADIUS;
    for (const puck of this.pucks) {
      puck.hitCooldown = Math.max(0, puck.hitCooldown - dt);

      // Shunted by the zamboni: pushed out and sent sliding
      const offset = puck.pos.clone().sub(vehiclePos);
      const dist = offset.length();
      if (dist < minDist) {
        const n = dist > 1e-4 ? offset.divideScalar(dist) : new THREE.Vector2(1, 0);
        puck.pos.copy(vehiclePos).addScaledVector(n, minDist);
        const impulse = Math.max(vehicleVel.dot(n), 0) + 1.2;
        puck.vel.copy(n).multiplyScalar(impulse);
        if (puck.hitCooldown === 0) {
          puck.hitCooldown = 0.5;
          this.events.onPuckHit(impulse);
        }
      }

      // Glide with a touch of ice friction, bounce off the boards
      puck.vel.multiplyScalar(Math.max(0, 1 - 0.25 * dt));
      puck.pos.addScaledVector(puck.vel, dt);
      const over = rinkSignedDistance(puck.pos.x, puck.pos.y) + PUCK_RADIUS;
      if (over > 0) {
        const n = rinkBoundaryNormal(puck.pos.x, puck.pos.y);
        puck.pos.addScaledVector(n, -over);
        const vAlongN = puck.vel.dot(n);
        if (vAlongN > 0) puck.vel.addScaledVector(n, -1.65 * vAlongN);
      }
      puck.mesh.position.set(puck.pos.x, 0.025, puck.pos.y);
    }
  }

  private updateCones(
    dt: number,
    vehiclePos: THREE.Vector2,
    vehicleVel: THREE.Vector2,
  ): void {
    const hitDist = ZAM_COLLISION_RADIUS + CONE_RADIUS;
    for (const cone of this.cones) {
      if (!cone.fallen) {
        if (cone.pos.distanceTo(vehiclePos) < hitDist) {
          cone.fallen = true;
          // Tip away from the zamboni, biased by its direction of travel
          const dir = cone.pos
            .clone()
            .sub(vehiclePos)
            .normalize()
            .addScaledVector(vehicleVel, 0.2)
            .normalize();
          // Rotating up=(0,1,0) around (dz, 0, -dx) leans the cone toward dir
          cone.tipAxis.set(dir.y, 0, -dir.x).normalize();
          this.events.onConeHit();
        }
        continue;
      }
      if (cone.tip < 1) {
        cone.tip = Math.min(1, cone.tip + dt * 3);
        const ease = 1 - (1 - cone.tip) * (1 - cone.tip);
        cone.mesh.quaternion.setFromAxisAngle(
          cone.tipAxis,
          ease * (Math.PI / 2 - 0.08),
        );
        // The pivot is the base centre, so lift a little to keep it on the ice
        cone.mesh.position.y = ease * 0.16;
      }
    }
  }

  private buildCone(): THREE.Group {
    const g = new THREE.Group();
    const orange = new THREE.MeshStandardMaterial({ color: '#ff6d00', roughness: 0.7 });
    const white = new THREE.MeshStandardMaterial({ color: '#f5f5f5', roughness: 0.6 });

    const base = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.05, 0.46), orange);
    base.position.y = 0.025;
    base.castShadow = true;
    g.add(base);

    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, CONE_RADIUS * 0.8, 0.52, 14),
      orange,
    );
    body.position.y = 0.31;
    body.castShadow = true;
    g.add(body);

    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.105, 0.155, 0.13, 14),
      white,
    );
    band.position.y = 0.33;
    g.add(band);

    return g;
  }
}
