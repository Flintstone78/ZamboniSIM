import * as THREE from 'three';
import { RINK_LENGTH, RINK_WIDTH, GATE_X_MIN, GATE_X_MAX } from './constants';
import { loadTextureInto } from './assets';
import type { LevelDef } from './levels';

// The zamboni tunnel cuts a vomitory-style gap through the -Z stands so the
// equipment-room corridor isn't walled in (and the reveal camera isn't buried).
const GATE_GAP: [number, number] = [GATE_X_MIN - 0.5, GATE_X_MAX + 0.5];

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
  // Exposed via userData so the game can run a "wave" through the blocks.
  const crowdMats: THREE.MeshStandardMaterial[] = [];
  group.userData.crowdMats = crowdMats;
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

  // Aisle stairs: a concrete strip climbing the deck between crowd segments
  const aisleMat = new THREE.MeshStandardMaterial({ color: '#6b7480', roughness: 0.92 });

  // One deck of stepped rows + its crowd plane. `gap` (an x-range, long sides
  // only) punches a vomitory tunnel through the rows for the zamboni gate.
  // Concrete aisle stairs split the crowd into blocks every ~9 m.
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
    const AISLE_W = 1.1;
    for (const [a, b] of spans) {
      if (b - a < 0.5) continue;
      // Aisle positions inside this span; crowd fills the blocks between them
      const aisles: number[] = [];
      if (rows >= 4) {
        for (let p = a + 4.5; p <= b - 4.5; p += 9) aisles.push(p);
      }
      let cur = a;
      for (const p of aisles) {
        const blockEnd = p - AISLE_W / 2;
        if (blockEnd - cur > 0.5) {
          crowdPlane(blockEnd - cur, alongX, side, near, far, yNear, yFar, (cur + blockEnd) / 2);
        }
        // The stair strip itself: a sloped quad in concrete grey
        const half = AISLE_W / 2;
        const c = (along: number, d: number, y: number): [number, number, number] =>
          alongX ? [p + along, y, side * d] : [side * d, y, p + along];
        const positions = new Float32Array([
          ...c(-half, near, yNear),
          ...c(half, near, yNear),
          ...c(-half, far, yFar),
          ...c(half, far, yFar),
        ]);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setIndex([0, 1, 2, 1, 3, 2]);
        geo.computeVertexNormals();
        const stair = new THREE.Mesh(geo, aisleMat);
        (stair.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
        group.add(stair);
        cur = p + AISLE_W / 2;
      }
      if (b - cur > 0.5) {
        crowdPlane(b - cur, alongX, side, near, far, yNear, yFar, (cur + b) / 2);
      }
    }
    return { far, top: baseY + rows * TIER_HEIGHT };
  };

  const longLen = RINK_LENGTH + 12;
  const shortLen = RINK_WIDTH + 8;
  const longOff = RINK_WIDTH / 2 + 4;
  const shortOff = RINK_LENGTH / 2 + 4;

  const fasciaMat = new THREE.MeshStandardMaterial({ color: '#171d25', roughness: 0.85 });
  const railMat = new THREE.MeshStandardMaterial({ color: '#c7d0da', roughness: 0.35, metalness: 0.6 });

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
      const upperBase = lower.top + 2.4;
      deck(length, alongX, side, upperOff, upperBase, spec.upperRows);

      // Fascia wall closing the gap under the upper deck (it floated before),
      // topped with a guard rail along the balcony edge.
      const fasciaH = upperBase - lower.top + 0.4;
      const fDist = upperOff - TIER_DEPTH / 2 - 0.08;
      const fascia = new THREE.Mesh(
        alongX
          ? new THREE.BoxGeometry(length, fasciaH, 0.25)
          : new THREE.BoxGeometry(0.25, fasciaH, length),
        fasciaMat,
      );
      const fy = lower.top + fasciaH / 2 - 0.2;
      if (alongX) fascia.position.set(0, fy, side * fDist);
      else fascia.position.set(side * fDist, fy, 0);
      group.add(fascia);
      const rail = new THREE.Mesh(
        alongX
          ? new THREE.BoxGeometry(length, 0.07, 0.07)
          : new THREE.BoxGeometry(0.07, 0.07, length),
        railMat,
      );
      if (alongX) rail.position.set(0, upperBase + 0.85, side * fDist);
      else rail.position.set(side * fDist, upperBase + 0.85, 0);
      group.add(rail);
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

  // Team benches + penalty boxes nestled against the +Z boards (rink-side
  // furniture that sells the "real arena" read). Built when there are stands.
  if (spec.rows > 0) {
    const zBench = RINK_WIDTH / 2 + 1.0;
    const darkMat = new THREE.MeshStandardMaterial({ color: '#202830', roughness: 0.8 });
    const seatMat = new THREE.MeshStandardMaterial({ color: '#b71c1c', roughness: 0.7 });
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: '#cfe8ff', transparent: true, opacity: 0.16, roughness: 0.05, side: THREE.DoubleSide,
    });
    const box = (w: number, x: number, seatColor?: string) => {
      const g = new THREE.Group();
      const back = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, 1.6), darkMat);
      back.position.set(0, 0.55, 0);
      g.add(back);
      const seat = new THREE.Mesh(
        new THREE.BoxGeometry(w - 0.4, 0.18, 0.5),
        seatColor ? new THREE.MeshStandardMaterial({ color: seatColor, roughness: 0.7 }) : seatMat,
      );
      seat.position.set(0, 0.55, 0.3);
      g.add(seat);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(w, 0.8, 0.04), glassMat);
      glass.position.set(0, 1.5, -0.7);
      g.add(glass);
      g.position.set(x, 0, zBench);
      group.add(g);
    };
    box(7, -9, '#1565c0'); // home bench
    box(7, 9, '#c62828'); // away bench
    box(2.6, -3); // penalty box
    box(2.6, 3); // penalty box
  }

  // Glowing ribbon board around the lower-bowl fascia (modern-arena look)
  if (spec.rows > 0 && level.tier >= 2) {
    const ribbonMat = new THREE.MeshStandardMaterial({
      color: '#0a1622', emissive: '#1d6fb8', emissiveIntensity: 1.1,
    });
    loadTextureInto('/assets/board_ads.png', (tex) => {
      tex.wrapS = THREE.RepeatWrapping;
      tex.repeat.set(8, 1);
      ribbonMat.map = tex;
      ribbonMat.emissiveMap = tex;
      ribbonMat.color.set('#ffffff');
      ribbonMat.emissive.set('#9fd0ff');
      ribbonMat.needsUpdate = true;
    });
    const y = spec.rows * TIER_HEIGHT + 0.5;
    const ring = (len: number, alongX: boolean, off: number) => {
      const geo = new THREE.PlaneGeometry(len, 0.7);
      for (const side of [1, -1] as const) {
        const m = new THREE.Mesh(geo, ribbonMat);
        if (alongX) {
          m.position.set(0, y, side * off);
          m.rotation.y = side > 0 ? Math.PI : 0;
        } else {
          m.position.set(side * off, y, 0);
          m.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        }
        group.add(m);
      }
    };
    ring(RINK_LENGTH + 8, true, RINK_WIDTH / 2 + 3.6);
    if (spec.allSides) ring(RINK_WIDTH + 4, false, RINK_LENGTH / 2 + 3.6);
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

  // ---- Steel roof trusses (arena tiers; the barn keeps its wooden beams) ----
  if (!spec.barn && !spec.domed && spec.rows > 0) {
    const steel = new THREE.MeshStandardMaterial({ color: '#3d4650', roughness: 0.55, metalness: 0.55 });
    const ty = spec.ceiling - 0.9;
    // Two lengthwise double-chord trusses with vertical web posts
    for (const z of [-9, 9]) {
      for (const dy of [0, -1.1]) {
        const chord = new THREE.Mesh(new THREE.BoxGeometry(RINK_LENGTH + 34, 0.3, 0.3), steel);
        chord.position.set(0, ty + dy, z);
        group.add(chord);
      }
      for (let x = -24; x <= 24; x += 6) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.1, 0.16), steel);
        post.position.set(x, ty - 0.55, z);
        group.add(post);
      }
    }
    // Cross beams tying the trusses together
    for (let x = -24; x <= 24; x += 12) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 22), steel);
      beam.position.set(x, ty, 0);
      group.add(beam);
    }
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
  // Kept close to neutral: the hall is baked into the ice's reflections, so a
  // warm palette here would tint the whole sheet beige
  group.add(
    new THREE.HemisphereLight(
      spec.barn ? '#cfc9b8' : '#bdd4ea',
      '#1c222b',
      (spec.barn ? 0.5 : 0.6) * level.lightIntensity,
    ),
  );
  const key = new THREE.DirectionalLight(spec.barn ? '#f6ecd7' : '#fbfaf4', 2.1 * level.lightIntensity);
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
    const boardY = spec.domed ? 22 : spec.ceiling - 6;
    board.position.set(0, boardY, 0);
    group.add(board);

    // Suspension cables from the rafters to the four corners of the cube
    const cableMat = new THREE.MeshStandardMaterial({ color: '#20262e', roughness: 0.5, metalness: 0.6 });
    const roofY = spec.domed ? 34 : spec.ceiling - 0.6;
    const cableLen = roofY - (boardY + (screenH + 0.6) / 2);
    if (cableLen > 0.5) {
      const cableGeo = new THREE.CylinderGeometry(0.035, 0.035, cableLen, 6);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const cable = new THREE.Mesh(cableGeo, cableMat);
          cable.position.set(sx * w * 0.32, boardY + (screenH + 0.6) / 2 + cableLen / 2, sz * w * 0.32);
          group.add(cable);
        }
      }
    }
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
