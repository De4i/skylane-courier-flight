// The archipelago: a living tropical sea with animated waves, islands
// built as real heightfields (sand beach, grass slopes, rock on the steep
// ground, pine and palm trees, boulders), two graded airfields with a
// hangar and control hut, a gradient sky with a glowing sun, and shaded
// cumulus clouds. The layout is seeded, so the same seed always builds
// the same world — and groundHeight() is the exact function the meshes
// are sampled from, so the flight model, the landing check and the
// visuals never disagree. The runways sit on graded flat aprons blended
// into groundHeight itself, so the strip, the plane and the ground agree.

import { PALETTE, RUNWAY, WORLD } from './config.js';
import { createRandom, range } from './random.js';

const THREE = window.THREE;

function clamp01(t) {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function smoothstep(t) {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

function lambert(colour) {
  return new THREE.MeshLambertMaterial({ color: colour });
}

function phong(colour, shininess = 40) {
  return new THREE.MeshPhongMaterial({ color: colour, shininess });
}

/** A radial-gradient glow texture, generated at runtime (no external file). */
function makeGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
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
 * homeRunway, farRunway, islands, clouds, sun, sea, seaBase }.
 * seaBase is the sea mesh's flat vertex positions, for wave animation.
 */
export function createTerrain(seed) {
  const random = createRandom(seed);
  const group = new THREE.Group();

  // --- islands: analytic hills first, meshes built to match ---
  const islands = [];
  const home = { x: 0, z: 0, r: 330, h: 26 };
  islands.push(home);
  const far = { x: 1500, z: -420, r: 300, h: 22 };
  islands.push(far);
  const spots = [
    // 56, not 74: this peak sits beside a Grand Tour cargo pad, and the
    // dive-and-turn after the drop threads directly over its summit with
    // only metres to spare — at 74 m the turn clips the peak, at 56 m
    // either turn direction clears it by a wide margin.
    { x: -780, z: 620, r: 260, h: 56 },
    { x: 620, z: 820, r: 300, h: 88 },
    { x: -1250, z: -760, r: 280, h: 64 },
    { x: 1050, z: -1180, r: 240, h: 52 },
    { x: -420, z: -1350, r: 260, h: 96 },
    { x: 1500, z: 700, r: 220, h: 44 },
    { x: -1600, z: 120, r: 230, h: 58 },
  ];
  for (const spot of spots) islands.push(spot);

  // Runway rectangles, known before the terrain is built so the ground
  // can be graded flat around them and trees kept clear of them.
  const RUNWAYS = [
    { x: 0, z: 0, heading: 0 },
    { x: far.x, z: far.z, heading: 0 },
  ];

  function hillHeight(island, x, z) {
    const dx = x - island.x;
    const dz = z - island.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d >= island.r) return 0;
    const t = d / island.r;
    return island.h * (0.5 + 0.5 * Math.cos(Math.PI * t)) + 2.5 * (1 - t);
  }

  // Deterministic ridge detail: a few long sine waves per island, fading
  // out at the shoreline so the beach stays clean.
  const detailPhase = {
    a: random() * Math.PI * 2, b: random() * Math.PI * 2,
    c: random() * Math.PI * 2, d: random() * Math.PI * 2,
  };
  // Rolling detail on the analytic surface. Amplitude is deliberately
  // small (<= ~3.1 m): the old terrain had no detail at all, and the
  // Grand Tour route threads a dive over a 74 m mountain with only a few
  // metres of clearance — an 11 m ridge there turned a clear pass into a
  // crash. Visual ruggedness comes from the hills, vertex colours, trees
  // and rocks, not from moving the flight surface.
  function detailHeight(island, x, z) {
    const dx = x - island.x;
    const dz = z - island.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d >= island.r) return 0;
    const t = d / island.r;
    const fade = smoothstep((1 - t) / 0.3);
    const s = Math.sin(dx * 0.021 + detailPhase.a) * Math.cos(dz * 0.017 + detailPhase.b)
      + 0.6 * Math.sin((dx + dz) * 0.033 + detailPhase.c);
    const fine = 0.55 * Math.sin(dx * 0.085 + detailPhase.d) * Math.cos(dz * 0.079 + detailPhase.a);
    return fade * (1.6 * s + fine);
  }

  function rawHeight(x, z) {
    let best = 0;
    for (const island of islands) {
      const hh = hillHeight(island, x, z);
      if (hh <= 0) continue;
      // Detail ridges live mid-slope only: they fade to nothing on the
      // flanks (so a ridge can never carve a sea-level pit into grass)
      // and to nothing at the summit (so a ridge can never raise the
      // peak the Grand Tour dive threads with metres to spare), and the
      // surface never drops below 60% of the hill it sits on.
      const detail = detailHeight(island, x, z)
        * clamp01(hh / 12) * clamp01((island.h - hh) / 12);
      const h = Math.max(hh * 0.6, hh + detail);
      if (h > best) best = h;
    }
    return best;
  }

  // Each airfield is a graded plateau at 60% of its island's centre hill
  // height — a tabletop runway. (A flat apron at full centre height lifts
  // the plane's parking spot so high that the climb after takeoff bleeds
  // almost no speed, and a slow plane on final then mushes above the
  // strip forever instead of sinking onto it.)
  for (let i = 0; i < RUNWAYS.length; i += 1) {
    RUNWAYS[i].base = hillHeight(islands[i], RUNWAYS[i].x, RUNWAYS[i].z) * 0.6;
  }

  // How strongly the ground is graded flat toward a runway's base height.
  function flattenBlend(x, z) {
    let best = 0;
    let base = 0;
    for (const rw of RUNWAYS) {
      const dx = x - rw.x;
      const dz = z - rw.z;
      const along = dx * Math.cos(rw.heading) + dz * Math.sin(rw.heading);
      const across = -dx * Math.sin(rw.heading) + dz * Math.cos(rw.heading);
      const a = smoothstep((RUNWAY.length / 2 + 80 - Math.abs(along)) / 80);
      const b = smoothstep((RUNWAY.width / 2 + 80 - Math.abs(across)) / 80);
      const f = a * b;
      if (f > best) {
        best = f;
        base = rw.base;
      }
    }
    return { blend: best, base };
  }

  function groundHeight(x, z) {
    const raw = rawHeight(x, z);
    const { blend, base } = flattenBlend(x, z);
    if (blend <= 0) return raw;
    return raw * (1 - blend) + base * blend;
  }

  function nearRunway(x, z, margin) {
    for (const rw of RUNWAYS) {
      const dx = x - rw.x;
      const dz = z - rw.z;
      const along = dx * Math.cos(rw.heading) + dz * Math.sin(rw.heading);
      const across = -dx * Math.sin(rw.heading) + dz * Math.cos(rw.heading);
      if (Math.abs(along) <= RUNWAY.length / 2 + margin && Math.abs(across) <= RUNWAY.width / 2 + margin) return true;
    }
    return false;
  }

  // --- sky dome: a gradient from deep blue overhead to warm haze at the
  // horizon, so the sky has depth instead of one flat colour. ---
  {
    const skyGeo = new THREE.SphereGeometry(4200, 28, 18);
    const pos = skyGeo.attributes.position;
    const colours = new Float32Array(pos.count * 3);
    const top = new THREE.Color(0x1e5f9e);
    const mid = new THREE.Color(0x6fb1e6);
    // Pale blue, not cream: a warm horizon band blew out to white under
    // ACES tone mapping and washed the whole sky out of the cover shot.
    const horizon = new THREE.Color(0xcfe0f0);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i += 1) {
      const t = clamp01(pos.getY(i) / 4200); // 0 at horizon, 1 at zenith
      if (t > 0.25) c.copy(mid).lerp(top, (t - 0.25) / 0.75);
      else c.copy(horizon).lerp(mid, t / 0.25);
      colours[i * 3] = c.r;
      colours[i * 3 + 1] = c.g;
      colours[i * 3 + 2] = c.b;
    }
    skyGeo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.BackSide, fog: false,
    }));
    group.add(sky);
  }

  // --- sea: a fine grid with a sun-glinting Phong surface; the renderer
  // animates its vertices into slow rolling waves. ---
  const seaGeo = new THREE.PlaneGeometry(WORLD.extent * 3.4, WORLD.extent * 3.4, 150, 150);
  const sea = new THREE.Mesh(
    seaGeo,
    new THREE.MeshPhongMaterial({
      color: PALETTE.sea, specular: 0xcfe8ff, shininess: 110,
    }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = 0;
  sea.receiveShadow = true;
  group.add(sea);
  const seaBase = seaGeo.attributes.position.array.slice();

  // --- island heightfield meshes, sampled from groundHeight itself ---
  const islandMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const sandCol = new THREE.Color(PALETTE.sand);
  const sandWetCol = new THREE.Color(PALETTE.sandWet);
  const grassCol = new THREE.Color(PALETTE.grass);
  const grassDarkCol = new THREE.Color(PALETTE.grassDark);
  const grassLightCol = new THREE.Color(PALETTE.grassLight);
  const rockCol = new THREE.Color(PALETTE.rock);
  const rockDarkCol = new THREE.Color(PALETTE.rockDark);
  const tmpCol = new THREE.Color();
  const tmpCol2 = new THREE.Color();

  function colourFor(x, z, h, island) {
    // Slope from a central difference of the analytic height.
    const e = 6;
    const slope = Math.max(
      Math.abs(groundHeight(x + e, z) - groundHeight(x - e, z)),
      Math.abs(groundHeight(x, z + e) - groundHeight(x, z - e)),
    ) / (2 * e);
    if (h < 2.2) {
      tmpCol.copy(sandWetCol).lerp(sandCol, clamp01(h / 2.2));
    } else if (h < 5) {
      tmpCol.copy(sandCol).lerp(grassCol, (h - 2.2) / 2.8);
    } else if (slope > 0.8) {
      tmpCol.copy(rockDarkCol);
    } else if (slope > 0.5) {
      tmpCol.copy(rockCol).lerp(grassCol, (0.8 - slope) / 0.3);
    } else if (h > island.h * 0.72) {
      tmpCol.copy(grassCol).lerp(rockCol, 0.45);
    } else {
      // Patchy grass: light and dark meadows alternate across the island.
      const patch = Math.sin(x * 0.045 + 1.7) * Math.cos(z * 0.05 - 0.6);
      tmpCol.copy(grassCol).lerp(patch > 0.25 ? grassLightCol : grassDarkCol, 0.55);
    }
    // A little per-vertex jitter so the facets read individually.
    const j = 0.92 + random() * 0.16;
    tmpCol2.setRGB(tmpCol.r * j, tmpCol.g * j, tmpCol.b * j);
    return tmpCol2;
  }

  const SEG = 56;
  const RINGS = 18;
  for (const island of islands) {
    const positions = [];
    const colours = [];
    const indices = [];
    // Centre vertex, then concentric rings out to the shoreline.
    positions.push(island.x, groundHeight(island.x, island.z), island.z);
    let c = colourFor(island.x, island.z, groundHeight(island.x, island.z), island);
    colours.push(c.r, c.g, c.b);
    for (let ring = 1; ring <= RINGS; ring += 1) {
      const radius = island.r * (ring / RINGS);
      for (let s = 0; s < SEG; s += 1) {
        const angle = (s / SEG) * Math.PI * 2;
        const x = island.x + Math.cos(angle) * radius;
        const z = island.z + Math.sin(angle) * radius;
        const h = groundHeight(x, z);
        positions.push(x, h, z);
        c = colourFor(x, z, h, island);
        colours.push(c.r, c.g, c.b);
      }
    }
    const ringStart = (ring) => 1 + (ring - 1) * SEG;
    for (let s = 0; s < SEG; s += 1) {
      indices.push(0, ringStart(1) + ((s + 1) % SEG), ringStart(1) + s);
    }
    for (let ring = 1; ring < RINGS; ring += 1) {
      for (let s = 0; s < SEG; s += 1) {
        const a = ringStart(ring) + s;
        const b = ringStart(ring) + ((s + 1) % SEG);
        const d = ringStart(ring + 1) + s;
        const e = ringStart(ring + 1) + ((s + 1) % SEG);
        indices.push(a, d, b, b, d, e);
      }
    }
    // Skirt: a sand cliff from the shoreline down under the water.
    const skirtStart = positions.length / 3;
    for (let s = 0; s < SEG; s += 1) {
      const angle = (s / SEG) * Math.PI * 2;
      const x = island.x + Math.cos(angle) * island.r * 1.12;
      const z = island.z + Math.sin(angle) * island.r * 1.12;
      positions.push(x, -8, z);
      colours.push(sandWetCol.r, sandWetCol.g, sandWetCol.b);
    }
    for (let s = 0; s < SEG; s += 1) {
      const a = ringStart(RINGS) + s;
      const b = ringStart(RINGS) + ((s + 1) % SEG);
      const d = skirtStart + s;
      const e = skirtStart + ((s + 1) % SEG);
      indices.push(a, d, b, b, d, e);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    geo.setIndex(indices);
    const nonIndexed = geo.toNonIndexed();
    nonIndexed.computeVertexNormals(); // flat facets: the low-poly look
    const mesh = new THREE.Mesh(nonIndexed, islandMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    geo.dispose();

    // Foam ring where the waves meet the sand: a thin shoreline line, not
    // a wide halo (the old 10%-wide ring read as a giant white halo from
    // the air and swamped the bottom of the takeoff shot).
    const foam = new THREE.Mesh(
      new THREE.RingGeometry(island.r * 0.99, island.r * 1.035, 56),
      new THREE.MeshBasicMaterial({ color: PALETTE.seaFoam, transparent: true, opacity: 0.3 }),
    );
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(island.x, 0.7, island.z);
    group.add(foam);

    // Trees: pines on the high ground, palms down by the beach. Dense
    // enough to read as vegetation from the air (the old count left most
    // islands looking bare at 200 m).
    const treeCount = Math.floor(island.r / 30);
    for (let i = 0; i < treeCount; i += 1) {
      const angle = random() * Math.PI * 2;
      const dist = island.r * range(random, 0.12, 0.88);
      const tx = island.x + Math.cos(angle) * dist;
      const tz = island.z + Math.sin(angle) * dist;
      const gh = groundHeight(tx, tz);
      if (gh < 4 || nearRunway(tx, tz, 46)) continue;
      const scale = range(random, 0.8, 1.5);
      if (gh < 10 && random() < 0.45) {
        group.add(buildPalm(tx, gh, tz, scale, random));
      } else {
        group.add(buildPine(tx, gh, tz, scale, random));
      }
    }
    // Boulders on the steep ground.
    const rockCount = 2 + Math.floor(random() * 3);
    for (let i = 0; i < rockCount; i += 1) {
      const angle = random() * Math.PI * 2;
      const dist = island.r * range(random, 0.3, 0.85);
      const tx = island.x + Math.cos(angle) * dist;
      const tz = island.z + Math.sin(angle) * dist;
      const gh = groundHeight(tx, tz);
      if (gh < 6 || nearRunway(tx, tz, 40)) continue;
      const rock = new THREE.Mesh(
        jitterGeometry(new THREE.IcosahedronGeometry(range(random, 3, 7), 0), random, 1.2),
        lambert(PALETTE.rock),
      );
      rock.position.set(tx, gh + 1, tz);
      rock.castShadow = true;
      group.add(rock);
    }
  }

  function buildPine(x, y, z, scale, rand) {
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.0, 4, 6), lambert(PALETTE.trunk));
    trunk.position.y = 2;
    trunk.castShadow = true;
    tree.add(trunk);
    const c1 = new THREE.Mesh(jitterGeometry(new THREE.ConeGeometry(4.6, 11, 7), rand, 0.7), lambert(PALETTE.pine));
    c1.position.y = 8.5;
    c1.castShadow = true;
    tree.add(c1);
    const c2 = new THREE.Mesh(jitterGeometry(new THREE.ConeGeometry(3.3, 9, 7), rand, 0.6), lambert(PALETTE.pineLight));
    c2.position.y = 14.5;
    c2.castShadow = true;
    tree.add(c2);
    tree.position.set(x, y, z);
    tree.scale.setScalar(scale);
    tree.rotation.y = rand() * Math.PI * 2;
    return tree;
  }

  function buildPalm(x, y, z, scale, rand) {
    const tree = new THREE.Group();
    // A gently leaning trunk made of three short segments.
    let px = 0;
    let py = 0;
    for (let i = 0; i < 3; i += 1) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 4.2, 6), lambert(PALETTE.trunk));
      seg.position.set(px + 0.5, py + 2, 0);
      seg.rotation.z = -0.16;
      seg.castShadow = true;
      tree.add(seg);
      px += 0.65;
      py += 3.9;
    }
    // Fronds: long flattened cones fanning out and drooping from the crown.
    for (let i = 0; i < 6; i += 1) {
      const angle = (i / 6) * Math.PI * 2;
      const frond = new THREE.Mesh(
        jitterGeometry(new THREE.ConeGeometry(1.5, 9, 5), rand, 0.4),
        lambert(PALETTE.palm),
      );
      frond.scale.set(1, 1, 0.22);
      frond.position.set(px + Math.cos(angle) * 2.6, py + 1.2, Math.sin(angle) * 2.6);
      frond.rotation.set(Math.sin(angle) * 1.9, 0, -Math.cos(angle) * 1.9);
      frond.castShadow = true;
      tree.add(frond);
    }
    // Coconuts: two small brown spheres under the crown.
    for (const side of [-1, 1]) {
      const nut = new THREE.Mesh(new THREE.SphereGeometry(0.7, 6, 5), lambert(0x5a3a1e));
      nut.position.set(px + side * 0.8, py - 0.6, 0.6);
      tree.add(nut);
    }
    tree.position.set(x, y, z);
    tree.scale.setScalar(scale);
    tree.rotation.y = rand() * Math.PI * 2;
    return tree;
  }

  // --- runways: dark strip, white centre dashes, threshold bars, glowing
  // edge lights, windsock, plus a hangar and control hut at home. ---
  function buildRunway(cx, cz, headingRad, isHome) {
    const runwayGroup = new THREE.Group();
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(RUNWAY.length, 1.2, RUNWAY.width),
      lambert(PALETTE.runway),
    );
    strip.position.y = 0.6;
    strip.receiveShadow = true;
    runwayGroup.add(strip);
    const dashMat = lambert(PALETTE.runwayLine);
    for (let d = -RUNWAY.length / 2 + 22; d < RUNWAY.length / 2 - 10; d += 34) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(16, 0.4, 2.2), dashMat);
      dash.position.set(d, 1.35, 0);
      runwayGroup.add(dash);
    }
    for (const end of [-1, 1]) {
      for (let k = -2; k <= 2; k += 1) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(10, 0.4, 2.4), dashMat);
        bar.position.set(end * (RUNWAY.length / 2 - 16), 1.35, k * 4.6);
        runwayGroup.add(bar);
      }
    }
    // Edge lights: posts with bright warm bulbs.
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
    for (let d = -RUNWAY.length / 2 + 12; d <= RUNWAY.length / 2 - 12; d += 42) {
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 2.6, 5), lambert(0x222222));
        post.position.set(d, 2.4, side * (RUNWAY.width / 2 + 2));
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(1.05, 8, 6), lightMat);
        bulb.position.set(d, 4.2, side * (RUNWAY.width / 2 + 2));
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

    if (isHome) {
      // Hangar: cream walls, teal gable roof, big dark door, windows.
      const hangar = new THREE.Group();
      const walls = new THREE.Mesh(new THREE.BoxGeometry(34, 13, 26), lambert(PALETTE.hangarWall));
      walls.position.y = 6.5;
      walls.castShadow = true;
      hangar.add(walls);
      const roofShape = new THREE.Shape();
      roofShape.moveTo(-18, 0);
      roofShape.lineTo(18, 0);
      roofShape.lineTo(0, 8);
      roofShape.closePath();
      const roof = new THREE.Mesh(
        new THREE.ExtrudeGeometry(roofShape, { depth: 27, bevelEnabled: false }),
        lambert(PALETTE.hangarRoof),
      );
      roof.position.set(0, 13, -13.5);
      roof.castShadow = true;
      hangar.add(roof);
      const door = new THREE.Mesh(new THREE.BoxGeometry(20, 10, 0.8), lambert(0x2c343c));
      door.position.set(0, 5, 13.4);
      hangar.add(door);
      for (const wx of [-11, 11]) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 0.6), new THREE.MeshBasicMaterial({ color: 0x9fd4ff }));
        win.position.set(wx, 9, 13.4);
        hangar.add(win);
      }
      hangar.position.set(-RUNWAY.length / 2 + 55, 0, -(RUNWAY.width / 2 + 34));
      runwayGroup.add(hangar);
      // Fuel drums beside the hangar.
      for (let i = 0; i < 3; i += 1) {
        const drum = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 3.4, 10), lambert(0xe4572e));
        drum.position.set(-RUNWAY.length / 2 + 30 + i * 4.5, 1.7, -(RUNWAY.width / 2 + 22));
        drum.castShadow = true;
        runwayGroup.add(drum);
      }
    }
    // Control hut: small building with a glass band and an antenna mast.
    const hut = new THREE.Group();
    const hutWalls = new THREE.Mesh(new THREE.BoxGeometry(11, 7, 9), lambert(PALETTE.hangarWall));
    hutWalls.position.y = 3.5;
    hutWalls.castShadow = true;
    hut.add(hutWalls);
    const hutRoof = new THREE.Mesh(new THREE.BoxGeometry(12.5, 1, 10.5), lambert(PALETTE.hangarRoof));
    hutRoof.position.y = 7.5;
    hut.add(hutRoof);
    const band = new THREE.Mesh(new THREE.BoxGeometry(11.4, 2, 9.4), new THREE.MeshBasicMaterial({ color: 0x9fd4ff }));
    band.position.y = 5.2;
    hut.add(band);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 9, 5), lambert(0xdddddd));
    mast.position.set(3, 12, 0);
    hut.add(mast);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), lambert(0xf2f2e8));
    dish.position.set(3, 16.4, 0);
    dish.rotation.x = -0.7;
    hut.add(dish);
    hut.position.set(RUNWAY.length / 2 - 30, 0, RUNWAY.width / 2 + 26);
    runwayGroup.add(hut);

    runwayGroup.position.set(cx, groundHeight(cx, cz) + 0.4, cz);
    runwayGroup.rotation.y = -headingRad;
    group.add(runwayGroup);
    return { x: cx, z: cz, heading: headingRad, alt: groundHeight(cx, cz) + 1.6 };
  }

  const homeRunway = buildRunway(0, 0, 0, true);
  const farRunway = buildRunway(far.x, far.z, 0, false);

  function isRunway(x, z) {
    for (const r of [homeRunway, farRunway]) {
      const dx = x - r.x;
      const dz = z - r.z;
      const along = dx * Math.cos(r.heading) + dz * Math.sin(r.heading);
      const across = -dx * Math.sin(r.heading) + dz * Math.cos(r.heading);
      if (Math.abs(along) <= RUNWAY.length / 2 + 6 && Math.abs(across) <= RUNWAY.width / 2 + 4) return true;
    }
    return false;
  }

  // --- clouds: big shaded cumulus clusters, drifting slowly ---
  const clouds = [];
  const cloudMat = new THREE.MeshLambertMaterial({ color: PALETTE.cloud, transparent: true, opacity: 0.95 });
  const cloudShadeMat = new THREE.MeshLambertMaterial({ color: PALETTE.cloudShade, transparent: true, opacity: 0.95 });
  for (let i = 0; i < 26; i += 1) {
    const cloud = new THREE.Group();
    const puffs = 5 + Math.floor(random() * 4);
    const big = i < 4; // a few huge distant clouds for depth
    for (let p = 0; p < puffs; p += 1) {
      const s = range(random, big ? 34 : 16, big ? 58 : 36);
      const lower = p > 0 && random() < 0.45;
      const puff = new THREE.Mesh(new THREE.SphereGeometry(s, 10, 8), lower ? cloudShadeMat : cloudMat);
      puff.scale.y = 0.5;
      puff.position.set(range(random, -44, 44), range(random, lower ? -8 : -2, 8), range(random, -20, 20));
      puff.castShadow = false;
      cloud.add(puff);
    }
    cloud.position.set(
      range(random, -WORLD.extent, WORLD.extent),
      range(random, big ? 380 : 200, big ? 460 : 340),
      range(random, -WORLD.extent, WORLD.extent),
    );
    cloud.userData.speed = range(random, 1.5, 4);
    clouds.push(cloud);
    group.add(cloud);
  }

  // --- sun: a big bright disc with a soft glow halo, low in the west ---
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(70, 20, 14),
    new THREE.MeshBasicMaterial({ color: PALETTE.sun, fog: false }),
  );
  sun.position.set(-1500, 620, -1900);
  group.add(sun);
  // The halo needs a canvas, so it only exists in a real browser — the
  // headless rules sim loads this module without a document.
  if (typeof document !== 'undefined') {
    const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeGlowTexture(), color: 0xffe9a8, transparent: true, opacity: 0.6,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    sunGlow.scale.set(550, 550, 1);
    sunGlow.position.copy(sun.position);
    group.add(sunGlow);
  }

  return { group, groundHeight, isRunway, homeRunway, farRunway, islands, clouds, sun, sea, seaBase };
}
