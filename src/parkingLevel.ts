import * as THREE from 'three';
import {
  LOT_WIDTH,
  LOT_DEPTH,
  STALL_WIDTH,
  STALL_DEPTH,
  SWATH_REAR_OFFSET,
  PARK_TIME_LIMIT,
  CAR_APPROACH_SPEED,
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
import { disposeObject } from './assets';

type StallState = 'empty' | 'incoming' | 'snowed' | 'occupied';

/**
 * The route a car drives to its stall, measured in metres along it: straight
 * down the central lane (z = 0), a quarter-circle turn, then straight into
 * the stall. Distances below 0 extend the lane back out past the entrance
 * (where a car that lost its stall reverses away).
 */
interface CarPath {
  x0: number; // lane entrance x
  dirX: number; // ±1, direction of travel down the lane
  sz: number; // ±1, which row the stall is on
  cx: number; // stall centre x
  la: number; // lane segment length
  lb: number; // arc length
  lc: number; // final straight into the stall
  start: number; // heading along the lane
  delta: number; // signed heading change through the turn (always ±π/2)
}

interface CarMover {
  mesh: THREE.Group;
  path: CarPath;
  s: number; // distance along the path
  speed: number; // signed m/s along the path (− = reversing)
  leaving: boolean; // lost its stall – backing out to despawn
  wait: number; // seconds spent blocked by the zamboni
  honked: boolean;
}

interface StallRuntime {
  stall: Stall;
  state: StallState;
  mover: CarMover | null;
  indicator: THREE.Mesh | null;
}

// Cars enter from the +X end of the central lane and drive in
const LANE_ENTRANCE_X = LOT_WIDTH / 2 - 1.5;
const TURN_RADIUS = 2.2;
const CAR_TURN_SPEED = 4.2; // m/s through the quarter turn
const CAR_ACCEL = 5; // m/s²
const CAR_BRAKE = 7; // m/s²
const CAR_REVERSE_SPEED = 3.2;
const CAR_CREEP_SPEED = 1.5; // nudging past a zamboni that won't move
const CAR_PATIENCE = 1.3; // seconds a car waits before nudging past
const CAR_LOOKAHEAD = 5.6; // m – stop if something is this close ahead
const CAR_HALF_WIDTH = 1.15;

function makePath(cx: number, cz: number): CarPath {
  const dirX = cx < LANE_ENTRANCE_X ? -1 : 1;
  const sz = cz > 0 ? 1 : -1;
  const start = dirX < 0 ? -Math.PI / 2 : Math.PI / 2;
  const target = sz > 0 ? 0 : Math.PI; // nose into the stall
  const turnX = cx - dirX * TURN_RADIUS;
  return {
    x0: LANE_ENTRANCE_X,
    dirX,
    sz,
    cx,
    la: Math.abs(turnX - LANE_ENTRANCE_X),
    lb: (Math.PI / 2) * TURN_RADIUS,
    lc: Math.max(0, Math.abs(cz) - TURN_RADIUS),
    start,
    // Shortest way round – the old lerp swung the far row's cars 270°
    delta: Math.atan2(Math.sin(target - start), Math.cos(target - start)),
  };
}

const pathLength = (p: CarPath): number => p.la + p.lb + p.lc;

/** Pose at distance `s` along the path. */
function poseOnPath(p: CarPath, s: number, out: { x: number; z: number; h: number }): void {
  const R = TURN_RADIUS;
  if (s <= p.la) {
    out.x = p.x0 + p.dirX * s;
    out.z = 0;
    out.h = p.start;
  } else if (s <= p.la + p.lb) {
    const phi = (s - p.la) / R;
    out.x = p.cx - p.dirX * R + p.dirX * R * Math.sin(phi);
    out.z = p.sz * R * (1 - Math.cos(phi));
    out.h = p.start + p.delta * (phi / (Math.PI / 2));
  } else {
    out.x = p.cx;
    out.z = p.sz * (R + (s - p.la - p.lb));
    out.h = p.start + p.delta;
  }
}

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
  private leaving: CarMover[] = []; // cars backing out of a stall you stole
  private readonly scratchPose = { x: 0, z: 0, h: 0 };
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
      mover: null,
      indicator: null,
    }));
  }

  /** The group holding the cars, indicators and snow piles (moved per step,
   *  so the game interpolates its children between steps). */
  get movingGroup(): THREE.Object3D {
    return this.dynamic;
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
    disposeObject(this.dynamic); // cars/indicators/piles are built per round
    this.dynamic.clear();
    for (const r of this.stalls) {
      r.state = 'empty';
      r.mover = null;
      r.indicator = null;
    }
    this.leaving = [];
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

    const blinkOn = Math.floor(this.blinkClock * 6) % 2 === 0;
    for (const r of this.stalls) {
      if (r.state === 'incoming' && r.mover) {
        // The target stall blinks red the whole time the car is on its way in
        if (r.indicator) {
          (r.indicator.material as THREE.MeshStandardMaterial).opacity = blinkOn ? 0.8 : 0.25;
        }
        if (this.driveCar(r.mover, dt, vehicle)) this.completePark(r);
      }
    }
    for (let i = this.leaving.length - 1; i >= 0; i--) {
      const m = this.leaving[i];
      if (this.driveCar(m, dt, vehicle)) {
        // Backed out past the entrance – gone
        this.dynamic.remove(m.mesh);
        disposeObject(m.mesh);
        this.leaving.splice(i, 1);
      }
    }

    // Every car is solid, moving or parked. Running into one is on you; a
    // car creeping into a zamboni that's standing still just nudges it.
    for (const m of this.allCars()) {
      const impact = vehicle.collideCircle(m.mesh.position.x, m.mesh.position.z, CAR_COLLISION_RADIUS);
      if (impact > 0) {
        this.collisions++;
        this.toast('Hit a car! −300 pts');
        this.onCarHit(impact);
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

  /** Every car on the lot: arriving, parked and backing out. */
  private *allCars(): Generator<CarMover> {
    for (const r of this.stalls) if (r.mover) yield r.mover;
    yield* this.leaving;
  }

  /**
   * Advance one car along its path with a speed controller: cruise down the
   * lane, slow for the turn, brake to a stop exactly in the stall, and stop
   * for anything in the way – a car ahead, or the zamboni (which, if it just
   * sits there, gets nudged aside after a moment). Returns true once the car
   * reaches the end of its trip (parked, or backed out of sight).
   */
  private driveCar(m: CarMover, dt: number, vehicle: Vehicle): boolean {
    const p = m.path;
    const end = m.leaving ? -6 : pathLength(p);
    const dir = m.leaving ? -1 : 1;
    const remaining = Math.max(0, (end - m.s) * dir);

    let target = m.leaving ? CAR_REVERSE_SPEED : CAR_APPROACH_SPEED;
    if (!m.leaving) {
      // Ease off approaching the turn, hold turn speed through it
      const toTurn = p.la - m.s;
      if (toTurn < p.lb + 4) target = Math.min(target, CAR_TURN_SPEED + Math.max(0, toTurn) * 0.9);
      // Brake to arrive at rest
      target = Math.min(target, Math.sqrt(2 * CAR_BRAKE * remaining) + 0.15);
    }

    // Anything ahead (in the direction of travel)?
    poseOnPath(p, m.s, this.scratchPose);
    const fx = Math.sin(this.scratchPose.h) * dir;
    const fz = Math.cos(this.scratchPose.h) * dir;
    // Look far enough ahead to stop from the current speed before touching
    const v0 = Math.abs(m.speed);
    const look = CAR_LOOKAHEAD + (v0 * v0) / (2 * CAR_BRAKE);
    const ahead = (x: number, z: number): boolean => {
      const dx = x - this.scratchPose.x;
      const dz = z - this.scratchPose.z;
      const along = dx * fx + dz * fz;
      return along > 0 && along < look && Math.abs(dx * fz - dz * fx) < CAR_HALF_WIDTH + 1.2;
    };
    let carAhead = false;
    for (const o of this.allCars()) {
      if (o !== m && ahead(o.mesh.position.x, o.mesh.position.z)) carAhead = true;
    }
    if (carAhead) {
      target = 0;
    } else if (ahead(vehicle.position.x, vehicle.position.y)) {
      m.wait += dt;
      if (m.wait < CAR_PATIENCE) {
        target = 0;
      } else {
        target = Math.min(target, CAR_CREEP_SPEED);
        if (!m.honked) {
          m.honked = true;
          this.toast('Honk! A car is squeezing past');
        }
      }
    } else {
      m.wait = 0;
    }

    // Smooth accel/brake toward the target speed (speed kept as magnitude)
    const v = Math.abs(m.speed);
    const next = v < target ? Math.min(target, v + CAR_ACCEL * dt) : Math.max(target, v - CAR_BRAKE * dt);
    m.speed = next * dir;
    m.s += m.speed * dt;
    const arrived = m.leaving ? m.s <= end : m.s >= end - 0.01;
    if (arrived) m.s = end;

    poseOnPath(p, m.s, this.scratchPose);
    m.mesh.position.set(this.scratchPose.x, 0, this.scratchPose.z);
    m.mesh.rotation.y = this.scratchPose.h;
    return arrived;
  }

  private scheduleCar(): void {
    // Don't spawn a car on top of one still waiting at the entrance
    for (const o of this.allCars()) {
      if (Math.hypot(o.mesh.position.x - LANE_ENTRANCE_X, o.mesh.position.z) < 6) {
        this.nextSpawn = 0.6;
        return;
      }
    }
    const free = this.stalls.filter((r) => r.state === 'empty');
    if (free.length === 0) return;
    const r = free[(Math.random() * free.length) | 0];
    r.state = 'incoming';

    const car = createCar();
    const mover: CarMover = {
      mesh: car,
      path: makePath(r.stall.cx, r.stall.cz),
      s: 0,
      speed: CAR_APPROACH_SPEED * 0.7, // rolls in already moving
      leaving: false,
      wait: 0,
      honked: false,
    };
    poseOnPath(mover.path, 0, this.scratchPose);
    car.position.set(this.scratchPose.x, 0, this.scratchPose.z);
    car.rotation.y = this.scratchPose.h;
    r.mover = mover;
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
    if (r.mover) r.mover.speed = 0;
    if (r.indicator) {
      this.dynamic.remove(r.indicator);
      disposeObject(r.indicator);
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

    if (best.mover) {
      // Beaten to it – the car backs out the way it came instead of vanishing
      best.mover.leaving = true;
      best.mover.wait = 0;
      this.leaving.push(best.mover);
      best.mover = null;
    }
    if (best.indicator) {
      this.dynamic.remove(best.indicator);
      disposeObject(best.indicator);
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
    // Nothing snowed is a failed round – no free star for idling
    const stars = frac <= 0 ? 0 : frac >= 0.9 ? 3 : frac >= 0.6 ? 2 : 1;
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
