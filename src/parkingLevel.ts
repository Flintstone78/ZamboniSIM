import * as THREE from 'three';
import {
  LOT_WIDTH,
  LOT_DEPTH,
  STALL_WIDTH,
  STALL_DEPTH,
  SWATH_REAR_OFFSET,
  PARK_TIME_LIMIT,
  CAR_APPROACH_SPEED,
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
import {
  computeStalls,
  createParkingLot,
  createCar,
  createSnowPile,
  rectBounds,
  type Stall,
} from './parking';
import type { Vehicle, Boundary } from './vehicle';

type StallState = 'empty' | 'incoming' | 'snowed' | 'occupied';

interface StallRuntime {
  stall: Stall;
  state: StallState;
  phase: 'approach' | 'park'; // sub-phase while a car is incoming
  parkT: number; // 0..1 turn-in progress during 'park'
  approachHeading: number; // car's facing while driving the lane
  car: THREE.Group | null;
  indicator: THREE.Mesh | null;
}

// Cars enter from the +X end of the central lane and drive in
const LANE_ENTRANCE_X = LOT_WIDTH / 2 - 1.5;

export interface ParkingResult {
  title: string;
  stallScore: number;
  timeBonus: number;
  collisionPenalty: number;
  total: number;
  stars: number;
}

/**
 * Bonus level: out in the arena parking lot, dump snow from the tank onto the
 * free stalls before arriving cars claim them (SPACE dumps). A stall you snow
 * is saved (800 pts); a stall a car parks in is lost and becomes an obstacle.
 */
export class Parking {
  readonly group = new THREE.Group();
  readonly bounds: Boundary = rectBounds(LOT_WIDTH / 2, LOT_DEPTH / 2);
  readonly background = new THREE.Color('#070a12');
  readonly fog = new THREE.Fog('#070a12', 45, 130);
  readonly startPose = { x: -LOT_WIDTH / 2 + 5, z: 0, heading: Math.PI / 2 };

  private stalls: StallRuntime[] = [];
  private dynamic = new THREE.Group();
  private nextSpawn = CAR_SPAWN_FIRST;
  private snowed = 0;
  private occupied = 0;
  private collisions = 0;
  private done = false;
  private endedByTime = false;
  private blinkClock = 0;

  constructor(
    private toast: (msg: string) => void,
    private onCarHit: (impact: number) => void,
  ) {
    const stalls = computeStalls();
    this.group.add(createParkingLot(stalls));
    this.group.add(this.dynamic);
    this.stalls = stalls.map((stall) => ({
      stall,
      state: 'empty' as StallState,
      phase: 'approach' as 'approach' | 'park',
      parkT: 0,
      approachHeading: -Math.PI / 2,
      car: null,
      indicator: null,
    }));
  }

  get total(): number {
    return this.stalls.length;
  }
  get snowedCount(): number {
    return this.snowed;
  }
  get occupiedCount(): number {
    return this.occupied;
  }
  get crashCount(): number {
    return this.collisions;
  }
  get finished(): boolean {
    return this.done;
  }

  reset(): void {
    this.dynamic.clear();
    for (const r of this.stalls) {
      r.state = 'empty';
      r.phase = 'approach';
      r.parkT = 0;
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

  update(dt: number, vehicle: Vehicle, elapsed: number): void {
    this.blinkClock += dt;
    const remaining = Math.max(0, PARK_TIME_LIMIT - elapsed);

    this.nextSpawn -= dt;
    if (this.nextSpawn <= 0 && remaining > 0) {
      this.scheduleCar();
      this.nextSpawn = CAR_SPAWN_INTERVAL;
    }

    for (const r of this.stalls) {
      if (r.state === 'incoming' && r.car) {
        // The target stall blinks red the whole time the car is on its way in
        if (r.indicator) {
          const on = Math.floor(this.blinkClock * 6) % 2 === 0;
          (r.indicator.material as THREE.MeshStandardMaterial).opacity = on ? 0.8 : 0.25;
        }
        if (r.phase === 'approach') {
          // Drive along the lane (z ≈ 0) toward the stall's x
          const dx = r.stall.cx - r.car.position.x;
          const step = CAR_APPROACH_SPEED * dt;
          r.approachHeading = dx < 0 ? -Math.PI / 2 : Math.PI / 2;
          r.car.rotation.y = r.approachHeading;
          if (Math.abs(dx) <= step) {
            r.car.position.x = r.stall.cx;
            r.phase = 'park';
            r.parkT = 0;
          } else {
            r.car.position.x += Math.sign(dx) * step;
          }
        } else {
          // Turn and pull into the stall
          r.parkT = Math.min(1, r.parkT + dt / CAR_PARK_TIME);
          r.car.position.z = THREE.MathUtils.lerp(0, r.stall.cz, r.parkT);
          const parkHeading = r.stall.cz > 0 ? 0 : Math.PI; // nose into the stall
          r.car.rotation.y = THREE.MathUtils.lerp(r.approachHeading, parkHeading, r.parkT);
          if (r.parkT >= 1) this.completePark(r);
        }
      }

      if (r.state === 'occupied' && r.car) {
        const impact = vehicle.collideCircle(r.stall.cx, r.stall.cz, CAR_COLLISION_RADIUS);
        if (impact > 0) {
          this.collisions++;
          this.toast('Hit a parked car! −300 pts');
          this.onCarHit(impact);
        }
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
    r.phase = 'approach';
    r.parkT = 0;
    r.approachHeading = -Math.PI / 2;

    const car = createCar();
    car.position.set(LANE_ENTRANCE_X, 0, 0); // drive in from the lane entrance
    car.rotation.y = r.approachHeading;
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

  /** SPACE: dump snow on the nearest free/incoming stall within range. */
  action(vehicle: Vehicle): void {
    if (this.done) return;
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
      this.toast('No free stall here');
      return;
    }

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
    this.toast(`Snow dumped! +${SCORE_PER_STALL} pts`);
  }

  score(elapsed: number): number {
    const remaining = Math.max(0, PARK_TIME_LIMIT - elapsed);
    const timeBonus = Math.min(SCORE_PARK_TIME_MAX, remaining * SCORE_PARK_TIME_PER_SECOND);
    return (
      this.snowed * SCORE_PER_STALL +
      timeBonus * (this.snowed / this.total) -
      this.collisions * SCORE_COLLISION_PENALTY
    );
  }

  result(elapsed: number): ParkingResult {
    const remaining = Math.max(0, PARK_TIME_LIMIT - elapsed);
    const stallScore = this.snowed * SCORE_PER_STALL;
    const timeBonus =
      Math.min(SCORE_PARK_TIME_MAX, remaining * SCORE_PARK_TIME_PER_SECOND) * (this.snowed / this.total);
    const collisionPenalty = this.collisions * SCORE_COLLISION_PENALTY;
    const total = stallScore + timeBonus - collisionPenalty;
    const frac = this.snowed / this.total;
    const stars = frac >= 0.9 ? 3 : frac >= 0.6 ? 2 : 1;
    const title =
      this.snowed === this.total
        ? 'Whole lot snowed!'
        : this.endedByTime
          ? "Time's up!"
          : 'The lot is full!';
    return { title, stallScore, timeBonus, collisionPenalty, total, stars };
  }

  /** Where the top-down overview camera sits. */
  topView(): { position: THREE.Vector3; up: THREE.Vector3; lookAt: THREE.Vector3 } {
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

    ctx.save();
    ctx.translate(toX(vehicle.position.x), toY(vehicle.position.y));
    ctx.rotate(Math.PI / 2 - vehicle.heading);
    ctx.fillStyle = '#ffca28';
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.lineTo(-4, 4);
    ctx.lineTo(-4, -4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
