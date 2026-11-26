// Skylane Courier — every tuning number and colour in one place.
// World units are metres; speeds are shown in knots (1 kt = 0.514 m/s).
// The play area is a 3.6 km archipelago of sea and low-poly islands.

export const STEP = 1 / 60;

export const WORLD = {
  extent: 1800,          // islands live inside +/- extent on x and z
  seaLevel: 0,
  fogNear: 700,
  fogFar: 3200,
  skyTop: '#7fb8e8',
  fogColour: '#a9cbe4',
};

export const PLANE = {
  maxSpeedKt: 195,       // full throttle, level flight
  cruiseKt: 120,
  stallKt: 55,           // below this the wing stops flying and she sinks
  minSpeedKt: 28,
  accel: 0.45,           // how fast speed chases the throttle target (per second)
  climbBleed: 14,        // knots lost per second while climbing hard
  diveGain: 18,          // knots gained per second while diving
  maxPitch: 0.5,         // radians, nose up or down
  maxBank: 0.95,         // radians of roll
  turnRate: 0.55,        // heading change per second at full bank and cruise speed
  pitchRate: 1.6,        // radians per second toward the target pitch
  bankRate: 2.4,         // radians per second toward the target bank
  throttleRate: 0.55,    // throttle travel per second
  boostSpeedKt: 42,      // extra top speed while Shift is held
  fuelDrainBase: 0.10,   // fuel % per second, engine idling
  fuelDrainThrottle: 0.5,// extra fuel % per second at full throttle
  fuelDrainBoost: 0.85,  // extra fuel % per second while boosting
  hullCrashSpeed: 110,   // knots: faster than this into terrain is always a crash
};

export const RUNWAY = {
  length: 420,
  width: 26,
  headingDeg: 90,        // runway points east (+X), the direction the plane starts in
};

export const RING = {
  radius: 26,
  tube: 2.2,
  passRadius: 24,        // plane centre within this of the ring centre counts
};

export const SCORE = {
  ring: 500,
  fuelRing: 250,
  pad: 800,
  beacon: 400,
  landing: 1000,
  timeBonusPerSecond: 12, // under-par seconds are worth this many points
};

export const PALETTE = {
  sea: 0x1f6f9e,
  seaDeep: 0x155a82,
  sand: 0xd9c28a,
  grass: 0x5da244,
  grassDark: 0x47853a,
  hill: 0x6faf4e,
  rock: 0x8a8f96,
  runway: 0x3a3f46,
  runwayLine: 0xf2f2e8,
  cloud: 0xffffff,
  sun: 0xffe9a8,
  fuselage: 0xff8c42,
  fuselageDark: 0xd96a1e,
  wing: 0xf7f3e8,
  tail: 0xe4572e,
  canopy: 0x274b73,
  prop: 0x2b2b2b,
  ringGold: 0xffb703,
  ringFuel: 0x2fd47a,
  beacon: 0x35d0ff,
  pad: 0xff5964,
  hudText: '#f4f8ff',
  hudDim: '#b9c8dc',
  hudWarn: '#ffb703',
  hudDanger: '#ff5964',
  hudGood: '#2fd47a',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** localStorage key for campaign progress (unlocked missions, best times/scores, medals). */
export const CAMPAIGN_KEY = 'skylane-courier.campaign.v1';
