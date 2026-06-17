import * as THREE from 'three';
import type { Bounds } from './vehicle';
import {
  RINK_LENGTH,
  RINK_WIDTH,
  CORNER_RADIUS,
  BOARD_HEIGHT,
  BOARD_THICKNESS,
  GLASS_HEIGHT,
  GOAL_LINE_X,
  BLUE_LINE_X,
  FACEOFF_CIRCLE_RADIUS,
  FACEOFF_SPOT_X,
  FACEOFF_SPOT_Z,
} from './constants';

/**
 * Signed distance from a point to the rounded-rectangle rink boundary.
 * Negative inside the rink, positive outside.
 */
export function rinkSignedDistance(x: number, z: number): number {
  const qx = Math.abs(x) - (RINK_LENGTH / 2 - CORNER_RADIUS);
  const qz = Math.abs(z) - (RINK_WIDTH / 2 - CORNER_RADIUS);
  const ax = Math.max(qx, 0);
  const az = Math.max(qz, 0);
  return Math.min(Math.max(qx, qz), 0) + Math.hypot(ax, az) - CORNER_RADIUS;
}

/** Outward boundary normal at a point, via central differences of the SDF. */
export function rinkBoundaryNormal(x: number, z: number): THREE.Vector2 {
  const e = 0.01;
  const nx = rinkSignedDistance(x + e, z) - rinkSignedDistance(x - e, z);
  const nz = rinkSignedDistance(x, z + e) - rinkSignedDistance(x, z - e);
  return new THREE.Vector2(nx, nz).normalize();
}

/** Vehicle collision boundary for the rink (the boards). */
export const rinkBounds: Bounds = {
  signedDistance: rinkSignedDistance,
  normal: rinkBoundaryNormal,
};

function roundedRectShape(halfL: number, halfW: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-halfL + r, -halfW);
  s.lineTo(halfL - r, -halfW);
  s.absarc(halfL - r, -halfW + r, r, -Math.PI / 2, 0, false);
  s.lineTo(halfL, halfW - r);
  s.absarc(halfL - r, halfW - r, r, 0, Math.PI / 2, false);
  s.lineTo(-halfL + r, halfW);
  s.absarc(-halfL + r, halfW - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-halfL, -halfW + r);
  s.absarc(-halfL + r, -halfW + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, cy - h / 2, w, h, r);
}

/**
 * Paints the ice colour map: white ice with regulation-ish markings, concrete
 * grey outside the rounded rink outline. Canvas x maps to world X, canvas y to
 * world Z (top of canvas = -Z side).
 */
