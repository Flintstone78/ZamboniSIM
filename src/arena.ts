import * as THREE from 'three';
import { RINK_LENGTH, RINK_WIDTH } from './constants';
import { loadTextureInto } from './assets';

/**
 * The surroundings: concrete apron, tiered stands, ceiling rig and lights.
 * This is the part that gets swapped out per arena (local rink vs MSG) –
 * the rink itself is regulation-sized everywhere.
 */
export function createArena(scene: THREE.Scene): void {
  scene.background = new THREE.Color('#0a0e14');
  scene.fog = new THREE.Fog('#0a0e14', 60, 160);

  // Concrete floor around the rink
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(RINK_LENGTH + 40, RINK_WIDTH + 40),
    new THREE.MeshStandardMaterial({ color: '#23272d', roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  floor.receiveShadow = true;
  scene.add(floor);

  // Tiered stands along both long sides and behind the goals
  const seatColors = ['#15418c', '#0f3370', '#1a4da3'];
  const standMat = seatColors.map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }),
  );
  const tierCount = 9;
  const tierDepth = 1.6;
  const tierHeight = 0.8;

  // Crowd: a generated audience texture draped as a sloped plane over the
  // tiers. Materials start invisible and fade in when the texture loads, so
  // the stands still read as empty seating without the asset.
  const crowdMats: THREE.MeshStandardMaterial[] = [];
  loadTextureInto('/assets/crowd.png', (tex) => {
    tex.wrapS = THREE.RepeatWrapping;
    for (const mat of crowdMats) {
      const ownTex = tex.clone();
      ownTex.repeat.set(mat.userData.repeatX, 1);
      ownTex.needsUpdate = true;
      mat.map = ownTex;
      mat.visible = true;
      mat.needsUpdate = true;
    }
  });

  const crowdPlane = (length: number, alongX: boolean, side: 1 | -1, offset: number) => {
    const near = offset - tierDepth / 2;
    const far = offset + (tierCount - 1) * tierDepth + tierDepth / 2;
    const yNear = tierHeight + 0.08;
    const yFar = tierCount * tierHeight + 0.08;
    const half = length / 2;
    const corner = (along: number, d: number, y: number): [number, number, number] =>
      alongX ? [along, y, side * d] : [side * d, y, along];
    const positions = new Float32Array([
      ...corner(-half, near, yNear),
      ...corner(half, near, yNear),
      ...corner(-half, far, yFar),
      ...corner(half, far, yFar),
    ]);
    const slope = Math.hypot(far - near, yFar - yNear);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2),
    );
    geo.setIndex([0, 1, 2, 1, 3, 2]);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.95,
      visible: false,
      side: THREE.DoubleSide,
    });
    // One full texture per ~slope-width of stand keeps the figures life-sized
    mat.userData.repeatX = Math.max(1, Math.round(length / (slope * (16 / 9))));
    crowdMats.push(mat);
    scene.add(new THREE.Mesh(geo, mat));
  };

  const buildStand = (length: number, alongX: boolean, side: 1 | -1, offset: number) => {
    for (let i = 0; i < tierCount; i++) {
      const geo = alongX
        ? new THREE.BoxGeometry(length, tierHeight, tierDepth)
        : new THREE.BoxGeometry(tierDepth, tierHeight, length);
      const m = new THREE.Mesh(geo, standMat[i % standMat.length]);
      const dist = offset + i * tierDepth;
      const y = tierHeight / 2 + i * tierHeight;
      if (alongX) m.position.set(0, y, side * dist);
      else m.position.set(side * dist, y, 0);
      scene.add(m);
    }
    crowdPlane(length, alongX, side, offset);
  };
  buildStand(RINK_LENGTH + 10, true, 1, RINK_WIDTH / 2 + 4);
  buildStand(RINK_LENGTH + 10, true, -1, RINK_WIDTH / 2 + 4);
  buildStand(RINK_WIDTH + 6, false, 1, RINK_LENGTH / 2 + 4);
  buildStand(RINK_WIDTH + 6, false, -1, RINK_LENGTH / 2 + 4);

  // Dark walls and ceiling to close the volume
  const hall = new THREE.Mesh(
    new THREE.BoxGeometry(RINK_LENGTH + 50, 24, RINK_WIDTH + 50),
    new THREE.MeshStandardMaterial({ color: '#11151b', roughness: 1, side: THREE.BackSide }),
  );
  hall.position.y = 12 - 0.05;
  scene.add(hall);

  // Light rig: emissive fixtures + real lights
  const fixtureMat = new THREE.MeshStandardMaterial({
    color: '#fff',
    emissive: '#f4f8ff',
    emissiveIntensity: 3,
  });
  for (let i = -2; i <= 2; i++) {
    for (const z of [-6, 6]) {
      const fixture = new THREE.Mesh(new THREE.BoxGeometry(4, 0.25, 1.2), fixtureMat);
      fixture.position.set(i * 12, 17, z);
      scene.add(fixture);
    }
  }

  scene.add(new THREE.HemisphereLight('#bdd4ea', '#1c222b', 0.55));

  const key = new THREE.DirectionalLight('#fdf6e8', 2.2);
  key.position.set(18, 26, 12);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -45;
  key.shadow.camera.right = 45;
  key.shadow.camera.top = 30;
  key.shadow.camera.bottom = -30;
  key.shadow.camera.far = 70;
  key.shadow.bias = -0.0004;
  scene.add(key);

  const fill = new THREE.DirectionalLight('#cfe2f5', 0.7);
  fill.position.set(-20, 20, -14);
  scene.add(fill);

  // Simple centre-hung scoreboard
  const board = new THREE.Group();
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(5, 2.4, 5),
    new THREE.MeshStandardMaterial({ color: '#14181d', roughness: 0.6 }),
  );
  board.add(cube);
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
    screenMat.emissiveIntensity = 0.9;
    screenMat.needsUpdate = true;
  });
  for (const ry of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.9), screenMat);
    screen.position.set(Math.sin(ry) * 2.51, 0, Math.cos(ry) * 2.51);
    screen.rotation.y = ry;
    board.add(screen);
  }
  board.position.set(0, 12, 0);
  scene.add(board);
}
