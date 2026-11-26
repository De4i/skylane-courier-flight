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
 * Stage a shot on the live app. `app` exposes startMission(index, start),
 * stepFixed(ctl), currentTarget(), flight and renderFrame(). Returns the
 * mission name shown on the HUD.
 */
export function stageShot(name, app) {
  const shot = name || 'cover';
  if (shot === 'takeoff') {
    // Mission 2, on the home runway: full throttle, rotate and climb.
    app.startMission(1, 'runway');
    const steps = Math.round(6 / STEP);
    for (let i = 0; i < steps; i += 1) {
      app.stepFixed({ throttleAxis: 1, bankAxis: 0, pitchAxis: i > 150 ? 0.55 : 0, boost: false });
    }
    return 'Runway Landing';
  }
  if (shot === 'landing') {
    // Mission 2, already airborne on final approach to the far runway.
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
    // Mission 1, chasing the second ring: the ring fills the frame ahead.
    app.startMission(0, 'runway');
    const steps = Math.round(11 / STEP);
    for (let i = 0; i < steps; i += 1) {
      app.stepFixed(autopilotInput(app.flight, app.currentTarget()));
    }
    return 'Ring Trial';
  }
  // Cover: mission 1, flown to the fourth ring so a glowing ring, the
  // islands and sea, and the far runway island all sit in frame.
  app.startMission(0, 'runway');
  const steps = Math.round(17 / STEP);
  for (let i = 0; i < steps; i += 1) {
    app.stepFixed(autopilotInput(app.flight, app.currentTarget()));
  }
  return 'Ring Trial';
}
