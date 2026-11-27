// The HUD: big high-contrast DOM readouts plus two small canvases — a
// compass strip and an artificial horizon — drawn every frame from the live
// flight state. Every number on it moves with the flight: altitude, speed,
// heading, throttle, fuel, hull, timer, score and the mission objective.

import { PALETTE } from './config.js';
import { altitudeFeet as altFeet, headingDegrees as hdgDeg } from './flight-model.js';

function el(id) {
  return document.getElementById(id);
}

export function createHud() {
  const attitude = el('attitude');
  const attitudeCtx = attitude.getContext('2d');
  const compass = el('compass');
  const compassCtx = compass.getContext('2d');
  let toastTimer = null;

  function drawAttitude(pitch, bank) {
    const w = attitude.width;
    const h = attitude.height;
    const ctx = attitudeCtx;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-bank);
    const offset = Math.max(-h, Math.min(h, pitch * h * 0.9));
    // Sky above the horizon line, ground below it.
    ctx.fillStyle = '#3f8fd2';
    ctx.fillRect(-w, -h + offset, w * 2, h - offset);
    ctx.fillStyle = '#7a5a34';
    ctx.fillRect(-w, offset, w * 2, h - offset + h);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-w, offset);
    ctx.lineTo(w, offset);
    ctx.stroke();
    ctx.restore();
    // Fixed aircraft symbol in the middle.
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 26, h / 2);
    ctx.lineTo(w / 2 - 8, h / 2);
    ctx.moveTo(w / 2 + 8, h / 2);
    ctx.lineTo(w / 2 + 26, h / 2);
    ctx.moveTo(w / 2, h / 2 - 2);
    ctx.lineTo(w / 2, h / 2 + 8);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  }

  function drawCompass(headingDegValue) {
    const w = compass.width;
    const h = compass.height;
    const ctx = compassCtx;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(10, 18, 32, 0.72)';
    ctx.fillRect(0, 0, w, h);
    const points = [
      [0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'],
      [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW'],
    ];
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 120 degrees of sky across the strip; the centre is the current heading.
    // Draw the tick every 5 degrees and a label at every 45-degree point
    // whose offset from the current heading falls inside the strip.
    for (let d = -60; d <= 60; d += 5) {
      const deg = ((Math.round(headingDegValue) + d) % 360 + 360) % 360;
      const x = w / 2 + (d / 120) * w;
      const major = deg % 45 === 0;
      ctx.strokeStyle = major ? '#ffffff' : 'rgba(255,255,255,0.45)';
      ctx.lineWidth = major ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, h - 4);
      ctx.lineTo(x, h - (major ? 16 : 10));
      ctx.stroke();
    }
    for (const [pointDeg, label] of points) {
      let offset = ((pointDeg - headingDegValue) % 360 + 540) % 360 - 180;
      if (Math.abs(offset) > 58) continue;
      const x = w / 2 + (offset / 120) * w;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, x, 12);
    }
    // Centre caret.
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.moveTo(w / 2 - 7, 0);
    ctx.lineTo(w / 2 + 7, 0);
    ctx.lineTo(w / 2, 9);
    ctx.closePath();
    ctx.fill();
  }

  function setBar(id, percent, colour) {
    const bar = el(id);
    if (!bar) return;
    bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    if (colour) bar.style.background = colour;
  }

  return {
    /**
     * Big centre feedback for a scoring event ("RING! +500"): visible
     * for six seconds, then gone. Six, not four: the screenshot
     * stager runs the flight synchronously and the first frame after
     * it (shader compile in a cold browser) can take seconds, so a
     * four-second toast could hide before the still is taken.
     */
    toast(text) {
      const toastEl = el('hud-toast');
      if (!toastEl) return;
      toastEl.textContent = text;
      toastEl.style.display = 'block';
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toastEl.style.display = 'none'; }, 6000);
    },
    /**
     * Refresh every readout from the live state.
     * `view` is { flight, mission, timeLeft, score, objective, missionName }.
     */
    update(view) {
      const f = view.flight;
      const alt = el('hud-alt');
      if (alt) alt.textContent = String(altFeet(f.y));
      const spd = el('hud-spd');
      if (spd) spd.textContent = String(Math.round(f.speedKt));
      const hdg = el('hud-hdg');
      if (hdg) hdg.textContent = String(Math.round(hdgDeg(f.heading))).padStart(3, '0');
      const thr = el('hud-thr');
      if (thr) thr.textContent = `${Math.round(f.throttle * 100)}%`;
      const fuel = el('hud-fuel');
      if (fuel) fuel.textContent = `${Math.round(f.fuel)}%`;
      const hull = el('hud-hull');
      if (hull) hull.textContent = `${Math.round(f.hull)}%`;
      const timer = el('hud-timer');
      if (timer) {
        const t = Math.max(0, view.timeLeft);
        const m = Math.floor(t / 60);
        const s = Math.floor(t % 60);
        timer.textContent = `${m}:${String(s).padStart(2, '0')}`;
        timer.style.color = t < 30 ? PALETTE.hudDanger : PALETTE.hudText;
      }
      const score = el('hud-score');
      if (score) score.textContent = String(view.score);
      const objective = el('hud-objective');
      if (objective) objective.textContent = view.objective;
      const missionName = el('hud-mission');
      if (missionName) missionName.textContent = view.missionName;
      const stall = el('hud-stall');
      if (stall) stall.style.display = f.speedKt < 55 && f.airborne ? 'block' : 'none';
      const boost = el('hud-boost');
      if (boost) boost.style.display = f.boosting ? 'block' : 'none';

      setBar('bar-throttle', f.throttle * 100, '#ffd23f');
      setBar('bar-fuel', f.fuel, f.fuel < 25 ? PALETTE.hudDanger : f.fuel < 50 ? PALETTE.hudWarn : PALETTE.hudGood);
      setBar('bar-hull', f.hull, f.hull < 30 ? PALETTE.hudDanger : f.hull < 60 ? PALETTE.hudWarn : PALETTE.hudGood);
      drawAttitude(f.pitch, f.bank);
      drawCompass(hdgDeg(f.heading));
    },
    show() {
      const hud = el('hud');
      if (hud) hud.style.display = 'block';
    },
    hide() {
      const hud = el('hud');
      if (hud) hud.style.display = 'none';
    },
  };
}
