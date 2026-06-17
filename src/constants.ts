// Rink dimensions follow the IIHF standard (metres). The ice is centred at the
// world origin with its long axis along X and width along Z.
export const RINK_LENGTH = 60;
export const RINK_WIDTH = 30;
export const CORNER_RADIUS = 8.5;

export const BOARD_HEIGHT = 1.07;
export const BOARD_THICKNESS = 0.15;
export const GLASS_HEIGHT = 1.8;

export const GOAL_LINE_X = RINK_LENGTH / 2 - 4;
export const BLUE_LINE_X = 7.14;
export const FACEOFF_CIRCLE_RADIUS = 4.5;
export const FACEOFF_SPOT_X = 20;
export const FACEOFF_SPOT_Z = 7;

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
export const COVERAGE_GOAL = 0.995; // counts as fully resurfaced
export const REVISIT_SECONDS = 2.5; // repaint after this long counts as overlap

// Scoring
export const SCORE_COVERAGE_MAX = 10000;
export const SCORE_PRECISION_MAX = 2000;
export const SCORE_TIME_MAX = 4000;
export const SCORE_TIME_PER_SECOND = 12;
export const SCORE_COLLISION_PENALTY = 300;

// Parking-lot bonus level. The lot is centred at the origin with a single
// drive lane running along X and a row of stalls on each side of it.
export const LOT_WIDTH = 44; // along X (interior, between perimeter snowbanks)
export const LOT_DEPTH = 30; // along Z
export const STALL_WIDTH = 2.7; // along X
export const STALL_DEPTH = 5.4; // along Z
export const LANE_HALF = 4.0; // half-width of the central drive lane
export const STALLS_PER_ROW = 7;

export const PARK_TIME_LIMIT = 80; // seconds before the round ends
export const CAR_WARN_TIME = 1.8; // "incoming" blink before a car commits
export const CAR_PARK_TIME = 1.1; // slide-in animation duration
export const CAR_SPAWN_FIRST = 4.0; // first car arrives after this long
export const CAR_SPAWN_INTERVAL = 3.0; // seconds between subsequent arrivals
export const DUMP_RANGE = 3.2; // max distance from blade to a stall centre to dump
export const CAR_COLLISION_RADIUS = 1.7;

export const SCORE_PER_STALL = 800;
export const SCORE_PARK_TIME_MAX = 4000;
export const SCORE_PARK_TIME_PER_SECOND = 45;
