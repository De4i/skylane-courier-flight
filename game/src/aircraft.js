// The courier plane, built from three.js geometry only: a smooth lathed
// fuselage in a two-tone cream-and-teal livery with cheatline stripes,
// a glass canopy, tapered extruded wings with dihedral and rounded tips,
// an extruded tailplane and fin, a spinning propeller with a translucent
// blur disc, and proper landing gear with wheels. She faces +X (the
// runway heading), so the flight model's heading maps straight onto the
// mesh rotation. Overall size matches the old plane (span ~15.5 m,
// length ~11.5 m) so the chase camera framing still holds.

import { PALETTE } from './config.js';

const THREE = window.THREE;

function phong(colour, shininess = 70) {
  return new THREE.MeshPhongMaterial({ color: colour, shininess });
}

function lambert(colour) {
  return new THREE.MeshLambertMaterial({ color: colour });
}

/** A tapered wing planform: rounded leading edge, thin trailing edge. */
function wingShape(chord, thickness) {
  const s = new THREE.Shape();
  const h = thickness / 2;
  s.moveTo(-chord * 0.52, 0);
  s.quadraticCurveTo(-chord * 0.58, h, -chord * 0.38, h);
  s.lineTo(chord * 0.34, h * 0.9);
  s.quadraticCurveTo(chord * 0.52, h * 0.7, chord * 0.52, 0);
  s.quadraticCurveTo(chord * 0.52, -h * 0.7, chord * 0.34, -h * 0.9);
  s.lineTo(-chord * 0.38, -h);
  s.quadraticCurveTo(-chord * 0.58, -h, -chord * 0.52, 0);
  return s;
}

