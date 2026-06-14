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
  setRinkStandard,
  RinkStandard,
} from './constants';
import { createRink, Rink } from './rink';
import { IceResurfacer } from './ice';
import { createZamboni, animateBlade } from './zamboni';
import { Vehicle, Input } from './vehicle';
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

  private cameraMode: CameraMode = 'chase';
  private camPos = new THREE.Vector3();
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

    // The boundary delegates to the current gate, which is swapped per level
    this.vehicle = new Vehicle(
      {
        onCollision: (impact) => {
          if (this.state !== 'playing') return;
          this.collisions++;
          this.audio.crash(impact);
          this.breakCombo();
          this.shake = Math.min(1, 0.3 + impact * 0.18);
          this.hud.showToast(impact > 2.5 ? 'CRASH! −300 pts' : 'Bump! −300 pts');
        },
      },
      {
        sdf: (x, z) => this.gate.boundarySignedDistance(x, z),
        normal: (x, z) => this.gate.boundaryNormal(x, z),
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

    this.input.onTap['KeyC'] = () => {
      const i = CAMERA_MODES.indexOf(this.cameraMode);
      this.cameraMode = CAMERA_MODES[(i + 1) % CAMERA_MODES.length];
    };
    this.input.onTap['KeyR'] = () => {
      if (this.state !== 'menu') this.startLevel(this.level.id);
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

  showSplash(): void {
    this.state = 'splash';
    this.hud.hideFinish();
    this.hud.hideMenu();
    this.hud.showSplash();
  }

  showMenu(): void {
    this.state = 'menu';
    this.hud.hideSplash();
    this.hud.hideFinish();
    this.hud.renderMenu(levelsForRegion(this.standard), loadStars(), this.standard);
    void this.hud.renderLeaderboard();
    this.hud.showMenu();
  }

  /** (Re)build the world for a level and start driving. */
  startLevel(levelId: string): void {
    this.level = levelById(levelId);
    // Region (and thus rink width) follows the level being played
    this.standard = this.level.region;
    setRinkStandard(this.standard);

    // Swap out the per-level world: rink (width may change), arena, gate
    if (this.rink) this.scene.remove(this.rink.group);
    if (this.arenaGroup) this.scene.remove(this.arenaGroup);
    this.scene.remove(this.gate.group);
    this.gate = new Gate();
    this.scene.add(this.gate.group);
    this.rink = createRink(this.level.tier >= 3); // ice ads on top-tier arenas
    this.rink.iceMaterial.roughnessMap = this.ice.texture;
    this.ice.attachColorMap(this.rink.colorTexture, this.rink.colorCanvas);
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
    this.state = 'playing';
    this.hud.hideFinish();
    this.hud.hideMenu();
    this.hud.setLevel(this.level);
    this.hud.setBlade(false);
    this.hud.showToast(`${this.level.name} – gate opening!`);
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
      else if (this.elapsed >= this.level.timeLimit) this.finish(false);
    }

    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.spray.update(dt);

    animateBlade(this.zamboni.blade, this.vehicle.bladeDown, dt);
    this.syncZamboni();
    this.updateCamera(dt);
    this.audio.update(
      this.state === 'playing' ? this.vehicle.forwardSpeed : 0,
      this.state === 'playing' ? this.input.throttle(0) : 0,
      scraping,
    );

    if (this.state === 'menu' || this.state === 'splash') return;

    this.hud.update(
      Math.min(1, this.ice.coverage / COVERAGE_GOAL),
      this.ice.precision,
      Math.max(0, this.level.timeLimit - this.elapsed),
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
      this.elapsed = Math.max(0, this.elapsed - POWERUP_TIME_BONUS);
      this.hud.popup(`+${POWERUP_TIME_BONUS}s`);
    } else if (type === 'boost') {
      this.boostMeter = 1;
      this.hud.popup('TURBO FULL!');
    } else {
      this.flowSurge = POWERUP_FLOW_SECONDS;
      this.hud.popup('2X FLOW!');
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
    const lines = ['You missed a spot! 👀', 'Ooooh, missed one!', 'Call that resurfaced?', 'A spot! Right there!'];
    this.hud.showToast(lines[(Math.random() * lines.length) | 0]);
    this.audio.jeer();
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
    if (this.comboTimer === 0 && this.multiplier > 1) this.breakCombo();
    this.hud.setCombo(this.multiplier, this.comboTimer / COMBO_GRACE);

    // The crowd swells with how much ice is done and how hot the streak is
    this.audio.setCrowd(this.ice.coverage * 0.7 + ((this.multiplier - 1) / COMBO_MAX) * 0.3);
  }

  private currentScore(): number {
    const time =
      Math.max(0, SCORE_TIME_MAX - this.elapsed * SCORE_TIME_PER_SECOND) * this.ice.coverage;
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
    if (success) {
      this.audio.finish();
      this.audio.cheer(1.4);
    }
    const coverageScore = this.ice.coverage * SCORE_COVERAGE_MAX;
    const precisionScore = this.ice.precision * SCORE_PRECISION_MAX;
    const timeScore = success
      ? Math.max(0, SCORE_TIME_MAX - this.elapsed * SCORE_TIME_PER_SECOND)
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
    if (pos.y < this.gate.gateZ + 2) {
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
