import * as THREE from 'three';
import { Vehicle, Input } from './vehicle';
import { Hud } from './hud';
import { createZamboni } from './zamboni';
import type { Level } from './level';
import { RinkLevel } from './rinkLevel';
import { ParkingLevel } from './parkingLevel';

type CameraMode = 'chase' | 'fpv' | 'top';
const CAMERA_MODES: CameraMode[] = ['chase', 'fpv', 'top'];

export class Game {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private vehicle: Vehicle;
  private zamboni = createZamboni();
  private input = new Input();
  private hud: Hud;
  private envMap: THREE.Texture | null = null;

  private levels: Level[];
  private level!: Level;

  private cameraMode: CameraMode = 'chase';
  private camPos = new THREE.Vector3();
  private elapsed = 0;
  private finishShown = false;
  private minimapTimer = 0;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      300,
    );

    this.scene.add(this.zamboni);
    this.vehicle = new Vehicle({
      onCollision: (impact) => {
        if (this.level.finished) return;
        this.level.onCollision(impact);
      },
    });

    this.hud = new Hud(() => this.restart());

    const toast = (msg: string) => this.hud.showToast(msg);
    this.levels = [new RinkLevel(toast), new ParkingLevel(toast)];

    this.input.onTap['c'] = () => {
      const i = CAMERA_MODES.indexOf(this.cameraMode);
      this.cameraMode = CAMERA_MODES[(i + 1) % CAMERA_MODES.length];
    };
    this.input.onTap['r'] = () => this.restart();
    this.input.onTap[' '] = () => this.level.action(this.vehicle);
    this.input.onTap['1'] = () => this.setLevel(0);
    this.input.onTap['2'] = () => this.setLevel(1);

    this.setLevel(0);

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  setEnvironment(envMap: THREE.Texture): void {
    this.envMap = envMap;
    this.scene.environment = envMap;
  }

  /** Debug/test access used by scripts/screenshot.mjs. */
  get debugLevel(): Level {
    return this.level;
  }
  get debugVehicle(): Vehicle {
    return this.vehicle;
  }

  /** Switch to a level by index and start it fresh. */
  setLevel(index: number): void {
    if (this.level) this.scene.remove(this.level.group);
    this.level = this.levels[index];
    this.scene.add(this.level.group);
    this.scene.background = this.level.background;
    this.scene.fog = this.level.fog;
    this.scene.environment = this.envMap;
    this.vehicle.bounds = this.level.bounds;
    this.hud.setHelp(this.level.helpText);
    this.restart();
  }

  restart(): void {
    this.level.reset();
    const p = this.level.startPose;
    this.vehicle.reset(p.x, p.z, p.heading);
    this.elapsed = 0;
    this.finishShown = false;
    this.hud.hideFinish();
    this.syncZamboni();
    this.camPos.set(0, 0, 0); // forces a camera snap next update
    this.updateCamera(1);
  }

  update(dt: number): void {
    this.tick(dt);
    this.renderer.render(this.scene, this.camera);
  }

  /** One simulation step without rendering (also used by headless tests). */
  tick(dt: number): void {
    if (!this.level.finished) {
      this.elapsed += dt;
      this.vehicle.update(dt, this.input.throttle, this.input.steer);
      this.level.update(dt, this.vehicle, this.elapsed);
    }
    if (this.level.finished && !this.finishShown) {
      this.finishShown = true;
      this.hud.showFinish(this.level.result(this.elapsed));
    }

    this.syncZamboni();
    this.updateCamera(dt);
    this.hud.update(this.level.hud(this.vehicle, this.elapsed), this.vehicle.forwardSpeed);

    this.minimapTimer -= dt;
    if (this.minimapTimer <= 0) {
      this.minimapTimer = 0.2;
      this.hud.drawMinimap(this.level, this.vehicle);
    }
  }

  private syncZamboni(): void {
    this.zamboni.position.set(this.vehicle.position.x, 0, this.vehicle.position.y);
    this.zamboni.rotation.y = this.vehicle.heading;
  }

  private updateCamera(dt: number): void {
    const fwd = this.vehicle.forward;
    const pos = this.vehicle.position;

    if (this.cameraMode === 'top') {
      const tv = this.level.topView();
      this.camera.up.copy(tv.up);
      this.camera.position.copy(tv.position);
      this.camera.lookAt(tv.lookAt);
      this.camPos.copy(this.camera.position);
      return;
    }
    this.camera.up.set(0, 1, 0);

    if (this.cameraMode === 'fpv') {
      // Driver's eye from the rear platform
      this.camera.position.set(pos.x - fwd.x * 1.4, 2.25, pos.y - fwd.y * 1.4);
      this.camera.lookAt(pos.x + fwd.x * 12, 1.3, pos.y + fwd.y * 12);
      this.camPos.copy(this.camera.position);
      return;
    }

    const target = new THREE.Vector3(pos.x - fwd.x * 8.5, 4.6, pos.y - fwd.y * 8.5);
    if (this.camPos.lengthSq() === 0) this.camPos.copy(target);
    this.camPos.lerp(target, Math.min(1, dt * 3.5));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(pos.x + fwd.x * 4, 1.2, pos.y + fwd.y * 4);
  }
}