function createMarkingsTexture(): { texture: THREE.CanvasTexture; canvas: HTMLCanvasElement } {
  const W = 2048;
  const H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const sx = W / RINK_LENGTH; // px per metre
  const sy = H / RINK_WIDTH;
  const px = (x: number) => (x + RINK_LENGTH / 2) * sx;
  const py = (z: number) => (z + RINK_WIDTH / 2) * sy;

  // Concrete apron outside the rounded corners
  ctx.fillStyle = '#3a3f45';
  ctx.fillRect(0, 0, W, H);

  // Everything else is clipped to the rink outline
  ctx.save();
  roundedRectPath(ctx, W / 2, H / 2, W, H, CORNER_RADIUS * sx);
  ctx.clip();

  ctx.fillStyle = '#eef4f8';
  ctx.fillRect(0, 0, W, H);

  const lineW = (m: number) => m * sx;

  // Goal and blue lines, red centre line
  ctx.fillStyle = '#c8102e';
  ctx.fillRect(px(0) - lineW(0.3) / 2, 0, lineW(0.3), H);
  ctx.fillRect(px(-GOAL_LINE_X) - lineW(0.05), 0, lineW(0.1), H);
  ctx.fillRect(px(GOAL_LINE_X) - lineW(0.05), 0, lineW(0.1), H);
  ctx.fillStyle = '#0033a0';
  ctx.fillRect(px(-BLUE_LINE_X) - lineW(0.3) / 2, 0, lineW(0.3), H);
  ctx.fillRect(px(BLUE_LINE_X) - lineW(0.3) / 2, 0, lineW(0.3), H);

  const circle = (x: number, z: number, rM: number, color: string, fillSpot = true) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineW(0.05);
    ctx.beginPath();
    ctx.ellipse(px(x), py(z), rM * sx, rM * sy, 0, 0, Math.PI * 2);
    ctx.stroke();
    if (fillSpot) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(px(x), py(z), 0.3 * sx, 0.3 * sy, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  circle(0, 0, FACEOFF_CIRCLE_RADIUS, '#0033a0', false);
  for (const ix of [-1, 1]) {
    for (const iz of [-1, 1]) {
      circle(ix * FACEOFF_SPOT_X, iz * FACEOFF_SPOT_Z, FACEOFF_CIRCLE_RADIUS, '#c8102e');
    }
  }

  // Goal creases
  ctx.fillStyle = 'rgba(65, 143, 222, 0.55)';
  for (const ix of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(
      px(ix * GOAL_LINE_X),
      py(0),
      1.8 * sx,
      1.8 * sy,
      0,
      ix > 0 ? Math.PI / 2 : -Math.PI / 2,
      ix > 0 ? Math.PI * 1.5 : Math.PI / 2,
    );
    ctx.fill();
  }

  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { texture: tex, canvas };
}

export interface Rink {
  group: THREE.Group;
  iceMaterial: THREE.MeshPhysicalMaterial;
  /** The ice colour map – the resurfacer paints a wet tint into it. */
  colorTexture: THREE.CanvasTexture;
  colorCanvas: HTMLCanvasElement;
}

export function createRink(): Rink {
  const group = new THREE.Group();

  const markings = createMarkingsTexture();
  const iceMaterial = new THREE.MeshPhysicalMaterial({
    map: markings.texture,
    roughness: 1, // modulated by the dynamic roughness map from IceResurfacer
    metalness: 0,
    envMapIntensity: 1.1,
  });
  const ice = new THREE.Mesh(new THREE.PlaneGeometry(RINK_LENGTH, RINK_WIDTH), iceMaterial);
  ice.rotation.x = -Math.PI / 2;
  ice.receiveShadow = true;
  group.add(ice);

  // Boards: a rounded-rectangle ring extruded upwards
  const outer = roundedRectShape(
    RINK_LENGTH / 2 + BOARD_THICKNESS,
    RINK_WIDTH / 2 + BOARD_THICKNESS,
    CORNER_RADIUS + BOARD_THICKNESS,
  );
  outer.holes.push(
    roundedRectShape(RINK_LENGTH / 2, RINK_WIDTH / 2, CORNER_RADIUS),
  );

  const boardGeo = new THREE.ExtrudeGeometry(outer, {
    depth: BOARD_HEIGHT,
    bevelEnabled: false,
    curveSegments: 32,
  });
  const boards = new THREE.Mesh(
    boardGeo,
    new THREE.MeshStandardMaterial({ color: '#f5f5f5', roughness: 0.55 }),
  );
  boards.rotation.x = -Math.PI / 2;
  boards.castShadow = true;
  group.add(boards);

  // Yellow kickplate strip at the base of the boards (slightly inset ring)
  const kickOuter = roundedRectShape(RINK_LENGTH / 2 + 0.02, RINK_WIDTH / 2 + 0.02, CORNER_RADIUS + 0.02);
  kickOuter.holes.push(
    roundedRectShape(RINK_LENGTH / 2 - 0.02, RINK_WIDTH / 2 - 0.02, CORNER_RADIUS - 0.02),
  );
  const kick = new THREE.Mesh(
    new THREE.ExtrudeGeometry(kickOuter, { depth: 0.2, bevelEnabled: false, curveSegments: 32 }),
    new THREE.MeshStandardMaterial({ color: '#f2c40f', roughness: 0.6 }),
  );
  kick.rotation.x = -Math.PI / 2;
  kick.position.y = 0.005;
  group.add(kick);

  // Red handrail cap on top of the boards
  const capOuter = roundedRectShape(
    RINK_LENGTH / 2 + BOARD_THICKNESS + 0.02,
    RINK_WIDTH / 2 + BOARD_THICKNESS + 0.02,
    CORNER_RADIUS + BOARD_THICKNESS + 0.02,
  );
  capOuter.holes.push(roundedRectShape(RINK_LENGTH / 2 - 0.02, RINK_WIDTH / 2 - 0.02, CORNER_RADIUS - 0.02));
  const cap = new THREE.Mesh(
    new THREE.ExtrudeGeometry(capOuter, { depth: 0.06, bevelEnabled: false, curveSegments: 32 }),
    new THREE.MeshStandardMaterial({ color: '#b71c1c', roughness: 0.4 }),
  );
  cap.rotation.x = -Math.PI / 2;
  cap.position.y = BOARD_HEIGHT;
  group.add(cap);

  // Protective glass above the boards
  const glassOuter = roundedRectShape(
    RINK_LENGTH / 2 + BOARD_THICKNESS / 2 + 0.025,
    RINK_WIDTH / 2 + BOARD_THICKNESS / 2 + 0.025,
    CORNER_RADIUS + BOARD_THICKNESS / 2 + 0.025,
  );
  glassOuter.holes.push(
    roundedRectShape(
      RINK_LENGTH / 2 + BOARD_THICKNESS / 2 - 0.025,
      RINK_WIDTH / 2 + BOARD_THICKNESS / 2 - 0.025,
      CORNER_RADIUS + BOARD_THICKNESS / 2 - 0.025,
    ),
  );
  const glass = new THREE.Mesh(
    new THREE.ExtrudeGeometry(glassOuter, { depth: GLASS_HEIGHT, bevelEnabled: false, curveSegments: 32 }),
    new THREE.MeshPhysicalMaterial({
      color: '#cfe8ff',
      transparent: true,
      opacity: 0.13,
      roughness: 0.05,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  glass.rotation.x = -Math.PI / 2;
  glass.position.y = BOARD_HEIGHT + 0.06;
  group.add(glass);

  return { group, iceMaterial, colorTexture: markings.texture, colorCanvas: markings.canvas };
}
