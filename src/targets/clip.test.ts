import assert from "node:assert/strict";
import { test } from "node:test";
import { film, plan, shotOf, type Beat } from "./clip.ts";

const size = { width: 1920, height: 1080 };
const beat = (t: number, x: number, y: number): Beat => ({ t, kind: "click", x, y, rect: { x: x - 60, y: y - 20, width: 120, height: 40 } });

test("the camera is on each element by the time it's clicked, however close the clicks are", () => {
  // Far apart and quick in succession: the worst case for a camera that eases in.
  const beats = [beat(1, 300, 200), beat(1.9, 1600, 900), beat(2.6, 1500, 850), beat(5, 200, 950)];
  const fps = 25;
  const shots = film(plan(beats, undefined, 7, size), 8 * fps, size);
  for (const b of beats) {
    const cam = shots[Math.round(b.t * fps)]!;
    const want = shotOf(b.rect, 1.8, size);
    const inView = Math.abs(b.x - cam.x) < size.width / (2 * cam.z) && Math.abs(b.y - cam.y) < size.height / (2 * cam.z);
    assert.ok(inView, `click at ${b.t}s is off screen`);
    assert.ok(Math.abs(cam.z - want.z) < 0.05 && Math.hypot(cam.x - want.x, cam.y - want.y) < 20, `camera still moving at ${b.t}s`);
  }
});
