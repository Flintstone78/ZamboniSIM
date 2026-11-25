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
  SCORE_CONE_PENALTY,
  SCORE_FLOW_PER_CELL,
  COMBO_STEP,
  COMBO_MAX,
  COMBO_GRACE,
  BOOST_DRAIN,
  BOOST_REFILL,
  POWERUP_TIME_BONUS,
  POWERUP_FLOW_SECONDS,
  PARK_TIME_LIMIT,
  setRinkStandard,
  RinkStandard,
} from './constants';
import { createRink, Rink } from './rink';
import { IceResurfacer } from './ice';
import { createZamboni, animateBlade, tiltBody } from './zamboni';
import { disposeObject } from './assets';
import { setupTouchControls } from './touch';
import { Vehicle, Input, damp, type Boundary, type Pose } from './vehicle';
import { Parking } from './parkingLevel';
import { Hud } from './hud';
import { createArena } from './arena';
import { Obstacles } from './obstacles';
import { AudioEngine } from './audio';
import { Gate } from './gate';
import { Goals } from './goals';
import { Skaters } from './skaters';
import { IceSpray } from './particles';
import { PowerUps, PowerType } from './powerups';
import { TransformInterpolator } from './interp';
import {
  LevelDef,
  EUROPE_LEVELS,
  levelsForRegion,
  levelById,
  loadStars,
  saveStars,
  nextLevel,
} from './levels';
import {
  loadLevelBests,
  saveLevelBest,
  careerScore,
  getName,
  submitScore,
} from './leaderboard';

type CameraMode = 'chase' | 'fpv' | 'top';
const CAMERA_MODES: CameraMode[] = ['chase', 'fpv', 'top'];

type GameState = 'splash' | 'menu' | 'playing' | 'paused' | 'finished';

/**
 * The simulation runs at a fixed rate, decoupled from the display: physics,
 * collisions and scoring behave identically at 30, 60 or 144 Hz, and frames
 * are rendered part-way between steps (interpolation) so motion stays smooth
 * on any refresh rate.
 */
const SIM_STEP = 1 / 120;
const MAX_STEPS_PER_FRAME = 15; // beyond this (a >125 ms hitch) drop time instead of spiralling
const SPRAY_RATE = 170; // flakes per second behind the blade (doubled on turbo)

const ZERO = new THREE.Vector2();

