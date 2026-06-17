import * as THREE from 'three';
import {
  LOT_WIDTH,
  LOT_DEPTH,
  STALL_WIDTH,
  STALL_DEPTH,
  LANE_HALF,
  SWATH_REAR_OFFSET,
  PARK_TIME_LIMIT,
  CAR_WARN_TIME,
  CAR_PARK_TIME,
  CAR_SPAWN_FIRST,
  CAR_SPAWN_INTERVAL,
  DUMP_RANGE,
  CAR_COLLISION_RADIUS,
  SCORE_PER_STALL,
  SCORE_PARK_TIME_MAX,
  SCORE_PARK_TIME_PER_SECOND,
  SCORE_COLLISION_PENALTY,
} from './constants';
import { computeStalls, createParkingLot, createCar, createSnowPile, rectBounds, type Stall } from './parking';
import type { Vehicle, Bounds } from './vehicle';
import type { Level, HudState, FinishResult, TopView } from './level';
import { drawVehicleMarker } from './level';

type StallState = 'empty' | 'incoming' | 'snowed' | 'occupied';

interface StallRuntime {
  stall: Stall;
  state: StallState;
  warn: number; // counts down during the "incoming" warning
  parking: number; // counts up while the car slides in
  car: THREE.Group | null;
  indicator: THREE.Mesh | null;
  spawnZ: number; // lane-side z the car slides in from
}

/**
 * Bonus level: out in the arena parking lot, dump snow from the tank onto the
 * free stalls before arriving cars claim them. Spacebar dumps. A stall the
 * player snows is "saved"; a stall a car parks in is lost.
 */
export class ParkingLevel implements Level {
  readonly name = 'Parkeringen';
  readonly group = new THREE.Group();
  readonly bounds: Bounds = rectBounds(LOT_WIDTH / 2, LOT_DEPTH / 2);
  readonly background = new THREE.Color('#070a12');
  readonly fog: THREE.Fog = new THREE.Fog('#070a12', 45, 130);
  readonly startPose = { x: -LOT_WIDTH / 2 + 5, z: 0, heading: Math.PI / 2 };
  readonly helpText = 'Dumpa snö (MELLANSLAG) på lediga rutor innan bilarna tar dem.';

  private stalls: StallRuntime[] = [];
  private dynamic = new THREE.Group(); // cars, snow piles, indicators
  private nextSpawn = CAR_SPAWN_FIRST;
  private snowed = 0;
  private occupied = 0;
  private collisions = 0;
  private done = false;
  private endedByTime = false;
  private blinkClock = 0;

  constructor(private toast: (msg: string) => void) {
    const stalls = computeStalls();
    this.group.add(createParkingLot(stalls));
    this.group.add(this.dynamic);
    this.stalls = stalls.map((stall) => ({
      stall,
      state: 'empty',
      warn: 0,
      parking: 0,
      car: null,
      indicator: null,
      spawnZ: Math.sign(stall.cz) * (LANE_HALF - 0.5),
    }));
  }

  reset(): void {
    this.dynamic.clear();
    for (const r of this.stalls) {
      r.state = 'empty';
      r.warn = 0;
      r.parking = 0;
      r.car = null;
      r.indicator = null;
    }
    this.nextSpawn = CAR_SPAWN_FIRST;
    this.snowed = 0;
    this.occupied = 0;
    this.collisions = 0;
    this.done = false;
    this.endedByTime = false;
    this.blinkClock = 0;
  }

  private get total(): number {
    return this.stalls.length;
  }

