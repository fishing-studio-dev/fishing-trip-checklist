// three.js view of the sea and the boat. Purely a view: it reads simulation
// state and never changes it (camera / view switches can't re-roll fish).
import * as THREE from 'three';
import { coastY } from '../core/sea.js';
import { PORT } from '../core/data.js';

const SEA_SIZE = 1600;
const SEG = 80;
const CELL = SEA_SIZE / SEG;

function lerpColor(stops, h) {
  if (h <= stops[0][0]) return new THREE.Color(stops[0][1]);
  for (let i = 0; i < stops.length - 1; i++) {
    const [h0, c0] = stops[i];
    const [h1, c1] = stops[i + 1];
    if (h >= h0 && h <= h1) return new THREE.Color(c0).lerp(new THREE.Color(c1), (h - h0) / (h1 - h0));
  }
  return new THREE.Color(stops[stops.length - 1][1]);
}
const SKY = [[4.5, 0x56618a], [5.2, 0xe8b08c], [6.5, 0xb9cfe0], [8, 0x9ccbe8], [14, 0x96c6e6], [15.5, 0xc9c0a8], [16.6, 0xec9b5c], [17.5, 0x3a3550]];
const SKY_TOP = [[4.5, 0x1e2c52], [5.4, 0x5577a8], [7, 0x3f7fc4], [15, 0x3f7fc4], [16.6, 0x4a5a8a], [17.5, 0x1e2244]];
const SEA_COL = [[4.5, 0x24405c], [5.5, 0x2d5672], [7, 0x1f6385], [15, 0x1d5a7a], [16.6, 0x3b4a5a]];

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 8000);
  scene.fog = new THREE.Fog(0x9ccbe8, 500, 3200);

  // sky dome: zenith colour fading to the fog/horizon colour (no seam at the horizon)
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color(0x4f86c6) }, horizon: { value: new THREE.Color(0x9ccbe8) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float h = clamp(vP.y * 2.2, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.7)), 1.0); }',
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(6000, 24, 12), skyMat);
  skyDome.renderOrder = -1;
  scene.add(skyDome);
  const hemi = new THREE.HemisphereLight(0xdcecff, 0x1d3b4c, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-300, 400, 200);
  scene.add(sun);

  // --- sea: a wave mesh that follows the camera on a fixed grid + far plane
  const seaGeo = new THREE.PlaneGeometry(SEA_SIZE, SEA_SIZE, SEG, SEG);
  seaGeo.rotateX(-Math.PI / 2);
  const base = seaGeo.attributes.position.array.slice();
  const seaMat = new THREE.MeshStandardMaterial({ color: 0x1d5a7a, roughness: 0.3, metalness: 0.1 });
  const sea = new THREE.Mesh(seaGeo, seaMat);
  scene.add(sea);
  const farGeo = new THREE.PlaneGeometry(30000, 30000);
  farGeo.rotateX(-Math.PI / 2);
  const far = new THREE.Mesh(farGeo, seaMat);
  far.position.y = -0.8;
  scene.add(far);

  scene.add(buildLand());
  let boat = buildBoat('skiff_1');
  scene.add(boat.group);
  const hlLines = [buildLine(), buildLine()];
  for (const l of hlLines) scene.add(l.obj);
  const trollLines = [buildLine(), buildLine(), buildLine(), buildLine()];
  for (const l of trollLines) scene.add(l.obj);
  const wake = buildWake(scene);
  const fishFx = [];
  const fishGeo = new THREE.SphereGeometry(1, 10, 8);
  const fishMat = new THREE.MeshStandardMaterial({ color: 0xc9d6dc, metalness: 0.7, roughness: 0.3 });

  const camPos = new THREE.Vector3(PORT.dock.x + 40, 20, -(PORT.dock.y + 120));
  const camLook = new THREE.Vector3(PORT.dock.x, 0, -PORT.dock.y);
  let lastWakeAt = 0;

  function waveH(x, z, t, amp) {
    return amp * (0.32 * Math.sin(0.045 * x + 0.9 * t) + 0.22 * Math.sin(0.061 * z - 1.1 * t + 1.0) + 0.1 * Math.sin(0.13 * (x + z) + 1.7 * t));
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  /**
   * state: { mode: 'port'|'sea', boat:{x,y,heading,speed}, gameTime, windSpeed,
   *          boatModel, reels:{starboard,port}, trollId,
   *          hlLines:[{station, active, depth}], trollLines:[{active, offset, len}],
   *          working, view: 'helm'|'deck', realTime, newLandings }
   */
  function render(st) {
    const rt = st.realTime;
    const hour = st.gameTime / 3600;
    const sky = lerpColor(SKY, hour);
    scene.background = sky;
    scene.fog.color.copy(sky);
    skyMat.uniforms.horizon.value.copy(sky);
    skyMat.uniforms.top.value.copy(lerpColor(SKY_TOP, hour));
    seaMat.color.copy(lerpColor(SEA_COL, hour));
    const dayK = Math.max(0.5, Math.min(1, Math.sin(((hour - 4.8) / 12.5) * Math.PI) * 1.4));
    sun.intensity = 1.7 * dayK;
    hemi.intensity = 0.55 + 0.6 * dayK;
    sun.color.copy(lerpColor([[5, 0xffb38a], [7.5, 0xffffff], [15, 0xffffff], [16.8, 0xffa060]], hour));

    if (st.boatModel && st.boatModel !== boat.modelId) {
      scene.remove(boat.group);
      boat = buildBoat(st.boatModel);
      scene.add(boat.group);
    }
    boat.setReels(st.reels || { starboard: 'reel_hand' });
    boat.setTroll(st.trollId || null);

    const amp = Math.min(1.6, 0.35 + (st.windSpeed || 3) / 6);
    // boat pose
    const bx = st.boat.x;
    const bz = -st.boat.y;
    const g = boat.group;
    g.position.set(bx, waveH(bx, bz, rt, amp) * 0.6, bz);
    g.rotation.set(0, 0, 0);
    g.rotation.y = -st.boat.heading;
    g.rotateX(0.04 * amp * Math.sin(rt * 1.3) - Math.min(0.08, Math.max(0, st.boat.speed) * 0.008));
    g.rotateZ(0.05 * amp * Math.sin(rt * 0.9 + 1));

    // camera
    const fwd = new THREE.Vector3(Math.sin(st.boat.heading), 0, -Math.cos(st.boat.heading));
    const right = new THREE.Vector3(Math.cos(st.boat.heading), 0, Math.sin(st.boat.heading));
    let wantPos;
    let wantLook;
    if (st.mode === 'port') {
      wantPos = new THREE.Vector3(bx + 34, 14, bz - 46);
      wantLook = new THREE.Vector3(bx - 10, 2, bz + 10);
    } else if (st.view === 'deck') {
      // over the fisherman's shoulder at the starboard station, looking at the line
      const dc = boat.cam.deck;
      wantPos = g.position.clone().add(right.clone().multiplyScalar(dc.right)).add(fwd.clone().multiplyScalar(dc.fwd)).add(new THREE.Vector3(0, dc.up, 0));
      wantLook = g.position.clone().add(right.clone().multiplyScalar(3.4)).add(fwd.clone().multiplyScalar(1.4)).add(new THREE.Vector3(0, -0.4, 0));
    } else {
      wantPos = g.position.clone().add(fwd.clone().multiplyScalar(-boat.cam.chase)).add(new THREE.Vector3(0, 10.5, 0)).add(right.clone().multiplyScalar(4));
      wantLook = g.position.clone().add(fwd.clone().multiplyScalar(22));
    }
    const k = st.snapCamera ? 1 : Math.min(1, (st.realDt || 0.016) * (st.view === 'deck' ? 10 : 4));
    camPos.lerp(wantPos, k);
    camLook.lerp(wantLook, k);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    skyDome.position.copy(camPos);
    const fov = st.mode === 'sea' && st.view === 'deck' ? 68 : 55;
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    // waves around the camera
    const sx = Math.round(camPos.x / CELL) * CELL;
    const sz = Math.round(camPos.z / CELL) * CELL;
    sea.position.set(sx, 0, sz);
    const pos = seaGeo.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) pos[i + 1] = waveH(base[i] + sx, base[i + 2] + sz, rt, amp);
    seaGeo.attributes.position.needsUpdate = true;
    seaGeo.computeVertexNormals();
    far.position.set(camPos.x, -0.8, camPos.z);

    // handlines from the rod tips straight down
    g.updateMatrixWorld(true);
    const mainStation = boat.stations.starboard;
    const tip = mainStation.tip.getWorldPosition(new THREE.Vector3());
    hlLines.forEach((obj, i) => {
      const spec = st.hlLines && st.hlLines[i];
      const station = spec && boat.stations[spec.station];
      if (!spec || !spec.active || !station) {
        obj.obj.visible = false;
        return;
      }
      const t = station.tip.getWorldPosition(new THREE.Vector3());
      obj.obj.visible = true;
      const p = obj.obj.geometry.attributes.position.array;
      p[0] = t.x; p[1] = t.y; p[2] = t.z;
      p[3] = t.x + (st.boat.vx || 0) * -0.6; p[4] = waveH(t.x, t.z, rt, amp) - Math.min(3, spec.depth * 0.08); p[5] = t.z - (st.boat.vy || 0) * -0.6;
      obj.obj.geometry.attributes.position.needsUpdate = true;
    });
    boat.animateWorker(rt, st.working);
    // trolling lines streaming astern (outer ones from the outriggers)
    trollLines.forEach((tlObj, i) => {
      const spec = st.trollLines && st.trollLines[i];
      if (!spec || !spec.active || !boat.trollTips[i]) {
        tlObj.obj.visible = false;
        return;
      }
      const tipW = boat.trollTips[i].tip.getWorldPosition(new THREE.Vector3());
      const back = Math.max(2, spec.len);
      const end = g.position.clone().add(fwd.clone().multiplyScalar(-back)).add(right.clone().multiplyScalar(spec.offset));
      const p = tlObj.obj.geometry.attributes.position.array;
      p[0] = tipW.x; p[1] = tipW.y; p[2] = tipW.z;
      p[3] = end.x; p[4] = waveH(end.x, end.z, rt, amp); p[5] = end.z;
      tlObj.obj.geometry.attributes.position.needsUpdate = true;
      tlObj.obj.visible = true;
    });

    // landed fish: arc from the water by the rod to the fish box
    for (const n of st.newLandings || []) {
      for (let i = 0; i < Math.min(5, n); i++) {
        const m = new THREE.Mesh(fishGeo, fishMat);
        m.scale.set(0.07, 0.06, 0.24);
        scene.add(m);
        fishFx.push({ m, born: rt + i * 0.18 });
      }
    }
    const box = boat.fishBox.getWorldPosition(new THREE.Vector3());
    for (let i = fishFx.length - 1; i >= 0; i--) {
      const f = fishFx[i];
      const u = (rt - f.born) / 0.9;
      if (u < 0) {
        f.m.visible = false;
        continue;
      }
      f.m.visible = true;
      if (u >= 1) {
        scene.remove(f.m);
        fishFx.splice(i, 1);
        continue;
      }
      const from = new THREE.Vector3(tip.x, 0, tip.z);
      f.m.position.lerpVectors(from, box, u);
      f.m.position.y += Math.sin(u * Math.PI) * 2.2;
      f.m.rotation.set(rt * 9, 0, u * 3);
    }

    // wake
    if (st.mode === 'sea' && Math.abs(st.boat.speed) > 1 && rt - lastWakeAt > 0.12) {
      lastWakeAt = rt;
      wake.spawn(g.position.clone().add(fwd.clone().multiplyScalar(-(boat.cam.half + 0.1))), rt, st.boat.speed);
    }
    wake.update(rt);

    renderer.render(scene, camera);
  }

  resize();
  return { render, resize, renderer };
}

