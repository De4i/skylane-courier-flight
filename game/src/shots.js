// The screenshot scenes behind ?shot=cover|takeoff|rings|landing&seed=7.
// Each one plays the real game forward from a fresh mission for a fixed
// number of fixed steps, steered by a simple autopilot (bank toward the next
// target, pitch toward its altitude, throttle held high), so the frame is
// what a short flight really looks like and the same seed always gives the
// same frame. The scene paints twice and sets window.__shotReady.

import { STEP } from './config.js';
import { angleDelta } from './flight-model.js';

/** Autopilot input for one step: steer at `target` {x, y, z}. */
function autopilotInput(flight, target) {
  const desiredHeading = Math.atan2(target.z - flight.z, target.x - flight.x);
  const err = angleDelta(desiredHeading, flight.heading);
  // Heading decreases when the bank is positive (right wing down), so the
  // bank sign is the opposite of the heading error.
  const bank = Math.max(-1, Math.min(1, -err * 1.6));
  const altErr = target.y - flight.y;
  const pitch = Math.max(-1, Math.min(1, altErr * 0.008));
  return { throttleAxis: 1, bankAxis: bank, pitchAxis: pitch, boost: false };
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/**
 * Fly the autopilot until `targetRings` rings are passed, then keep
 * flying `extraSeconds` more. The extra flight is short on purpose:
 * the "RING! +500" toast lives for four seconds, so stopping ~1.2 s
 * after the last ring keeps the payoff visible in the still while the
 * next ring is already ahead. Capped at `maxSeconds` so a missed ring
 * can never hang the stager. Deterministic: same seed, same frame.
 * `clampCtl` optionally clamps the autopilot's bank/pitch (the cover
 * flies almost level so the plane never rolls hard sideways).
 */
function flyUntilRings(app, targetRings, extraSeconds, maxSeconds, clampCtl) {
  const maxSteps = Math.round(maxSeconds / STEP);
  let steps = 0;
  while (app.ringsPassed < targetRings && steps < maxSteps) {
    let ctl = autopilotInput(app.flight, app.currentTarget());
    if (clampCtl) ctl = clampCtl(ctl);
    app.stepFixed(ctl);
    steps += 1;
  }
  const extra = Math.round(extraSeconds / STEP);
  for (let i = 0; i < extra; i += 1) {
    let ctl = autopilotInput(app.flight, app.currentTarget());
    if (clampCtl) ctl = clampCtl(ctl);
    app.stepFixed(ctl);
  }
}

/**
 * Stage a shot on the live app. `app` exposes startMission(index, start),
 * stepFixed(ctl), currentTarget(), flight and renderFrame(). Returns the
 * mission name shown on the HUD.
 */
export function stageShot(name, app) {
  const shot = name || 'cover';
  if (shot === 'diag-top') {
    // High oblique over the home runway island: does the strip sit on
    // land, and what do the shoreline, sand band and foam ring really
    // look like from above? Diagnostic only, not a submitted screenshot.
    app.startMission(0, 'runway');
    app.setDiagPose({ x: 520, y: 640, z: 520 }, { x: -40, y: 12, z: -20 });
    return 'Ring Trial';
  }
  if (shot === 'diag-low') {
    // Low pass at the shoreline of the (1500, 700) island, the one whose
    // foam ring reads as a pale-blue lagoon in the rings shot.
    app.startMission(0, 'runway');
    app.setFlight({
      x: 980, y: 62, z: 700, heading: 0, pitch: 0, bank: 0,
      speedKt: 90, throttle: 0.6, airborne: true,
    });
    app.setDiagPose({ x: 960, y: 58, z: 700 }, { x: 1500, y: 30, z: 700 });
    return 'Ring Trial';
  }
  if (shot === 'takeoff') {
    // Mission 2, on the home runway: full throttle, rotate and climb.
    // 10 s, not 8: at 8 s she is still rotating hard and the chase
    // camera sits below her, so the wings read as thin lines; at 10 s
    // the climb has levelled, she is high over the home island with the
    // sea and the sun ahead, and every gauge is live (throttle 100%,
    // timer and fuel already moving). Mission 2 has no rings, so the
    // score is honestly 0 here — the flight itself is the story.
    app.startMission(1, 'runway');
    const steps = Math.round(10 / STEP);
    for (let i = 0; i < steps; i += 1) {
      app.stepFixed({ throttleAxis: 1, bankAxis: 0, pitchAxis: i > 150 ? 0.55 : 0, boost: false });
    }
    return 'Runway Landing';
  }
  if (shot === 'landing') {
    // Mission 2, already airborne on final approach to the far runway.
    // 9 s, the round-1 duration: at 9 s she is on final at 70 kt with
    // the strip ahead and a slight correcting angle that shows her
    // flank; 12 s was tried and bled her to 39 kt with a red STALL
    // banner in the frame, and a centreline start gave a dead-axis
    // slab. Score is honestly 0 (mission 2 has no rings) — the
    // approach is the story.
    app.startMission(1, 'final');
    const steps = Math.round(9 / STEP);
    for (let i = 0; i < steps; i += 1) {
      const target = app.landingTarget();
      const ctl = autopilotInput(app.flight, target);
      // Hold approach speed until short final, then ease the throttle off.
      const dist = Math.hypot(target.x - app.flight.x, target.z - app.flight.z);
      if (dist < 260) ctl.throttleAxis = app.flight.speedKt > 70 ? -1 : 0;
      else ctl.throttleAxis = app.flight.speedKt > 95 ? 0 : 1;
      ctl.pitchAxis = clamp(ctl.pitchAxis, -0.45, 0.3);
      app.stepFixed(ctl);
    }
    return 'Runway Landing';
  }
  if (shot === 'rings') {
    // Mission 1, flown until 3 rings are genuinely passed, then 1.2 s
    // more: the HUD reads Rings 3/8, SCORE 1500, the "RING! +500"
    // toast from the third ring is still up, and the fourth ring
    // (swung north toward the far runway island) is ahead in frame.
    // The old 11 s fixed run never passed a ring at all — every shot
    // showed Rings 0/8, SCORE 0, a game at zero. Bank is clamped to
    // 0.55 so the turn toward the fourth ring does not roll her hard
    // sideways in the still.
    app.startMission(0, 'runway');
    flyUntilRings(app, 3, 1.2, 40, (ctl) => ({
      ...ctl,
      bankAxis: Math.max(-0.55, Math.min(0.55, ctl.bankAxis)),
    }));
    return 'Ring Trial';
  }
  // Cover: mission 1, flown gently until 2 rings are genuinely passed,
  // then 1.2 s more. The bank is clamped so she flies almost level
  // (the old 16 s full-bank run had her rolled hard sideways with the
  // ring glow white-outing the centre). The HUD reads Rings 2/8,
  // SCORE 1000, the "RING! +500" toast is still up, the third ring is
  // ahead, and the sun sits in the upper frame ahead of her.
  app.startMission(0, 'runway');
  flyUntilRings(app, 2, 1.2, 40, (ctl) => ({
    ...ctl,
    bankAxis: Math.max(-0.35, Math.min(0.35, ctl.bankAxis)),
    pitchAxis: Math.max(-0.3, Math.min(0.3, ctl.pitchAxis)),
  }));
  return 'Ring Trial';
}
