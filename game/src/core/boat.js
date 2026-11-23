// Boat motion: manual helm, drift from tide + wind, simple autopilot for
// "帰港" and "流し直し" (movement assistance only — it never searches for fish).
import { AREA, PORT } from './data.js';
import { isLand, currentAt, windAt } from './sea.js';

export function createBoatRuntime(model, x, y, heading) {
  return {
    x,
    y,
    heading, // rad, 0 = north, clockwise
    speed: 0, // m/s through water (forward)
    throttle: 1, // index into model.speeds (1 = stop)
    rudder: 0, // -1..1 (input)
    vx: 0,
    vy: 0,
    distance: 0, // m travelled under power
    grounded: false,
    outOfBounds: false,
  };
}

export function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Steering toward a target point; returns {rudder, throttle, arrived}. */
export function autopilotCommand(boat, model, target, slowRadius = 120, arriveRadius = 15) {
  const dx = target.x - boat.x;
  const dy = target.y - boat.y;
  const dist = Math.hypot(dx, dy);
  if (dist < arriveRadius) return { rudder: 0, throttle: 1, arrived: true, dist };
  const want = Math.atan2(dx, dy);
  const err = wrapAngle(want - boat.heading);
  const rudder = Math.max(-1, Math.min(1, err * 2.2));
  let throttle = 4;
  if (dist < slowRadius) throttle = 3;
  if (dist < slowRadius * 0.4) throttle = 2;
  if (Math.abs(err) > 1.2) throttle = Math.min(throttle, 2);
  return { rudder, throttle, arrived: false, dist };
}

/** True if a straight run between two sea points stays off land. */
export function clearPath(a, b) {
  const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 20);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (isLand(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
  }
  return true;
}

/** Waypoints for an assisted return to the dock. */
export function routeToPort(from) {
  const pts = [];
  if (!clearPath(from, PORT.entrance)) pts.push({ x: from.x, y: Math.max(from.y, 450) });
  pts.push({ x: PORT.entrance.x, y: PORT.entrance.y });
  pts.push({ x: PORT.dock.x, y: PORT.dock.y + 20 });
  return pts;
}

/**
 * Advance boat by dt game seconds.
 * `mode`: 'manual' | 'drift' (engine idle while fishing) | 'docked'
 */
export function stepBoat(boat, model, cond, t, dt, mode) {
  if (mode === 'docked') {
    boat.speed = 0;
    boat.vx = 0;
    boat.vy = 0;
    return;
  }
  const target = mode === 'drift' ? 0 : model.speeds[boat.throttle];
  boat.speed += (target - boat.speed) * Math.min(1, dt * model.accel);
  if (Math.abs(boat.speed) < 0.01 && target === 0) boat.speed = 0;
  const turnFactor = Math.max(0.15, Math.min(1, Math.abs(boat.speed) / 3));
  const rudder = mode === 'drift' ? 0 : boat.rudder;
  boat.heading = wrapAngle(boat.heading + rudder * model.maxTurn * turnFactor * dt * Math.sign(boat.speed || 1));
  const c = currentAt(cond, t);
  const w = windAt(cond, t);
  const vx = Math.sin(boat.heading) * boat.speed + c.x + w.x * model.windage;
  const vy = Math.cos(boat.heading) * boat.speed + c.y + w.y * model.windage;
  const nx = boat.x + vx * dt;
  const ny = boat.y + vy * dt;
  boat.grounded = false;
  boat.outOfBounds = false;
  if (isLand(nx, ny)) {
    boat.grounded = true;
    boat.speed = 0;
    boat.vx = 0;
    boat.vy = 0;
    return;
  }
  const m = 20;
  boat.x = Math.max(m, Math.min(AREA.W - m, nx));
  boat.y = Math.max(m, Math.min(AREA.H - m, ny));
  if (boat.x !== nx || boat.y !== ny) boat.outOfBounds = true;
  boat.vx = vx;
  boat.vy = vy;
  if (mode !== 'drift') boat.distance += Math.abs(boat.speed) * dt;
}
