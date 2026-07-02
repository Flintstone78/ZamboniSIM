import * as THREE from 'three';
import { ZAM_LENGTH, ZAM_WIDTH, SWATH_WIDTH } from './constants';
import { loadModelInto } from './assets';

// Yaw applied to the generated GLB so its nose points along local +Z
// (depends on how the mesh generator oriented it – tuned visually).
const MODEL_YAW = -Math.PI / 2;

export interface ZamboniRig {
  group: THREE.Group;
  /** The conditioner housing dragged behind – animated up/down with Space. */
  blade: THREE.Mesh;
  /** The seated driver figure (hidden in first-person view). */
  driver: THREE.Object3D;
}

const BLADE_DOWN_Y = 0.1;
const BLADE_UP_Y = 0.5;

/** Ease the blade toward its up/down position; call every frame. */
export function animateBlade(blade: THREE.Mesh, down: boolean, dt: number): void {
  const target = down ? BLADE_DOWN_Y : BLADE_UP_Y;
  blade.position.y += (target - blade.position.y) * Math.min(1, dt * 8);
  blade.rotation.x = ((blade.position.y - BLADE_DOWN_Y) / (BLADE_UP_Y - BLADE_DOWN_Y)) * 0.35;
}

/** A seated hi-vis driver, facing local +Z (origin at the seat). */
function buildDriver(): THREE.Group {
  const d = new THREE.Group();
  const hivis = new THREE.MeshStandardMaterial({ color: '#ff7a18', roughness: 0.6 });
  const pants = new THREE.MeshStandardMaterial({ color: '#1c2330', roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: '#e8b98c', roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: '#15181f', roughness: 0.7 });
  const part = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number, y: number, z: number,
    rx = 0,
  ): void => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    m.castShadow = true;
    d.add(m);
  };
  // Thighs forward, shins down (seated)
  part(new THREE.BoxGeometry(0.42, 0.16, 0.46), pants, 0, 0, 0.2);
  for (const sx of [-0.12, 0.12]) part(new THREE.CapsuleGeometry(0.07, 0.34, 4, 8), pants, sx, -0.26, 0.4);
  // Torso (hi-vis), slight forward lean
  part(new THREE.CapsuleGeometry(0.2, 0.36, 4, 10), hivis, 0, 0.46, 0.03, 0.16);
  // Arms reaching forward to the wheel
  for (const sx of [-0.19, 0.19]) part(new THREE.CapsuleGeometry(0.06, 0.34, 4, 8), hivis, sx, 0.52, 0.28, 1.15);
  // Head + dark beanie
  part(new THREE.SphereGeometry(0.13, 12, 12), skin, 0, 0.95, 0.05);
  part(new THREE.SphereGeometry(0.145, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), dark, 0, 0.98, 0.04);
  return d;
}

/**
 * Procedural low-poly zamboni, nose pointing along local +Z so it can be
 * driven with rotation.y = heading. Upgrades itself to the generated GLB
 * model from /assets when available; the primitives are the fallback. The
 * blade lives outside the swappable body so it survives the model upgrade.
 */