function buildLand() {
  const group = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(-4000, -3000);
  for (let x = -4000; x <= 7000; x += 20) shape.lineTo(x, coastY(x));
  shape.lineTo(7000, -3000);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 6, bevelEnabled: false, steps: 1 });
  geo.rotateX(-Math.PI / 2);
  const land = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x6d8a58, roughness: 0.95, flatShading: true }));
  land.position.y = -1;
  group.add(land);
  // rocky beach band
  const beach = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x9a907a, roughness: 1 }));
  beach.scale.set(1, 0.4, 1);
  beach.position.set(0, -0.4, -6);
  group.add(beach);
  // hills
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x4f6e45, roughness: 1, flatShading: true });
  const hills = [[600, -350, 380, 160], [1150, -600, 420, 210], [2100, -420, 460, 190], [2900, -300, 320, 140], [-200, -500, 500, 230], [3600, -700, 600, 260]];
  for (const [x, y, r, h] of hills) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), hillMat);
    c.position.set(x, h / 2 - 2, -y);
    group.add(c);
  }
  // port: pier, market and houses
  const concrete = new THREE.MeshStandardMaterial({ color: 0xb8b8b0, roughness: 0.9 });
  const pier = new THREE.Mesh(new THREE.BoxGeometry(14, 2.2, 46), concrete);
  pier.position.set(PORT.dock.x - 12, 0.6, -(PORT.dock.y + 2));
  group.add(pier);
  const market = new THREE.Mesh(new THREE.BoxGeometry(40, 7, 18), new THREE.MeshStandardMaterial({ color: 0xd9d4c4 }));
  market.position.set(PORT.dock.x - 30, 8, -(coastY(PORT.dock.x - 30) - 18));
  group.add(market);
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x4a6f8a });
  const roof = new THREE.Mesh(new THREE.BoxGeometry(42, 1, 20), roofMat);
  roof.position.set(market.position.x, 12, market.position.z);
  group.add(roof);
  const houseCols = [0xe8e0d0, 0xc9b9a0, 0xf0f0ea, 0xb8c4c8];
  for (let i = 0; i < 14; i++) {
    const x = PORT.dock.x - 170 + i * 26 + (i % 3) * 5;
    const yb = coastY(x) - 30 - (i % 4) * 14;
    const hgt = 5 + (i % 3) * 2;
    const hmesh = new THREE.Mesh(new THREE.BoxGeometry(12, hgt, 10), new THREE.MeshStandardMaterial({ color: houseCols[i % 4] }));
    hmesh.position.set(x, 5 + hgt / 2, -yb);
    group.add(hmesh);
    const r = new THREE.Mesh(new THREE.ConeGeometry(9, 4, 4), new THREE.MeshStandardMaterial({ color: i % 2 ? 0x6b3b30 : 0x34495a }));
    r.rotation.y = Math.PI / 4;
    r.position.set(x, 5 + hgt + 2, -yb);
    group.add(r);
  }
  // lighthouse on a headland
  const lhX = 2350;
  const lh = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffffff }));
  lh.position.set(lhX, 13, -(coastY(lhX) - 12));
  group.add(lh);
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 2.5, 12), new THREE.MeshStandardMaterial({ color: 0xc0392b }));
  lamp.position.set(lhX, 22, lh.position.z);
  group.add(lamp);
  return group;
}

