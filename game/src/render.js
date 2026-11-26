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

export function createRenderer(canvas, terrain) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.skyTop ? 0x87bfe8 : 0x87bfe8);
  scene.fog = new THREE.Fog(new THREE.Color(WORLD.fogColour).getHex(), WORLD.fogNear, WORLD.fogFar);
  scene.add(terrain.group);

  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(ambient);
  const sunLight = new THREE.DirectionalLight(0xfff2cc, 1.05);
  sunLight.position.set(-1500, 900, -1900);
  scene.add(sunLight);

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
  }

  function buildMarkers(mission) {
    clearMarkers();
    for (const ring of mission.rings) {
      const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: PALETTE.ringGold, transparent: true, opacity: 0.95,
      }));
      mesh.position.set(ring.x, ring.y, ring.z);
      mesh.userData.ring = ring;
      markers.add(mesh);
      ringMeshes.push(mesh);
      // A small floating number plate is too fiddly in 3D; the next ring
      // gets a pulsing halo instead (see animate).
    }
    for (const ring of mission.fuelRings) {
      const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: PALETTE.ringFuel, transparent: true, opacity: 0.9,
      }));
      mesh.position.set(ring.x, ring.y, ring.z);
      mesh.userData.ring = ring;
      markers.add(mesh);
      fuelMeshes.push(mesh);
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
    const pos = { x: flight.x - fx * 24, y: Math.max(3.5, flight.y - fy * 24 + 7.5), z: flight.z - fz * 24 };
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
    /** Jump the camera straight behind the plane (mission start, shot staging). */
    snap(flight, cameraMode) {
      const pose = chasePose(flight, cameraMode);
      camPos.set(pose.pos.x, pose.pos.y, pose.pos.z);
      camLook.set(pose.look.x, pose.look.y, pose.look.z);
    },
    /** Draw one frame: pose the plane, chase it, pulse the markers. */
    draw(flight, aircraft, mission, cameraMode, time, dt) {
      // Plane pose.
      aircraft.pose(flight, time);

      // Camera: chase view sits behind and above the plane; the close view
      // (C) rides just behind the canopy, cockpit-style.
      const pose = chasePose(flight, cameraMode);
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