/** Exponentially approach angle `b` from `a` along the shortest way round. */
function dampAngle(a: number, b: number, rate: number, dt: number): number {
  return a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * (1 - Math.exp(-rate * dt));
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class Game {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private ice = new IceResurfacer();
  private vehicle: Vehicle;
  private zamboni = createZamboni();
  private input = new Input();
  private hud: Hud;
  private obstacles: Obstacles;
  private audio = new AudioEngine();
  private gate!: Gate; // rebuilt per level (its boards move with rink width)
  private goals = new Goals();
  private skaters = new Skaters();
  private spray = new IceSpray();
  private powerups: PowerUps;
  private interp = new TransformInterpolator();

  // Fixed-step loop
  private accumulator = 0;
  private scraping = false; // blade laying ice on the latest step
  private lastThrottle = 0;
  private readonly pose: Pose = { x: 0, z: 0, heading: 0 }; // interpolated render pose

  // Combo / flow state
  private combo = 0; // fresh cells laid in the current streak
  private multiplier = 1;
  private comboTimer = 0;
  private flowBonus = 0;
  private prevPainted = 0;
  private prevOverlaps = 0;
  private shake = 0; // camera trauma 0..1
  private boostMeter = 1; // 0..1 turbo reserve
  private boosting = false;
  private flowSurge = 0; // seconds of 2x flow left (from a power-up)
  private skatersAnnounced = false;
  private heckleTimer = 4;

  private state: GameState = 'splash';
  private level: LevelDef = EUROPE_LEVELS[0];
  private standard: RinkStandard = 'europa';
  private rink: Rink | null = null;
  private arenaGroup: THREE.Group | null = null;

  // Parking-lot bonus minigame (an alternate gameplay mode)
  private mode: 'rink' | 'parking' = 'rink';
  private parking: Parking | null = null;
  private activeBoundary!: Boundary; // the vehicle's current collision boundary
  private gateBoundary!: Boundary; // the rink gate boundary (reused per rink level)

  // Camera rig
  private cameraMode: CameraMode = 'chase';
  private camPos = new THREE.Vector3(); // chase position (damped)
  private camLook = new THREE.Vector3(); // chase look target (damped)
  private camYaw = 0; // chase yaw – lags the heading so turns swing the view
  private fpvYaw = 0;
  private camFov = 60;
  private camSnap = true; // next camera update jumps straight to its target
  private camBlend = 1; // 0..1 progress of a camera transition
  private camBlendDur = 0.45;
  private blendFromPos = new THREE.Vector3();
  private blendFromQuat = new THREE.Quaternion();
  private blendFromFov = 60;
  private blendToQuat = new THREE.Quaternion();
  private shakeTime = 0;
  private boostVisual = 0; // smoothed 0..1 for FOV/pull-back
  private tmpV = new THREE.Vector3();
  private tmpLook = new THREE.Vector3();

  private pmrem: THREE.PMREMGenerator | null = null;
  private envRT: THREE.WebGLRenderTarget | null = null;
  /** Extra seconds granted by CLOCK power-ups. Kept separate so `elapsed`
   *  stays monotonic – the ice painter uses it as its timestamp clock. */
  private timeBonus = 0;
  private crowdClock = 0; // drives the crowd wave animation
  private finishClock = 0; // drives the results-screen drone orbit
  private elapsed = 0;
  private collisions = 0;
  private skaterHits = 0;
  private minimapTimer = 0;
  private menuSpin = 0;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      300,
    );

    this.gate = new Gate();
    this.scene.add(this.gate.group);
    this.scene.add(this.zamboni.group);

    // The vehicle's boundary delegates to whichever level is active (rink gate
    // or parking-lot perimeter); the perimeter is swapped per level.
    this.gateBoundary = {
      sdf: (x, z) => this.gate.boundarySignedDistance(x, z),
      normal: (x, z) => this.gate.boundaryNormal(x, z),
    };
    this.activeBoundary = this.gateBoundary;
    this.vehicle = new Vehicle(
      {
        onCollision: (impact) => {
          if (this.state !== 'playing') return;
          if (this.mode === 'parking') {
            // The lot perimeter is soft snowbanks – just a little jolt
            this.shake = Math.min(1, 0.25 + impact * 0.12);
            return;
          }
          this.collisions++;
          this.audio.crash(impact);
          this.breakCombo();
          this.shake = Math.min(1, 0.4 + impact * 0.18);
          this.hud.showToast(impact > 2.5 ? 'CRASH! −300 pts' : 'Bump! −300 pts');
        },
      },
      {
        sdf: (x, z) => this.activeBoundary.sdf(x, z),
        normal: (x, z) => this.activeBoundary.normal(x, z),
      },
    );

    this.obstacles = new Obstacles({
      onConeHit: () => {}, // cones retired; kept for the interface
      onPuckHit: () => this.audio.puck(),
    });
    this.scene.add(this.obstacles.group);
    this.scene.add(this.goals.group);
    this.scene.add(this.skaters.group);
    this.scene.add(this.spray.points);
    this.powerups = new PowerUps((type) => this.collectPowerUp(type));
    this.scene.add(this.powerups.group);

    this.hud = new Hud({
      onRestart: () => this.startLevel(this.level.id),
      onMenu: () => this.showMenu(),
      onNext: () => {
        const next = nextLevel(this.level, loadStars());
        if (next) this.startLevel(next.id);
      },
      onSelectLevel: (id) => this.startLevel(id),
      onStandard: (std) => {
        this.standard = std;
        this.hud.renderMenu(levelsForRegion(std), loadStars(), std);
      },
      onPlay: () => this.showMenu(),
      onResume: () => this.resume(),
    });

    setupTouchControls(this.input);

    this.input.onTap['KeyC'] = () => {
      if (this.state === 'menu' || this.state === 'splash') return;
      this.beginCameraBlend(0.45);
      const i = CAMERA_MODES.indexOf(this.cameraMode);
      this.cameraMode = CAMERA_MODES[(i + 1) % CAMERA_MODES.length];
      this.camSnap = true; // the new rig starts at its target; the blend hides the jump
    };
    this.input.onTap['KeyR'] = () => {
      // Restart only mid-run/at the results – not from the splash or the menu
      if (this.state === 'playing' || this.state === 'paused' || this.state === 'finished') {
        this.startLevel(this.level.id);
      }
    };
    this.input.onTap['KeyM'] = () => {
      this.hud.showToast(this.audio.toggleMuted() ? 'Sound off' : 'Sound on');
    };
    this.input.onTap['KeyP'] = () => this.togglePause();
    this.input.onTap['Escape'] = () => {
      if (this.state === 'playing' || this.state === 'paused') this.togglePause();
      else if (this.state === 'finished') this.showMenu();
    };
    // Gamepad menu navigation (D-pad moves focus, A presses, B backs out)
    this.input.onTap['PadUp'] = () => {
      if (this.state !== 'playing') this.hud.moveFocus(-1);
    };
    this.input.onTap['PadDown'] = () => {
      if (this.state !== 'playing') this.hud.moveFocus(1);
    };
    this.input.onTap['PadConfirm'] = () => {
      if (this.state !== 'playing' && this.state !== 'splash') this.hud.confirmFocus();
    };
    this.input.onTap['PadBack'] = () => {
      if (this.state === 'paused') this.resume();
      else if (this.state === 'finished') this.showMenu();
    };
    this.input.onAnyPadButton = () => {
      if (this.state === 'splash') this.showMenu();
    };
    // Any key dismisses the title splash into the level-select menu
    window.addEventListener('keydown', () => {
      if (this.state === 'splash') this.showMenu();
    });
    // Losing focus (alt-tab, switching apps on a phone) pauses the run
    window.addEventListener('blur', () => this.pause());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
    });
    for (const code of this.input.bladeCodes(0)) {
      this.input.onTap[code] = () => {
        if (this.state !== 'playing') return;
        if (this.mode === 'parking') {
          this.parking?.action(this.vehicle); // SPACE dumps snow
          return;
        }
        this.vehicle.bladeDown = !this.vehicle.bladeDown;
        this.hud.setBlade(this.vehicle.bladeDown);
        this.hud.showToast(this.vehicle.bladeDown ? 'Blade down' : 'Blade up');
      };
    }

    // Dev/verification entry: ?autostart=1&level=<id>&standard=<std> skips menu
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart')) {
      const std = params.get('standard');
      if (std === 'europa' || std === 'nordamerika') this.standard = std;
      this.startLevel(params.get('level') ?? EUROPE_LEVELS[0].id);
    } else {
      this.showSplash();
    }

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  setEnvironment(envMap: THREE.Texture): void {
    this.scene.environment = envMap;
  }

  /**
   * Bake the freshly built hall into the environment map so clean ice mirrors
   * the actual arena – light rig, crowd, scoreboard – instead of a generic
   * room. One 256px cubemap render per level start; the moving pieces are
   * hidden so they don't freeze into the reflection.
   */
  private captureEnvironment(): void {
    if (!this.pmrem) this.pmrem = new THREE.PMREMGenerator(this.renderer);
    const movers: Array<[THREE.Object3D, boolean]> = [];
    for (const o of [
      this.zamboni.group,
      this.spray.points,
      this.skaters.group,
      this.obstacles.group,
      this.powerups.group,
    ] as THREE.Object3D[]) {
      movers.push([o, o.visible]);
      o.visible = false;
    }
    const fog = this.scene.fog;
    this.scene.fog = null; // bake crisp reflections; fog stays a live effect
    const old = this.envRT;
    this.envRT = this.pmrem.fromScene(this.scene, 0, 0.1, 250, {
      position: new THREE.Vector3(0, 2.5, 0),
    });
    this.scene.environment = this.envRT.texture;
    old?.dispose();
    this.scene.fog = fog;
    for (const [o, v] of movers) o.visible = v;
  }

  showSplash(): void {
    this.state = 'splash';
    this.leavePause();
    this.hud.hideFinish();
    this.hud.hideMenu();
    this.hud.showSplash();
  }

  showMenu(): void {
    this.state = 'menu';
    this.leavePause();
    this.audio.setCrowd(0); // no arena murmur under the menu
    this.hud.hideSplash();
    this.hud.hideFinish();
    this.hud.renderMenu(levelsForRegion(this.standard), loadStars(), this.standard);
    void this.hud.renderLeaderboard();
    this.hud.showMenu();
  }

  // --- Pause ---------------------------------------------------------------

  private togglePause(): void {
    if (this.state === 'playing') this.pause();
    else if (this.state === 'paused') this.resume();
  }

  private pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.hud.showPause();
    this.audio.setPaused(true);
  }

  private resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.leavePause();
  }

  /** Tear down the pause overlay/ducking (also when leaving via a button). */
  private leavePause(): void {
    this.hud.hidePause();
    this.audio.setPaused(false);
    this.accumulator = 0; // don't fast-forward through the time spent paused
  }

  /** Toggle the rink-specific scene groups (hidden during the parking bonus). */
  private setRinkGroupsVisible(v: boolean): void {
    for (const g of [
      this.gate.group,
      this.obstacles.group,
      this.goals.group,
      this.skaters.group,
      this.spray.points,
      this.powerups.group,
    ] as THREE.Object3D[]) {
      g.visible = v;
    }
    if (this.rink) this.rink.group.visible = v;
    if (this.arenaGroup) this.arenaGroup.visible = v;
  }

  /** (Re)build the world for a level and start driving. */
  startLevel(levelId: string): void {
    this.level = levelById(levelId);
    if (this.level.parking) {
      this.startParking();
      return;
    }
    this.mode = 'rink';
    this.activeBoundary = this.gateBoundary;
    this.hud.setRinkLabels();
    if (this.parking) this.parking.group.visible = false;
    this.setRinkGroupsVisible(true);
    // Region (and thus rink width) follows the level being played
    this.standard = this.level.region;
    setRinkStandard(this.standard);

    // Swap out the per-level world: rink (width may change), arena, gate.
    // Dispose what's removed – rebuilding on every restart would otherwise pin
    // GPU memory (shadow maps, canvas textures, geometry) for the session.
    if (this.rink) {
      this.scene.remove(this.rink.group);
      disposeObject(this.rink.group, [this.ice.texture, this.ice.tintTexture]);
    }
    if (this.arenaGroup) {
      this.scene.remove(this.arenaGroup);
      disposeObject(this.arenaGroup);
    }
    this.scene.remove(this.gate.group);
    disposeObject(this.gate.group);
    this.gate = new Gate();
    this.scene.add(this.gate.group);
    this.rink = createRink(this.level.tier >= 3); // ice ads on top-tier arenas
    this.rink.iceMaterial.roughnessMap = this.ice.texture;
    this.rink.tintMaterial.map = this.ice.tintTexture;
    this.rink.tintMaterial.visible = true;
    this.rink.tintMaterial.needsUpdate = true;
    this.scene.add(this.rink.group);
    this.arenaGroup = createArena(this.scene, this.level);
    this.goals.reset();
    this.skaters.reset();
    this.spray.reset();

    this.ice.reset();
    this.vehicle.reset(this.gate.spawn.x, this.gate.spawn.z, this.gate.spawn.heading);
    this.obstacles.reset(
      this.gate.spawn.x,
      this.gate.spawn.z,
      this.level.cones,
      this.level.pucks,
    );
    this.elapsed = 0;
    this.timeBonus = 0;
    this.collisions = 0;
    this.skaterHits = 0;
    this.combo = 0;
    this.multiplier = 1;
    this.comboTimer = 0;
    this.flowBonus = 0;
    this.prevPainted = 0;
    this.prevOverlaps = 0;
    this.shake = 0;
    this.boostMeter = 1;
    this.boosting = false;
    this.flowSurge = 0;
    this.scraping = false;
    this.skatersAnnounced = false;
    this.heckleTimer = 4;
    this.powerups.reset();
    this.interp.watch(this.obstacles.group, this.skaters.group, this.powerups.group);
    this.hud.setCombo(1, 0);
    this.captureEnvironment();
    this.state = 'playing';
    this.leavePause();
    this.hud.hideFinish();
    this.hud.hideMenu();
    this.hud.hideSplash();
    this.hud.setLevel(this.level);
    this.hud.setBlade(false);
    this.hud.showToast(`${this.level.name} – gate opening!`);
    this.beginLevelCamera();
  }

  /** Start the parking-lot bonus minigame. */
  private startParking(): void {
    this.mode = 'parking';
    this.setRinkGroupsVisible(false);
    if (!this.parking) {
      this.parking = new Parking(
        (msg) => this.hud.showToast(msg),
        (impact) => {
          this.audio.crash(impact);
          this.shake = Math.min(1, 0.45 + impact * 0.15);
        },
      );
      this.scene.add(this.parking.group);
    } else {
      this.parking.reset();
    }
    this.parking.group.visible = true;
    this.scene.background = this.parking.background;
    this.scene.fog = this.parking.fog;
    this.activeBoundary = this.parking.bounds;
    this.vehicle.reset(this.parking.startPose.x, this.parking.startPose.z, this.parking.startPose.heading);
    this.vehicle.bladeDown = false;
    this.interp.watch(this.parking.movingGroup);
    this.captureEnvironment();
    this.elapsed = 0;
    this.shake = 0;
    this.boostMeter = 1;
    this.boosting = false;
    this.scraping = false;
    this.audio.setCrowd(0); // an empty lot at night – no rink crowd murmur
    this.state = 'playing';
    this.leavePause();
    this.hud.hideFinish();
    this.hud.hideMenu();
    this.hud.hideSplash();
    this.hud.setLevel(this.level);
    this.hud.setCombo(1, 0); // clear any combo badge left over from a rink run
    this.hud.setActionHint('DUMP SNOW – press SPACE');
    this.hud.showToast('Dump snow on free stalls — press SPACE!');
    this.beginLevelCamera();
  }

  /** Swoop from wherever the camera was (menu orbit, results drone) down to
   *  the start of the run. */
  private beginLevelCamera(): void {
    this.accumulator = 0;
    this.syncZamboni(this.vehicle.lerpPose(1, this.pose));
    this.camSnap = true;
    if (this.camera.position.lengthSq() > 1e-6) this.beginCameraBlend(1.3);
    else this.camBlend = 1; // very first frame – nothing to swoop from
  }

  // --- Main loop -------------------------------------------------------------

  /** Per rendered frame: run however many fixed steps are due, then draw. */
  update(frameDt: number): void {
    this.input.poll();
    const dt = Math.min(frameDt, 0.25);
    if (this.state !== 'paused') {
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= SIM_STEP && steps < MAX_STEPS_PER_FRAME) {
        this.step(SIM_STEP);
        this.accumulator -= SIM_STEP;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
    }
    const alpha = this.state === 'paused' ? 1 : this.accumulator / SIM_STEP;
    this.present(dt, alpha);
    this.renderer.render(this.scene, this.camera);
  }

  /** One simulation step plus a presentation pass, without rendering. Used by
   *  the headless verification scripts to drive the game deterministically. */
  tick(dt: number): void {
    this.step(dt);
    this.present(dt, 1);
  }

  /** A single fixed simulation step, with interpolation bookkeeping. */
  private step(dt: number): void {
    this.interp.restore();
    if (this.mode === 'parking') this.simulateParking(dt);
    else this.simulateRink(dt);
    this.interp.afterStep();
  }

  private simulateRink(dt: number): void {
    this.scraping = false;
    this.gate.update(dt);

    if (this.state !== 'playing') {
      // Nothing drives the machine: stop interpolating toward a stale step
      this.vehicle.snapInterpolation();
      this.lastThrottle = 0;
      if (this.state === 'finished') {
        // Life goes on after the buzzer – players keep skating and loose
        // pucks glide to rest under the results screen (nothing scores now)
        this.obstacles.update(dt, this.vehicle.position, ZERO, this.vehicle.heading);
        this.skaters.update(dt, this.vehicle.position, this.obstacles, ZERO, this.vehicle.heading);
      }
      return;
    }

    this.elapsed += dt;
    if (this.elapsed > 0.3) this.gate.open();

    const throttle = this.input.throttle(0);
    this.lastThrottle = throttle;
    // Turbo: drains the meter for extra speed/accel; refills when off
    const boosting = this.input.boosting(0) && this.boostMeter > 0.04 && throttle > 0;
    this.boostMeter = boosting
      ? Math.max(0, this.boostMeter - BOOST_DRAIN * dt)
      : Math.min(1, this.boostMeter + BOOST_REFILL * dt);
    this.vehicle.update(dt, throttle, this.input.steer(0), boosting ? 1 : 0);
    this.boosting = boosting;

    this.powerups.update(dt, this.vehicle.position);
    this.flowSurge = Math.max(0, this.flowSurge - dt);

    const goalImpact = this.goals.resolveCollision(this.vehicle);
    if (goalImpact > 0) this.vehicle.registerHit(goalImpact);
    if (this.goals.update(dt, this.ice) > 0) {
      this.hud.popup('NET CLEARED!');
      this.audio.cheer(0.8);
    }
    this.obstacles.update(dt, this.vehicle.position, this.vehicle.velocity, this.vehicle.heading);

    // Players trickle on from a third of the way in, more the longer you take
    const frac = this.elapsed / this.level.timeLimit;
    const wantSkaters = frac < 0.3 ? 0 : Math.min(6, 1 + Math.floor(((frac - 0.3) / 0.7) * 5));
    if (this.skaters.ensureActive(wantSkaters, this.vehicle.position) > 0 && !this.skatersAnnounced) {
      this.skatersAnnounced = true;
      this.hud.showToast('Players are taking the ice — dodge them!');
    }
    const skaterImpact = this.skaters.update(
      dt,
      this.vehicle.position,
      this.obstacles,
      this.vehicle.velocity,
      this.vehicle.heading,
    );
    if (skaterImpact > 0) {
      this.skaterHits++;
      this.audio.crash(1.4);
      this.breakCombo();
      this.shake = Math.max(this.shake, 0.55);
      this.hud.showToast('Knocked a player! −150 pts');
    }

    // The conditioner only lays clean ice while down and rolling forwards
    if (this.vehicle.bladeDown && this.vehicle.forwardSpeed > 0.3) {
      this.scraping = true;
      const fwd = this.vehicle.forward;
      const bladeX = this.vehicle.position.x - fwd.x * SWATH_REAR_OFFSET;
      const bladeZ = this.vehicle.position.y - fwd.y * SWATH_REAR_OFFSET;
      this.ice.paint(bladeX, bladeZ, this.vehicle.heading, this.elapsed);
      this.spray.emit(bladeX, bladeZ, this.vehicle.heading, SPRAY_RATE * (this.boosting ? 2 : 1), dt);
    } else {
      this.ice.liftBlade();
    }

    this.updateCombo(dt, this.scraping);
    this.updateHeckle(dt);

    if (this.ice.coverage >= COVERAGE_GOAL) this.finish(true);
    else if (this.elapsed >= this.level.timeLimit + this.timeBonus) this.finish(false);
  }

  private simulateParking(dt: number): void {
    const p = this.parking!;
    this.scraping = false;
    if (this.state !== 'playing') {
      this.vehicle.snapInterpolation();
      this.lastThrottle = 0;
      return;
    }
    this.elapsed += dt;
    const throttle = this.input.throttle(0);
    this.lastThrottle = throttle;
    const boosting = this.input.boosting(0) && this.boostMeter > 0.04 && throttle > 0;
    this.boostMeter = boosting
      ? Math.max(0, this.boostMeter - BOOST_DRAIN * dt)
      : Math.min(1, this.boostMeter + BOOST_REFILL * dt);
    this.vehicle.update(dt, throttle, this.input.steer(0), boosting ? 1 : 0);
    this.boosting = boosting;
    p.update(dt, this.vehicle, this.elapsed);
    if (p.finished) this.finishParking();
  }

  /** Per-frame visuals: interpolated poses, camera, HUD, audio. */
  private present(dt: number, alpha: number): void {
    const vdt = this.state === 'paused' ? 0 : dt; // world animation freezes while paused
    this.interp.present(alpha);
    this.shake = Math.max(0, this.shake - vdt * 2.2);
    this.boostVisual = damp(this.boostVisual, this.boosting && this.state === 'playing' ? 1 : 0, 4, dt);

    const pose = this.vehicle.lerpPose(alpha, this.pose);
    if (this.mode === 'rink') {
      this.spray.update(vdt);
      this.ice.present(dt);
      this.updateCrowdWave(vdt);
    }
    animateBlade(this.zamboni.blade, this.mode === 'rink' && this.vehicle.bladeDown, vdt);
    this.syncZamboni(pose);
    this.updateCamera(dt, pose);

    const live = this.state === 'playing';
    this.audio.update(
      live ? this.vehicle.forwardSpeed : 0,
      live ? this.lastThrottle : 0,
      live && this.scraping,
      vdt,
    );

    if (this.state === 'menu' || this.state === 'splash') return;
    if (this.mode === 'parking') this.presentParkingHud(dt);
    else this.presentRinkHud(dt);
  }

  private presentRinkHud(dt: number): void {
    this.hud.update(
      Math.min(1, this.ice.coverage / COVERAGE_GOAL),
      this.ice.precision,
      Math.max(0, this.level.timeLimit + this.timeBonus - this.elapsed),
      this.collisions,
      this.skaterHits,
      this.currentScore(),
      this.vehicle.forwardSpeed,
    );
    this.hud.setBoost(this.boostMeter, this.boosting);
    if (this.state === 'playing') {
      this.hud.setCombo(this.multiplier, this.comboTimer / COMBO_GRACE);
      // The crowd swells with how much ice is done and how hot the streak is
      this.audio.setCrowd(this.ice.coverage * 0.7 + ((this.multiplier - 1) / COMBO_MAX) * 0.3);
    }
    this.minimapTimer -= dt;
    if (this.minimapTimer <= 0) {
      this.minimapTimer = 0.2;
      this.hud.drawMinimap(this.ice);
      this.hud.drawMinimapMarker(
        (this.pose.x + RINK_LENGTH / 2) / RINK_LENGTH,
        (this.pose.z + RINK_WIDTH / 2) / RINK_WIDTH,
        this.pose.heading,
      );
    }
  }

  private presentParkingHud(dt: number): void {
    const p = this.parking!;
    const timeLeft = Math.max(0, PARK_TIME_LIMIT - this.elapsed);
    this.hud.updateParking(
      p.snowedCount,
      p.total,
      timeLeft,
      p.occupiedCount,
      p.crashCount,
      p.score(this.elapsed),
      this.vehicle.forwardSpeed,
    );
    this.hud.setBoost(this.boostMeter, this.boosting);
    this.minimapTimer -= dt;
    if (this.minimapTimer <= 0) {
      this.minimapTimer = 0.2;
      this.hud.drawCustomMinimap((ctx) => p.drawMinimap(ctx, this.vehicle));
    }
  }

  private finishParking(): void {
    this.state = 'finished';
    this.beginFinishCamera();
    const p = this.parking!;
    const res = p.result(this.elapsed);
    const success = res.stars > 0;
    if (success) {
      this.audio.finish();
      this.audio.cheer(1.2);
      saveStars('parking', res.stars);
    }
    const prevBest = loadLevelBests()['parking'] ?? 0;
    const isRecord = success && saveLevelBest('parking', res.total);
    if (isRecord && getName()) void submitScore(getName(), careerScore());
    this.hud.showFinish({
      success,
      title: res.title,
      coverage: p.total ? p.snowedCount / p.total : 0,
      coverageScore: res.stallScore,
      precisionScore: 0,
      timeScore: res.timeBonus,
      flowBonus: 0,
      collisionPenalty: res.collisionPenalty,
      conePenalty: 0,
      total: res.total,
      stars: res.stars,
      best: Math.max(prevBest, Math.round(res.total)),
      isRecord,
      hasNext: false,
    });
  }

  private collectPowerUp(type: PowerType): void {
    this.audio.cheer(0.6);
    if (type === 'time') {
      this.timeBonus += POWERUP_TIME_BONUS;
      this.hud.popup(`+${POWERUP_TIME_BONUS}s`);
    } else if (type === 'boost') {
      this.boostMeter = 1;
      this.hud.popup('TURBO FULL!');
    } else {
      this.flowSurge = POWERUP_FLOW_SECONDS;
      this.hud.popup('2X FLOW!');
    }
  }

  /**
   * A gentle idle sway in the stands, breaking into a travelling stadium wave
   * through the crowd blocks when the flow combo runs hot (x3+) and at the
   * results screen after a cleared level.
   */
  private updateCrowdWave(dt: number): void {
    this.crowdClock += dt;
    const mats = this.arenaGroup?.userData.crowdMats as THREE.MeshStandardMaterial[] | undefined;
    if (!mats || mats.length === 0) return;
    const excited =
      (this.state === 'playing' && this.multiplier >= 3) ||
      (this.state === 'finished' && this.mode === 'rink');
    const amp = excited ? 0.014 : 0.004;
    const speed = excited ? 5.2 : 1.6;
    for (let i = 0; i < mats.length; i++) {
      const map = mats[i].map;
      if (!map) continue;
      // Bob each block up/down with a phase offset – reads as a wave rolling
      // around the bowl
      map.offset.y = Math.max(0, Math.sin(this.crowdClock * speed - i * 0.9)) * amp;
    }
  }

  /** Crowd heckles when you leave an unresurfaced patch boxed in behind you. */
  private updateHeckle(dt: number): void {
    this.heckleTimer -= dt;
    if (this.heckleTimer > 0) return;
    this.heckleTimer = 3;
    if (this.ice.coverage < 0.12 || this.ice.coverage > 0.97) return;
    const spot = this.ice.findMissedSpot();
    if (!spot) return;
    const d = Math.hypot(spot.x - this.vehicle.position.x, spot.z - this.vehicle.position.y);
    if (d < 7) return; // only nag about spots you've actually driven past
    const lines = ['You missed a spot!', 'Ooooh, missed one!', 'Call that resurfaced?', 'A spot! Right there!'];
    const line = lines[(Math.random() * lines.length) | 0];
    this.hud.showToast(line);
    this.audio.jeer();
    this.audio.speak(line);
    this.heckleTimer = 9; // cool off after an actual heckle
  }

  private breakCombo(): void {
    this.combo = 0;
    this.multiplier = 1;
    this.comboTimer = 0;
    this.hud.setCombo(1, 0);
  }

  /** Build/decay the flow combo from fresh vs overlapped ice this step. */
  private updateCombo(dt: number, scraping: boolean): void {
    const dPaint = this.ice.painted - this.prevPainted;
    const dOver = this.ice.overlaps - this.prevOverlaps;
    this.prevPainted = this.ice.painted;
    this.prevOverlaps = this.ice.overlaps;

    if (scraping && dOver > 0) {
      this.breakCombo();
    } else if (scraping && dPaint > 0) {
      this.combo += dPaint;
      this.comboTimer = COMBO_GRACE;
      // A flow-surge power-up doubles the effective multiplier while it lasts
      const eff = this.flowSurge > 0 ? Math.min(COMBO_MAX, this.multiplier * 2) : this.multiplier;
      this.flowBonus += dPaint * eff * SCORE_FLOW_PER_CELL;
      const m = Math.min(COMBO_MAX, 1 + Math.floor(this.combo / COMBO_STEP));
      if (m > this.multiplier) {
        this.multiplier = m;
        this.hud.popup(m >= COMBO_MAX ? 'MAX FLOW! x5' : `COMBO x${m}`);
        this.audio.cheer(0.4 + m * 0.1);
      }
    }
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    // Any accumulated streak dies with the grace timer – also sub-x2 progress,
    // which otherwise silently survives long pauses
    if (this.comboTimer === 0 && this.combo > 0) this.breakCombo();
  }

  private currentScore(): number {
    // CLOCK pickups pay their bonus back through the effective elapsed time
    const eff = Math.max(0, this.elapsed - this.timeBonus);
    const time =
      Math.max(0, SCORE_TIME_MAX - eff * SCORE_TIME_PER_SECOND) * this.ice.coverage;
    return (
      this.ice.coverage * SCORE_COVERAGE_MAX +
      this.ice.precision * SCORE_PRECISION_MAX * this.ice.coverage +
      time +
      this.flowBonus -
      this.collisions * SCORE_COLLISION_PENALTY -
      this.skaterHits * SCORE_CONE_PENALTY
    );
  }

  private finish(success: boolean): void {
    this.state = 'finished';
    this.beginFinishCamera();
    if (success) {
      this.audio.finish();
      this.audio.cheer(1.4);
    }
    const coverageScore = this.ice.coverage * SCORE_COVERAGE_MAX;
    const precisionScore = this.ice.precision * SCORE_PRECISION_MAX;
    const timeScore = success
      ? Math.max(0, SCORE_TIME_MAX - Math.max(0, this.elapsed - this.timeBonus) * SCORE_TIME_PER_SECOND)
      : 0;
    const flowBonus = Math.round(this.flowBonus);
    const collisionPenalty = this.collisions * SCORE_COLLISION_PENALTY;
    const conePenalty = this.skaterHits * SCORE_CONE_PENALTY;
    const total =
      coverageScore + precisionScore + timeScore + flowBonus - collisionPenalty - conePenalty;
    const stars = !success ? 0 : total >= 14000 ? 3 : total >= 11000 ? 2 : 1;
    if (success) saveStars(this.level.id, stars);

    // Per-level personal best feeds the global career-score leaderboard
    const prevBest = loadLevelBests()[this.level.id] ?? 0;
    const isRecord = success && saveLevelBest(this.level.id, total);
    if (isRecord && getName()) void submitScore(getName(), careerScore());
    const best = Math.max(prevBest, success ? Math.round(total) : 0);

    this.hud.showFinish({
      success,
      coverage: this.ice.coverage,
      coverageScore,
      precisionScore,
      timeScore,
      flowBonus,
      collisionPenalty,
      conePenalty,
      total,
      stars,
      best: Math.max(best, success ? total : 0),
      isRecord,
      hasNext: success && nextLevel(this.level, loadStars()) !== null,
    });
  }

  /** Place the zamboni at the interpolated pose and rock its body. */
  private syncZamboni(pose: Pose): void {
    this.zamboni.group.position.set(pose.x, 0, pose.z);
    this.zamboni.group.rotation.set(0, pose.heading, 0);
    tiltBody(this.zamboni, this.vehicle.pitch, this.vehicle.roll);
  }

  // --- Camera ----------------------------------------------------------------

  /** Start a smooth transition from the camera's current view. */
  private beginCameraBlend(seconds: number): void {
    this.blendFromPos.copy(this.camera.position);
    this.blendFromQuat.copy(this.camera.quaternion);
    this.blendFromFov = this.camera.fov;
    this.camBlend = 0;
    this.camBlendDur = seconds;
  }

  /** Ease from the gameplay view into the results drone orbit. */
  private beginFinishCamera(): void {
    this.finishClock = 0;
    this.beginCameraBlend(2.2);
  }

  private updateCamera(dt: number, pose: Pose): void {
    const cam = this.camera;
    const speed = Math.abs(this.vehicle.forwardSpeed);
    let fovTarget = 60;

    if (this.state === 'menu' || this.state === 'splash') {
      // Slow orbit around the rink behind the menu/splash
      this.menuSpin += dt * 0.08;
      cam.up.set(0, 1, 0);
      cam.position.set(Math.sin(this.menuSpin) * 34, 16, Math.cos(this.menuSpin) * 34);
      cam.lookAt(0, 0, 0);
    } else if (this.state === 'finished') {
      // Results screen: a slow drone sweep over the finished ice (or the
      // lot), gently descending as it circles
      this.finishClock += dt;
      this.zamboni.driver.visible = true;
      const t = this.finishClock;
      const a = t * 0.22 + Math.PI * 0.25;
      const r = 30 - Math.min(6, t * 0.9);
      const h = 16 - Math.min(6, t * 0.8);
      cam.up.set(0, 1, 0);
      cam.position.set(Math.sin(a) * r, h, Math.cos(a) * r * 0.72);
      cam.lookAt(0, 0.5, 0);
      fovTarget = 55;
    } else {
      // Playing or paused: the driving rigs. The seated driver would fill the
      // lower frame in first-person, so hide him when looking through his eyes.
      this.zamboni.driver.visible = this.cameraMode !== 'fpv';
      if (this.cameraMode === 'top') this.topCamera();
      else if (this.cameraMode === 'fpv') fovTarget = this.fpvCamera(dt, pose, speed);
      else fovTarget = this.chaseCamera(dt, pose, speed);
    }

    this.camFov = this.camSnap ? fovTarget : damp(this.camFov, fovTarget, 3, dt);
    let fov = this.camFov;

    // Transitions (mode switch, level start swoop, results) blend from the
    // previous view instead of cutting
    if (this.camBlend < 1) {
      this.camBlend = Math.min(1, this.camBlend + dt / this.camBlendDur);
      const e = easeInOutCubic(this.camBlend);
      this.blendToQuat.copy(cam.quaternion);
      cam.position.lerpVectors(this.blendFromPos, cam.position, e);
      cam.quaternion.slerpQuaternions(this.blendFromQuat, this.blendToQuat, e);
      fov = THREE.MathUtils.lerp(this.blendFromFov, fov, e);
    }
    // From straight above, clip everything over ~6.5 m – roof trusses, the
    // media cube, light rigs – so the overview shows the ice, not the rafters.
    // Only once the camera has arrived, or the swoop up would cut to black.
    const overhead = this.cameraMode === 'top' && this.camBlend >= 1 &&
      (this.state === 'playing' || this.state === 'paused');
    const near = overhead ? Math.max(0.1, cam.position.y - 6.5) : 0.1;
    if (Math.abs(cam.fov - fov) > 0.01 || cam.near !== near) {
      cam.fov = fov;
      cam.near = near;
      cam.updateProjectionMatrix();
    }
    this.applyShake(dt);
    this.camSnap = false;
  }

  private topCamera(): void {
    const cam = this.camera;
    if (this.mode === 'parking' && this.parking) {
      const tv = this.parking.topView();
      cam.up.copy(tv.up);
      cam.position.copy(tv.position);
      cam.lookAt(tv.lookAt);
    } else {
      cam.up.set(0, 0, -1);
      cam.position.set(0, 46, 0);
      cam.lookAt(0, 0, 0);
    }
  }

  /** Over-the-shoulder chase rig. Returns the FOV it wants. */
  private chaseCamera(dt: number, pose: Pose, speed: number): number {
    const cam = this.camera;
    const fwdX = Math.sin(pose.heading);
    const fwdZ = Math.cos(pose.heading);
    // The camera's yaw trails the machine's heading, so a hard turn swings
    // the view out and shows off the slide instead of staying bolted on
    this.camYaw = this.camSnap ? pose.heading : dampAngle(this.camYaw, pose.heading, 3.4, dt);
    const dist = 8.2 + speed * 0.22 + this.boostVisual * 1.4;
    const height = 4.6 + speed * 0.06;
    const desired = this.tmpV.set(
      pose.x - Math.sin(this.camYaw) * dist,
      height,
      pose.z - Math.cos(this.camYaw) * dist,
    );
    const lookAhead = 4 + speed * 0.4;
    const look = this.tmpLook.set(pose.x + fwdX * lookAhead, 1.0, pose.z + fwdZ * lookAhead);

    // In the open equipment bay at the start, rise up behind the machine and
    // look down over its roof at the gate, instead of tucking in so close
    // that the roof fills the screen
    if (this.mode === 'rink' && pose.z < this.gate.gateZ + 2) {
      // Stay inside the bay (behind it the camera would sit among the stand
      // blocks beside the tunnel) and rise above the roof line
      desired.z = Math.max(desired.z, this.gate.cameraMinZ - 1);
      desired.y = Math.max(desired.y, 6.4);
      look.set(pose.x + fwdX * 10, 0.3, pose.z + fwdZ * 10);
    }

    if (this.camSnap) {
      this.camPos.copy(desired);
      this.camLook.copy(look);
    } else {
      this.camPos.lerp(desired, 1 - Math.exp(-6 * dt));
      this.camLook.lerp(look, 1 - Math.exp(-8 * dt));
    }
    cam.up.set(0, 1, 0);
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
    return 58 + speed * 0.55 + this.boostVisual * 7;
  }

  /** First-person seat rig: rides the body's pitch/roll. Returns its FOV. */
  private fpvCamera(dt: number, pose: Pose, speed: number): number {
    const cam = this.camera;
    const fwdX = Math.sin(pose.heading);
    const fwdZ = Math.cos(pose.heading);
    // A light smoothing on where the driver looks keeps steering twitches
    // from whipping the whole view
    this.fpvYaw = this.camSnap ? pose.heading : dampAngle(this.fpvYaw, pose.heading, 14, dt);
    const lift = this.zamboni.body.position.y;
    cam.up.set(0, 1, 0);
    // Driver's eye from the raised rear seat, high enough to see over the
    // snow tank of the full-size model and down onto the ice ahead
    cam.position.set(pose.x - fwdX * 1.6, 3.25 + lift, pose.z - fwdZ * 1.6);
    cam.lookAt(
      cam.position.x + Math.sin(this.fpvYaw) * 14,
      0.6,
      cam.position.z + Math.cos(this.fpvYaw) * 14,
    );
    // Sit in the machine: the view dips and leans with the body
    cam.rotateX(-this.vehicle.pitch);
    cam.rotateZ(-this.vehicle.roll);
    return 66 + speed * 0.5 + this.boostVisual * 6;
  }

  /** Crash shake: smooth layered noise scaled by trauma², not per-frame
   *  random jitter, plus a little roll. */
  private applyShake(dt: number): void {
    if (this.shake <= 0.001) return;
    this.shakeTime += dt;
    const t = this.shakeTime;
    const s = this.shake * this.shake;
    const n = (f: number, p: number): number =>
      Math.sin(t * f + p) * 0.6 + Math.sin(t * f * 2.13 + p * 1.7) * 0.4;
    const cam = this.camera;
    cam.position.x += n(29, 0) * s * 0.45;
    cam.position.y += n(23, 1.3) * s * 0.3;
    cam.position.z += n(31, 2.6) * s * 0.45;
    cam.rotateZ(n(19, 0.7) * s * 0.05);
  }
}
