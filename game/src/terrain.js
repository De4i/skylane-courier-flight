// The archipelago: blue sea, green low-poly islands with hills and valleys,
// a home island with a striped runway and lights, a far island with a second
// runway, white drifting clouds and a low sun. The island layout is seeded,
// so the same seed always builds the same world — and the analytic
// groundHeight() matches the meshes exactly, so the flight model, the
// landing check and the visuals never disagree.

import { PALETTE, RUNWAY, WORLD } from './config.js';
import { createRandom, range } from './random.js';

const THREE = window.THREE;

// Note: three r128's MeshLambertMaterial ignores flatShading (it warns if
// you pass it), so the low-poly look comes from the low-segment geometry
// itself — few-sided cones and jittered vertices — not from this flag.
function lambert(colour) {
  return new THREE.MeshLambertMaterial({ color: colour });
}

function jitterGeometry(geometry, random, amount) {
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    position.setXYZ(
      i,
      position.getX(i) + (random() - 0.5) * amount,
      position.getY(i) + (random() - 0.5) * amount,
      position.getZ(i) + (random() - 0.5) * amount,
    );
  }
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Build the world for a seed. Returns { group, groundHeight, isRunway,
 * homeRunway, farRunway, islands, clouds, sun }.
 */
export function createTerrain(seed) {
  const random = createRandom(seed);
  const group = new THREE.Group();

  // --- sea ---
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.extent * 3.4, WORLD.extent * 3.4, 1, 1),
    new THREE.MeshLambertMaterial({ color: PALETTE.sea }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = 0;
  group.add(sea);

  // --- islands: analytic hills first, meshes built to match ---
  // Each island: centre, base radius, peak height. groundHeight is the sum
  // of smooth cosine hills, so it is exact and cheap to evaluate.
  const islands = [];
  const home = { x: 0, z: 0, r: 330, h: 26 };
  islands.push(home);
  const far = { x: 1500, z: -420, r: 300, h: 22 };
  islands.push(far);
  const spots = [
    { x: -780, z: 620, r: 260, h: 74 },
    { x: 620, z: 820, r: 300, h: 88 },
    { x: -1250, z: -760, r: 280, h: 64 },
    { x: 1050, z: -1180, r: 240, h: 52 },
    { x: -420, z: -1350, r: 260, h: 96 },
    { x: 1500, z: 700, r: 220, h: 44 },
    { x: -1600, z: 120, r: 230, h: 58 },
  ];
  for (const spot of spots) islands.push(spot);

  function hillHeight(island, x, z) {
    const dx = x - island.x;
    const dz = z - island.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d >= island.r) return 0;
    const t = d / island.r;
    return island.h * (0.5 + 0.5 * Math.cos(Math.PI * t)) + 2.5 * (1 - t);
  }

  function groundHeight(x, z) {
    let best = 0;
    for (const island of islands) {
      const h = hillHeight(island, x, z);
      if (h > best) best = h;
    }
    return best;
  }

  // --- island meshes: a flat-topped sand base, then 2-4 jittered cones ---
  const sandMat = lambert(PALETTE.sand);
  const grassMat = lambert(PALETTE.grass);
  const hillMat = lambert(PALETTE.hill);
  const rockMat = lambert(PALETTE.rock);
  for (const island of islands) {
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(island.r * 0.98, island.r * 1.06, 7, 18),
      sandMat,
    );
    base.position.set(island.x, 1.5, island.z);
    group.add(base);
    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(island.r * 0.94, island.r * 0.98, 3, 18),
      grassMat,
    );
    top.position.set(island.x, 6, island.z);
    group.add(top);
    const hillCount = island === home || island === far ? 2 : 3 + Math.floor(random() * 2);
    for (let i = 0; i < hillCount; i += 1) {
      const hr = island.r * range(random, 0.28, 0.45);
      const hh = island.h * range(random, 0.55, 0.95);
      const angle = random() * Math.PI * 2;
      const dist = island.r * range(random, 0.05, 0.45);
      const cone = new THREE.Mesh(
        jitterGeometry(new THREE.ConeGeometry(hr, hh, 7), random, hr * 0.12),
        i % 2 === 0 ? hillMat : rockMat,
      );
      cone.position.set(island.x + Math.cos(angle) * dist, 6 + hh / 2 - 1, island.z + Math.sin(angle) * dist);
      group.add(cone);
    }
    // A few pine-ish trees on the bigger islands.
    const treeCount = Math.floor(island.r / 55);
    for (let i = 0; i < treeCount; i += 1) {
      const angle = random() * Math.PI * 2;
      const dist = island.r * range(random, 0.15, 0.85);
      const tx = island.x + Math.cos(angle) * dist;
      const tz = island.z + Math.sin(angle) * dist;
      if (groundHeight(tx, tz) < 8) continue;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.2, 6, 5), lambert(0x7a5230));
      trunk.position.set(tx, groundHeight(tx, tz) + 3, tz);
      const crown = new THREE.Mesh(
        jitterGeometry(new THREE.ConeGeometry(4.5, 12, 6), random, 0.8),
        lambert(PALETTE.grassDark),
      );
      crown.position.set(tx, groundHeight(tx, tz) + 10, tz);
      group.add(trunk);
      group.add(crown);
    }
  }

  // --- runways: dark strip, white centre dashes, edge lights, windsock ---
  function buildRunway(cx, cz, headingRad) {
    const runwayGroup = new THREE.Group();
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(RUNWAY.length, 1.2, RUNWAY.width),
      lambert(PALETTE.runway),
    );
    strip.position.y = 0.6;
    runwayGroup.add(strip);
    const dashMat = lambert(PALETTE.runwayLine);
    for (let d = -RUNWAY.length / 2 + 22; d < RUNWAY.length / 2 - 10; d += 34) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(16, 0.4, 2.2), dashMat);
      dash.position.set(d, 1.35, 0);
      runwayGroup.add(dash);
    }
    // Threshold bars at both ends.
    for (const end of [-1, 1]) {
      for (let k = -2; k <= 2; k += 1) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(10, 0.4, 2.4), dashMat);
        bar.position.set(end * (RUNWAY.length / 2 - 16), 1.35, k * 4.6);
        runwayGroup.add(bar);
      }
    }
    // Edge lights: small emissive posts down both sides.
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
    for (let d = -RUNWAY.length / 2 + 12; d <= RUNWAY.length / 2 - 12; d += 42) {
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 2.6, 5), lambert(0x222222));
        post.position.set(d, 2.4, side * (RUNWAY.width / 2 + 2));
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.85, 8, 6), lightMat);
        bulb.position.set(d, 4, side * (RUNWAY.width / 2 + 2));
        runwayGroup.add(post);
        runwayGroup.add(bulb);
      }
    }
    // Windsock on a pole beside the threshold.
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 14, 6), lambert(0xdddddd));
    pole.position.set(-RUNWAY.length / 2 + 8, 7, RUNWAY.width / 2 + 14);
    const sock = new THREE.Mesh(new THREE.ConeGeometry(2.2, 9, 8), lambert(0xff5964));
    sock.rotation.z = Math.PI / 2;
    sock.position.set(-RUNWAY.length / 2 + 12, 13.4, RUNWAY.width / 2 + 14);
    runwayGroup.add(pole);
    runwayGroup.add(sock);

    runwayGroup.position.set(cx, groundHeight(cx, cz) + 0.4, cz);
    runwayGroup.rotation.y = -headingRad;
    group.add(runwayGroup);
    return { x: cx, z: cz, heading: headingRad, alt: groundHeight(cx, cz) + 1.6 };
  }

  const homeRunway = buildRunway(0, 0, 0);
  const farRunway = buildRunway(far.x, far.z, 0);

  function isRunway(x, z) {
    for (const r of [homeRunway, farRunway]) {
      const dx = x - r.x;
      const dz = z - r.z;
      // Runway runs along +X (heading 0); rotate the offset back by -heading.
      const along = dx * Math.cos(r.heading) + dz * Math.sin(r.heading);
      const across = -dx * Math.sin(r.heading) + dz * Math.cos(r.heading);
      if (Math.abs(along) <= RUNWAY.length / 2 + 6 && Math.abs(across) <= RUNWAY.width / 2 + 4) return true;
    }
    return false;
  }

  // --- clouds: clusters of flat white spheres, drifting slowly ---
  const clouds = [];
  const cloudMat = new THREE.MeshLambertMaterial({ color: PALETTE.cloud, transparent: true, opacity: 0.94 });
  for (let i = 0; i < 26; i += 1) {
    const cloud = new THREE.Group();
    const puffs = 3 + Math.floor(random() * 3);
    for (let p = 0; p < puffs; p += 1) {
      const s = range(random, 14, 30);
      const puff = new THREE.Mesh(new THREE.SphereGeometry(s, 8, 6), cloudMat);
      puff.scale.y = 0.45;
      puff.position.set(range(random, -34, 34), range(random, -4, 6), range(random, -16, 16));
      cloud.add(puff);
    }
    cloud.position.set(
      range(random, -WORLD.extent, WORLD.extent),
      range(random, 190, 330),
      range(random, -WORLD.extent, WORLD.extent),
    );
    cloud.userData.speed = range(random, 1.5, 4);
    clouds.push(cloud);
    group.add(cloud);
  }

  // --- sun: a bright disc low in the sky, plus the lights that match it ---
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(46, 16, 12),
    new THREE.MeshBasicMaterial({ color: PALETTE.sun }),
  );
  sun.position.set(-1500, 620, -1900);
  group.add(sun);

  return { group, groundHeight, isRunway, homeRunway, farRunway, islands, clouds, sun };
}
