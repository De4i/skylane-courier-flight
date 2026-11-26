// Bayu — Archipelago Courier — boot and the one loop. Input is read every frame, the
// world advances in fixed 1/60 s steps, and the renderer paints what is
// there. The game moves between four screens: menu (campaign + mission
// select), playing, paused and mission over (success, crash or out of time).
//
// ?seed=N fixes the archipelago. ?shot=cover|takeoff|rings|landing (with
// &seed=N) stages that scene instead of running the loop, paints it twice
// and sets window.__shotReady for a screenshot.

import { STEP } from './config.js';
import { createRandom } from './random.js';
import { createTerrain } from './terrain.js';
import { createAircraft } from './aircraft.js';
import { createFlight, stepFlight } from './flight-model.js';
import { createRenderer } from './render.js';
import { createHud } from './hud.js';
import { createInput, ACTION_CONFIRM, ACTION_PAUSE, ACTION_RESTART, ACTION_DROP, ACTION_CAMERA, ACTION_MUTE } from './input.js';
import { createAudio } from './audio.js';
import { MISSIONS, createMission, missionStart, landingStart, missionRunway, objectiveText, objectivesComplete, medalFor } from './missions.js';
import { loadCampaign, recordFinish, medalEmoji } from './campaign.js';
import { stageShot } from './shots.js';
import { SCORE } from './config.js';

const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 7;

const canvas = document.getElementById('game');
const statusEl = document.getElementById('status');
const menuEl = document.getElementById('menu');
const missionListEl = document.getElementById('mission-list');
const endEl = document.getElementById('end');
const endTitleEl = document.getElementById('end-title');
const endDetailEl = document.getElementById('end-detail');
const pauseEl = document.getElementById('pause-banner');

const terrain = createTerrain(seed);
const aircraft = createAircraft();
const renderer = createRenderer(canvas, terrain);
renderer.scene.add(aircraft.group);
const hud = createHud();
const audio = createAudio();
const campaign = loadCampaign();
const shotRandom = createRandom(seed * 13 + 5);

let screen = 'menu';           // menu | playing | paused | over
let missionIndex = 0;
let mission = null;
let flight = null;
let cameraMode = 'chase';      // chase | close
let time = 0;                  // wall-clock seconds since boot, for animation
let endInfo = null;

function announce(message) {
  if (statusEl) statusEl.textContent = message;
}

function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** The point the autopilot (and the shot stager) steers at. */
function currentTarget() {
  if (!mission) return { x: 0, y: 150, z: 0 };
  if (mission.nextRing < mission.rings.length) {
    const ring = mission.rings[mission.nextRing];
    return { x: ring.x, y: ring.y, z: ring.z };
  }
  const runway = missionRunway(mission.def, terrain);
  // Aim at the near threshold of the strip, just above it, so the final
  // approach comes down onto the runway instead of clipping the grass
  // short of it. Both runways are approached from the west, heading east.
  return { x: runway.x - 110, y: runway.alt + 8, z: runway.z };
}

/** A higher, further aim point for the landing screenshot: the plane stays
 * fast and level on final instead of sinking onto the threshold early. */
function landingTarget() {
  if (!mission) return { x: 0, y: 150, z: 0 };
  const runway = missionRunway(mission.def, terrain);
  return { x: runway.x, y: runway.alt + 25, z: runway.z };
}

function startMission(index, startMode) {
  missionIndex = index;
  const def = MISSIONS[index];
  mission = createMission(def, terrain, seed);
  const start = startMode === 'final' ? landingStart(terrain) : missionStart(terrain);
  flight = createFlight(start);
  flight.fuel = def.fuel;
  if (startMode === 'final') {
    flight.speedKt = 88;
    flight.throttle = 0.5;
    flight.airborne = true;
  }
  renderer.buildMarkers(mission);
  renderer.setStorm(Boolean(def.storm));
  renderer.snap(flight, 'chase');
  cameraMode = 'chase';
  screen = 'playing';
  endInfo = null;
  menuEl.style.display = 'none';
  endEl.style.display = 'none';
  pauseEl.style.display = 'none';
  hud.show();
  audio.unlock();
  announce(`${def.name}. ${def.brief}`);
}

