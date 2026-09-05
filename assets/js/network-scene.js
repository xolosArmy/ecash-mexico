/* Decorative WebGL enhancement. All content and navigation live in the HTML. */
(() => {
  "use strict";

  const stage = document.getElementById("network-scene");
  const canvas = document.getElementById("network-canvas");
  if (!stage || !canvas) return;

  const controls = document.querySelector(".scene-controls");
  const pauseButton = document.getElementById("scene-pause");
  const rotateButton = document.getElementById("scene-rotate");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const forcedColors = matchMedia("(forced-colors: active)");
  const connection = navigator.connection;
  let paused = reducedMotion.matches || Boolean(connection?.saveData);
  let visible = false;
  let lost = false;
  let failed = false;
  let frame = 0;
  let lastTime = 0;
  let yaw = -0.35;
  let pitch = 0.22;
  let pointerX = 0;
  let pointerY = 0;
  let renderer;

  function showFallback() {
    failed = true;
    cancelAnimationFrame(frame);
    frame = 0;
    renderer?.dispose();
    renderer = undefined;
    stage.classList.remove("scene-ready");
    controls.hidden = true;
  }

  function canRender() {
    return (
      visible && !document.hidden && !forcedColors.matches && !lost && !failed
    );
  }

  function updateButton() {
    pauseButton.textContent = paused ? "Animar" : "Pausar";
    pauseButton.setAttribute(
      "aria-label",
      paused ? "Animar la escena 3D" : "Pausar la escena 3D",
    );
  }

  function draw(time) {
    frame = 0;
    if (!canRender()) return;
    // Limit the animation to 30 fps and avoid jumps after backgrounding the tab.
    if (!paused && lastTime && time - lastTime < 1000 / 30) {
      frame = requestAnimationFrame(draw);
      return;
    }
    if (!paused)
      yaw += Math.min((time - (lastTime || time)) / 1000, 0.05) * 0.15;
    lastTime = time;
    try {
      renderer.render(pitch + pointerY, yaw + pointerX);
      stage.classList.add("scene-ready");
      controls.hidden = false;
    } catch {
      showFallback();
      return;
    }
    if (!paused) frame = requestAnimationFrame(draw);
  }

  function schedule() {
    if (!canRender()) {
      cancelAnimationFrame(frame);
      frame = 0;
      lastTime = 0;
      return;
    }
    if (!renderer) {
      try {
        renderer = createRenderer(canvas);
      } catch {
        showFallback();
        return;
      }
    }
    if (!frame) frame = requestAnimationFrame(draw);
  }

  pauseButton.addEventListener("click", () => {
    paused = !paused;
    lastTime = 0;
    updateButton();
    schedule();
  });
  rotateButton.addEventListener("click", () => {
    yaw += Math.PI / 6;
    schedule();
  });
  stage.addEventListener(
    "pointermove",
    (event) => {
      // Touch keeps native vertical scrolling. Pausing also stops pointer motion.
      if (event.pointerType !== "mouse" || paused || reducedMotion.matches)
        return;
      const rect = stage.getBoundingClientRect();
      pointerX = ((event.clientX - rect.left) / rect.width - 0.5) * 0.35;
      pointerY = ((event.clientY - rect.top) / rect.height - 0.5) * 0.2;
      schedule();
    },
    { passive: true },
  );
  stage.addEventListener("pointerleave", () => {
    pointerX = pointerY = 0;
    if (!paused) schedule();
  });
  document.addEventListener("visibilitychange", schedule);
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("pageshow", schedule);
  window.addEventListener("pagehide", () => {
    cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
  });
  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) paused = true;
    pointerX = pointerY = 0;
    updateButton();
    schedule();
  });
  connection?.addEventListener?.("change", () => {
    if (connection.saveData) paused = true;
    updateButton();
    schedule();
  });
  forcedColors.addEventListener("change", schedule);
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    lost = true;
    renderer = undefined;
    stage.classList.remove("scene-ready");
    controls.hidden = true;
    schedule();
  });
  canvas.addEventListener("webglcontextrestored", () => {
    lost = false;
    failed = false;
    schedule();
  });
  if ("ResizeObserver" in window) new ResizeObserver(schedule).observe(stage);
  updateButton();
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        schedule();
      },
      { threshold: 0 },
    ).observe(stage);
  } else {
    visible = true;
    schedule();
  }

  function createRenderer(element) {
    const gl = element.getContext("webgl", {
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error("WebGL unavailable");

    const vertexSource = `
      attribute vec3 aPosition;
      attribute vec3 aNormal;
      attribute vec3 aColor;
      uniform vec2 uRotation;
      uniform float uAspect;
      varying mediump vec3 vNormal;
      varying mediump vec3 vColor;
      varying mediump vec3 vView;
      vec3 rotate(vec3 p) {
        float cx = cos(uRotation.x), sx = sin(uRotation.x);
        float cy = cos(uRotation.y), sy = sin(uRotation.y);
        vec3 q = vec3(p.x, cx*p.y-sx*p.z, sx*p.y+cx*p.z);
        return vec3(cy*q.x+sy*q.z, q.y, -sy*q.x+cy*q.z);
      }
      void main() {
        vec3 p = rotate(aPosition);
        vNormal = rotate(aNormal);
        vColor = aColor;
        p.z -= 7.2;
        vView = -p;
        gl_Position = vec4(p.x*2.4/uAspect, p.y*2.4, -1.01*p.z-0.201, -p.z);
      }
    `;
    const fragmentSource = `
      precision mediump float;
      varying mediump vec3 vNormal;
      varying mediump vec3 vColor;
      varying mediump vec3 vView;
      void main() {
        vec3 n = normalize(vNormal);
        vec3 eye = normalize(vView);
        vec3 light = normalize(vec3(-2.0, 3.0, 4.0));
        float diffuse = max(dot(n, light), 0.0);
        float rim = pow(1.0-max(dot(n, eye), 0.0), 2.6);
        float specular = pow(max(dot(n, normalize(light+eye)), 0.0), 60.0);
        vec3 color = vColor*(0.24+0.8*diffuse) + vColor*rim*0.5 + vec3(specular*0.65);
        gl_FragColor = vec4(color, 1.0);
      }
    `;
    const program = gl.createProgram();
    const shaders = [];
    const buffers = [];
    const dispose = () => {
      buffers.forEach((buffer) => gl.deleteBuffer(buffer));
      shaders.forEach((shader) => gl.deleteShader(shader));
      gl.deleteProgram(program);
    };
    try {
      for (const [type, source] of [
        [gl.VERTEX_SHADER, vertexSource],
        [gl.FRAGMENT_SHADER, fragmentSource],
      ]) {
        const shader = gl.createShader(type);
        if (!shader) throw new Error("Shader unavailable");
        shaders.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error("Shader link failed");
      gl.useProgram(program);

      const triangles = [];
      const lines = [];
      const cyan = [0.22, 0.88, 0.85];
      const gold = [0.93, 0.73, 0.35];
      const dark = [0.08, 0.37, 0.43];

      function rotatePoint(p, angles = [0, 0, 0]) {
        let [x, y, z] = p;
        for (let axis = 0; axis < 3; axis++) {
          const c = Math.cos(angles[axis]),
            s = Math.sin(angles[axis]);
          if (axis === 0) [y, z] = [y * c - z * s, y * s + z * c];
          if (axis === 1) [x, z] = [x * c + z * s, -x * s + z * c];
          if (axis === 2) [x, y] = [x * c - y * s, x * s + y * c];
        }
        return [x, y, z];
      }

      function surface(
        sample,
        width,
        height,
        color,
        offset = [0, 0, 0],
        angles = [0, 0, 0],
      ) {
        const emit = (u, v) => {
          const [point, normal] = sample(u, v);
          const position = rotatePoint(point, angles).map(
            (value, i) => value + offset[i],
          );
          triangles.push(...position, ...rotatePoint(normal, angles), ...color);
        };
        for (let u = 0; u < width; u++)
          for (let v = 0; v < height; v++) {
            for (const [du, dv] of [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
              [1, 1],
              [0, 1],
            ])
              emit((u + du) / width, (v + dv) / height);
          }
      }

      function torus(radius, tube, color, angles) {
        surface(
          (u, v) => {
            const a = u * 2 * Math.PI,
              b = v * 2 * Math.PI;
            const n = [
              Math.cos(a) * Math.cos(b),
              Math.sin(a) * Math.cos(b),
              Math.sin(b),
            ];
            return [
              [
                (radius + tube * Math.cos(b)) * Math.cos(a),
                (radius + tube * Math.cos(b)) * Math.sin(a),
                tube * Math.sin(b),
              ],
              n,
            ];
          },
          88,
          tube > 0.1 ? 20 : 6,
          color,
          [0, 0, 0],
          angles,
        );
      }

      function sphere(position, radius, color) {
        surface(
          (u, v) => {
            const a = u * 2 * Math.PI,
              b = v * Math.PI;
            const n = [
              Math.cos(a) * Math.sin(b),
              Math.cos(b),
              Math.sin(a) * Math.sin(b),
            ];
            return [n.map((value) => value * radius), n];
          },
          16,
          10,
          color,
          position,
        );
      }

      torus(1.03, 0.21, cyan, [0.28, -0.2, 0.1]);
      torus(1.57, 0.024, gold, [1.1, 0.2, -0.3]);
      torus(2.05, 0.015, dark, [-0.65, 0.6, 0.5]);
      sphere([0, 0, 0], 0.43, dark);
      // A designed abstract network, not a live topology or a price chart.
      const positions = [];
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        const position = [
          2.06 * Math.cos(angle),
          1.72 * Math.sin(angle),
          Math.sin(angle * 3) * 0.55,
        ];
        positions.push(position);
        sphere(position, i % 3 === 0 ? 0.13 : 0.07, i % 3 === 0 ? gold : cyan);
        lines.push(...position, 0, 0, 1, ...dark, 0, 0, 0, 0, 0, 1, ...dark);
      }
      positions.forEach((position, i) =>
        lines.push(
          ...position,
          0,
          0,
          1,
          ...dark,
          ...positions[(i + 1) % positions.length],
          0,
          0,
          1,
          ...dark,
        ),
      );

      function upload(data) {
        const buffer = gl.createBuffer();
        if (!buffer) throw new Error("Buffer unavailable");
        buffers.push(buffer);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
        return { buffer, count: data.length / 9 };
      }
      const mesh = upload(triangles);
      const edges = upload(lines);
      const attributes = ["aPosition", "aNormal", "aColor"].map((name) =>
        gl.getAttribLocation(program, name),
      );
      const rotation = gl.getUniformLocation(program, "uRotation");
      const aspect = gl.getUniformLocation(program, "uAspect");
      // Read implementation limits once, outside the animation loop.
      const maxViewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
      gl.enable(gl.DEPTH_TEST);
      gl.clearColor(0, 0, 0, 0);
      if (gl.getError() !== gl.NO_ERROR)
        throw new Error("WebGL initialization failed");

      function drawBuffer(data, mode) {
        gl.bindBuffer(gl.ARRAY_BUFFER, data.buffer);
        attributes.forEach((location, index) => {
          gl.enableVertexAttribArray(location);
          gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 36, index * 12);
        });
        gl.drawArrays(mode, 0, data.count);
      }
      return {
        dispose,
        render(x, y) {
          const bounds = element.getBoundingClientRect();
          const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
          const width = Math.max(
            1,
            Math.min(Math.round(bounds.width * dpr), maxViewport[0]),
          );
          const height = Math.max(
            1,
            Math.min(Math.round(bounds.height * dpr), maxViewport[1]),
          );
          if (element.width !== width || element.height !== height) {
            element.width = width;
            element.height = height;
          }
          gl.viewport(0, 0, width, height);
          gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
          gl.uniform2f(rotation, x, y);
          gl.uniform1f(aspect, width / height);
          drawBuffer(edges, gl.LINES);
          drawBuffer(mesh, gl.TRIANGLES);
        },
      };
    } catch (error) {
      dispose();
      throw error;
    }
  }
})();