  update(dt: number, vehicle: Vehicle, elapsed: number): void {
    this.blinkClock += dt;
    const remaining = Math.max(0, PARK_TIME_LIMIT - elapsed);

    // Schedule a new car onto a still-free stall
    this.nextSpawn -= dt;
    if (this.nextSpawn <= 0 && remaining > 0) {
      this.scheduleCar();
      this.nextSpawn = CAR_SPAWN_INTERVAL;
    }

    for (const r of this.stalls) {
      if (r.state === 'incoming') {
        if (r.warn > 0) {
          r.warn -= dt;
          if (r.indicator) {
            const on = Math.floor(this.blinkClock * 6) % 2 === 0;
            (r.indicator.material as THREE.MeshStandardMaterial).opacity = on ? 0.75 : 0.25;
          }
        } else {
          // Car commits and slides into the stall
          r.parking += dt;
          const t = Math.min(1, r.parking / CAR_PARK_TIME);
          if (r.car) r.car.position.z = THREE.MathUtils.lerp(r.spawnZ, r.stall.cz, t);
          if (t >= 1) this.completePark(r);
        }
      }

      // Parked cars are solid obstacles
      if (r.state === 'occupied' && r.car) {
        vehicle.collideCircle(r.stall.cx, r.stall.cz, CAR_COLLISION_RADIUS);
      }
    }

    const openStalls = this.stalls.some((r) => r.state === 'empty' || r.state === 'incoming');
    if (remaining <= 0) {
      this.done = true;
      this.endedByTime = true;
    } else if (!openStalls) {
      this.done = true;
    }
  }

  private scheduleCar(): void {
    const free = this.stalls.filter((r) => r.state === 'empty');
    if (free.length === 0) return;
    const r = free[(Math.random() * free.length) | 0];
    r.state = 'incoming';
    r.warn = CAR_WARN_TIME;
    r.parking = 0;

    const car = createCar();
    car.position.set(r.stall.cx, 0, r.spawnZ);
    car.rotation.y = r.stall.cz > 0 ? 0 : Math.PI; // nose points into the stall
    r.car = car;
    this.dynamic.add(car);

    const indicator = new THREE.Mesh(
      new THREE.PlaneGeometry(STALL_WIDTH * 0.9, STALL_DEPTH * 0.9),
      new THREE.MeshStandardMaterial({
        color: '#ff5252',
        emissive: '#ff1744',
        emissiveIntensity: 1.4,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
      }),
    );
    indicator.rotation.x = -Math.PI / 2;
    indicator.position.set(r.stall.cx, 0.05, r.stall.cz);
    r.indicator = indicator;
    this.dynamic.add(indicator);
  }

  private completePark(r: StallRuntime): void {
    r.state = 'occupied';
    this.occupied++;
    if (r.car) r.car.position.z = r.stall.cz;
    if (r.indicator) {
      this.dynamic.remove(r.indicator);
      r.indicator = null;
    }
  }

  action(vehicle: Vehicle): void {
    if (this.done) return;
    // The snow chute is at the rear of the zamboni
    const fwd = vehicle.forward;
    const bx = vehicle.position.x - fwd.x * SWATH_REAR_OFFSET;
    const bz = vehicle.position.y - fwd.y * SWATH_REAR_OFFSET;

    let best: StallRuntime | null = null;
    let bestDist = DUMP_RANGE;
    for (const r of this.stalls) {
      if (r.state !== 'empty' && r.state !== 'incoming') continue;
      const d = Math.hypot(r.stall.cx - bx, r.stall.cz - bz);
      if (d < bestDist) {
        bestDist = d;
        best = r;
      }
    }

    if (!best) {
      this.toast('Ingen ledig ruta här');
      return;
    }

    // Steal it from an incoming car if needed
    if (best.car) {
      this.dynamic.remove(best.car);
      best.car = null;
    }
    if (best.indicator) {
      this.dynamic.remove(best.indicator);
      best.indicator = null;
    }
    best.state = 'snowed';
    this.snowed++;
    const pile = createSnowPile();
    pile.position.set(best.stall.cx, 0, best.stall.cz);
    this.dynamic.add(pile);
    this.toast(`Snö dumpad! +${SCORE_PER_STALL} p`);
  }

  onCollision(): void {
    this.collisions++;
    this.toast('Krock med bil! −300 p');
  }