function endMission(statusKind, reason) {
  if (!mission || mission.status !== 'flying') return;
  mission.status = statusKind;
  mission.endReason = reason;
  screen = 'over';
  const def = mission.def;
  if (statusKind === 'done') {
    const timeBonus = Math.max(0, Math.round((def.par - mission.time) * SCORE.timeBonusPerSecond));
    mission.score += SCORE.landing + timeBonus;
    const medal = medalFor(mission.time, def.par);
    recordFinish(campaign, def.id, def.number, mission.time, mission.score, medal);
    audio.fanfare();
    endInfo = { kind: 'done', medal };
    endTitleEl.textContent = `Mission complete! ${medalEmoji(medal)}`;
    endDetailEl.innerHTML =
      `<p><strong>${def.name}</strong> finished in ${formatTime(mission.time)} ` +
      `(par ${formatTime(def.par)}) — medal: <strong>${medal}</strong>.</p>` +
      `<p>Score <strong>${mission.score}</strong> ` +
      `(landing +${SCORE.landing}, time bonus +${timeBonus}).</p>` +
      `<p>Best for this mission: ${formatTime(campaign.best[def.id].time)} · ` +
      `${campaign.best[def.id].score} pts ${medalEmoji(campaign.best[def.id].medal)}</p>`;
    announce(`Mission complete. Score ${mission.score}. Medal ${medal}.`);
  } else {
    audio.fail();
    endInfo = { kind: statusKind };
    const title = statusKind === 'crashed' ? 'Crashed!' : 'Mission failed';
    endTitleEl.textContent = title;
    endDetailEl.innerHTML =
      `<p><strong>${def.name}</strong> — ${reason}</p>` +
      `<p>Score ${mission.score} · time ${formatTime(mission.time)}. ` +
      `The mission is still open: press R or Retry to fly it again.</p>`;
    announce(`${title} ${reason}`);
  }
  buildMenu();
  hud.update(hudView());
}

function hudView() {
  return {
    flight,
    mission,
    timeLeft: mission ? Math.max(0, mission.def.timeLimit - mission.time) : 0,
    score: mission ? mission.score : 0,
    objective: mission ? objectiveText(mission) : '',
    missionName: mission ? `${mission.def.number}. ${mission.def.name}` : 'Bayu — Archipelago Courier',
  };
}

function renderFrame(dt) {
  renderer.draw(flight, aircraft, mission, cameraMode, time, dt);
  if (flight && mission) hud.update(hudView());
}

