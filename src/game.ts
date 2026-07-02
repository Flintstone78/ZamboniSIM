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
import { createZamboni, animateBlade } from './zamboni';
import { disposeObject } from './assets';
import { setupTouchControls } from './touch';
import { Vehicle, Input, type Boundary } from './vehicle';
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

type GameState = 'splash' | 'menu' | 'playing' | 'finished';


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

  // Combo / flow state
  private combo = 0; // fresh cells laid in the current streak
  private multiplier = 1;
  private comboTimer = 0;
  private flowBonus = 0;
  private prevPainted = 0;
  private prevOverlaps = 0;
  private shake = 0;
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

  private cameraMode: CameraMode = 'chase';
  private camPos = new THREE.Vector3();
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
            this.shake = Math.min(1, 0.2 + impact * 0.12);
            return;
          }
          this.collisions++;
          this.audio.crash(impact);
          this.breakCombo();
          this.shake = Math.min(1, 0.3 + impact * 0.18);
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
    });

    setupTouchControls(this.input);

    this.input.onTap['KeyC'] = () => {
      const i = CAMERA_MODES.indexOf(this.cameraMode);
      this.cameraMode = CAMERA_MODES[(i + 1) % CAMERA_MODES.length];
    };
    this.input.onTap['KeyR'] = () => {
      // Restart only mid-run/at the results – not from the splash or the menu
      if (this.state === 'playing' || this.state === 'finished') this.startLevel(this.level.id);
    };
    this.input.onTap['KeyM'] = () => {
      this.hud.showToast(this.audio.toggleMuted() ? 'Sound off' : 'Sound on');
    };
    this.input.onTap['Escape'] = () => {
      if (this.state === 'playing' || this.state === 'finished') this.showMenu();
    };
    // Any key dismisses the title splash into the level-select menu
    window.addEventListener('keydown', () => {
      if (this.state === 'splash') this.showMenu();
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
    this.hud.hideFinish();
    this.hud.hideMenu();
    this.hud.showSplash();
  }

  showMenu(): void {
    this.state = 'menu';
    this.audio.setCrowd(0); // no arena murmur under the menu
    this.hud.hideSplash();
    this.hud.hideFinish();
    this.hud.renderMenu(levelsForRegion(this.standard), loadStars(), this.standard);
    void this.hud.renderLeaderboard();
    this.hud.showMenu();
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
    this.flowSurge = 0;
    this.skatersAnnounced = false;
    this.heckleTimer = 4;
    this.powerups.reset();
    this.hud.setCombo(1, 0);
    this.captureEnvironment();
    this.state = 'playing';
    this.hud.hideFinish();
    this.hud.hideMenu();
    this.hud.hideSplash();
    this.hud.setLevel(this.level);
    this.hud.setBlade(false);
    this.hud.showToast(`${this.level.name} – gate opening!`);
    this.syncZamboni();
    this.camPos.set(0, 0, 0); // forces a snap on the next camera update
    this.updateCamera(1);
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
          this.shake = Math.min(1, 0.4 + impact * 0.15);
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
    this.captureEnvironment();
    this.elapsed = 0;
    this.shake = 0;
    this.boostMeter = 1;
    this.boosting = false;
    this.audio.setCrowd(0); // an empty lot at night – no rink crowd murmur
    this.state = 'playing';
    this.hud.hideFinish();
    this.hud.hideMenu();
    this.hud.hideSplash();
    this.hud.setLevel(this.level);
    this.hud.setCombo(1, 0); // clear any combo badge left over from a rink run
    this.hud.setActionHint('DUMP SNOW – press SPACE');
    this.hud.showToast('Dump snow on free stalls — press SPACE!');
    this.syncZamboni();
    this.camPos.set(0, 0, 0);
    this.updateCamera(1);
  }

  private tickParking(dt: number): void {
    const p = this.parking!;
    let throttle = 0;
    if (this.state === 'playing') {
      this.elapsed += dt;
      throttle = this.input.throttle(0);
      const boosting = this.input.boosting(0) && this.boostMeter > 0.04 && throttle > 0;
      this.boostMeter = boosting
        ? Math.max(0, this.boostMeter - BOOST_DRAIN * dt)
        : Math.min(1, this.boostMeter + BOOST_REFILL * dt);
      this.vehicle.update(dt, throttle, this.input.steer(0), boosting ? 1 : 0);
      this.boosting = boosting;
      p.update(dt, this.vehicle, this.elapsed);
      if (p.finished) this.finishParking();
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
    animateBlade(this.zamboni.blade, false, dt);
    this.syncZamboni();
    this.updateCamera(dt);
    this.audio.update(this.state === 'playing' ? this.vehicle.forwardSpeed : 0, throttle, false, dt);

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
    this.finishClock = 0;
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

  update(dt: number): void {
    this.tick(dt);
    this.renderer.render(this.scene, this.camera);
  }

  /** One simulation step without rendering (also used by headless tests). */
  tick(dt: number): void {
    if (this.mode === 'parking') {
      this.tickParking(dt);
      return;
    }
    let scraping = false;
    this.gate.update(dt);

    if (this.state === 'playing') {
      this.elapsed += dt;
      if (this.elapsed > 0.3) this.gate.open();

      const throttle = this.input.throttle(0);
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
      this.obstacles.update(dt, this.vehicle.position, this.vehicle.velocity);

      // Players trickle on from a third of the way in, more the longer you take
      const frac = this.elapsed / this.level.timeLimit;
      const wantSkaters = frac < 0.3 ? 0 : Math.min(6, 1 + Math.floor(((frac - 0.3) / 0.7) * 5));
      if (this.skaters.ensureActive(wantSkaters) > 0 && !this.skatersAnnounced) {
        this.skatersAnnounced = true;
        this.hud.showToast('Players are taking the ice — dodge them!');
      }
      const skaterImpact = this.skaters.update(dt, this.vehicle.position, this.obstacles);
      if (skaterImpact > 0) {
        this.skaterHits++;
        this.audio.crash(1.4);
        this.breakCombo();
        this.shake = Math.max(this.shake, 0.5);
        this.hud.showToast('Knocked a player! −150 pts');
      }

      // The conditioner only lays clean ice while down and rolling forwards
      if (this.vehicle.bladeDown && this.vehicle.forwardSpeed > 0.3) {
        scraping = true;
        const fwd = this.vehicle.forward;
        const bladeX = this.vehicle.position.x - fwd.x * SWATH_REAR_OFFSET;
        const bladeZ = this.vehicle.position.y - fwd.y * SWATH_REAR_OFFSET;
        this.ice.paint(bladeX, bladeZ, this.vehicle.heading, this.elapsed);
        this.spray.emit(bladeX, bladeZ, this.vehicle.heading, this.boosting ? 6 : 3);
      } else {
        this.ice.liftBlade();
      }

      this.updateCombo(dt, scraping);
      this.updateHeckle(dt);

      if (this.ice.coverage >= COVERAGE_GOAL) this.finish(true);
      else if (this.elapsed >= this.level.timeLimit + this.timeBonus) this.finish(false);
    }

    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.spray.update(dt);
    this.updateCrowdWave(dt);

    animateBlade(this.zamboni.blade, this.vehicle.bladeDown, dt);
    this.syncZamboni();
    this.updateCamera(dt);
    this.audio.update(
      this.state === 'playing' ? this.vehicle.forwardSpeed : 0,
      this.state === 'playing' ? this.input.throttle(0) : 0,
      scraping,
      dt,
    );

    if (this.state === 'menu' || this.state === 'splash') return;

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

  /** Build/decay the flow combo from fresh vs overlapped ice this frame. */
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
    this.hud.setCombo(this.multiplier, this.comboTimer / COMBO_GRACE);

    // The crowd swells with how much ice is done and how hot the streak is
    this.audio.setCrowd(this.ice.coverage * 0.7 + ((this.multiplier - 1) / COMBO_MAX) * 0.3);
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
    this.finishClock = 0;
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

  private syncZamboni(): void {
    this.zamboni.group.position.set(this.vehicle.position.x, 0, this.vehicle.position.y);
    this.zamboni.group.rotation.y = this.vehicle.heading;
  }

  private updateCamera(dt: number): void {
    if (this.state === 'menu' || this.state === 'splash') {
      // Slow orbit around the rink behind the menu/splash
      this.menuSpin += dt * 0.08;
      this.camera.up.set(0, 1, 0);
      this.camera.position.set(
        Math.sin(this.menuSpin) * 34,
        16,
        Math.cos(this.menuSpin) * 34,
      );
      this.camera.lookAt(0, 0, 0);
      return;
    }

    // Results screen: a slow drone sweep over the finished ice (or the lot),
    // easing out of the gameplay camera and gently descending as it circles.
    if (this.state === 'finished') {
      this.finishClock += dt;
      this.zamboni.driver.visible = true;
      const t = this.finishClock;
      const a = t * 0.22 + Math.PI * 0.25;
      const r = 30 - Math.min(6, t * 0.9);
      const h = 16 - Math.min(6, t * 0.8);
      const target = new THREE.Vector3(Math.sin(a) * r, h, Math.cos(a) * r * 0.72);
      this.camera.up.set(0, 1, 0);
      if (this.camPos.lengthSq() === 0) this.camPos.copy(target);
      this.camPos.lerp(target, Math.min(1, dt * (t < 2 ? 1.2 : 4)));
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(0, 0.5, 0);
      return;
    }

    const fwd = this.vehicle.forward;
    const pos = this.vehicle.position;

    // The seated driver would fill the lower frame in first-person, so hide
    // it whenever we're looking out through his eyes.
    this.zamboni.driver.visible = this.cameraMode !== 'fpv';

    if (this.cameraMode === 'top') {
      // Overview from above (the parking lot has its own framing)
      if (this.mode === 'parking' && this.parking) {
        const tv = this.parking.topView();
        this.camera.up.copy(tv.up);
        this.camera.position.copy(tv.position);
        this.camera.lookAt(tv.lookAt);
      } else {
        this.camera.up.set(0, 0, -1);
        this.camera.position.set(0, 46, 0);
        this.camera.lookAt(0, 0, 0);
      }
      this.camPos.copy(this.camera.position);
      return;
    }
    this.camera.up.set(0, 1, 0);

    if (this.cameraMode === 'fpv') {
      // Driver's eye from the rear platform, just above the snow tank
      this.camera.position.set(
        pos.x - fwd.x * 1.9,
        2.6,
        pos.y - fwd.y * 1.9,
      );
      this.applyShake();
      this.camera.lookAt(pos.x + fwd.x * 12, 1.2, pos.y + fwd.y * 12);
      this.camPos.copy(this.camera.position);
      return;
    }

    const target = new THREE.Vector3(
      pos.x - fwd.x * 8.5,
      4.6,
      pos.y - fwd.y * 8.5,
    );
    // While still in the equipment room the chase camera would peer over the
    // low garage walls into the void – keep it inside the corridor and low,
    // looking through the open gate, for a clean reveal as the zamboni exits.
    if (this.mode === 'rink' && pos.y < this.gate.gateZ + 2) {
      target.z = Math.max(target.z, this.gate.cameraMinZ);
      target.y = 2.7;
    }
    if (this.camPos.lengthSq() === 0) this.camPos.copy(target);
    this.camPos.lerp(target, Math.min(1, dt * 3.5));
    this.camera.position.copy(this.camPos);
    this.applyShake();
    this.camera.lookAt(pos.x + fwd.x * 4, 1.2, pos.y + fwd.y * 4);
  }

  /** Jolt the camera briefly after a crash. */
  private applyShake(): void {
    if (this.shake <= 0) return;
    const s = this.shake * 0.5;
    this.camera.position.x += (Math.random() - 0.5) * s;
    this.camera.position.y += (Math.random() - 0.5) * s;
    this.camera.position.z += (Math.random() - 0.5) * s;
  }
}
