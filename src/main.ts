import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Game } from './game';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft is deprecated (and mapped to this) in r184
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('app')!.appendChild(renderer.domElement);

/**
 * Dynamic resolution for weaker GPUs. If frames run slower than ~42 fps it
 * lowers the pixel ratio in 15 % steps (down to half the native density);
 * when there's clear headroom again it climbs back. If a step down doesn't
 * actually speed things up – the display is vsync-locked at 30 Hz, or the
 * bottleneck isn't pixels – it reverts and stops adapting, so it never trades
 * sharpness for nothing.
 */
class AdaptiveResolution {
  private readonly max = Math.min(window.devicePixelRatio, 2);
  private readonly min = Math.max(0.6, this.max * 0.5);
  private ratio = this.max;
  private sum = 0;
  private frames = 0;
  private lastChange = performance.now();
  private probe: { before: number; prevRatio: number } | null = null;
  private settled = false;

  constructor(private readonly r: THREE.WebGLRenderer) {}

  get pixelRatio(): number {
    return this.ratio;
  }

  sample(dt: number): void {
    if (this.settled || dt <= 0 || dt > 0.1) return; // ignore hitches/tab switches
    this.sum += dt * 1000;
    if (++this.frames < 60) return;
    const avg = this.sum / this.frames;
    this.sum = 0;
    this.frames = 0;
    const now = performance.now();

    if (this.probe) {
      // Did the last step down pay off?
      if (avg > this.probe.before * 0.92) {
        this.apply(this.probe.prevRatio);
        this.settled = true;
      }
      this.probe = null;
      return;
    }
    if (avg > 24 && this.ratio > this.min && now - this.lastChange > 2000) {
      this.probe = { before: avg, prevRatio: this.ratio };
      this.apply(Math.max(this.min, this.ratio * 0.85));
    } else if (avg < 15 && this.ratio < this.max && now - this.lastChange > 8000) {
      this.apply(Math.min(this.max, this.ratio / 0.85));
    }
  }

  private apply(ratio: number): void {
    this.ratio = ratio;
    this.lastChange = performance.now();
    this.r.setPixelRatio(ratio);
  }
}
const quality = new AdaptiveResolution(renderer);

const game = new Game(renderer);
// Dev/verification hooks (used by scripts/*.mjs)
(window as unknown as { __game: Game; __quality: AdaptiveResolution }).__game = game;
(window as unknown as { __quality: AdaptiveResolution }).__quality = quality;

// Environment map: gives the freshly resurfaced ice its mirror sheen
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new RoomEnvironment();
game.setEnvironment(pmrem.fromScene(envScene, 0.04).texture);
pmrem.dispose();

// Timer (not the deprecated Clock) with the Page Visibility API, so a hidden
// tab doesn't come back with one giant time step
const timer = new THREE.Timer();
timer.connect(document);
function loop(timestamp: number): void {
  requestAnimationFrame(loop);
  timer.update(timestamp);
  const dt = timer.getDelta();
  quality.sample(dt);
  game.update(dt);
}
requestAnimationFrame(loop);
