import * as THREE from 'three';
import {
  LOT_WIDTH,
  LOT_DEPTH,
  STALL_WIDTH,
  STALL_DEPTH,
  LANE_HALF,
  STALLS_PER_ROW,
} from './constants';
import type { Boundary } from './vehicle';

export interface Stall {
  index: number;
  cx: number;
  cz: number;
  row: 1 | -1; // +1 = bottom row (+Z), -1 = top row (-Z)
}

/** Two rows of stalls flanking a central drive lane along X. */
export function computeStalls(): Stall[] {
  const stalls: Stall[] = [];
  const rowZ = LANE_HALF + STALL_DEPTH / 2;
  let index = 0;
  for (const row of [-1, 1] as const) {
    for (let i = 0; i < STALLS_PER_ROW; i++) {
      const cx = (i - (STALLS_PER_ROW - 1) / 2) * STALL_WIDTH;
      stalls.push({ index: index++, cx, cz: row * rowZ, row });
    }
  }
  return stalls;
}

/** Axis-aligned rectangular collision boundary (the lot perimeter). */
export function rectBounds(halfX: number, halfZ: number): Boundary {
  const sd = (x: number, z: number): number => {
    const qx = Math.abs(x) - halfX;
    const qz = Math.abs(z) - halfZ;
    const outside = Math.hypot(Math.max(qx, 0), Math.max(qz, 0));
    return outside + Math.min(Math.max(qx, qz), 0);
  };
  return {
    sdf: sd,
    normal: (x, z) =>
      new THREE.Vector2(sd(x + 0.01, z) - sd(x - 0.01, z), sd(x, z + 0.01) - sd(x, z - 0.01)).normalize(),
  };
}

function createLotTexture(stalls: Stall[]): THREE.CanvasTexture {
  const W = 2048;
  const H = Math.round((W * LOT_DEPTH) / LOT_WIDTH);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const sx = W / LOT_WIDTH;
  const sy = H / LOT_DEPTH;
  const px = (x: number) => (x + LOT_WIDTH / 2) * sx;
  const py = (z: number) => (z + LOT_DEPTH / 2) * sy;

  ctx.fillStyle = '#2b2e33';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 1600; i++) {
    ctx.fillStyle = `rgba(${(20 + Math.random() * 40) | 0},${(20 + Math.random() * 40) | 0},${(24 + Math.random() * 40) | 0},0.3)`;
    ctx.fillRect(Math.random() * W, Math.random() * H, 3, 3);
  }

  ctx.strokeStyle = '#e8edf2';
  ctx.lineWidth = 0.12 * sx;
  for (const s of stalls) {
    const halfW = (STALL_WIDTH / 2) * sx;
    const x = px(s.cx);
    const near = py(s.cz - s.row * (STALL_DEPTH / 2));
    const far = py(s.cz + s.row * (STALL_DEPTH / 2));
    ctx.beginPath();
    ctx.moveTo(x - halfW, near);
    ctx.lineTo(x - halfW, far);
    ctx.lineTo(x + halfW, far);
    ctx.lineTo(x + halfW, near);
    ctx.stroke();
  }

  ctx.strokeStyle = '#d9b73a';
  ctx.lineWidth = 0.18 * sx;
  ctx.setLineDash([1.2 * sx, 1.0 * sx]);
  ctx.beginPath();
  ctx.moveTo(px(-LOT_WIDTH / 2 + 2), py(0));
  ctx.lineTo(px(LOT_WIDTH / 2 - 2), py(0));
  ctx.stroke();
  ctx.setLineDash([]);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Builds the static parking-lot scenery. */
