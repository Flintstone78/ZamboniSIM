import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Game } from './game';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('app')!.appendChild(renderer.domElement);

const game = new Game(renderer);
// Dev/verification hook (used by scripts/screenshot.mjs)
(window as unknown as { __game: Game }).__game = game;

// Environment map: gives the freshly resurfaced ice its mirror sheen
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new RoomEnvironment();
game.setEnvironment(pmrem.fromScene(envScene, 0.04).texture);
pmrem.dispose();

const clock = new THREE.Clock();
function loop(): void {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  game.update(dt);
}
loop();
