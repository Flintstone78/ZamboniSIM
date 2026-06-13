import * as THREE from 'three';
import { RINK_LENGTH, RINK_WIDTH, GATE_X_MIN, GATE_X_MAX } from './constants';
import { loadTextureInto } from './assets';
import type { LevelDef } from './levels';

// The zamboni tunnel cuts a vomitory-style gap through the -Z stands so the
// equipment-room corridor isn't walled in (and the reveal camera isn't buried).
const GATE_GAP: [number, number] = [GATE_X_MIN - 2, GATE_X_MAX + 2];

/**
 * Per-tier arena recipe. The five career tiers escalate from a cold practice
 * barn with no crowd up to a domed showpiece (Globen / Madison Square Garden):
 * stands grow taller and gain an upper deck, the roof lifts and finally domes,
 * the light rig brightens, and the top tiers add a centre-hung scoreboard and
 * championship banners.
 */
interface ArenaSpec {
  rows: number; // lower-deck rows (0 = no stands)
  allSides: boolean; // stands behind the goals too
  upperRows: number; // upper-deck rows (0 = single tier)
  ceiling: number; // height of the enclosing roof / dome spring line
  domed: boolean; // Globen-style spherical dome
  scoreboard: 'none' | 'cube' | 'jumbo';
  banners: number; // championship banners hung per long side
  spotlights: boolean; // dramatic coloured spotlights
  barn: boolean; // exposed-truss practice shed
}

const ARENA_SPECS: ArenaSpec[] = [
  { rows: 0, allSides: false, upperRows: 0, ceiling: 8, domed: false, scoreboard: 'none', banners: 0, spotlights: false, barn: true },
  { rows: 5, allSides: false, upperRows: 0, ceiling: 13, domed: false, scoreboard: 'none', banners: 0, spotlights: false, barn: false },
  { rows: 8, allSides: true, upperRows: 0, ceiling: 19, domed: false, scoreboard: 'cube', banners: 0, spotlights: false, barn: false },
  { rows: 11, allSides: true, upperRows: 6, ceiling: 26, domed: false, scoreboard: 'cube', banners: 4, spotlights: true, barn: false },
  { rows: 13, allSides: true, upperRows: 10, ceiling: 32, domed: true, scoreboard: 'jumbo', banners: 6, spotlights: true, barn: false },
];

const TIER_DEPTH = 1.7;
const TIER_HEIGHT = 0.85;

