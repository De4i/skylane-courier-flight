// The flight model: a light arcade sim with real trade-offs. Throttle sets a
// target speed; the wing only flies above the stall speed, so a slow plane
// sinks and turns sluggishly; banking turns the plane; climbing bleeds speed
// and diving gains it; boost is fast but drinks fuel. Terrain and water are
// checked every step through the world's ground-height function.

import { PLANE } from './config.js';

export const KNOT_TO_MS = 0.514444;

/** Normalise an angle to (-PI, PI]. */
export function angleDelta(target, current) {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function approach(value, target, rate, dt) {
  const diff = target - value;
  const step = rate * dt;
  if (Math.abs(diff) <= step) return target;
  return value + Math.sign(diff) * step;
}

/**
 * Fresh flight state, sitting on the home runway.
 * start: { x, y, z, heading } in metres / radians.
 */
export function createFlight(start) {
  return {
    x: start.x,
    y: start.y,
    z: start.z,
    heading: start.heading,   // 0 = east (+X); forward = (cos h, 0, sin h)
    pitch: 0,                 // nose up positive, radians
    bank: 0,                  // right wing down positive, radians
    speedKt: 0,
    throttle: 0,
    fuel: 100,
    hull: 100,
    verticalSpeed: 0,         // m/s, positive climbing
    boosting: false,
    airborne: false,
    landed: false,
    crashed: false,
    onRunway: true,
    groundSpeedKt: 0,
  };
}

/**
 * One fixed step. `ctl` is { throttleAxis, bankAxis, pitchAxis, boost }.
 * `world` is { groundHeight(x, z), isRunway(x, z) } from terrain.js.
 * Returns an event string: '' | 'takeoff' | 'landed' | 'crash' | 'ditched'.
 */
export function stepFlight(f, ctl, dt, world) {
  if (f.crashed) return '';

  // --- throttle ---
  f.throttle = clamp(f.throttle + ctl.throttleAxis * PLANE.throttleRate * dt, 0, 1);
  f.boosting = Boolean(ctl.boost) && f.throttle > 0.5 && f.fuel > 0;
  if (f.fuel <= 0) {
    f.throttle = Math.max(0, f.throttle - dt * 0.5);
    f.boosting = false;
  }

  // --- speed chases the throttle target; climb bleeds, dive gains ---
  const targetKt = PLANE.minSpeedKt +
    f.throttle * (PLANE.maxSpeedKt - PLANE.minSpeedKt) +
    (f.boosting ? PLANE.boostSpeedKt : 0);
  f.speedKt += (targetKt - f.speedKt) * Math.min(1, PLANE.accel * dt);
  if (f.pitch > 0.08) f.speedKt -= f.pitch * PLANE.climbBleed * dt;
  else if (f.pitch < -0.08) f.speedKt -= f.pitch * PLANE.diveGain * dt; // pitch negative: gains
  f.speedKt = Math.max(0, f.speedKt);

  // --- attitude: bank and pitch chase their targets, weaker near the stall ---
  const authority = clamp((f.speedKt - 18) / (PLANE.stallKt - 18), 0.25, 1);
  const bankTarget = clamp(ctl.bankAxis, -1, 1) * PLANE.maxBank * authority;
  const pitchTarget = clamp(ctl.pitchAxis, -1, 1) * PLANE.maxPitch * authority;
  f.bank = approach(f.bank, bankTarget, PLANE.bankRate, dt);
  f.pitch = approach(f.pitch, pitchTarget, PLANE.pitchRate, dt);

  // --- turn: bank rolls the lift vector, so the nose follows the bank ---
  const speedFactor = clamp(f.speedKt / PLANE.cruiseKt, 0.3, 1.4);
  f.heading -= f.bank * PLANE.turnRate * speedFactor * dt;

  // --- motion ---
  const v = f.speedKt * KNOT_TO_MS;
  const cosP = Math.cos(f.pitch);
  const dx = Math.cos(f.heading) * cosP * v * dt;
  const dz = Math.sin(f.heading) * cosP * v * dt;
  let dy = Math.sin(f.pitch) * v * dt;
  // Stall sink: below stall speed the wing gives up and she drops.
  if (f.speedKt < PLANE.stallKt && f.y > 2) {
    dy -= (PLANE.stallKt - f.speedKt) * 0.22 * dt;
  }
  // Rolling on the ground: no climb until rotation speed.
  const ground = world.groundHeight(f.x, f.z);
  const wasAirborne = f.airborne;
  if (!f.airborne && f.speedKt < 62) dy = 0;
  f.x += dx;
  f.z += dz;
  f.y += dy;
  f.verticalSpeed = dt > 0 ? dy / dt : 0;
  f.groundSpeedKt = f.speedKt;

  // --- fuel ---
  const drain = PLANE.fuelDrainBase + f.throttle * PLANE.fuelDrainThrottle +
    (f.boosting ? PLANE.fuelDrainBoost : 0);
  f.fuel = Math.max(0, f.fuel - drain * dt);

  // --- ground / water contact ---
  const groundNow = world.groundHeight(f.x, f.z);
  const overRunway = world.isRunway(f.x, f.z);
  f.onRunway = overRunway;
  if (f.y <= groundNow + 1.6) {
    f.y = groundNow + 1.6;
    const hardImpact = f.verticalSpeed < -7 || f.speedKt > PLANE.hullCrashSpeed;
    const inWater = groundNow <= 0.6;
    if (inWater) {
      if (f.speedKt < 45 && f.verticalSpeed > -4 && f.airborne) {
        f.crashed = true;
        f.hull = 0;
        return 'ditched';
      }
      f.crashed = true;
      f.hull = 0;
      return 'crash';
    }
    if (hardImpact) {
      f.crashed = true;
      f.hull = 0;
      return 'crash';
    }
    if (overRunway && f.speedKt < 78 && Math.abs(f.verticalSpeed) < 6) {
      // A proper touchdown: roll out on the runway.
      f.airborne = false;
      f.landed = true;
      f.pitch = approach(f.pitch, 0, 2, dt);
      f.bank = approach(f.bank, 0, 2, dt);
      f.speedKt = Math.max(0, f.speedKt - 26 * dt);
      return wasAirborne ? 'landed' : '';
    }
    // Rough-field touchdown: survives, but the airframe pays for it — once
    // per touchdown, not once per frame while rolling on the grass.
    if (wasAirborne) {
      const damage = Math.round(14 + Math.abs(f.verticalSpeed) * 2 + Math.max(0, f.speedKt - 70) * 0.3);
      f.hull = Math.max(0, f.hull - damage);
      f.airborne = false;
      f.speedKt = Math.max(0, f.speedKt - 60 * dt);
      if (f.hull <= 0) {
        f.crashed = true;
        return 'crash';
      }
      return 'landed';
    }
    f.airborne = false;
    f.speedKt = Math.max(0, f.speedKt - 26 * dt);
    return '';
  }

  if (!wasAirborne && f.speedKt > 60 && f.y > groundNow + 4) {
    f.airborne = true;
    return 'takeoff';
  }
  if (f.airborne && f.y <= groundNow + 4) f.airborne = true;
  return '';
}

/** Compass heading in degrees: 0 = north (-Z), 90 = east (+X). */
export function headingDegrees(heading) {
  const deg = 90 - (heading * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/** Altitude in feet above sea level. */
export function altitudeFeet(y) {
  return Math.max(0, Math.round(y * 3.28084));
}
