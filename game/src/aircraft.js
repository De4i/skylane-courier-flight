// The courier plane, built from three.js geometry only: a rounded
// fuselage, tapered wings, tail fin and stabilisers, a spinning two-blade
// propeller, a glass canopy and red/green navigation lights. She faces +X
// (the runway heading), so the flight model's heading maps straight onto
// the mesh rotation.

import { PALETTE } from './config.js';

const THREE = window.THREE;

function mat(colour, opts = {}) {
  return new THREE.MeshLambertMaterial({ color: colour, ...opts });
}

export function createAircraft() {
  const group = new THREE.Group();
  const fuselageMat = mat(PALETTE.fuselage);
  const darkMat = mat(PALETTE.fuselageDark);
  const wingMat = mat(PALETTE.wing);
  const tailMat = mat(PALETTE.tail);

  // Fuselage: a cylinder along X with a rounded nose and a tapered tail.
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.05, 7.4, 10), fuselageMat);
  body.rotation.z = Math.PI / 2;
  group.add(body);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(1.25, 10, 8), fuselageMat);
  nose.scale.set(1.5, 1, 1);
  nose.position.x = 3.7;
  group.add(nose);
  const tailCone = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 0.28, 3.4, 8), darkMat);
  tailCone.rotation.z = Math.PI / 2;
  tailCone.position.x = -5.3;
  group.add(tailCone);

  // Belly stripe so the plane reads from below as well as above.
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(1.28, 1.08, 7.0, 10, 1, true, 0, Math.PI), tailMat);
  stripe.rotation.z = Math.PI / 2;
  stripe.rotation.x = Math.PI / 2;
  stripe.position.y = -0.05;
  group.add(stripe);

  // Main wings: a wide flat box, slightly swept by tapering the tips with
  // a second smaller box; plus a small dihedral lift.
  const wing = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.22, 15.5), wingMat);
  wing.position.set(0.4, -0.35, 0);
  wing.rotation.x = 0.06;
  group.add(wing);
  for (const side of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.18, 1.1), tailMat);
    tip.position.set(0.4, -0.3, side * 7.6);
    group.add(tip);
    // Navigation lights: red on the left (port), green on the right.
    const nav = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 8, 6),
      new THREE.MeshBasicMaterial({ color: side < 0 ? 0xff2a2a : 0x2aff66 }),
    );
    nav.position.set(0.4, -0.25, side * 8.1);
    nav.name = side < 0 ? 'navPort' : 'navStarboard';
    group.add(nav);
  }

  // Tail: vertical fin and horizontal stabilisers.
  const fin = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 0.22), tailMat);
  fin.position.set(-6.2, 1.35, 0);
  fin.rotation.z = 0.35;
  group.add(fin);
  const stab = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.16, 5.4), wingMat);
  stab.position.set(-6.0, 0.35, 0);
  group.add(stab);

  // Canopy: a dark glass half-dome over the cockpit.
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(1.05, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: PALETTE.canopy }),
  );
  canopy.scale.set(2.0, 0.85, 1.05);
  canopy.position.set(1.5, 0.85, 0);
  group.add(canopy);

  // Propeller: hub plus two blades on the nose, spinning around X.
  const prop = new THREE.Group();
  const hub = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.1, 8), mat(PALETTE.prop));
  hub.rotation.z = -Math.PI / 2;
  hub.position.x = 0.4;
  prop.add(hub);
  for (const side of [-1, 1]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 4.6, 0.55), mat(PALETTE.prop));
    blade.position.set(0, side * 2.3, 0);
    blade.rotation.x = 0.35;
    prop.add(blade);
  }
  prop.position.set(5.3, 0, 0);
  group.add(prop);

  // Landing skids: two small struts so she sits on the runway believably.
  for (const side of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.4, 5), mat(0x222222));
    strut.position.set(1.2, -1.5, side * 1.1);
    group.add(strut);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.4, 8), mat(0x181818));
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(1.2, -2.1, side * 1.1);
    group.add(wheel);
  }

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
      // Propeller spins faster with speed; nav lights blink.
      const spin = 6 + flight.speedKt * 0.55 + flight.throttle * 14;
      prop.rotation.x += spin * (1 / 60);
      const blink = Math.sin(time * 4) > 0;
      const port = group.getObjectByName('navPort');
      const starboard = group.getObjectByName('navStarboard');
      if (port) port.visible = blink;
      if (starboard) starboard.visible = !blink;
    },
  };
}