export function createZamboni(): ZamboniRig {
  const group = new THREE.Group();
  const g = new THREE.Group(); // swappable body
  group.add(g);

  // Conditioner: the blade housing dragged behind, full swath width
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(SWATH_WIDTH, 0.18, 0.5),
    new THREE.MeshStandardMaterial({ color: '#90a4ae', roughness: 0.5, metalness: 0.4 }),
  );
  blade.position.set(0, BLADE_UP_Y, -ZAM_LENGTH / 2 + 0.1);
  blade.castShadow = true;
  group.add(blade);

  // Driver sat well back in the black seat at the rear-left: butt on the
  // cushion against the backrest (z), centred on the chair (x), knees forward.
  const driver = buildDriver();
  driver.position.set(-0.35, 1.72, -1.77);
  group.add(driver);

  loadModelInto('/assets/zamboni.glb', (model) => {
    model.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    model.rotation.y = MODEL_YAW;
    // Normalise: real-world length, centred on the axle, wheels on the ice.
    // The generated mesh is chunkier than a real zamboni, so the height is
    // capped separately to keep the driver's sightline sensible.
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const sxz = ZAM_LENGTH / Math.max(size.x, size.z);
    model.scale.set(sxz, Math.min(sxz, 2.45 / size.y), sxz);
    box.setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.set(-center.x, -box.min.y, -center.z);
    g.clear();
    g.add(model);
  });
  const bodyMat = new THREE.MeshStandardMaterial({ color: '#1565c0', roughness: 0.35, metalness: 0.15 });
  const darkMat = new THREE.MeshStandardMaterial({ color: '#1b1f24', roughness: 0.8 });
  const greyMat = new THREE.MeshStandardMaterial({ color: '#90a4ae', roughness: 0.5, metalness: 0.4 });
  const seatMat = new THREE.MeshStandardMaterial({ color: '#263238', roughness: 0.9 });

  const box = (
    w: number, h: number, d: number,
    x: number, y: number, z: number,
    mat: THREE.Material,
  ): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };

  const L = ZAM_LENGTH;
  const W = ZAM_WIDTH;

  // Snow tank: the big sloped hopper over the front half
  const tank = box(W, 1.05, L * 0.52, 0, 1.05, L * 0.17, bodyMat);
  tank.rotation.x = 0.06;
  // Engine/water section over the rear half
  box(W, 0.75, L * 0.42, 0, 0.78, -L * 0.27, bodyMat);
  // Low chassis skirt all around
  box(W * 0.96, 0.45, L * 0.94, 0, 0.32, 0, darkMat);

  // Driver platform at the rear
  box(W * 0.8, 0.08, 0.9, 0, 1.18, -L * 0.28, greyMat);
  const seat = box(0.5, 0.5, 0.45, -0.35, 1.5, -L * 0.36, seatMat);
  seat.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.1), seatMat)).children[0]!
    .position.set(0, 0.4, -0.22);
  // Steering column + wheel
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.6), greyMat);
  column.position.set(-0.35, 1.45, -L * 0.17);
  column.rotation.x = 0.5;
  g.add(column);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 8, 24), darkMat);
  wheel.position.set(-0.35, 1.72, -L * 0.11);
  wheel.rotation.x = Math.PI / 2 - 0.5;
  g.add(wheel);

  // Wheels (studded tyres)
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 18);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const [x, z] of [
    [-W / 2 + 0.1, L * 0.3],
    [W / 2 - 0.1, L * 0.3],
    [-W / 2 + 0.1, -L * 0.3],
    [W / 2 - 0.1, -L * 0.3],
  ] as const) {
    const m = new THREE.Mesh(wheelGeo, darkMat);
    m.position.set(x, 0.34, z);
    m.castShadow = true;
    g.add(m);
  }

  // Beacon light on a pole
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.9), greyMat);
  pole.position.set(0.35, 2.0, -L * 0.36);
  g.add(pole);
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.09, 0.16, 12),
    new THREE.MeshStandardMaterial({
      color: '#ff9800',
      emissive: '#ff6d00',
      emissiveIntensity: 1.6,
    }),
  );
  beacon.position.set(0.35, 2.5, -L * 0.36);
  g.add(beacon);

  // Headlights
  const lampMat = new THREE.MeshStandardMaterial({
    color: '#fffde7',
    emissive: '#fff59d',
    emissiveIntensity: 1.2,
  });
  box(0.18, 0.12, 0.05, -W / 2 + 0.25, 0.85, L / 2 + 0.01, lampMat);
  box(0.18, 0.12, 0.05, W / 2 - 0.25, 0.85, L / 2 + 0.01, lampMat);

  return { group, blade, driver };
}
