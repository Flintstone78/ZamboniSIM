import * as THREE from 'three';
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
  faceoffSpotZ,
  GATE_X_MIN,
  GATE_X_MAX,
} from './constants';
import { loadTextureInto } from './assets';

/** True inside the board gap where the zamboni gate sits (-Z long side). */
export function inGateSpan(x: number, z: number): boolean {
  return (
    z < -RINK_WIDTH / 2 + 1.2 && x > GATE_X_MIN - 0.05 && x < GATE_X_MAX + 0.05
  );
}

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
function createMarkingsTexture(
  iceAds: boolean,
): { texture: THREE.CanvasTexture; canvas: HTMLCanvasElement } {
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
      circle(ix * FACEOFF_SPOT_X, iz * faceoffSpotZ(), FACEOFF_CIRCLE_RADIUS, '#c8102e');
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

  // Sponsor logos frozen into the ice (top-tier arenas only). Drawn slightly
  // translucent so they read as printed under the surface, in the neutral and
  // end zones where they don't fight the lines.
  if (iceAds) {
    const ad = (x: number, z: number, wM: number, hM: number, text: string, color: string) => {
      const w = wM * sx;
      const h = hM * sy;
      const cx = px(x);
      const cy = py(z);
      ctx.save();
      ctx.globalAlpha = 0.42;
      ctx.fillStyle = color;
      roundedRectPath(ctx, cx, cy, w, h, h * 0.22);
      ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 ${Math.round(h * 0.5)}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, cx, cy);
      ctx.restore();
    };
    // Neutral zone, between each blue line and the red centre line
    ad(0, -5.4, 9, 1.7, 'FRYSPUNKT', '#0e3a6b');
    ad(0, 5.4, 9, 1.7, 'POLAR TOOLS', '#7a1f1f');
    // Centred inside the four end-zone faceoff circles
    const fz = faceoffSpotZ();
    ad(-FACEOFF_SPOT_X, -fz, 5.6, 1.5, 'ISKRAFT', '#13633a');
    ad(FACEOFF_SPOT_X, -fz, 5.6, 1.5, 'NORDIC', '#5a3a87');
    ad(-FACEOFF_SPOT_X, fz, 5.6, 1.5, 'BLUE LINE', '#0e3a6b');
    ad(FACEOFF_SPOT_X, fz, 5.6, 1.5, 'FROST AB', '#7a1f1f');
  }

  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { texture: tex, canvas };
}

/**
 * Vertical ribbon following the rounded-rect outline between y0 and y1,
 * facing the rink. U is the arc length in metres, so a texture's horizontal
 * repeat is set in real-world metres via texture.repeat.x = 1 / widthMetres.
 */
