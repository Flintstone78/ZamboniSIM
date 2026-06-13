import * as THREE from 'three';
import {
  RINK_WIDTH,
  GOAL_WIDTH,
  GOAL_DEPTH,
  GOAL_HEIGHT,
  ZAM_COLLISION_RADIUS,
} from './constants';
import type { Vehicle } from './vehicle';

interface GoalBox {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
}

// During a resurfacing the nets are lifted off the goal line and parked
// against the long-side boards, clear of the driving path. Their footprint
// (collision + no-clean zone) is recomputed per level because the board they
// rest against moves with the rink width. One net per long side, kept away
// from the equipment-room gate on the -Z board (x -19..-15).
let goalBoxes: GoalBox[] = [];

interface ParkSpot {
  x: number; // centre of the net's mouth along the boards
  boardSign: 1 | -1; // +1 = +Z board, -1 = -Z board
}
const PARK_SPOTS: ParkSpot[] = [
  { x: -10, boardSign: 1 },
  { x: 10, boardSign: -1 },
];

function computeBoxes(): GoalBox[] {
  const boardZ = RINK_WIDTH / 2;
  return PARK_SPOTS.map(({ x, boardSign }) => {
    const back = boardSign * boardZ;
    const mouth = boardSign * (boardZ - GOAL_DEPTH);
    return {
      xMin: x - GOAL_WIDTH / 2,
      xMax: x + GOAL_WIDTH / 2,
      zMin: Math.min(back, mouth),
      zMax: Math.max(back, mouth),
    };
  });
}

/** True under/inside a parked goal cage (these cells can't be resurfaced). */
export function inGoalZone(x: number, z: number, margin = 0.25): boolean {
  return goalBoxes.some(
    (b) =>
      x > b.xMin - margin && x < b.xMax + margin && z > b.zMin - margin && z < b.zMax + margin,
  );
}

/** A single net with its mouth opening toward local +Z, net sloping back to -Z. */
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
  for (const x of [-GOAL_WIDTH / 2, GOAL_WIDTH / 2]) {
    const post = new THREE.Mesh(postGeo, red);
    post.position.set(x, GOAL_HEIGHT / 2, 0);
    post.castShadow = true;
    goal.add(post);
  }
  const bar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, GOAL_WIDTH + 0.1, 10),
    red,
  );
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, GOAL_HEIGHT, 0);
  goal.add(bar);

  // Net: sloped back sheet (mouth at z=0, base of net at z=-GOAL_DEPTH)
  const backNet = new THREE.Mesh(
    new THREE.PlaneGeometry(GOAL_WIDTH, Math.hypot(GOAL_DEPTH, GOAL_HEIGHT)),
    netMat,
  );
  backNet.rotation.x = -Math.atan2(GOAL_DEPTH, GOAL_HEIGHT);
  backNet.position.set(0, GOAL_HEIGHT / 2, -GOAL_DEPTH / 2);
  goal.add(backNet);
  for (const x of [-GOAL_WIDTH / 2, GOAL_WIDTH / 2]) {
    const sideShape = new THREE.Shape();
    sideShape.moveTo(0, 0);
    sideShape.lineTo(0, GOAL_HEIGHT);
    sideShape.lineTo(-GOAL_DEPTH, 0);
    sideShape.closePath();
    const sideNet = new THREE.Mesh(new THREE.ShapeGeometry(sideShape), netMat);
    sideNet.rotation.y = -Math.PI / 2;
    sideNet.position.set(x, 0, 0);
    goal.add(sideNet);
  }
  return goal;
}

/** Both nets parked against the long-side boards, mouths facing centre ice. */
export function createGoals(): THREE.Group {
  goalBoxes = computeBoxes();
  const group = new THREE.Group();
  const boardZ = RINK_WIDTH / 2;

  for (const { x, boardSign } of PARK_SPOTS) {
    const goal = buildGoalMesh();
    // Mouth faces centre ice; net back sits against the board.
    if (boardSign > 0) {
      // +Z board: opening toward -Z (rotate 180°), back at +boardZ
      goal.rotation.y = Math.PI;
      goal.position.set(x, 0, boardZ - GOAL_DEPTH);
    } else {
      // -Z board: opening toward +Z (no rotation), back at -boardZ
      goal.position.set(x, 0, -boardZ + GOAL_DEPTH);
    }
    group.add(goal);
  }
  return group;
}

/**
 * Push a vehicle out of the parked goal cages (box collision). Slows it down
 * like the boards do; returns the impact speed when a new hit lands, else 0.
 */
export function resolveGoalCollision(vehicle: Vehicle): number {
  const r = ZAM_COLLISION_RADIUS * 0.7;
  const p = vehicle.position;
  for (const b of goalBoxes) {
    const xMin = b.xMin - r;
    const xMax = b.xMax + r;
    const zMin = b.zMin - r;
    const zMax = b.zMax + r;
    if (p.x <= xMin || p.x >= xMax || p.y <= zMin || p.y >= zMax) continue;

    // Push out along the axis with the smallest penetration
    const dxMin = p.x - xMin;
    const dxMax = xMax - p.x;
    const dzMin = p.y - zMin;
    const dzMax = zMax - p.y;
    const m = Math.min(dxMin, dxMax, dzMin, dzMax);
    const n = new THREE.Vector2();
    if (m === dxMin) n.set(-1, 0);
    else if (m === dxMax) n.set(1, 0);
    else if (m === dzMin) n.set(0, -1);
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
