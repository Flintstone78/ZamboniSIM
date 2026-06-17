import * as THREE from 'three';
import type { Vehicle, Bounds } from './vehicle';

export interface HudRow {
  label: string;
  value: string;
}

/** Snapshot of everything the HUD needs to draw for the active level. */
export interface HudState {
  levelName: string;
  progressLabel: string;
  progress: number; // 0..1 for the bar fill
  progressText: string; // e.g. "42.0%" or "7 / 14"
  rows: HudRow[]; // right-hand stat rows (time, etc.)
  score: number;
}

export interface FinishResult {
  title: string;
  rows: HudRow[];
  total: number;
  stars: number;
}

/** Where the top-down overview camera sits for this level. */
export interface TopView {
  position: THREE.Vector3;
  up: THREE.Vector3;
  lookAt: THREE.Vector3;
}

/** A self-contained playable scenario hosted by the Game. */
export interface Level {
  readonly name: string;
  readonly group: THREE.Object3D; // contents to add to the scene
  readonly bounds: Bounds; // static collision boundary for the vehicle
  readonly background: THREE.Color;
  readonly fog: THREE.Fog | null;
  readonly startPose: { x: number; z: number; heading: number };
  readonly helpText: string;

  reset(): void;
  /** Advance the level. The vehicle has already moved this tick. */
  update(dt: number, vehicle: Vehicle, elapsed: number): void;
  /** Spacebar pressed. */
  action(vehicle: Vehicle): void;
  /** The vehicle hit the static boundary at this speed. */
  onCollision(impactSpeed: number): void;

  hud(vehicle: Vehicle, elapsed: number): HudState;
  readonly finished: boolean;
  result(elapsed: number): FinishResult;

  topView(): TopView;
  /** Draw the level's own minimap (coverage grid / parking map) into ctx. */
  drawMinimap(ctx: CanvasRenderingContext2D, vehicle: Vehicle): void;
}

/** Shared minimap helper: a little arrow showing the zamboni's pose. */
export function drawVehicleMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  heading: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 2 - heading);
  ctx.fillStyle = '#ffca28';
  ctx.beginPath();
  ctx.moveTo(6, 0);
  ctx.lineTo(-4, 4);
  ctx.lineTo(-4, -4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
