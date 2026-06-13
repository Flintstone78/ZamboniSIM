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

// Combo / flow: laying clean ice without overlap or crashes builds a streak.
// Every COMBO_STEP fresh cells bumps the multiplier (up to COMBO_MAX), and each
// fresh cell banks SCORE_FLOW_PER_CELL × multiplier into the flow bonus.
export const COMBO_STEP = 22;
export const COMBO_MAX = 5;
export const SCORE_FLOW_PER_CELL = 0.22;
export const COMBO_GRACE = 2.0; // seconds the streak survives without painting