export function createParkingLot(stalls: Stall[]): THREE.Group {
  const group = new THREE.Group();

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(LOT_WIDTH + 120, LOT_DEPTH + 120),
    new THREE.MeshStandardMaterial({ color: '#1a1c20', roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.03;
  ground.receiveShadow = true;
  group.add(ground);

  const lot = new THREE.Mesh(
    new THREE.PlaneGeometry(LOT_WIDTH, LOT_DEPTH),
    new THREE.MeshStandardMaterial({ map: createLotTexture(stalls), roughness: 0.92 }),
  );
  lot.rotation.x = -Math.PI / 2;
  lot.receiveShadow = true;
  group.add(lot);

  const snowMat = new THREE.MeshStandardMaterial({ color: '#eef4fa', roughness: 0.85 });
  const bankAlongX = new THREE.BoxGeometry(LOT_WIDTH + 6, 1.1, 3);
  const bankAlongZ = new THREE.BoxGeometry(3, 1.1, LOT_DEPTH + 6);
  for (const z of [-1, 1]) {
    const b = new THREE.Mesh(bankAlongX, snowMat);
    b.position.set(0, 0.4, z * (LOT_DEPTH / 2 + 1.5));
    b.castShadow = true;
    b.receiveShadow = true;
    group.add(b);
  }
  for (const x of [-1, 1]) {
    const b = new THREE.Mesh(bankAlongZ, snowMat);
    b.position.set(x * (LOT_WIDTH / 2 + 1.5), 0.4, 0);
    b.castShadow = true;
    b.receiveShadow = true;
    group.add(b);
  }

  const building = new THREE.Mesh(
    new THREE.BoxGeometry(LOT_WIDTH + 20, 16, 12),
    new THREE.MeshStandardMaterial({ color: '#3a4250', roughness: 0.8 }),
  );
  building.position.set(0, 8, -(LOT_DEPTH / 2 + 12));
  building.castShadow = true;
  group.add(building);
  const roof = new THREE.Mesh(
    new THREE.CylinderGeometry(10, 10, LOT_WIDTH + 20, 24, 1, false, 0, Math.PI),
    new THREE.MeshStandardMaterial({ color: '#4a5568', roughness: 0.7 }),
  );
  roof.rotation.z = Math.PI / 2;
  roof.position.set(0, 16, -(LOT_DEPTH / 2 + 12));
  group.add(roof);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 2.4),
    new THREE.MeshStandardMaterial({ color: '#0a1622', emissive: '#2f7fb8', emissiveIntensity: 1.5 }),
  );
  sign.position.set(0, 6, -(LOT_DEPTH / 2 + 5.9));
  group.add(sign);

  const poleMat = new THREE.MeshStandardMaterial({ color: '#2b2f36', roughness: 0.6, metalness: 0.4 });
  const lampMat = new THREE.MeshStandardMaterial({ color: '#fff7e0', emissive: '#ffe8a8', emissiveIntensity: 2.2 });
  for (const sxn of [-1, 1]) {
    for (const szn of [-1, 1]) {
      const x = sxn * (LOT_WIDTH / 2 - 2);
      const z = szn * (LOT_DEPTH / 2 - 2);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 8), poleMat);
      pole.position.set(x, 4, z);
      pole.castShadow = true;
      group.add(pole);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.4, 0.8), lampMat);
      lamp.position.set(x - sxn * 0.6, 7.9, z);
      group.add(lamp);
      const spot = new THREE.PointLight('#ffe9b8', 60, 36, 2);
      spot.position.set(x, 7.6, z);
      group.add(spot);
    }
  }

  group.add(new THREE.HemisphereLight('#5a6b82', '#0c0f14', 0.5));
  const moon = new THREE.DirectionalLight('#cdd8ff', 0.9);
  moon.position.set(-18, 24, -10);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.left = -36;
  moon.shadow.camera.right = 36;
  moon.shadow.camera.top = 26;
  moon.shadow.camera.bottom = -26;
  moon.shadow.camera.far = 70;
  moon.shadow.bias = -0.0005;
  group.add(moon);

  return group;
}

const CAR_COLORS = ['#c0392b', '#2980b9', '#27ae60', '#f39c12', '#8e44ad', '#ecf0f1', '#34495e'];

/** A simple low-poly car, nose along local +Z (so rotation.y orients it). */
export function createCar(): THREE.Group {
  const g = new THREE.Group();
  const color = CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0];
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 });
  const glassMat = new THREE.MeshStandardMaterial({ color: '#1a2733', roughness: 0.2, metalness: 0.1 });
  const tyreMat = new THREE.MeshStandardMaterial({ color: '#15181c', roughness: 0.9 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.7, 4.4), bodyMat);
  body.position.y = 0.65;
  body.castShadow = true;
  g.add(body);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.65, 2.2), glassMat);
  cabin.position.set(0, 1.2, -0.1);
  cabin.castShadow = true;
  g.add(cabin);

  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 16);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const wx of [-0.95, 0.95]) {
    for (const wz of [-1.4, 1.4]) {
      const w = new THREE.Mesh(wheelGeo, tyreMat);
      w.position.set(wx, 0.36, wz);
      g.add(w);
    }
  }

  const lightMat = new THREE.MeshStandardMaterial({ color: '#fffde7', emissive: '#fff3b0', emissiveIntensity: 1.2 });
  for (const wx of [-0.6, 0.6]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.1), lightMat);
    head.position.set(wx, 0.65, 2.21);
    g.add(head);
  }
  return g;
}

/** A plowed mound of snow dumped on a stall. */
export function createSnowPile(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#f3f8fd', roughness: 0.8 });
  const blobs: [number, number, number, number][] = [
    [0, 0.5, 0, 1.3],
    [-0.7, 0.35, 0.6, 0.85],
    [0.7, 0.4, -0.5, 0.95],
    [0.2, 0.35, 1.0, 0.7],
  ];
  for (const [x, y, z, r] of blobs) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), mat);
    m.position.set(x, y, z);
    m.scale.y = 0.6;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}