  get finished(): boolean {
    return this.done;
  }

  private score(elapsed: number): number {
    const remaining = Math.max(0, PARK_TIME_LIMIT - elapsed);
    const timeBonus = Math.min(SCORE_PARK_TIME_MAX, remaining * SCORE_PARK_TIME_PER_SECOND);
    return (
      this.snowed * SCORE_PER_STALL +
      timeBonus * (this.snowed / this.total) -
      this.collisions * SCORE_COLLISION_PENALTY
    );
  }

  hud(_vehicle: Vehicle, elapsed: number): HudState {
    const remaining = Math.max(0, PARK_TIME_LIMIT - elapsed);
    const m = Math.floor(remaining / 60);
    const s = Math.floor(remaining % 60);
    return {
      levelName: this.name,
      progressLabel: 'Snödumpade rutor',
      progress: this.snowed / this.total,
      progressText: `${this.snowed} / ${this.total}`,
      rows: [
        { label: 'Tid kvar', value: `${m}:${s.toString().padStart(2, '0')}` },
        { label: 'Bilar', value: `${this.occupied}` },
        { label: 'Krockar', value: `${this.collisions}` },
      ],
      score: Math.max(0, this.score(elapsed)),
    };
  }

  result(elapsed: number): FinishResult {
    const remaining = Math.max(0, PARK_TIME_LIMIT - elapsed);
    const stallScore = this.snowed * SCORE_PER_STALL;
    const timeBonus = Math.min(SCORE_PARK_TIME_MAX, remaining * SCORE_PARK_TIME_PER_SECOND) *
      (this.snowed / this.total);
    const collisionPenalty = this.collisions * SCORE_COLLISION_PENALTY;
    const total = stallScore + timeBonus - collisionPenalty;
    const frac = this.snowed / this.total;
    const stars = frac >= 0.9 ? 3 : frac >= 0.6 ? 2 : 1;
    const title =
      this.snowed === this.total
        ? 'Hela parkeringen snöad!'
        : this.endedByTime
          ? 'Tiden är ute!'
          : 'Parkeringen är full!';
    return {
      title,
      rows: [
        { label: `Snöade rutor (${this.snowed}/${this.total})`, value: `+${Math.round(stallScore)}` },
        { label: 'Tidsbonus', value: `+${Math.round(timeBonus)}` },
        { label: 'Krockavdrag', value: `−${Math.round(collisionPenalty)}` },
      ],
      total,
      stars,
    };
  }

  topView(): TopView {
    return {
      position: new THREE.Vector3(0, 40, 0),
      up: new THREE.Vector3(0, 0, -1),
      lookAt: new THREE.Vector3(0, 0, 0),
    };
  }

  drawMinimap(ctx: CanvasRenderingContext2D, vehicle: Vehicle): void {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const toX = (x: number) => ((x + LOT_WIDTH / 2) / LOT_WIDTH) * w;
    const toY = (z: number) => ((z + LOT_DEPTH / 2) / LOT_DEPTH) * h;
    ctx.fillStyle = '#10161f';
    ctx.fillRect(0, 0, w, h);

    const blinkOn = Math.floor(this.blinkClock * 6) % 2 === 0;
    const cw = (STALL_WIDTH / LOT_WIDTH) * w;
    const ch = (STALL_DEPTH / LOT_DEPTH) * h;
    for (const r of this.stalls) {
      let color = '#39424e';
      if (r.state === 'snowed') color = '#4fc3f7';
      else if (r.state === 'occupied') color = '#e53935';
      else if (r.state === 'incoming') color = blinkOn ? '#ffb300' : '#7a5a12';
      ctx.fillStyle = color;
      ctx.fillRect(toX(r.stall.cx) - cw / 2, toY(r.stall.cz) - ch / 2, cw, ch);
    }

    drawVehicleMarker(ctx, toX(vehicle.position.x), toY(vehicle.position.y), vehicle.heading);
  }
}
