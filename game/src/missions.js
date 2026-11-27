// The six-mission campaign. Each mission is a different job for the same
// courier plane, with its own goal, timer, fuel load and par time: rings to
// thread, a runway to land on, crates to drop on pads, a storm to fly
// through, beacons to rescue and a grand tour that combines everything.
// Ring, pad and beacon positions are fixed per mission (seeded once), so a
// mission is the same challenge every time you fly it.

import { RING } from './config.js';
import { createRandom, range } from './random.js';

export const MISSIONS = [
  {
    id: 'ring-trial',
    number: 1,
    name: 'Ring Trial',
    brief: 'Thread all 8 sky rings in order, then land on the home runway.',
    goal: 'Fly through the rings in order, then land.',
    rings: 8,
    timeLimit: 300,
    par: 150,
    fuel: 100,
    storm: false,
    needsLanding: true,
  },
  {
    id: 'runway-landing',
    number: 2,
    name: 'Runway Landing',
    brief: 'Take off from the home runway, cross the sea and land gently on the far island runway.',
    goal: 'Land on the far runway: slow, low and over the strip.',
    rings: 0,
    timeLimit: 300,
    par: 140,
    fuel: 100,
    storm: false,
    needsLanding: true,
    farLanding: true,
  },
  {
    id: 'cargo-drop',
    number: 3,
    name: 'Cargo Drop',
    brief: 'Three supply crates, three island pads. Press Space over a pad to drop a crate.',
    goal: 'Drop 3 crates on the red pads (Space), then land home.',
    rings: 0,
    pads: 3,
    timeLimit: 360,
    par: 190,
    fuel: 100,
    storm: false,
    needsLanding: true,
  },
  {
    id: 'storm-rings',
    number: 4,
    name: 'Storm Rings',
    brief: 'Six rings in cloud and rain with a tight fuel load. Green rings refuel.',
    goal: 'Thread 6 rings in the storm, then land home.',
    rings: 6,
    timeLimit: 300,
    par: 170,
    fuel: 62,
    storm: true,
    needsLanding: true,
  },
  {
    id: 'beacon-rescue',
    number: 5,
    name: 'Beacon Rescue',
    brief: 'Five stranded beacons are flashing across the islands. Collect them all, then land.',
    goal: 'Collect 5 beacons, then land on the home runway.',
    rings: 0,
    beacons: 5,
    timeLimit: 360,
    par: 200,
    fuel: 100,
    storm: false,
    needsLanding: true,
  },
  {
    id: 'grand-tour',
    number: 6,
    name: 'Grand Tour',
    brief: 'The full courier run: 6 rings, 2 cargo drops and a landing on the far runway.',
    goal: '6 rings, 2 crate drops, then land on the far runway.',
    rings: 6,
    pads: 2,
    timeLimit: 480,
    par: 300,
    fuel: 100,
    storm: false,
    needsLanding: true,
    farLanding: true,
  },
];

/** Medal thresholds: gold at par, silver at par + 60 s, bronze at finishing at all. */
export function medalFor(time, par) {
  if (time <= par) return 'gold';
  if (time <= par + 60) return 'silver';
  return 'bronze';
}

function ringPath(random, count, terrain) {
  // A winding path across the archipelago: rings step east with alternating
  // north/south swings and altitudes between 120 and 280 m. The later rings
  // drift toward the far runway island (1500, -420), so the route leads the
  // pilot across the sea toward the second runway.
  const rings = [];
  let x = 320;
  let z = 60;
  for (let i = 0; i < count; i += 1) {
    x += range(random, 190, 260);
    if (i >= 3) z = range(random, -560, -160);
    else z += range(random, -320, 320);
    z = Math.max(-1250, Math.min(1250, z));
    const y = range(random, 130, 270);
    rings.push({ x, y, z, r: RING.radius, passed: false });
  }
  return rings;
}

function padSpots(random, count, terrain) {
  // Pads sit on flat-enough island ground away from the home runway.
  const pads = [];
  const candidates = terrain.islands.filter((island) => island.r > 200 && Math.abs(island.x) + Math.abs(island.z) > 100);
  for (let i = 0; i < count; i += 1) {
    const island = candidates[i % candidates.length];
    const angle = random() * Math.PI * 2;
    const dist = island.r * range(random, 0.1, 0.5);
    const x = island.x + Math.cos(angle) * dist;
    const z = island.z + Math.sin(angle) * dist;
    pads.push({ x, z, y: terrain.groundHeight(x, z), r: 30, hit: false });
  }
  return pads;
}