// Hull sizes per boat model (simple shapes; the bow points to -z, +x is starboard).
const HULLS = {
  skiff_1: { half: 3.75, beam: 1.15, depth: 1.15, house: [1.5, 1.4, 1.5], houseZ: 0.9, boot: 0x1f4f86, roof: 0x2f5d8a, deck: { right: -0.65, fwd: 0, up: 2.95 }, chase: 26 },
  cruiser_2: { half: 4.95, beam: 1.45, depth: 1.4, house: [2.0, 1.7, 2.2], houseZ: 1.3, boot: 0x8a2b26, roof: 0x3d6f4f, deck: { right: -0.9, fwd: 0.6, up: 3.3 }, chase: 31 },
};

function buildBoat(modelId = 'skiff_1') {
  const H = HULLS[modelId] || HULLS.skiff_1;
  const sz = H.half / 3.75;
  const sx = H.beam / 1.15;
  const group = new THREE.Group();
  const hullShape = new THREE.Shape();
  const pts = [[-1.05, -3.75], [1.05, -3.75], [1.15, -0.5], [0.85, 1.9], [0.35, 3.25], [0, 3.75], [-0.35, 3.25], [-0.85, 1.9], [-1.15, -0.5]].map(([x, z]) => [x * sx, z * sz]);
  hullShape.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) hullShape.lineTo(p[0], p[1]);
  hullShape.closePath();
  const hullGeo = new THREE.ExtrudeGeometry(hullShape, { depth: H.depth, bevelEnabled: false });
  hullGeo.rotateX(-Math.PI / 2);
  const white = new THREE.MeshStandardMaterial({ color: 0xf1f1ec, roughness: 0.55 });
  const hull = new THREE.Mesh(hullGeo, white);
  hull.position.y = -0.45;
  group.add(hull);
  const boot = new THREE.Mesh(hullGeo, new THREE.MeshStandardMaterial({ color: H.boot }));
  boot.scale.set(1.025, 0.22, 1.01);
  boot.position.y = -0.47;
  group.add(boot);
  const deckY = H.depth - 0.53;
  const deckGeo = new THREE.ShapeGeometry(hullShape);
  deckGeo.rotateX(-Math.PI / 2);
  const deck = new THREE.Mesh(deckGeo, new THREE.MeshStandardMaterial({ color: 0xb98d5f, roughness: 0.9 }));
  deck.scale.set(0.9, 1, 0.94);
  deck.position.y = deckY;
  group.add(deck);
  // wheelhouse (slightly aft of centre)
  const [hw, hh, hd] = H.house;
  const house = new THREE.Mesh(new THREE.BoxGeometry(hw, hh, hd), white);
  house.position.set(0, deckY + hh / 2, H.houseZ);
  group.add(house);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(hw * 0.86, 0.5, 0.05), new THREE.MeshStandardMaterial({ color: 0x223344, metalness: 0.5, roughness: 0.2 }));
  glass.position.set(0, deckY + hh * 0.78, H.houseZ - hd / 2 - 0.02);
  group.add(glass);
  const roofY = deckY + hh + 0.05;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(hw + 0.25, 0.1, hd + 0.25), new THREE.MeshStandardMaterial({ color: H.roof }));
  roof.position.set(0, roofY, H.houseZ);
  group.add(roof);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.0), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
  mast.position.set(0, roofY + 1.0, H.houseZ + hd * 0.25);
  group.add(mast);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.32), new THREE.MeshStandardMaterial({ color: 0xd94b3d, side: THREE.DoubleSide }));
  flag.position.set(0.26, roofY + 1.8, H.houseZ + hd * 0.25);
  group.add(flag);
  // fish box (魚倉) at the stern
  const fishBox = new THREE.Mesh(new THREE.BoxGeometry(0.9 * sx, 0.5, 0.65 * sz), new THREE.MeshStandardMaterial({ color: 0x3d7fb8 }));
  fishBox.position.set(-0.2, deckY + 0.28, 2.6 * sz);
  group.add(fishBox);

  // reel stations: starboard always, port on boats that have one
  const stations = {};
  for (const [name, side] of [['starboard', 1], ['port', -1]]) {
    if (name === 'port' && modelId !== 'cruiser_2') continue;
    const rod = new THREE.Group();
    rod.position.set(side * (H.beam - 0.2), deckY + 0.33, -0.9 * sz);
    const rodMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.035, 2.6), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    rodMesh.position.y = 1.3;
    rod.add(rodMesh);
    rod.rotation.z = -side * 1.05;
    group.add(rod);
    const tip = new THREE.Object3D();
    tip.position.y = 2.6;
    rod.add(tip);
    const handReel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.09, 16), new THREE.MeshStandardMaterial({ color: 0x555b60, metalness: 0.6 }));
    handReel.rotation.z = Math.PI / 2;
    handReel.position.set(0, 0.25, 0.08);
    rod.add(handReel);
    const eReel = new THREE.Group();
    const eBody = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.18, 0.22), new THREE.MeshStandardMaterial({ color: 0xd8342c, metalness: 0.3, roughness: 0.4 }));
    eReel.add(eBody);
    const eDrum = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.26, 12), new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.8 }));
    eDrum.rotation.z = Math.PI / 2;
    eDrum.position.y = 0.11;
    eReel.add(eDrum);
    eReel.position.set(0, 0.3, 0.12);
    rod.add(eReel);
    stations[name] = { rod, tip, handReel, eReel, side };
  }

  // the fisherman (player character) between the stations
  const worker = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.95, 10), new THREE.MeshStandardMaterial({ color: 0x3e6b8c }));
  body.position.y = 0.48;
  worker.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), new THREE.MeshStandardMaterial({ color: 0xe0b48f }));
  head.position.y = 1.08;
  worker.add(head);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.09, 12), new THREE.MeshStandardMaterial({ color: 0xf3f3f3 }));
  cap.position.y = 1.2;
  worker.add(cap);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.55), new THREE.MeshStandardMaterial({ color: 0x3e6b8c }));
  arm.position.set(0.18, 0.7, -0.22);
  worker.add(arm);
  worker.position.set(modelId === 'cruiser_2' ? 0.2 : 0.45, deckY, -0.55 * sz);
  group.add(worker);

  // stern trolling rods, plus outriggers for the four-line gear
  const trollGroup = new THREE.Group();
  const outGroup = new THREE.Group();
  const trollTips = [];
  for (const side of [-1, 1]) {
    const r = new THREE.Group();
    r.position.set(side * (H.beam - 0.3), deckY + 0.28, 3.2 * sz);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.04, 3.2), new THREE.MeshStandardMaterial({ color: 0x2a2a2a }));
    m.position.y = 1.6;
    r.add(m);
    r.rotation.z = -side * 0.75;
    r.rotation.x = 0.55;
    const tip = new THREE.Object3D();
    tip.position.y = 3.2;
    r.add(tip);
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.32), new THREE.MeshStandardMaterial({ color: 0xe0e040 }));
    board.position.set(0, 0.4, 0.15);
    r.add(board);
    trollGroup.add(r);
    trollTips.push({ side, tip });
  }
  for (const side of [-1, 1]) {
    const o = new THREE.Group();
    o.position.set(side * (hw / 2), roofY, H.houseZ);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 7.5), new THREE.MeshStandardMaterial({ color: 0xbfc6c9, metalness: 0.5 }));
    pole.position.y = 3.75;
    o.add(pole);
    o.rotation.z = -side * 1.15;
    const tip = new THREE.Object3D();
    tip.position.y = 7.5;
    o.add(tip);
    outGroup.add(o);
    trollTips.push({ side, tip });
  }
  group.add(trollGroup);
  group.add(outGroup);

  function setTroll(itemId) {
    trollGroup.visible = !!itemId;
    outGroup.visible = itemId === 'troll_tr2';
  }
  /** reels: { starboard: itemId|null, port: itemId|null } */
  function setReels(reels) {
    for (const [name, st] of Object.entries(stations)) {
      const id = reels[name];
      st.rod.visible = !!id;
      st.eReel.visible = id === 'reel_electric';
      st.handReel.visible = id === 'reel_hand';
    }
  }
  function animateWorker(rt, working) {
    if (working === 'retrieve') {
      worker.rotation.x = 0.12 * Math.sin(rt * 8);
      arm.rotation.x = 0.6 * Math.sin(rt * 8);
    } else if (working === 'unhook' || working === 'prep') {
      worker.rotation.x = 0.25;
      arm.rotation.x = 0.3 * Math.sin(rt * 5);
    } else {
      worker.rotation.x = 0.03 * Math.sin(rt);
      arm.rotation.x = 0;
    }
  }
  setTroll(null);
  setReels({ starboard: 'reel_hand' });
  return { group, modelId, stations, fishBox, setReels, animateWorker, setTroll, trollTips, cam: H };
}

function buildLine() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const obj = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xf5f5f5, transparent: true, opacity: 0.85 }));
  obj.frustumCulled = false;
  obj.visible = false;
  return { obj };
}

function buildWake(scene) {
  const geo = new THREE.CircleGeometry(1, 16);
  geo.rotateX(-Math.PI / 2);
  const items = [];
  for (let i = 0; i < 40; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false;
    scene.add(m);
    items.push({ m, born: -1e9, sp: 0 });
  }
  let next = 0;
  return {
    spawn(p, rt, sp) {
      const it = items[next];
      next = (next + 1) % items.length;
      it.m.position.set(p.x, 0.35, p.z);
      it.born = rt;
      it.sp = sp;
      it.m.visible = true;
    },
    update(rt) {
      for (const it of items) {
        const age = rt - it.born;
        if (age > 3.5) {
          it.m.visible = false;
          continue;
        }
        const s = 1 + age * (0.6 + it.sp * 0.12);
        it.m.scale.set(s, 1, s);
        it.m.material.opacity = 0.55 * (1 - age / 3.5);
      }
    },
  };
}
