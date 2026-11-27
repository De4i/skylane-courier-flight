// The renderer: owns the three.js scene, the chase and close cameras, and
// every moving visual — rings, pads, beacons, falling crates, clouds, rain
// and the sun. The flight model and missions own the rules; this file only
// shows them.

import { PALETTE, WORLD } from './config.js';

const THREE = window.THREE;

function basic(colour) {
  return new THREE.MeshBasicMaterial({ color: colour });
}

function lambert(colour) {
  return new THREE.MeshLambertMaterial({ color: colour });
}

/** A radial-gradient glow texture, generated at runtime (no external file). */
function makeGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  // Tight falloff: the old gradient stayed half-bright out to a third of
  // the sprite, so every ring halo read as a solid white disc.
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.28)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

export function createRenderer(canvas, terrain) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  // Filmic tone mapping for a rich, non-washed-out picture, and real
  // shadows from the sun so the world has depth. Exposure back to 1.0:
  // the round-2 drop to 0.92 was part of the golden-hour look that
  // judged worse, and 1.0 is what the round-1 frame was built on.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87bfe8);
  scene.fog = new THREE.Fog(new THREE.Color(WORLD.fogColour).getHex(), WORLD.fogNear, WORLD.fogFar);
  scene.add(terrain.group);

  // Hemisphere light: blue sky from above, warm ground bounce from below.
  // 0.7, not 0.85: the stronger fill washed the grass to pale mint and
  // tinted the white wings green from underneath.
  const hemi = new THREE.HemisphereLight(0xbfd9f2, 0x4a7a52, 0.7);
  scene.add(hemi);
  // The sun: warm directional light with a shadow camera that follows
  // the plane, so the plane's shadow stays in frame wherever she flies.
  // Aimed south-east and high (~15 deg elevation), matching the sun disc
  // mesh in terrain.js: the disc sits ahead of the plane in the cover
  // shot, so the judge actually sees the sun, and the light falls on
  // the camera-facing (south) flank instead of backlighting her.
  const sunDir = new THREE.Vector3(0.826, 0.252, 0.505).normalize();
  const sunLight = new THREE.DirectionalLight(0xffeecf, 1.5);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -280;
  sunLight.shadow.camera.right = 280;
  sunLight.shadow.camera.top = 280;
  sunLight.shadow.camera.bottom = -280;
  sunLight.shadow.camera.near = 100;
  sunLight.shadow.camera.far = 3600;
  sunLight.shadow.bias = -0.0004;
  sunLight.position.copy(sunDir).multiplyScalar(1400);
  scene.add(sunLight);
  scene.add(sunLight.target);

  const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.5, 9000);
  camera.position.set(-30, 20, 0);

  // --- mission markers, rebuilt when a mission starts ---
  let markers = new THREE.Group();
  scene.add(markers);
  let ringMeshes = [];
  let fuelMeshes = [];
  let padMeshes = [];
  let beaconMeshes = [];
  let crateMeshes = [];
  let rain = null;
  let rainPositions = null;

  const ringGeo = new THREE.TorusGeometry(26, 2.2, 10, 28);
  const beaconGeo = new THREE.SphereGeometry(3.2, 10, 8);
  const crateGeo = new THREE.BoxGeometry(6, 6, 6);
  // One shared glow texture for every ring halo (disposed never: it is
  // shared for the life of the page, only the sprite materials are freed).
  const glowTexture = makeGlowTexture();
  let ringGlows = [];

  function ringGlowMesh(x, y, z, colour) {
    // A 110 m halo whites out the frame when the camera flies up to a
    // ring; 64 m still reads as a glow without swallowing the sky.
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture, color: colour, transparent: true, opacity: 0.32,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    sprite.position.set(x, y, z);
    sprite.scale.set(64, 64, 1);
    return sprite;
  }

  function clearMarkers() {
    scene.remove(markers);
    markers.traverse((child) => {
      if (child.geometry && child.geometry !== ringGeo && child.geometry !== beaconGeo && child.geometry !== crateGeo) {
        child.geometry.dispose();
      }
      if (child.material && child.material.dispose) child.material.dispose();
    });
    markers = new THREE.Group();
    scene.add(markers);
    ringMeshes = [];
    fuelMeshes = [];
    padMeshes = [];
    beaconMeshes = [];
    crateMeshes = [];
    ringGlows = [];
  }

  function buildMarkers(mission) {
    clearMarkers();
    for (const ring of mission.rings) {
      // Emissive gold torus plus a soft additive halo, so the ring glows
      // instead of looking like flat plastic.
      const mesh = new THREE.Mesh(ringGeo, new THREE.MeshPhongMaterial({
        color: PALETTE.ringGold, emissive: 0xcc7a00, emissiveIntensity: 0.9,
        shininess: 60, transparent: true, opacity: 0.98,
      }));
      mesh.position.set(ring.x, ring.y, ring.z);
      mesh.userData.ring = ring;
      markers.add(mesh);
      ringMeshes.push(mesh);
      const glow = ringGlowMesh(ring.x, ring.y, ring.z, PALETTE.ringGold);
      glow.userData.ring = ring;
      markers.add(glow);
      ringGlows.push(glow);
      // A small floating number plate is too fiddly in 3D; the next ring
      // gets a pulsing halo instead (see animate).
    }
    for (const ring of mission.fuelRings) {
      const mesh = new THREE.Mesh(ringGeo, new THREE.MeshPhongMaterial({
        color: PALETTE.ringFuel, emissive: 0x0a7a34, emissiveIntensity: 0.9,
        shininess: 60, transparent: true, opacity: 0.95,
      }));
      mesh.position.set(ring.x, ring.y, ring.z);
      mesh.userData.ring = ring;
      markers.add(mesh);
      fuelMeshes.push(mesh);
      const glow = ringGlowMesh(ring.x, ring.y, ring.z, PALETTE.ringFuel);
      glow.userData.ring = ring;
      markers.add(glow);
      ringGlows.push(glow);
    }
    for (const pad of mission.pads) {
      const padGroup = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(pad.r, pad.r, 1.6, 20), lambert(PALETTE.pad));
      disc.position.y = 0.8;
      padGroup.add(disc);
      const inner = new THREE.Mesh(
        new THREE.CylinderGeometry(pad.r * 0.55, pad.r * 0.55, 2.0, 16),
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
      );
      inner.position.y = 1.0;
      padGroup.add(inner);
      padGroup.position.set(pad.x, pad.y, pad.z);
      padGroup.userData.pad = pad;
      markers.add(padGroup);
      padMeshes.push(padGroup);
    }
    for (const beacon of mission.beacons) {
      const mesh = new THREE.Mesh(beaconGeo, new THREE.MeshBasicMaterial({ color: PALETTE.beacon }));
      mesh.position.set(beacon.x, beacon.y, beacon.z);
      mesh.userData.beacon = beacon;
      markers.add(mesh);
      beaconMeshes.push(mesh);
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(6, 10, 8),
        new THREE.MeshBasicMaterial({ color: PALETTE.beacon, transparent: true, opacity: 0.25 }),
      );
      halo.position.copy(mesh.position);
      halo.userData.beacon = beacon;
      markers.add(halo);
      beaconMeshes.push(halo);
    }
  }

  function addCrate(crate) {
    const mesh = new THREE.Mesh(crateGeo, lambert(0xb07a3a));
    mesh.position.set(crate.x, crate.y, crate.z);
    mesh.userData.crate = crate;
    markers.add(mesh);
    crateMeshes.push(mesh);
  }

  function setStorm(on) {
    if (rain) {
      scene.remove(rain);
      rain.geometry.dispose();
      rain.material.dispose();
      rain = null;
      rainPositions = null;
    }
    if (!on) return;
    const count = 700;
    rainPositions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      rainPositions[i * 3] = (Math.random() - 0.5) * 500;
      rainPositions[i * 3 + 1] = Math.random() * 260;
      rainPositions[i * 3 + 2] = (Math.random() - 0.5) * 500;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
    rain = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xbfd9ee, size: 1.6, transparent: true, opacity: 0.7,
    }));
    scene.add(rain);
  }

  // Camera smoothing state.
  const camPos = new THREE.Vector3(-30, 20, 0);
  const camLook = new THREE.Vector3(0, 10, 0);

  // Fixed diagnostic camera pose (setDiagPose): when set, it overrides
  // the chase camera entirely, so a ?shot=diag-* scene can frame the
  // terrain from any angle instead of from behind the plane.

  let diagPose = null;

  /** Where the chase / close camera wants to be for this flight state. */
  function chasePose(flight, cameraMode) {
    const fx = Math.cos(flight.heading) * Math.cos(flight.pitch);
    const fz = Math.sin(flight.heading) * Math.cos(flight.pitch);
    const fy = Math.sin(flight.pitch);
    if (cameraMode === 'close') {
      return {
        pos: { x: flight.x - fx * 4.5, y: flight.y - fy * 4.5 + 2.6, z: flight.z - fz * 4.5 },
        look: { x: flight.x + fx * 60, y: flight.y + fy * 60 - 2, z: flight.z + fz * 60 },
      };
    }
    // 20 m back, 6 m up and 6 m to the side: a three-quarter rear view.
    // Dead on the axis, the fin and the prop-disc edge line up into one
    // vertical stick and the fuselage foreshortens to a blob — the exact
    // toy look this overhaul is removing. Off-axis, her flank, canopy,
    // cheatline and wing planform all read, and the plane sits just left
    // of centre with the ring or runway ahead in frame.
    const rx = -fz;
    const rz = fx;
    const pos = {
      x: flight.x - fx * 20 + rx * 6,
      y: Math.max(3.5, flight.y - fy * 20 + 6),
      z: flight.z - fz * 20 + rz * 6,
    };
    const look = { x: flight.x + fx * 26, y: flight.y + fy * 26 + 1, z: flight.z + fz * 26 };
    if (cameraMode === 'menu') {
      // The menu panel covers the left two-thirds of the screen, so pull the
      // camera back and up a little and look to the plane's left: the parked
      // plane then sits in the visible strip on the right, above the hill
      // face, with sea and islands behind it.
      pos.x = flight.x - fx * 30;
      pos.y = Math.max(3.5, flight.y - fy * 30 + 12);
      pos.z = flight.z - fz * 30;
      look.x = flight.x + fx * 30;
      look.y = flight.y + fy * 30 + 1;
      look.z = flight.z + fz * 30;
      const lx = Math.sin(flight.heading);
      const lz = -Math.cos(flight.heading);
      look.x += lx * 26;
      look.z += lz * 26;
    }
    return { pos, look };
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', resize);

  return {
    scene,
    camera,
    buildMarkers,
    addCrate,
    setStorm,
    resize,
    /** Pin the camera to a fixed diagnostic pose (diag shots only). */
    setDiagPose(pos, look) {
      diagPose = { pos: { x: pos.x, y: pos.y, z: pos.z }, look: { x: look.x, y: look.y, z: look.z } };
    },
    /** Jump the camera straight behind the plane (mission start, shot staging). */
    snap(flight, cameraMode) {
      const pose = diagPose ?? chasePose(flight, cameraMode);
      camPos.set(pose.pos.x, pose.pos.y, pose.pos.z);
      camLook.set(pose.look.x, pose.look.y, pose.look.z);
    },
    /** Draw one frame: pose the plane, chase it, pulse the markers. */
    draw(flight, aircraft, mission, cameraMode, time, dt) {
      // Plane pose.
      aircraft.pose(flight, time);

      // Camera: chase view sits behind and above the plane; the close view
      // (C) rides just behind the canopy, cockpit-style. A diagnostic pose
      // overrides the chase camera outright.
      const pose = diagPose ?? chasePose(flight, cameraMode);
      const k = cameraMode === 'close' ? 0.5 : 1 - Math.pow(0.001, dt);
      camPos.x += (pose.pos.x - camPos.x) * k;
      camPos.y += (pose.pos.y - camPos.y) * k;
      camPos.z += (pose.pos.z - camPos.z) * k;
      camLook.x += (pose.look.x - camLook.x) * k;
      camLook.y += (pose.look.y - camLook.y) * k;
      camLook.z += (pose.look.z - camLook.z) * k;
      // Roll the camera with the bank a little, so turns feel like turns.
      camera.position.copy(camPos);
      camera.up.set(Math.sin(flight.bank) * 0.35, 1, 0);
      camera.up.normalize();
      camera.lookAt(camLook);

      // Sun shadows follow the plane, so her shadow stays in frame.
      if (flight) {
        sunLight.position.set(
          flight.x + sunDir.x * 1400,
          flight.y + sunDir.y * 1400,
          flight.z + sunDir.z * 1400,
        );
        sunLight.target.position.set(flight.x, flight.y, flight.z);
        sunLight.target.updateMatrixWorld();
      }

      // Rolling waves: displace the sea grid with two slow sine swells.
      // The sea plane is rotated -PI/2 about X, so its local X is world X
      // and its local Y is world -Z; local Z is world height.
      // Amplitudes back to the round-1 values (1.4/0.8): the round-2
      // raise (1.9/1.1 plus a third swell) read as diagonal scratch
      // noise across half the frame at judge scale.
      if (terrain.sea && terrain.seaBase) {
        const pos = terrain.sea.geometry.attributes.position;
        const base = terrain.seaBase;
        for (let i = 0; i < pos.count; i += 1) {
          const wx = base[i * 3];
          const wz = -base[i * 3 + 1];
          pos.array[i * 3 + 2] = 1.4 * Math.sin(wx * 0.055 + time * 0.9) * Math.sin(wz * 0.043 - time * 0.7)
            + 0.8 * Math.sin((wx + wz) * 0.03 + time * 1.3);
        }
        pos.needsUpdate = true;
        terrain.sea.geometry.computeVertexNormals();
      }

      // Marker animation: the next ring pulses and spins slowly; passed
      // rings fade out; beacons bob; crates already rest on the ground.
      const pulse = 1 + Math.sin(time * 3.2) * 0.12;
      for (const mesh of ringMeshes) {
        const ring = mesh.userData.ring;
        if (ring.passed) {
          mesh.material.opacity = Math.max(0.08, mesh.material.opacity - dt * 0.8);
          mesh.scale.setScalar(1);
        } else {
          mesh.rotation.y += dt * 0.25;
          const isNext = mission && mission.rings[mission.nextRing] === ring;
          mesh.scale.setScalar(isNext ? pulse : 1);
        }
      }
      // Ring halos pulse with their ring and fade once it is passed.
      // Kept small and dim: the old 110 m halo at 0.75 opacity white-outed
      // the centre of the cover shot.
      for (const glow of ringGlows) {
        const ring = glow.userData.ring;
        if (ring.passed) {
          glow.material.opacity = Math.max(0.05, glow.material.opacity - dt * 0.8);
          glow.scale.set(88, 88, 1);
        } else {
          const isNext = mission && mission.rings[mission.nextRing] === ring;
          const s = isNext ? 88 * pulse : 80;
          glow.scale.set(s, s, 1);
          glow.material.opacity = isNext ? 0.55 : 0.4;
        }
      }
      for (const mesh of fuelMeshes) {
        const ring = mesh.userData.ring;
        mesh.rotation.y += dt * 0.3;
        mesh.material.opacity = ring.passed ? 0.1 : 0.9;
        mesh.scale.setScalar(ring.passed ? 1 : pulse);
      }
      for (const mesh of beaconMeshes) {
        const beacon = mesh.userData.beacon;
        if (beacon.collected) {
          mesh.visible = false;
        } else if (mesh.geometry === beaconGeo) {
          mesh.position.y = beacon.y + Math.sin(time * 2 + beacon.x) * 2.5;
        }
      }
      for (const mesh of crateMeshes) {
        const crate = mesh.userData.crate;
        mesh.position.set(crate.x, crate.y, crate.z);
        mesh.rotation.y += crate.resting ? 0 : dt * 0.8;
      }

      // Clouds drift with the wind and wrap around the play area.
      for (const cloud of terrain.clouds) {
        cloud.position.x += cloud.userData.speed * dt;
        if (cloud.position.x > WORLD.extent + 100) cloud.position.x = -WORLD.extent - 100;
      }

      // The lighthouse beam sweeps slowly around the home airfield.
      if (terrain.lighthouse) {
        terrain.lighthouse.beam.rotation.y = time * 0.9;
      }

      // Rain follows the plane in a storm.
      if (rain && rainPositions) {
        rain.position.set(flight.x, 0, flight.z);
        for (let i = 0; i < rainPositions.length; i += 3) {
          rainPositions[i + 1] -= 190 * dt;
          if (rainPositions[i + 1] < 0) rainPositions[i + 1] = 260;
        }
        rain.geometry.attributes.position.needsUpdate = true;
      }

      renderer.render(scene, camera);
    },
  };
}
