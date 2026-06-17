import * as THREE from 'three';
import {
  RINK_LENGTH,
  RINK_WIDTH,
  SWATH_REAR_OFFSET,
  COVERAGE_GOAL,
  GRID_COLS,
  GRID_ROWS,
  SCORE_COVERAGE_MAX,
  SCORE_PRECISION_MAX,
  SCORE_TIME_MAX,
  SCORE_TIME_PER_SECOND,
  SCORE_COLLISION_PENALTY,
} from './constants';
import { createRink, rinkBounds } from './rink';
import { createArena } from './arena';
import { IceResurfacer } from './ice';
import type { Vehicle, Bounds } from './vehicle';
import type { Level, HudState, FinishResult, TopView } from './level';
import { drawVehicleMarker } from './level';

/** The main game: resurface the whole sheet of ice without hitting the boards. */
export class RinkLevel implements Level {
  readonly name = 'Ishall';
  readonly group = new THREE.Group();
  readonly bounds: Bounds = rinkBounds;
  readonly background = new THREE.Color('#0a0e14');
  readonly fog: THREE.Fog = new THREE.Fog('#0a0e14', 60, 160);
  readonly startPose = { x: -RINK_LENGTH / 2 + 6, z: -RINK_WIDTH / 2 + 4, heading: Math.PI / 2 };
  readonly helpText = 'Spola hela isen utan att dunka i sargen.';

  readonly ice = new IceResurfacer();
  private collisions = 0;
  private done = false;

  constructor(private toast: (msg: string) => void) {
    const rink = createRink();
    rink.iceMaterial.roughnessMap = this.ice.texture;
    this.ice.attachColorMap(rink.colorTexture, rink.colorCanvas);
    this.group.add(rink.group);
    this.group.add(createArena());
  }

  reset(): void {
    this.ice.reset();
    this.collisions = 0;
    this.done = false;
  }

  update(_dt: number, vehicle: Vehicle, elapsed: number): void {
    // The conditioner only lays clean ice while rolling forwards
    if (vehicle.forwardSpeed > 0.3) {
      const fwd = vehicle.forward;
      const bladeX = vehicle.position.x - fwd.x * SWATH_REAR_OFFSET;
      const bladeZ = vehicle.position.y - fwd.y * SWATH_REAR_OFFSET;
      this.ice.paint(bladeX, bladeZ, vehicle.heading, elapsed);
    } else {
      this.ice.liftBlade();
    }
    if (this.ice.coverage >= COVERAGE_GOAL) this.done = true;
  }

  action(): void {
    // No dump action on the ice.
  }

  onCollision(impact: number): void {
    this.collisions++;
    this.toast(impact > 2.5 ? 'KRASCH! −300 p' : 'Dunk i sargen! −300 p');
  }

  get finished(): boolean {
    return this.done;
  }

  private score(elapsed: number): number {
    const cov = this.ice.coverage;
    return (
      cov * SCORE_COVERAGE_MAX +
      this.ice.precision * SCORE_PRECISION_MAX * cov +
      Math.max(0, SCORE_TIME_MAX - elapsed * SCORE_TIME_PER_SECOND) * cov -
      this.collisions * SCORE_COLLISION_PENALTY
    );
  }

  hud(_vehicle: Vehicle, elapsed: number): HudState {
    const cov = Math.min(1, this.ice.coverage / COVERAGE_GOAL);
    const m = Math.floor(elapsed / 60);
    const s = Math.floor(elapsed % 60);
    return {
      levelName: this.name,
      progressLabel: 'Spolad is',
      progress: cov,
      progressText: `${(cov * 100).toFixed(1)}%`,
      rows: [
        { label: 'Tid', value: `${m}:${s.toString().padStart(2, '0')}` },
        { label: 'Precision', value: `${Math.round(this.ice.precision * 100)}%` },
        { label: 'Krockar', value: `${this.collisions}` },
      ],
      score: Math.max(0, this.score(elapsed)),
    };
  }

  result(elapsed: number): FinishResult {
    const coverageScore = this.ice.coverage * SCORE_COVERAGE_MAX;
    const precisionScore = this.ice.precision * SCORE_PRECISION_MAX;
    const timeScore = Math.max(0, SCORE_TIME_MAX - elapsed * SCORE_TIME_PER_SECOND);
    const collisionPenalty = this.collisions * SCORE_COLLISION_PENALTY;
    const total = coverageScore + precisionScore + timeScore - collisionPenalty;
    const stars = total >= 13000 ? 3 : total >= 10500 ? 2 : 1;
    return {
      title: 'Isen är spolad!',
      rows: [
        { label: 'Täckning', value: `+${Math.round(coverageScore)}` },
        { label: 'Precision', value: `+${Math.round(precisionScore)}` },
        { label: 'Tidsbonus', value: `+${Math.round(timeScore)}` },
        { label: 'Krockavdrag', value: `−${Math.round(collisionPenalty)}` },
      ],
      total,
      stars,
    };
  }

  topView(): TopView {
    return {
      position: new THREE.Vector3(0, 46, 0),
      up: new THREE.Vector3(0, 0, -1),
      lookAt: new THREE.Vector3(0, 0, 0),
    };
  }

  drawMinimap(ctx: CanvasRenderingContext2D, vehicle: Vehicle): void {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const cw = w / GRID_COLS;
    const ch = h / GRID_ROWS;
    ctx.fillStyle = '#10161f';
    ctx.fillRect(0, 0, w, h);
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        if (!this.ice.isCellPaintable(c, r)) continue;
        ctx.fillStyle = this.ice.isCellPainted(c, r) ? '#4fc3f7' : '#39424e';
        ctx.fillRect(c * cw, r * ch, Math.ceil(cw), Math.ceil(ch));
      }
    }
    drawVehicleMarker(
      ctx,
      ((vehicle.position.x + RINK_LENGTH / 2) / RINK_LENGTH) * w,
      ((vehicle.position.y + RINK_WIDTH / 2) / RINK_WIDTH) * h,
      vehicle.heading,
    );
  }
}