function perimeterBandGeometry(
  halfL: number,
  halfW: number,
  r: number,
  y0: number,
  y1: number,
  skipGate = false,
): THREE.BufferGeometry {
  const pts = roundedRectShape(halfL, halfW, r).getPoints(160);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) s += pts[i].distanceTo(pts[i - 1]);
    positions.push(pts[i].x, y0, pts[i].y, pts[i].x, y1, pts[i].y);
    uvs.push(s, 0, s, 1);
    if (i > 0) {
      if (
        skipGate &&
        inGateSpan(pts[i - 1].x, pts[i - 1].y) &&
        inGateSpan(pts[i].x, pts[i].y)
      ) {
        continue;
      }
      const a = (i - 1) * 2;
      // Wound so the front face points into the rink
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Horizontal strip between two parallel outlines at height y (board cap). */
function perimeterCapGeometry(
  innerHalfL: number,
  innerHalfW: number,
  innerR: number,
  outerHalfL: number,
  outerHalfW: number,
  outerR: number,
  y: number,
  skipGate = false,
): THREE.BufferGeometry {
  const inner = roundedRectShape(innerHalfL, innerHalfW, innerR).getPoints(160);
  const outer = roundedRectShape(outerHalfL, outerHalfW, outerR).getPoints(160);
  const n = Math.min(inner.length, outer.length);
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    positions.push(inner[i].x, y, inner[i].y, outer[i].x, y, outer[i].y);
    if (i > 0) {
      if (
        skipGate &&
        inGateSpan(inner[i - 1].x, inner[i - 1].y) &&
        inGateSpan(inner[i].x, inner[i].y)
      ) {
        continue;
      }
      const a = (i - 1) * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export interface Rink {
  group: THREE.Group;
  iceMaterial: THREE.MeshPhysicalMaterial;
  /** The ice colour map – the resurfacer paints a wet tint into it. */
  colorTexture: THREE.CanvasTexture;
  colorCanvas: HTMLCanvasElement;
}

export function createRink(iceAds = false): Rink {
  const group = new THREE.Group();

  const markings = createMarkingsTexture(iceAds);
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

  // Boards: inner + outer faces and a red handrail cap, built as ribbons so
  // the zamboni gate can punch a real gap through them
  const boardMat = new THREE.MeshStandardMaterial({
    color: '#f5f5f5',
    roughness: 0.55,
    side: THREE.DoubleSide,
  });
  const innerFace = new THREE.Mesh(
    perimeterBandGeometry(RINK_LENGTH / 2, RINK_WIDTH / 2, CORNER_RADIUS, 0, BOARD_HEIGHT, true),
    boardMat,
  );
  innerFace.castShadow = true;
  group.add(innerFace);
  group.add(
    new THREE.Mesh(
      perimeterBandGeometry(
        RINK_LENGTH / 2 + BOARD_THICKNESS,
        RINK_WIDTH / 2 + BOARD_THICKNESS,
        CORNER_RADIUS + BOARD_THICKNESS,
        0,
        BOARD_HEIGHT,
        true,
      ),
      boardMat,
    ),
  );
  group.add(
    new THREE.Mesh(
      perimeterCapGeometry(
        RINK_LENGTH / 2,
        RINK_WIDTH / 2,
        CORNER_RADIUS,
        RINK_LENGTH / 2 + BOARD_THICKNESS,
        RINK_WIDTH / 2 + BOARD_THICKNESS,
        CORNER_RADIUS + BOARD_THICKNESS,
        BOARD_HEIGHT,
        true,
      ),
      new THREE.MeshStandardMaterial({ color: '#b71c1c', roughness: 0.4, side: THREE.DoubleSide }),
    ),
  );
  // (the gate's own module closes the board cross-section at the opening)

  // Sponsor ads on the inside of the boards (generated texture; the band
  // stays plain white until/unless the asset loads)
  const adMaterial = new THREE.MeshStandardMaterial({ color: '#f5f5f5', roughness: 0.5 });
  const adBand = new THREE.Mesh(
    perimeterBandGeometry(
      RINK_LENGTH / 2 - 0.015,
      RINK_WIDTH / 2 - 0.015,
      CORNER_RADIUS - 0.015,
      0.21,
      BOARD_HEIGHT - 0.02,
      true,
    ),
    adMaterial,
  );
  loadTextureInto('/assets/board_ads.png', (tex) => {
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.set(1 / 5, 1); // one strip of five ad panels per 5 m of boards
    adMaterial.map = tex;
    adMaterial.color.set('#ffffff');
    adMaterial.needsUpdate = true;
  });
  group.add(adBand);

  // Yellow kickplate strip at the base of the boards
  group.add(
    new THREE.Mesh(
      perimeterBandGeometry(
        RINK_LENGTH / 2 - 0.01,
        RINK_WIDTH / 2 - 0.01,
        CORNER_RADIUS - 0.01,
        0,
        0.2,
        true,
      ),
      new THREE.MeshStandardMaterial({ color: '#f2c40f', roughness: 0.6, side: THREE.DoubleSide }),
    ),
  );

  // Protective glass above the boards
  const glass = new THREE.Mesh(
    perimeterBandGeometry(
      RINK_LENGTH / 2 + BOARD_THICKNESS / 2,
      RINK_WIDTH / 2 + BOARD_THICKNESS / 2,
      CORNER_RADIUS + BOARD_THICKNESS / 2,
      BOARD_HEIGHT,
      BOARD_HEIGHT + GLASS_HEIGHT,
      true,
    ),
    new THREE.MeshPhysicalMaterial({
      color: '#cfe8ff',
      transparent: true,
      opacity: 0.13,
      roughness: 0.05,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  group.add(glass);

  return { group, iceMaterial, colorTexture: markings.texture, colorCanvas: markings.canvas };
}
