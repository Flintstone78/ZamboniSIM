import * as THREE from 'three';
import {
  RINK_LENGTH,
  RINK_WIDTH,
  SWATH_REAR_OFFSET,
  COVERAGE_GOAL,
  SCORE_COVERAGE_MAX,
  SCORE_PRECISION_MAX,
  SCORE_TIME_MAX,
  SCORE_TIME_PER_SECOND,
  SCORE_COLLISION_PENALTY,
} from './constants';
import { createRink } from './rink';
import { IceResurfacer } from './ice';
import { createZamboni } from './zamboni';
import { Vehicle, Input } from './vehicle';
import { Hud } from './hud';
import { createArena } from './arena';

type CameraMode = 'chase' | 'fpv' | 'top';
const CAMERA_MODES: CameraMode[] = ['chase', 'fpv', 'top'];

export class Game {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private ice = new IceResurfacer();
  private vehicle: Vehicle;
  private zamboni = createZamboni();
  private input = new Input();
  private hud: Hud;

  private cameraMode: CameraMode = 'chase';
  private camPos = new THREE.Vector3();
  private elapsed = 0;
  private collisions = 0;
  private finished = false;
  private minimapTimer = 0;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      300,
    );

    const rink = createRink();
    rink.iceMaterial.roughnessMap = this.ice.texture;
    this.ice.attachColorMap(rink.colorTexture, rink.colorCanvas);
    this.scene.add(rink.group);
    createArena(this.scene);
    this.scene.add(this.zamboni);

    this.vehicle = new Vehicle({
      onCollision: (impact) => {
        if (this.finished) return;
        this.collisions++;
        this.hud.showToast(impact > 2.5 ? 'KRASCH! −300 p' : 'Dunk i sargen! −300 p');
      },
    });

    this.hud = new Hud(() => this.restart());
    this.input.onTap['c'] = () => {
      const i = CAMERA_MODES.indexOf(this.cameraMode);
      this.cameraMode = CAMERA_MODES[(i + 1) % CAMERA_MODES.length];
    };
    this.input.onTap['r'] = () => this.restart();

    this.restart();

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  setEnvironment(envMap: THREE.Texture): void {
    this.scene.environment = envMap;
  }

  restart(): void {
    this.ice.reset();
    // Start by the boards at one end, facing down the rink
    this.vehicle.reset(-RINK_LENGTH / 2 + 6, -RINK_WIDTH / 2 + 4, Math.PI / 2);
    this.elapsed = 0;
    this.collisions = 0;
    this.finished = false;
    this.hud.hideFinish();
    this.syncZamboni();
    this.camPos.set(0, 0, 0); // forces a snap on the next camera update
    this.updateCamera(1);
  }

  update(dt: number): void {
    this.tick(dt);
    this.renderer.render(this.scene, this.camera);
  }

  /** One simulation step without rendering (also used by headless tests). */
  tick(dt: number): void {
    if (!this.finished) {
      this.elapsed += dt;
      this.vehicle.update(dt, this.input.throttle, this.input.steer);

      // The conditioner only lays clean ice while rolling forwards
      if (this.vehicle.forwardSpeed > 0.3) {
        const fwd = this.vehicle.forward;
        const bladeX = this.vehicle.position.x - fwd.x * SWATH_REAR_OFFSET;
        const bladeZ = this.vehicle.position.y - fwd.y * SWATH_REAR_OFFSET;
        this.ice.paint(bladeX, bladeZ, this.vehicle.heading, this.elapsed);
      } else {
        this.ice.liftBlade();
      }

      if (this.ice.coverage >= COVERAGE_GOAL) this.finish();
    }

    this.syncZamboni();
    this.updateCamera(dt);

    this.hud.update(
      Math.min(1, this.ice.coverage / COVERAGE_GOAL),
      this.ice.precision,
      this.elapsed,
      this.collisions,
      this.currentScore(),
      this.vehicle.forwardSpeed,
    );
    this.minimapTimer -= dt;
    if (this.minimapTimer <= 0) {
      this.minimapTimer = 0.2;
      this.hud.drawMinimap(this.ice);
      this.hud.drawMinimapMarker(
        (this.vehicle.position.x + RINK_LENGTH / 2) / RINK_LENGTH,
        (this.vehicle.position.y + RINK_WIDTH / 2) / RINK_WIDTH,
        this.vehicle.heading,
      );
    }
  }

  private currentScore(): number {
    return (
      this.ice.coverage * SCORE_COVERAGE_MAX +
      this.ice.precision * SCORE_PRECISION_MAX * this.ice.coverage +
      Math.max(0, SCORE_TIME_MAX - this.elapsed * SCORE_TIME_PER_SECOND) *
        this.ice.coverage -
      this.collisions * SCORE_COLLISION_PENALTY
    );
  }

  private finish(): void {
    this.finished = true;
    const coverageScore = this.ice.coverage * SCORE_COVERAGE_MAX;
    const precisionScore = this.ice.precision * SCORE_PRECISION_MAX;
    const timeScore = Math.max(0, SCORE_TIME_MAX - this.elapsed * SCORE_TIME_PER_SECOND);
    const collisionPenalty = this.collisions * SCORE_COLLISION_PENALTY;
    const total = coverageScore + precisionScore + timeScore - collisionPenalty;
    const stars = total >= 13000 ? 3 : total >= 10500 ? 2 : 1;
    this.hud.showFinish({ coverageScore, precisionScore, timeScore, collisionPenalty, total, stars });
  }

  private syncZamboni(): void {
    this.zamboni.position.set(this.vehicle.position.x, 0, this.vehicle.position.y);
    this.zamboni.rotation.y = this.vehicle.heading;
  }

  private updateCamera(dt: number): void {
    const fwd = this.vehicle.forward;
    const pos = this.vehicle.position;

    if (this.cameraMode === 'top') {
      // Overview: whole rink from above, long axis across the screen
      this.camera.up.set(0, 0, -1);
      this.camera.position.set(0, 46, 0);
      this.camera.lookAt(0, 0, 0);
      this.camPos.copy(this.camera.position);
      return;
    }
    this.camera.up.set(0, 1, 0);

    if (this.cameraMode === 'fpv') {
      // Driver's eye from the rear platform
      this.camera.position.set(
        pos.x - fwd.x * 1.4,
        2.25,
        pos.y - fwd.y * 1.4,
      );
      this.camera.lookAt(pos.x + fwd.x * 12, 1.3, pos.y + fwd.y * 12);
      this.camPos.copy(this.camera.position);
      return;
    }

    const target = new THREE.Vector3(
      pos.x - fwd.x * 8.5,
      4.6,
      pos.y - fwd.y * 8.5,
    );
    if (this.camPos.lengthSq() === 0) this.camPos.copy(target);
    this.camPos.lerp(target, Math.min(1, dt * 3.5));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(pos.x + fwd.x * 4, 1.2, pos.y + fwd.y * 4);
  }
}