/** One fixed simulation step with a control input { throttleAxis, bankAxis, pitchAxis, boost }. */
function stepFixed(ctl) {
  if (!flight || !mission || mission.status !== 'flying') return;
  time += STEP;
  mission.time += STEP;

  // Storm turbulence: the wind shoves the plane around a little.
  let effectiveCtl = ctl;
  if (mission.def.storm) {
    effectiveCtl = {
      ...ctl,
      bankAxis: ctl.bankAxis + (shotRandom() - 0.5) * 0.35,
      pitchAxis: ctl.pitchAxis + (shotRandom() - 0.5) * 0.25,
    };
  }

  const event = stepFlight(flight, effectiveCtl, STEP, terrain);

  // --- rings: only the next ring in order counts ---
  if (mission.nextRing < mission.rings.length) {
    const ring = mission.rings[mission.nextRing];
    const d = Math.hypot(flight.x - ring.x, flight.y - ring.y, flight.z - ring.z);
    if (d < 24) {
      ring.passed = true;
      mission.ringsPassed += 1;
      mission.nextRing += 1;
      mission.score += SCORE.ring;
      audio.ring();
      announce(`Ring ${mission.ringsPassed} of ${mission.def.rings}.`);
    }
  }
  // --- fuel rings: green rings top the tank up ---
  for (const ring of mission.fuelRings) {
    if (ring.passed) continue;
    const d = Math.hypot(flight.x - ring.x, flight.y - ring.y, flight.z - ring.z);
    if (d < 24) {
      ring.passed = true;
      flight.fuel = Math.min(100, flight.fuel + 35);
      mission.score += SCORE.fuelRing;
      audio.ring();
      announce('Fuel ring! +35% fuel.');
    }
  }
  // --- beacons ---
  for (const beacon of mission.beacons) {
    if (beacon.collected) continue;
    const d = Math.hypot(flight.x - beacon.x, flight.y - beacon.y, flight.z - beacon.z);
    if (d < 26) {
      beacon.collected = true;
      mission.score += SCORE.beacon;
      audio.pickup();
      announce('Beacon collected.');
    }
  }
  // --- falling crates ---
  for (const crate of mission.crates) {
    if (crate.resting) continue;
    crate.vy -= 22 * STEP;
    crate.y += crate.vy * STEP;
    const ground = terrain.groundHeight(crate.x, crate.z);
    if (crate.y <= ground + 3) {
      crate.y = ground + 3;
      crate.resting = true;
      const pad = mission.pads.find((p) => !p.hit && Math.hypot(crate.x - p.x, crate.z - p.z) < p.r);
      if (pad) {
        pad.hit = true;
        mission.score += SCORE.pad;
        audio.pickup();
        announce('Crate on the pad! +800.');
      } else {
        announce('Crate missed the pad.');
      }
    }
  }

  if (event === 'crash') {
    audio.thud(true);
    endMission('crashed', 'The plane hit the ground too hard.');
    return;
  }
  if (event === 'ditched') {
    audio.thud(true);
    endMission('crashed', 'Ditched in the sea.');
    return;
  }
  if (event === 'landed') {
    audio.thud(false);
    const runway = missionRunway(mission.def, terrain);
    const overTarget = Math.hypot(flight.x - runway.x, flight.z - runway.z) < 320;
    if (objectivesComplete(mission) && overTarget) {
      endMission('done', '');
      return;
    }
    if (overTarget && !objectivesComplete(mission)) {
      announce('Landed, but the job is not finished — throttle up (W) and take off again.');
    }
  }
  if (event === 'takeoff') announce('Airborne.');

  if (mission.time >= mission.def.timeLimit) {
    endMission('failed', 'Out of time.');
    return;
  }
  if (flight.fuel <= 0 && !flight.airborne) {
    endMission('failed', 'Out of fuel on the ground.');
  }
}

function dropCrate() {
  if (!mission || !flight || mission.status !== 'flying') return;
  if (mission.cratesLeft <= 0) return;
  if (!flight.airborne) {
    announce('Take off before dropping cargo.');
    return;
  }
  mission.cratesLeft -= 1;
  const crate = { x: flight.x, y: flight.y - 3, z: flight.z, vy: 0, resting: false };
  mission.crates.push(crate);
  renderer.addCrate(crate);
  audio.click();
  announce(`Crate away! ${mission.cratesLeft} left.`);
}

function buildMenu() {
  missionListEl.innerHTML = '';
  MISSIONS.forEach((def, index) => {
    const locked = index + 1 > campaign.unlocked;
    const best = campaign.best[def.id];
    const button = document.createElement('button');
    button.className = `mission${locked ? ' locked' : ''}`;
    button.disabled = locked;
    button.innerHTML =
      `<span class="mission-num">${def.number}</span>` +
      `<span class="mission-body"><strong>${def.name}</strong>` +
      `<span class="mission-brief">${def.brief}</span>` +
      `<span class="mission-best">${locked ? '🔒 Finish the previous mission to unlock' :
        best ? `Best ${formatTime(best.time)} · ${best.score} pts ${medalEmoji(best.medal)}` :
        `Par ${formatTime(def.par)} · ${formatTime(def.timeLimit)} limit`}</span></span>`;
    button.addEventListener('click', () => {
      audio.unlock();
      audio.click();
      startMission(index, 'runway');
    });
    missionListEl.appendChild(button);
  });
}

