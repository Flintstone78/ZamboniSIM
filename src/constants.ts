// Rink dimensions in metres. The ice is centred at the world origin with its
// long axis along X and width along Z. Length is 60 m in both standards;
// the width is 30 m (IIHF/Europa) or 26 m (NHL/Nordamerika) and is switched
// at level start – RINK_WIDTH is a live binding, so importers always read
// the current value.
export const RINK_LENGTH = 60;
export let RINK_WIDTH = 30;
export const CORNER_RADIUS = 8.5;

export type RinkStandard = 'europa' | 'nordamerika';
export function setRinkStandard(standard: RinkStandard): void {
  RINK_WIDTH = standard === 'europa' ? 30 : 26;
}

export const BOARD_HEIGHT = 1.07;
export const BOARD_THICKNESS = 0.15;
export const GLASS_HEIGHT = 1.8;

export const GOAL_LINE_X = RINK_LENGTH / 2 - 4;
export const BLUE_LINE_X = 7.14;
export const FACEOFF_CIRCLE_RADIUS = 4.5;
export const FACEOFF_SPOT_X = 20;
// Faceoff spots sit a fixed distance from the boards, so their Z follows the
// rink width: 7 m on a 30 m rink, 5 m on a 26 m NHL rink.
export function faceoffSpotZ(): number {
  return RINK_WIDTH / 2 - 8;
}

// Zamboni
export const ZAM_LENGTH = 4.6;
export const ZAM_WIDTH = 1.9;
export const SWATH_WIDTH = 2.2; // width of the conditioner blade
export const SWATH_REAR_OFFSET = 2.0; // blade sits this far behind the centre
export const ZAM_COLLISION_RADIUS = 1.5;

// Driving model
export const MAX_SPEED_FWD = 6.0; // m/s (a real zamboni tops out ~4.2; nudged for fun)
export const MAX_SPEED_REV = 2.5;
export const ENGINE_ACCEL = 3.0;
export const BRAKE_DECEL = 5.0;
export const ROLL_DRAG = 0.8;
export const WHEELBASE = 2.6;
export const MAX_STEER = 0.62; // rad
export const LATERAL_GRIP = 3.2; // how quickly sideways slide is damped (low = icy)

// Resurfacing coverage grid (0.5 m cells)
export const GRID_COLS = 120;
export const GRID_ROWS = 60;
export const COVERAGE_GOAL = 0.95; // counts as fully resurfaced
export const REVISIT_SECONDS = 2.5; // repaint after this long counts as overlap

// Goal cages (regulation-ish: 1.83 m wide, 1.12 m deep, 1.22 m tall).
// They sit on the goal lines, opening toward centre ice.
export const GOAL_WIDTH = 1.83;
export const GOAL_DEPTH = 1.12;
export const GOAL_HEIGHT = 1.22;

// Zamboni gate + equipment room. The gate is a gap in the boards on the long
// (-Z) side near a corner – this works for both rink widths, unlike the short
// end whose straight section is too narrow on a 26 m NHL rink. The board it
// sits on is at z = -RINK_WIDTH/2, which shifts with the chosen standard, so
// the gate is rebuilt per level. The drivable span is fixed along X.
export const GATE_X_MIN = -19;
export const GATE_X_MAX = -15;
export const GARAGE_DEPTH = 9; // how far the corridor extends outside the rink
export const GARAGE_WALL_HEIGHT = 3.2;

// Obstacle pools (per-level counts in levels.ts activate a subset)
export const PUCK_COUNT = 10;
export const CONE_COUNT = 7;
export const PUCK_RADIUS = 0.12; // oversized vs a real puck for visibility
export const CONE_RADIUS = 0.28;

// Scoring
export const SCORE_COVERAGE_MAX = 10000;
export const SCORE_PRECISION_MAX = 2000;
export const SCORE_TIME_MAX = 4000;
export const SCORE_TIME_PER_SECOND = 12;
export const SCORE_COLLISION_PENALTY = 300;
export const SCORE_CONE_PENALTY = 150;

// Parking-lot bonus level: a drive lane along X with a row of stalls each side.
// Dump snow on free stalls before arriving cars claim them.
export const LOT_WIDTH = 44; // along X (interior, between perimeter snowbanks)
export const LOT_DEPTH = 30; // along Z
export const STALL_WIDTH = 2.7;
export const STALL_DEPTH = 5.4;
export const LANE_HALF = 4.0; // half-width of the central drive lane
export const STALLS_PER_ROW = 7;
export const PARK_TIME_LIMIT = 80; // seconds before the round ends
export const CAR_WARN_TIME = 1.8; // "incoming" blink before a car commits
export const CAR_PARK_TIME = 1.1; // slide-in animation duration
export const CAR_SPAWN_FIRST = 4.0; // first car arrives after this long
export const CAR_SPAWN_INTERVAL = 3.0; // seconds between subsequent arrivals
export const DUMP_RANGE = 3.2; // max distance from chute to a stall to dump
export const CAR_COLLISION_RADIUS = 1.7;
export const SCORE_PER_STALL = 800;
export const SCORE_PARK_TIME_MAX = 4000;
export const SCORE_PARK_TIME_PER_SECOND = 45;

// Combo / flow: laying clean ice without overlap or crashes builds a streak.
// Every COMBO_STEP fresh cells bumps the multiplier (up to COMBO_MAX), and each
// fresh cell banks SCORE_FLOW_PER_CELL × multiplier into the flow bonus.
export const COMBO_STEP = 22;
export const COMBO_MAX = 5;
export const SCORE_FLOW_PER_CELL = 0.22;
export const COMBO_GRACE = 2.0; // seconds the streak survives without painting

// Turbo boost (hold Shift): a drainable meter that briefly lifts the speed cap
// and acceleration at the cost of grip (more slide). Refills when not boosting.
export const BOOST_SPEED_MULT = 1.6;
export const BOOST_ACCEL_MULT = 1.7;
export const BOOST_DRAIN = 0.5; // meter/second while boosting
export const BOOST_REFILL = 0.22; // meter/second while not

// Power-ups: floating pickups that spawn periodically on the ice.
export const POWERUP_MAX = 3; // active at once
export const POWERUP_INTERVAL = 9; // seconds between spawns
export const POWERUP_RADIUS = 0.6;
export const POWERUP_TIME_BONUS = 15; // seconds added by a CLOCK
export const POWERUP_FLOW_SECONDS = 8; // duration of a 2X FLOW surge
