import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = fs.readFileSync("assets/js/network-scene.js", "utf8");

function environment({
  reduce = false,
  saveData = false,
  available = true,
  link = true,
} = {}) {
  const element = () => ({
    events: {},
    hidden: true,
    textContent: "",
    attributes: {},
    addEventListener(name, fn) {
      this.events[name] = fn;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    classList: {
      values: new Set(),
      add(v) {
        this.values.add(v);
      },
      remove(v) {
        this.values.delete(v);
      },
    },
    getBoundingClientRect: () => ({ width: 360, height: 333, top: 0, left: 0 }),
  });
  const stage = element(),
    canvas = element(),
    pause = element(),
    rotate = element(),
    controls = element();
  const media = {
    matches: reduce,
    addEventListener(_, fn) {
      this.change = fn;
    },
  };
  const colors = {
    matches: false,
    addEventListener(_, fn) {
      this.change = fn;
    },
  };
  const connection = {
    saveData,
    addEventListener(_, fn) {
      this.change = fn;
    },
  };
  let draws = 0,
    contexts = 0,
    uploads = 0,
    observation;
  const noop = () => {};
  const gl = new Proxy(
    {
      LINK_STATUS: 1,
      MAX_VIEWPORT_DIMS: 2,
      NO_ERROR: 0,
      getProgramParameter: () => link,
      getParameter: () => [4096, 4096],
      getError: () => 0,
      createProgram: () => ({}),
      createShader: () => ({}),
      createBuffer: () => ({}),
      getAttribLocation: () => 0,
      getUniformLocation: () => ({}),
      bufferData(_, data) {
        assert.ok(data.length > 0);
        assert.ok(
          Array.from(data).every(Number.isFinite),
          "Geometry contains only finite coordinates",
        );
        uploads++;
      },
      drawArrays: () => {
        draws++;
      },
    },
    { get: (target, key) => target[key] ?? noop },
  );
  canvas.getContext = () => {
    contexts++;
    return available ? gl : null;
  };
  const document = {
    hidden: false,
    events: {},
    getElementById: (id) =>
      ({
        "network-scene": stage,
        "network-canvas": canvas,
        "scene-pause": pause,
        "scene-rotate": rotate,
      })[id],
    querySelector: () => controls,
    addEventListener(name, fn) {
      this.events[name] = fn;
    },
  };
  const jobs = new Map();
  let id = 0,
    time = 0;
  const context = {
    document,
    navigator: { connection },
    matchMedia: (query) => (query.includes("reduced-motion") ? media : colors),
    requestAnimationFrame(fn) {
      jobs.set(++id, fn);
      return id;
    },
    cancelAnimationFrame(key) {
      jobs.delete(key);
    },
    IntersectionObserver: class {
      constructor(fn) {
        observation = fn;
      }
      observe() {}
    },
    ResizeObserver: class {
      observe() {}
    },
    devicePixelRatio: 3,
    addEventListener: noop,
  };
  context.window = context;
  vm.runInNewContext(source, context);
  return {
    stage,
    canvas,
    pause,
    rotate,
    controls,
    document,
    media,
    colors,
    connection,
    get draws() {
      return draws;
    },
    get contexts() {
      return contexts;
    },
    get uploads() {
      return uploads;
    },
    get pending() {
      return jobs.size;
    },
    observe(visible) {
      observation([{ isIntersecting: visible }]);
    },
    step() {
      time += 40;
      const current = [...jobs.values()];
      jobs.clear();
      current.forEach((fn) => fn(time));
    },
  };
}

test("3D initializes only when visible and uses bounded resolution", () => {
  const env = environment();
  assert.equal(env.contexts, 0);
  env.observe(true);
  env.step();
  assert.equal(env.contexts, 1);
  assert.equal(env.canvas.width, 540);
  assert.ok(env.draws > 0);
  assert.ok(env.stage.classList.values.has("scene-ready"));
  assert.equal(env.controls.hidden, false);
  const uploads = env.uploads;
  env.step();
  assert.equal(env.uploads, uploads, "Geometry is not re-uploaded per frame");
});
test("missing WebGL keeps the HTML fallback and hides inactive controls", () => {
  const env = environment({ available: false });
  env.observe(true);
  env.step();
  assert.equal(env.pending, 0);
  assert.equal(env.controls.hidden, true);
  assert.equal(env.stage.classList.values.has("scene-ready"), false);
});
test("shader failure falls back without an animation loop", () => {
  const env = environment({ link: false });
  env.observe(true);
  env.step();
  assert.equal(env.pending, 0);
  assert.equal(env.controls.hidden, true);
});
for (const setting of ["reduce", "saveData"]) {
  test(`${setting} starts with one static frame; rotation remains available`, () => {
    const env = environment({ [setting]: true });
    env.observe(true);
    env.step();
    assert.equal(env.pending, 0);
    assert.equal(env.pause.textContent, "Animar");
    const before = env.draws;
    env.rotate.events.click();
    env.step();
    assert.ok(env.draws > before);
    assert.equal(env.pending, 0);
  });
}
test("pause and resume are keyboard-compatible native button actions", () => {
  const env = environment();
  env.observe(true);
  env.step();
  env.pause.events.click();
  env.step();
  assert.equal(env.pending, 0);
  assert.equal(env.pause.textContent, "Animar");
  env.pause.events.click();
  env.step();
  assert.equal(env.pending, 1);
  assert.equal(env.pause.textContent, "Pausar");
});
test("offscreen and hidden tabs suspend rendering, then resume", () => {
  const env = environment();
  env.observe(true);
  env.step();
  env.observe(false);
  assert.equal(env.pending, 0);
  env.observe(true);
  env.step();
  env.document.hidden = true;
  env.document.events.visibilitychange();
  assert.equal(env.pending, 0);
  env.document.hidden = false;
  env.document.events.visibilitychange();
  env.step();
  assert.equal(env.pending, 1);
});
test("a change to reduced motion stops an active animation", () => {
  const env = environment();
  env.observe(true);
  env.step();
  env.media.matches = true;
  env.media.change();
  env.step();
  assert.equal(env.pending, 0);
  assert.equal(env.pause.textContent, "Animar");
});
test("context loss shows fallback and restoration recreates resources", () => {
  const env = environment();
  env.observe(true);
  env.step();
  let prevented = false;
  env.canvas.events.webglcontextlost({
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(env.pending, 0);
  assert.equal(env.controls.hidden, true);
  env.canvas.events.webglcontextrestored();
  env.step();
  assert.equal(env.contexts, 2);
  assert.equal(env.controls.hidden, false);
});
test("forced colors avoids allocating a WebGL context", () => {
  const env = environment();
  env.colors.matches = true;
  env.observe(true);
  assert.equal(env.contexts, 0);
  assert.equal(env.pending, 0);
});