function showMenu() {
  screen = 'menu';
  mission = null;
  flight = null;
  renderer.setStorm(false);
  hud.hide();
  menuEl.style.display = 'block';
  endEl.style.display = 'none';
  pauseEl.style.display = 'none';
  buildMenu();
  // A quiet attract scene behind the menu: the plane parked on the runway.
  flight = createFlight(missionStart(terrain));
  mission = createMission(MISSIONS[0], terrain, seed);
  renderer.buildMarkers(mission);
  renderer.snap(flight, 'menu');
  cameraMode = 'menu';
  announce('Bayu — Archipelago Courier. Choose a mission to fly.');
}

function runShot(name) {
  // Stage the scene on the real systems, then paint twice.
  const missionName = stageShot(name, {
    startMission,
    stepFixed,
    currentTarget,
    landingTarget,
    setDiagPose(pos, look) { renderer.setDiagPose(pos, look); },
    setFlight(patch) { Object.assign(flight, patch); },
    get flight() {
      return flight;
    },
  });
  hud.show();
  renderer.snap(flight, 'chase');
  renderFrame(STEP);
  let painted = 0;
  function paint() {
    renderFrame(STEP);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
  void missionName;
}

function runGame() {
  const input = createInput(canvas);
  let accumulator = 0;
  let last = performance.now();

  showMenu();

  // End-screen buttons.
  document.getElementById('btn-retry').addEventListener('click', () => {
    audio.click();
    startMission(missionIndex, 'runway');
  });
  document.getElementById('btn-next').addEventListener('click', () => {
    audio.click();
    const next = Math.min(MISSIONS.length - 1, missionIndex + 1);
    if (next + 1 <= campaign.unlocked) startMission(next, 'runway');
    else showMenu();
  });
  document.getElementById('btn-menu').addEventListener('click', () => {
    audio.click();
    showMenu();
  });
  document.getElementById('btn-resume').addEventListener('click', () => {
    audio.click();
    screen = 'playing';
    pauseEl.style.display = 'none';
  });

  function frame(now) {
    requestAnimationFrame(frame);
    const dtReal = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    time += dtReal;

    const actions = input.takeActions();
    if (actions & ACTION_MUTE) {
      const muted = audio.toggleMute();
      announce(muted ? 'Sound muted.' : 'Sound on.');
    }
    if (screen === 'menu') {
      if (actions & ACTION_CONFIRM) audio.unlock();
      // Attract scene: gentle camera drift over the parked plane.
      if (flight && mission) renderFrame(dtReal);
      return;
    }
    if (screen === 'over') {
      if (actions & ACTION_CONFIRM) showMenu();
      else if (actions & ACTION_RESTART) startMission(missionIndex, 'runway');
      if (flight && mission) renderFrame(dtReal);
      return;
    }
    if (actions & ACTION_PAUSE) {
      if (screen === 'playing') {
        screen = 'paused';
        pauseEl.style.display = 'block';
        announce('Paused.');
      } else if (screen === 'paused') {
        screen = 'playing';
        pauseEl.style.display = 'none';
        announce('Flying.');
      }
    }
    if (screen === 'paused') {
      if (flight && mission) renderFrame(0);
      return;
    }
    if (actions & ACTION_RESTART) startMission(missionIndex, 'runway');
    if (actions & ACTION_DROP) dropCrate();
    if (actions & ACTION_CAMERA) {
      cameraMode = cameraMode === 'chase' ? 'close' : 'chase';
      announce(cameraMode === 'chase' ? 'Chase view.' : 'Close view.');
    }

    accumulator += dtReal;
    while (accumulator >= STEP && screen === 'playing') {
      stepFixed({
        throttleAxis: input.throttleAxis(),
        bankAxis: input.bankAxis(),
        pitchAxis: input.pitchAxis(),
        boost: input.boost(),
      });
      accumulator -= STEP;
    }
    if (screen === 'playing') {
      audio.engine(flight.throttle, flight.boosting, true);
      renderFrame(dtReal);
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === 'playing') {
      screen = 'paused';
      pauseEl.style.display = 'block';
      announce('Paused.');
    }
  });

  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