/** Procedural championship banner: navy field, gold border, star + number. */
function bannerTexture(n: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#0c2a5e';
  ctx.fillRect(0, 0, 128, 256);
  ctx.strokeStyle = '#f2c40f';
  ctx.lineWidth = 10;
  ctx.strokeRect(8, 8, 112, 240);
  ctx.fillStyle = '#f2c40f';
  ctx.font = 'bold 64px serif';
  ctx.textAlign = 'center';
  ctx.fillText('★', 64, 96);
  ctx.font = 'bold 40px sans-serif';
  ctx.fillText(String(1990 + n * 3), 64, 170);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The surroundings: concrete apron, tiered stands, roof and lights, built per
 * level from its tier and returned as one group so the next level swaps it out.
 */
export function createArena(scene: THREE.Scene, level: LevelDef): THREE.Group {
  const spec = ARENA_SPECS[Math.max(0, Math.min(ARENA_SPECS.length - 1, level.tier))];
  const group = new THREE.Group();
  scene.background = new THREE.Color(level.hallColor);
  scene.fog = new THREE.Fog(level.hallColor, 45, 110 + level.tier * 30);

  // Concrete apron around the rink
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(RINK_LENGTH + 60, RINK_WIDTH + 60),
    new THREE.MeshStandardMaterial({ color: spec.barn ? '#3a352c' : '#23272d', roughness: 0.96 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  floor.receiveShadow = true;
  group.add(floor);

  const seatMats = ['#15418c', '#0f3370', '#1a4da3'].map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }),
  );

  // Crowd: a generated audience texture draped as a sloped plane over each
  // deck. Materials start invisible and fade in when the texture loads.
  const crowdMats: THREE.MeshStandardMaterial[] = [];
  loadTextureInto('/assets/crowd.png', (tex) => {
    tex.wrapS = THREE.RepeatWrapping;
    for (const mat of crowdMats) {
      const own = tex.clone();
      own.repeat.set(mat.userData.repeatX, 1);
      own.needsUpdate = true;
      mat.map = own;
      mat.visible = true;
      mat.needsUpdate = true;
    }
  });

  const crowdPlane = (
    length: number,
    alongX: boolean,
    side: 1 | -1,
    nearOff: number,
    farOff: number,
    yNear: number,
    yFar: number,
    xCenter = 0,
  ) => {
    const half = length / 2;
    const corner = (along: number, d: number, y: number): [number, number, number] =>
      alongX ? [xCenter + along, y, side * d] : [side * d, y, along];
    const positions = new Float32Array([
      ...corner(-half, nearOff, yNear),
      ...corner(half, nearOff, yNear),
      ...corner(-half, farOff, yFar),
      ...corner(half, farOff, yFar),
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
    geo.setIndex([0, 1, 2, 1, 3, 2]);
    geo.computeVertexNormals();
    const slope = Math.hypot(farOff - nearOff, yFar - yNear);
    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.95,
      visible: false,
      side: THREE.DoubleSide,
    });
    mat.userData.repeatX = Math.max(1, Math.round(length / (slope * (16 / 9))));
    crowdMats.push(mat);
    group.add(new THREE.Mesh(geo, mat));
  };

  // One deck of stepped rows + its crowd plane. `gap` (an x-range, long sides
  // only) punches a vomitory tunnel through the rows for the zamboni gate.
  const deck = (
    length: number,
    alongX: boolean,
    side: 1 | -1,
    offset: number,
    baseY: number,
    rows: number,
    gap: [number, number] | null = null,
  ): { far: number; top: number } => {
    const spans: Array<[number, number]> =
      gap && alongX
        ? [
            [-length / 2, gap[0]],
            [gap[1], length / 2],
          ]
        : [[-length / 2, length / 2]];

    for (let i = 0; i < rows; i++) {
      const dist = offset + i * TIER_DEPTH;
      const y = baseY + TIER_HEIGHT / 2 + i * TIER_HEIGHT;
      for (const [a, b] of spans) {
        if (b - a < 0.5) continue;
        const segLen = b - a;
        const mid = (a + b) / 2;
        const geo = alongX
          ? new THREE.BoxGeometry(segLen, TIER_HEIGHT, TIER_DEPTH)
          : new THREE.BoxGeometry(TIER_DEPTH, TIER_HEIGHT, segLen);
        const m = new THREE.Mesh(geo, seatMats[i % seatMats.length]);
        if (alongX) m.position.set(mid, y, side * dist);
        else m.position.set(side * dist, y, mid);
        m.castShadow = i > rows - 3;
        group.add(m);
      }
    }
    const near = offset - TIER_DEPTH / 2;
    const far = offset + (rows - 1) * TIER_DEPTH + TIER_DEPTH / 2;
    const yNear = baseY + TIER_HEIGHT + 0.08;
    const yFar = baseY + rows * TIER_HEIGHT + 0.08;
    for (const [a, b] of spans) {
      if (b - a < 0.5) continue;
      crowdPlane(b - a, alongX, side, near, far, yNear, yFar, (a + b) / 2);
    }
    return { far, top: baseY + rows * TIER_HEIGHT };
  };

  const longLen = RINK_LENGTH + 12;
  const shortLen = RINK_WIDTH + 8;
  const longOff = RINK_WIDTH / 2 + 4;
  const shortOff = RINK_LENGTH / 2 + 4;

  const buildSide = (
    length: number,
    alongX: boolean,
    side: 1 | -1,
    baseOff: number,
    gap: [number, number] | null = null,
  ) => {
    // Only the lower deck needs the tunnel; the upper deck sits well clear
    const lower = deck(length, alongX, side, baseOff, 0, spec.rows, gap);
    if (spec.upperRows > 0) {
      const upperOff = lower.far + 2.6;
      deck(length, alongX, side, upperOff, lower.top + 2.4, spec.upperRows);
    }
  };

  if (spec.rows > 0) {
    buildSide(longLen, true, 1, longOff);
    buildSide(longLen, true, -1, longOff, GATE_GAP); // -Z side has the gate
    if (spec.allSides) {
      buildSide(shortLen, false, 1, shortOff);
      buildSide(shortLen, false, -1, shortOff);
    }
  }

  // ---- Roof / enclosure ----
  if (spec.domed) {
    // Globen-style: a ring wall topped by a spherical dome we sit inside
    const R = 46;
    const wallH = 13;
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, wallH, 48, 1, true),
      new THREE.MeshStandardMaterial({ color: '#10151c', roughness: 1, side: THREE.BackSide }),
    );
    wall.position.y = wallH / 2;
    group.add(wall);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(R, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: '#dfe7f0',
        emissive: '#9fb4cc',
        emissiveIntensity: 0.25,
        roughness: 0.85,
        side: THREE.BackSide,
      }),
    );
    dome.position.y = wallH;
    group.add(dome);
    // Ring of downlights where the dome springs from the wall
    const lampMat = new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#eaf2ff', emissiveIntensity: 2.5 });
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), lampMat);
      lamp.position.set(Math.cos(a) * (R - 1.5), wallH + 0.5, Math.sin(a) * (R - 1.5));
      group.add(lamp);
    }
  } else {
    const h = spec.ceiling;
    const hall = new THREE.Mesh(
      new THREE.BoxGeometry(RINK_LENGTH + 70, h, RINK_WIDTH + 70),
      new THREE.MeshStandardMaterial({
        color: spec.barn ? '#2a2519' : '#11151b',
        roughness: 1,
        side: THREE.BackSide,
      }),
    );
    hall.position.y = h / 2 - 0.05;
    group.add(hall);
  }

  // ---- Exposed roof trusses in the barn ----
  if (spec.barn) {
    const beamMat = new THREE.MeshStandardMaterial({ color: '#5b4a32', roughness: 0.9 });
    for (let i = -2; i <= 2; i++) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, RINK_WIDTH + 16), beamMat);
      beam.position.set(i * 12, spec.ceiling - 1.2, 0);
      group.add(beam);
    }
    const ridge = new THREE.Mesh(
      new THREE.BoxGeometry(RINK_LENGTH + 16, 0.4, 0.4),
      beamMat,
    );
    ridge.position.set(0, spec.ceiling - 0.8, 0);
    group.add(ridge);
  }

  // ---- Lighting ----
  group.add(
    new THREE.HemisphereLight(
      spec.barn ? '#cdbfa0' : '#bdd4ea',
      '#1c222b',
      (spec.barn ? 0.5 : 0.6) * level.lightIntensity,
    ),
  );
  const key = new THREE.DirectionalLight(spec.barn ? '#ffe6b8' : '#fdf6e8', 2.1 * level.lightIntensity);
  key.position.set(18, 26, 12);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -45;
  key.shadow.camera.right = 45;
  key.shadow.camera.top = 30;
  key.shadow.camera.bottom = -30;
  key.shadow.camera.far = 70;
  key.shadow.bias = -0.0004;
  group.add(key);
  const fill = new THREE.DirectionalLight('#cfe2f5', 0.6 * level.lightIntensity);
  fill.position.set(-20, 20, -14);
  group.add(fill);

  // Roof light rig (emissive fixtures); grander tiers get more, brighter rows
  const rigY = spec.domed ? 17 : spec.ceiling - 1.5;
  const fixtureMat = new THREE.MeshStandardMaterial({
    color: '#fff',
    emissive: '#f4f8ff',
    emissiveIntensity: spec.barn ? 1.6 : 3,
  });
  if (spec.barn) {
    // A few bare warm work lamps slung under the ridge
    const warm = new THREE.MeshStandardMaterial({ color: '#fff3d0', emissive: '#ffd27a', emissiveIntensity: 2 });
    for (const x of [-14, 0, 14]) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 10), warm);
      lamp.position.set(x, spec.ceiling - 1.6, 0);
      group.add(lamp);
      const pt = new THREE.PointLight('#ffdc9a', 0.5, 40);
      pt.position.set(x, spec.ceiling - 1.6, 0);
      group.add(pt);
    }
  } else {
    const cols = 2 + level.tier; // wider rig for bigger arenas
    for (let i = -cols; i <= cols; i++) {
      for (const z of [-7, 7]) {
        const fixture = new THREE.Mesh(new THREE.BoxGeometry(4, 0.25, 1.2), fixtureMat);
        fixture.position.set((i / cols) * (RINK_LENGTH / 2), rigY, z);
        group.add(fixture);
      }
    }
  }

  // Dramatic coloured spotlights raking the ice at the top tiers
  if (spec.spotlights) {
    const colors = ['#ff8a3d', '#3da5ff', '#ffd24a', '#7d5cff'];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const sl = new THREE.SpotLight(colors[i], 120, 120, Math.PI / 9, 0.5, 1.2);
      sl.position.set(Math.cos(a) * 26, rigY - 1, Math.sin(a) * 16);
      sl.target.position.set(Math.cos(a) * 6, 0, Math.sin(a) * 4);
      group.add(sl);
      group.add(sl.target);
    }
  }

  // ---- Centre-hung scoreboard ----
  if (spec.scoreboard !== 'none') {
    const jumbo = spec.scoreboard === 'jumbo';
    const w = jumbo ? 7 : 5;
    const screenH = jumbo ? 3.2 : 2.4;
    const board = new THREE.Group();
    board.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(w, screenH + 0.6, w),
        new THREE.MeshStandardMaterial({ color: '#14181d', roughness: 0.6 }),
      ),
    );
    const screenMat = new THREE.MeshStandardMaterial({
      color: '#0a1622',
      emissive: '#1c4d7a',
      emissiveIntensity: 1.4,
    });
    loadTextureInto('/assets/scoreboard.png', (tex) => {
      screenMat.map = tex;
      screenMat.color.set('#ffffff');
      screenMat.emissive.set('#ffffff');
      screenMat.emissiveMap = tex;
      screenMat.emissiveIntensity = 0.95;
      screenMat.needsUpdate = true;
    });
    for (const ry of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.88, screenH), screenMat);
      screen.position.set(Math.sin(ry) * (w / 2 + 0.01), 0, Math.cos(ry) * (w / 2 + 0.01));
      screen.rotation.y = ry;
      board.add(screen);
    }
    board.position.set(0, spec.domed ? 22 : spec.ceiling - 6, 0);
    group.add(board);
  }

  // ---- Championship banners from the rafters ----
  if (spec.banners > 0) {
    const y = (spec.domed ? 20 : spec.ceiling - 4);
    for (const side of [1, -1] as const) {
      for (let i = 0; i < spec.banners; i++) {
        const t = (i + 0.5) / spec.banners;
        const mat = new THREE.MeshStandardMaterial({
          map: bannerTexture(i + 1),
          emissive: '#22335a',
          emissiveIntensity: 0.5,
          side: THREE.DoubleSide,
        });
        const banner = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 4.2), mat);
        banner.position.set((t - 0.5) * RINK_LENGTH * 0.8, y, side * (RINK_WIDTH / 2 + 3));
        group.add(banner);
      }
    }
  }

  scene.add(group);
  return group;
}
