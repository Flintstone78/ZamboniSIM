import * as THREE from 'three';
import {
  RINK_LENGTH,
  GOAL_WIDTH,
  GOAL_DEPTH,
  GOAL_HEIGHT,
  ZAM_COLLISION_RADIUS,
} from './constants';
import type { Vehicle } from './vehicle';
import type { IceResurfacer } from './ice';

// Goals start pulled a good way in from the end boards so the first lap can
// run cleanly along every board – including the strip behind each net. Once
// that strip is resurfaced the net is "moved" back against the end boards
// (lifted and tilted out of the way), freeing its footprint.
const START_X = RINK_LENGTH / 2 - 7; // 23 m: net mouth faces centre ice
const MOVE_SECONDS = 1.3;
const BEHIND_CLEAN_THRESHOLD = 0.5;

interface GoalBox {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
}

interface GoalEntry {
  mesh: THREE.Group;
  side: 1 | -1; // +1 = +X end, -1 = -X end
  anim: number; // 0 = in play, 1 = moved against the boards
  lifting: boolean;
  moved: boolean;
}

// Footprints of goals that are still in play (collision + no-clean). Rebuilt
// whenever a goal starts moving, and read by inGoalZone / puck placement.
let goalBoxes: GoalBox[] = [];

/** True under an in-play goal cage (can't be resurfaced while the net sits). */
export function inGoalZone(x: number, z: number, margin = 0.25): boolean {
  return goalBoxes.some(
    (b) => x > b.xMin - margin && x < b.xMax + margin && z > b.zMin - margin && z < b.zMax + margin,
  );
}

function footprint(side: 1 | -1): GoalBox {
  const mouth = side * START_X;
  const back = side * (START_X + GOAL_DEPTH);
  return {
    xMin: Math.min(mouth, back),
    xMax: Math.max(mouth, back),
    zMin: -GOAL_WIDTH / 2,
    zMax: GOAL_WIDTH / 2,
  };
}

/** A goal facing local +X: posts at x=0, net sloping back toward -X. */
function buildGoalMesh(): THREE.Group {
  const goal = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: '#c8102e', roughness: 0.45 });
  const netMat = new THREE.MeshStandardMaterial({
    color: '#e8eef4',
    roughness: 0.9,
    transparent: true,
    opacity: 0.45,
    side: THREE.DoubleSide,
  });

  const postGeo = new THREE.CylinderGeometry(0.05, 0.05, GOAL_HEIGHT, 10);
  for (const z of [-GOAL_WIDTH / 2, GOAL_WIDTH / 2]) {
    const post = new THREE.Mesh(postGeo, red);
    post.position.set(0, GOAL_HEIGHT / 2, z);
    post.castShadow = true;
    goal.add(post);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, GOAL_WIDTH + 0.1, 10), red);
  bar.rotation.x = Math.PI / 2;
  bar.position.set(0, GOAL_HEIGHT, 0);
  goal.add(bar);

  const backNet = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.hypot(GOAL_DEPTH, GOAL_HEIGHT), GOAL_WIDTH),
    netMat,
  );
  backNet.rotation.y = Math.PI / 2;
  backNet.rotation.z = Math.PI / 2 - Math.atan2(GOAL_HEIGHT, GOAL_DEPTH);
  backNet.rotation.order = 'YZX';
  backNet.position.set(-GOAL_DEPTH / 2, GOAL_HEIGHT / 2, 0);
  goal.add(backNet);
  for (const z of [-GOAL_WIDTH / 2, GOAL_WIDTH / 2]) {
    const sideShape = new THREE.Shape();
    sideShape.moveTo(0, 0);
    sideShape.lineTo(0, GOAL_HEIGHT);
    sideShape.lineTo(-GOAL_DEPTH, 0);
    sideShape.closePath();
    const sideNet = new THREE.Mesh(new THREE.ShapeGeometry(sideShape), netMat);
    sideNet.position.set(0, 0, z);
    goal.add(sideNet);
  }
  return goal;
}