function beaconSpots(random, count, terrain) {
  const beacons = [];
  for (let i = 0; i < count; i += 1) {
    const island = terrain.islands[2 + (i % (terrain.islands.length - 2))];
    const angle = random() * Math.PI * 2;
    const dist = island.r * range(random, 0.1, 0.6);
    const x = island.x + Math.cos(angle) * dist;
    const z = island.z + Math.sin(angle) * dist;
    beacons.push({
      x,
      y: terrain.groundHeight(x, z) + range(random, 55, 95),
      z,
      r: 22,
      collected: false,
    });
  }
  return beacons;
}

/**
 * Build the runtime state for a mission: targets, fuel rings, timer and score.
 * `terrain` is the world from terrain.js; `seed` fixes the layout.
 */
export function createMission(def, terrain, seed) {
  const random = createRandom(seed * 31 + def.number * 977);
  const mission = {
    def,
    rings: def.rings ? ringPath(random, def.rings, terrain) : [],
    pads: def.pads ? padSpots(random, def.pads, terrain) : [],
    beacons: def.beacons ? beaconSpots(random, def.beacons, terrain) : [],
    fuelRings: [],
    crates: [],
    cratesLeft: def.pads || 0,
    time: 0,
    score: 0,
    status: 'flying', // flying | done | failed | crashed
    endReason: '',
    ringsPassed: 0,
    nextRing: 0,
  };
  // Fuel rings: green rings placed along the route of ring missions and the
  // storm mission, so a careful pilot can top up mid-flight.
  if (def.rings) {
    const fuelCount = def.storm ? 3 : 2;
    for (let i = 0; i < fuelCount; i += 1) {
      const anchor = mission.rings[Math.min(mission.rings.length - 1, 1 + i * 2)];
      if (!anchor) break;
      mission.fuelRings.push({
        x: anchor.x + range(random, -160, 160),
        y: range(random, 120, 220),
        z: anchor.z + range(random, -160, 160),
        r: RING.radius,
        passed: false,
      });
    }
  }
  return mission;
}

/** Where the plane starts for a mission: on the home runway, heading east. */
export function missionStart(terrain) {
  const r = terrain.homeRunway;
  const x = r.x - 150;
  const z = r.z;
  // Height from the ground exactly where the plane sits, not from the
  // runway centre 150 m away — the island slopes, and a centre-based
  // height leaves the plane floating (and then dropping) at the start.
  return { x, y: terrain.groundHeight(x, z) + 1.6, z, heading: 0 };
}

/** Where the plane starts for the landing shot: already airborne on final. */
export function landingStart(terrain) {
  const r = terrain.farRunway;
  // 90 m south of the centreline, heading east: the offset is what
  // makes the still work — the correcting turn puts her at a slight
  // angle to the strip, so the chase camera sees her flank, canopy and
  // fin instead of a dead-axis slab. A centreline start was tried and
  // gave exactly that toy look.
  return { x: r.x - 650, y: r.alt + 75, z: r.z + 90, heading: 0 };
}

/** The runway a mission must end on (home, or the far island). */
export function missionRunway(def, terrain) {
  return def.farLanding ? terrain.farRunway : terrain.homeRunway;
}

/** One line describing what is left to do, for the HUD objective banner. */
export function objectiveText(mission) {
  const def = mission.def;
  const parts = [];
  if (def.rings) parts.push(`Rings ${mission.ringsPassed}/${def.rings}`);
  if (def.pads) parts.push(`Cargo ${def.pads - mission.cratesLeft}/${def.pads} dropped`);
  if (def.beacons) {
    const got = mission.beacons.filter((b) => b.collected).length;
    parts.push(`Beacons ${got}/${def.beacons}`);
  }
  if (def.needsLanding) parts.push(mission.status === 'done' ? 'Landed' : 'Land on the runway');
  return parts.join('  ·  ') || def.goal;
}

/** True when every non-landing objective is complete. */
export function objectivesComplete(mission) {
  const def = mission.def;
  if (def.rings && mission.ringsPassed < def.rings) return false;
  if (def.pads && mission.cratesLeft > 0) return false;
  if (def.beacons && mission.beacons.some((b) => !b.collected)) return false;
  return true;
}
