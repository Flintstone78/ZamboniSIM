import * as THREE from 'three';
import {
  GOAL_LINE_X,
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

const BOXES: GoalBox[] = [1, -1].map((side) => {
  const xNear = side * GOAL_LINE_X;
  const xFar = side * (GOAL_LINE_X + GOAL_DEPTH);
  return {
    xMin: Math.min(xNear, xFar),
    xMax: Math.max(xNear, xFar),
    zMin: -GOAL_WIDTH / 2,
    zMax: GOAL_WIDTH / 2,
  };
});

/** True under/inside a goal cage (these cells can't be resurfaced). */
export function inGoalZone(x: number, z: number, margin = 0.25): boolean {
  return BOXES.some(
    (b) =>
      x > b.xMin - margin && x < b.xMax + margin && z > b.zMin - margin && z < b.zMax + margin,
  );
}

/** Red frame + net at both ends, opening toward centre ice. */
export function createGoals(): THREE.Group {
  const group = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: '#c8102e', roughness: 0.45 });
  const netMat = new THREE.MeshStandardMaterial({
    color: '#e8eef4',
    roughness: 0.9,
    transparent: true,
    opacity: 0.45,
    side: THREE.DoubleSide,
  });

  for (const side of [1, -1]) {
    const goal = new THREE.Group();
    const postGeo = new THREE.CylinderGeometry(0.05, 0.05, GOAL_HEIGHT, 10);
    for (const z of [-GOAL_WIDTH / 2, GOAL_WIDTH / 2]) {
      const post = new THREE.Mesh(postGeo, red);
      post.position.set(0, GOAL_HEIGHT / 2, z);
      post.castShadow = true;
      goal.add(post);
    }
    const bar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, GOAL_WIDTH + 0.1, 10),
      red,
    );
    bar.rotation.x = Math.PI / 2;
    bar.position.set(0, GOAL_HEIGHT, 0);
    goal.add(bar);

    // Net: sloped back sheet + two side sheets
    const backGeo = new THREE.PlaneGeometry(
      Math.hypot(GOAL_DEPTH, GOAL_HEIGHT),
      GOAL_WIDTH,
    );
    const backNet = new THREE.Mesh(backGeo, netMat);
    backNet.rotation.z = Math.PI / 2 - Math.atan2(GOAL_HEIGHT, GOAL_DEPTH);
    backNet.rotation.y = Math.PI / 2;
    backNet.rotation.order = 'YZX';
    backNet.position.set(GOAL_DEPTH / 2, GOAL_HEIGHT / 2, 0);
    goal.add(backNet);
    for (const z of [-GOAL_WIDTH / 2, GOAL_WIDTH / 2]) {
      const sideShape = new THREE.Shape();
      sideShape.moveTo(0, 0);
      sideShape.lineTo(GOAL_DEPTH, 0);
      sideShape.lineTo(0, GOAL_HEIGHT);
      sideShape.closePath();
      const sideNet = new THREE.Mesh(new THREE.ShapeGeometry(sideShape), netMat);
      sideNet.position.set(0, 0, z);
      goal.add(sideNet);
    }

    goal.position.x = side * GOAL_LINE_X;
    if (side < 0) goal.rotation.y = Math.PI;
    group.add(goal);
  }
  return group;
}

/**
 * Push a vehicle out of the goal cages (box collision). Slows it down like
 * the boards do; returns the impact speed when a new hit lands, else 0.
 */
export function resolveGoalCollision(vehicle: Vehicle): number {
  const r = ZAM_COLLISION_RADIUS * 0.75; // cages are smaller than the boards
  const p = vehicle.position;
  for (const b of BOXES) {
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