/** Both nets, started in play and moved aside once cleaned behind. */
export class Goals {
  readonly group = new THREE.Group();
  private entries: GoalEntry[] = [];

  constructor() {
    for (const side of [1, -1] as const) {
      const mesh = buildGoalMesh();
      this.group.add(mesh);
      this.entries.push({ mesh, side, anim: 0, lifting: false, moved: false });
    }
    this.reset();
  }

  reset(): void {
    for (const e of this.entries) {
      e.anim = 0;
      e.lifting = false;
      e.moved = false;
      e.mesh.visible = true;
      this.place(e);
    }
    goalBoxes = this.entries.map((e) => footprint(e.side));
  }

  private place(e: GoalEntry): void {
    const m = e.mesh;
    const endX = e.side * (RINK_LENGTH / 2 - 0.7);
    const x = THREE.MathUtils.lerp(e.side * START_X, endX, e.anim);
    m.position.set(x, Math.sin(e.anim * Math.PI) * 0.5, 0);
    // Mouth faces centre ice; lifts and tilts back onto the boards as it moves
    m.rotation.set(0, e.side > 0 ? Math.PI : 0, e.anim * (Math.PI / 2 - 0.1));
  }

  /** Animate any goal whose behind-strip has been resurfaced. Returns how many
   *  nets started moving this frame (for a cheer/popup). */
  update(dt: number, ice: IceResurfacer): number {
    let justLifted = 0;
    for (const e of this.entries) {
      if (e.moved) continue;
      if (!e.lifting) {
        // The board strip directly behind this net (between it and the end)
        const back = e.side * (START_X + GOAL_DEPTH);
        const stripMin = e.side > 0 ? back : -RINK_LENGTH / 2;
        const stripMax = e.side > 0 ? RINK_LENGTH / 2 : back;
        if (ice.regionCoverage(stripMin, stripMax, -GOAL_WIDTH, GOAL_WIDTH) > BEHIND_CLEAN_THRESHOLD) {
          e.lifting = true;
          justLifted++;
        }
      }
      if (e.lifting && e.anim < 1) {
        e.anim = Math.min(1, e.anim + dt / MOVE_SECONDS);
        this.place(e);
        if (e.anim >= 1) e.moved = true;
      }
    }
    if (justLifted > 0) {
      goalBoxes = this.entries
        .filter((e) => !e.lifting && !e.moved)
        .map((e) => footprint(e.side));
    }
    return justLifted;
  }

  /** Box-collision push-out for in-play nets. Returns impact speed, or 0. */
  resolveCollision(vehicle: Vehicle): number {
    const r = ZAM_COLLISION_RADIUS * 0.7;
    const p = vehicle.position;
    for (const e of this.entries) {
      if (e.lifting || e.moved) continue;
      const b = footprint(e.side);
      const xMin = b.xMin - r;
      const xMax = b.xMax + r;
      const zMin = b.zMin - r;
      const zMax = b.zMax + r;
      if (p.x <= xMin || p.x >= xMax || p.y <= zMin || p.y >= zMax) continue;
      const m = Math.min(p.x - xMin, xMax - p.x, p.y - zMin, zMax - p.y);
      const n = new THREE.Vector2();
      if (m === p.x - xMin) n.set(-1, 0);
      else if (m === xMax - p.x) n.set(1, 0);
      else if (m === p.y - zMin) n.set(0, -1);
      else n.set(0, 1);
      p.addScaledVector(n, m);
      const vAlongN = -vehicle.velocity.dot(n);
      if (vAlongN > 0) {
        vehicle.velocity.addScaledVector(n, vAlongN * 1.1);
        vehicle.velocity.multiplyScalar(0.4);
        if (vAlongN > 0.8) return vAlongN;
      }
    }
    return 0;
  }
}
