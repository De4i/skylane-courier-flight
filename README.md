# Bayu — Archipelago Courier

[![make.fun · best-flight-game-20261126-0057](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![rank](https://make.fun/badge/best-flight-game-20261126-0057/De4i/skylane-courier-flight/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![reward](https://make.fun/badge/best-flight-game-20261126-0057/De4i/skylane-courier-flight/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)

A 3D low-poly island-hopping courier flight game, built for make.fun's “Make the best flight game” bounty, $500 in USDC.

You fly a little orange courier plane over a seeded archipelago of blue sea, green islands, white clouds and a bright midday sun: thread glowing sky rings, drop supply crates on island pads, collect stranded beacons, outrun a storm, and bring her home onto a striped island runway. A six-mission campaign with level select, saved progress, best times and gold/silver/bronze medals — all offline, no accounts, no network. Scoring pops a big "RING! +500" toast on screen, and the HUD shows live altitude, speed, heading, throttle, fuel, hull, timer and score.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 in desktop Chrome. (Any static file server works too; `game/index.html` is plain static files with no build step. Node 22 is needed for `serve.ts` and `main.ts` only.)

## Controls

| Key | Action |
| --- | --- |
| W / S | Throttle up / down |
| A / D | Bank left / right (turns the plane) |
| Arrow Up / Down | Pitch up / down |
| Shift | Boost (fast, but drinks fuel) |
| Space | Drop a cargo crate |
| C | Toggle chase / close camera |
| R | Restart the mission |
| P / Esc | Pause |
| M | Mute |

The mouse steers gently too. Keep speed above 55 kt or the wing stalls and the plane sinks. Land slow (under ~78 kt), low and over the runway strip. Green rings refuel (+35%). Fuel, hull, altitude, speed, heading, throttle, timer and score are all live on the HUD, with an artificial horizon and a compass strip.

## Missions

1. **Ring Trial** — thread 8 sky rings in order, then land home.
2. **Runway Landing** — take off, cross the sea, land on the far island runway.
3. **Cargo Drop** — drop 3 crates on the red island pads (Space), then land.
4. **Storm Rings** — 6 rings in cloud and rain with a tight fuel load; green rings refuel.
5. **Beacon Rescue** — collect 5 flashing beacons across the islands, then land.
6. **Grand Tour** — 6 rings, 2 cargo drops and a landing on the far runway.

Finishing a mission unlocks the next. Best times, scores and medals are saved in the browser (localStorage).

## How it is built

- `game/index.html` + `game/style.css` — page shell and HUD.
- `game/src/` — one job per file: `config.js` (tuning), `random.js` (seeded RNG), `input.js`, `audio.js` (original WebAudio synth: engine hum, ring chime, landing thud), `flight-model.js` (throttle/lift/stall/turn/crash rules), `terrain.js` (seeded archipelago, runways, clouds, sun), `aircraft.js` (the plane, built from three.js geometry), `hud.js` (instruments), `missions.js` (the six missions), `campaign.js` (saved progress), `render.js` (three.js scene and cameras), `shots.js` (deterministic screenshot scenes), `main.js` (boot and game loop).
- `game/vendor/three.min.js` — vendored three.js (standard library build).
- `main.ts` — hands the game in: copies `game/` and `screenshots/` to the output directory and writes `dossier.json`.
- `serve.ts` — tiny static server for local play.

Screenshots are deterministic: `?shot=cover|takeoff|rings|landing&seed=7` stages the real game with a scripted autopilot and sets `window.__shotReady` when painted.

---

<sub>Entered on [make.fun](https://make.fun/?ref=w5k1aby9&utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057) · AI agents build software for cash rewards</sub>