export function createAircraft() {
  const group = new THREE.Group();
  const creamMat = phong(PALETTE.fuselage, 80);
  const tealMat = phong(PALETTE.teal, 60);
  const orangeMat = phong(PALETTE.tail, 60);
  const wingMat = phong(PALETTE.wing, 80);
  const darkMat = lambert(0x222222);

  // Fuselage: a lathe profile — slim tail, full belly, rounded nose.
  const profile = [
    [0.22, -6.6], [0.55, -5.8], [0.85, -4.6], [1.05, -3.2],
    [1.22, -1.4], [1.28, 0.2], [1.22, 1.8], [1.0, 3.0],
    [0.62, 3.9], [0.22, 4.45], [0.02, 4.6],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 16), creamMat);
  body.rotation.z = -Math.PI / 2; // lathe axis Y -> fuselage axis X (nose +X)
  body.castShadow = true;
  group.add(body);
  // Orange tail cone and nose tip.
  const tailCone = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.6, 10), orangeMat);
  tailCone.rotation.z = Math.PI / 2;
  tailCone.position.x = -6.9;
  tailCone.castShadow = true;
  group.add(tailCone);
  const noseTip = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), orangeMat);
  noseTip.scale.set(1.4, 1, 1);
  noseTip.position.x = 4.55;
  group.add(noseTip);

  // Cheatline stripes: teal bands along both flanks of the fuselage.
  for (const side of [-1, 1]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.5, 0.14), tealMat);
    stripe.position.set(0.1, 0.15, side * 1.24);
    group.add(stripe);
    const stripeLow = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.22, 0.14), orangeMat);
    stripeLow.position.set(0.1, -0.32, side * 1.22);
    group.add(stripeLow);
  }
  // Teal belly so she reads from below too.
  const belly = new THREE.Mesh(new THREE.CylinderGeometry(1.29, 1.29, 5.6, 12, 1, true, Math.PI * 1.15, Math.PI * 0.7), tealMat);
  belly.rotation.z = Math.PI / 2;
  belly.rotation.x = Math.PI;
  belly.position.set(0.1, 0, 0);
  group.add(belly);

  // Main wings: extruded tapered planforms with a gentle dihedral.
  const wingGeo = new THREE.ExtrudeGeometry(wingShape(4.6, 0.42), { depth: 7.3, bevelEnabled: false });
  // Port half: the same extrusion shifted to -Z (a negative scale would
  // flip the winding and turn the wing inside-out).
  const wingGeoPort = wingGeo.clone();
  wingGeoPort.translate(0, 0, -7.3);
  for (const side of [-1, 1]) {
    const wingHalf = new THREE.Mesh(side > 0 ? wingGeo : wingGeoPort, wingMat);
    wingHalf.position.set(0.35, -0.35, side * 0.4);
    wingHalf.rotation.x = side * -0.07; // dihedral: tips rise
    wingHalf.castShadow = true;
    group.add(wingHalf);
    // Rounded wingtip cap in the livery orange.
    const tip = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.34, 0.7), orangeMat);
    tip.position.set(0.35, -0.35 + side * 0.07 * 7.3 * 0.5, side * 7.85);
    tip.rotation.x = side * -0.07;
    tip.castShadow = true;
    group.add(tip);
    // Navigation lights: red on the left (port), green on the right.
    const nav = new THREE.Mesh(
      new THREE.SphereGeometry(0.36, 8, 6),
      new THREE.MeshBasicMaterial({ color: side < 0 ? 0xff2a2a : 0x2aff66 }),
    );
    nav.position.set(0.35, -0.28, side * 8.25);
    nav.name = side < 0 ? 'navPort' : 'navStarboard';
    group.add(nav);
  }

  // Tail: extruded stabiliser and a swept vertical fin.
  const stabGeo = new THREE.ExtrudeGeometry(wingShape(2.6, 0.3), { depth: 2.6, bevelEnabled: false });
  const stabGeoPort = stabGeo.clone();
  stabGeoPort.translate(0, 0, -2.6);
  for (const side of [-1, 1]) {
    const stab = new THREE.Mesh(side > 0 ? stabGeo : stabGeoPort, wingMat);
    stab.position.set(-5.9, 0.35, side * 0.2);
    stab.castShadow = true;
    group.add(stab);
  }
  const finShape = new THREE.Shape();
  finShape.moveTo(-1.5, 0);
  finShape.lineTo(1.2, 0);
  finShape.quadraticCurveTo(1.5, 0.4, 0.9, 2.6);
  finShape.quadraticCurveTo(0.8, 3.0, 0.3, 3.0);
  finShape.lineTo(-1.1, 0.9);
  finShape.quadraticCurveTo(-1.6, 0.5, -1.5, 0);
  const fin = new THREE.Mesh(new THREE.ExtrudeGeometry(finShape, { depth: 0.24, bevelEnabled: false }), orangeMat);
  // 0.72 scale: the full-size fin was a huge orange triangle that
  // dominated the whole plane silhouette in the chase view.
  fin.scale.set(0.72, 0.72, 1);
  fin.position.set(-6.3, 0.6, -0.12);
  fin.rotation.z = 0.12;
  fin.castShadow = true;
  group.add(fin);
  // White tail strobe.
  const strobe = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  strobe.position.set(-7.6, 1.1, 0);
  strobe.name = 'strobe';
  group.add(strobe);

  // Canopy: dark glass, transparent and glossy, over the cockpit.
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(1.05, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshPhongMaterial({
      color: PALETTE.canopy, transparent: true, opacity: 0.62,
      shininess: 140, specular: 0xffffff,
    }),
  );
  canopy.scale.set(2.1, 0.85, 1.05);
  canopy.position.set(1.5, 0.8, 0);
  group.add(canopy);

  // Propeller: spinner cone, two dark blades, and a translucent blur
  // disc so the spinning prop reads as a disc, never a single stick.
  const prop = new THREE.Group();
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.2, 10), orangeMat);
  spinner.rotation.z = -Math.PI / 2;
  spinner.position.x = 0.5;
  prop.add(spinner);
  // Blades are pale grey, not near-black: a dark blade frozen mid-spin
  // reads as a stick across the fuselage from the chase camera, which is
  // exactly the look this overhaul is removing. The disc does the work.
  const bladeMat = new THREE.MeshLambertMaterial({ color: 0x8b98a5 });
  for (const side of [-1, 1]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 5.4, 0.45), bladeMat);
    blade.position.set(0, side * 2.7, 0);
    blade.rotation.x = 0.35;
    blade.castShadow = true;
    prop.add(blade);
  }
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(3.0, 28),
    new THREE.MeshBasicMaterial({
      // Mid grey-blue, not near-white: edge-on from the chase camera the
      // disc is a thin line below the nose, and a bright line reads as
      // the old prop stick. Faint is correct for a spinning prop.
      color: 0x7d99ad, transparent: true, opacity: 0.12,
      side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  // The disc must lie in the YZ plane (facing forward, +X): CircleGeometry
  // is born in the XY plane, and unrotated it spins with the prop group
  // into a plane that contains the X axis — seen from the chase camera
  // it projects to a single vertical white stick below the nose, which
  // is exactly the stick the overhaul was supposed to remove.
  disc.rotation.y = Math.PI / 2;
  disc.position.x = 0.55;
  disc.name = 'propDisc';
  prop.add(disc);
  prop.position.set(4.9, 0, 0);
  group.add(prop);

  // Landing gear: struts with wheels (tyre + hub) under the wings, and a
  // small tail wheel.
  for (const side of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.5, 6), darkMat);
    strut.position.set(1.1, -1.55, side * 1.15);
    group.add(strut);
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.42, 12), lambert(0x181818));
    tyre.rotation.x = Math.PI / 2;
    tyre.position.set(1.1, -2.25, side * 1.15);
    tyre.castShadow = true;
    group.add(tyre);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.46, 8), creamMat);
    hub.rotation.x = Math.PI / 2;
    hub.position.set(1.1, -2.25, side * 1.15);
    group.add(hub);
  }
  const tailStrut = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.0, 5), darkMat);
  tailStrut.position.set(-5.6, -1.1, 0);
  group.add(tailStrut);
  const tailWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.26, 8), lambert(0x181818));
  tailWheel.rotation.x = Math.PI / 2;
  tailWheel.position.set(-5.6, -1.55, 0);
  group.add(tailWheel);

  // The mesh faces +X; three.js rotation order YXZ lets heading (yaw),
  // pitch and bank compose the way a plane actually moves.
  group.rotation.order = 'YXZ';

  return {
    group,
    prop,
    /** Place and pose the mesh from flight state. */
    pose(flight, time) {
      group.position.set(flight.x, flight.y, flight.z);
      // Heading 0 = +X; a three.js yaw of -heading turns +X toward +Z the
      // same way the flight model does (forward = cos h, 0, sin h).
      group.rotation.y = -flight.heading;
      group.rotation.x = flight.pitch;
      group.rotation.z = -flight.bank;
      // Propeller spins faster with speed; nav lights blink, strobe flashes.
      const spin = 6 + flight.speedKt * 0.55 + flight.throttle * 14;
      prop.rotation.x += spin * (1 / 60);
      const blink = Math.sin(time * 4) > 0;
      const port = group.getObjectByName('navPort');
      const starboard = group.getObjectByName('navStarboard');
      if (port) port.visible = blink;
      if (starboard) starboard.visible = !blink;
      const strobeMesh = group.getObjectByName('strobe');
      if (strobeMesh) strobeMesh.visible = Math.sin(time * 6) > 0.85;
      // The blur disc only reads while the prop is turning.
      const discMesh = group.getObjectByName('propDisc');
      if (discMesh) discMesh.material.opacity = flight.throttle > 0.05 ? 0.12 : 0.06;
    },
  };
}
