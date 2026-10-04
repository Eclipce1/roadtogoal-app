// Obsidian-style graph of all goals: "My goals" hub -> goals -> their steps.
// A small force simulation (no libraries, works offline): nodes repel each other,
// links pull like springs, and the whole thing settles into a readable layout.

const Graph = (() => {
  const NS = "http://www.w3.org/2000/svg";
  let svg, viewport, edgeLayer, nodeLayer;
  let nodes = [];
  let edges = [];
  let neighbors = new Map();
  let alpha = 0;
  let raf = null;
  let view = { x: 0, y: 0, k: 1 };
  let userMoved = false;
  let drag = null;

  function el(tag, attrs = {}) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function build(data) {
    nodes = [];
    edges = [];
    const root = { id: "root", type: "root", label: "Мои цели", r: 10, x: 0, y: 0, fixed: true };
    nodes.push(root);

    const goals = data.goals;
    goals.forEach((g, gi) => {
      const total = g.steps.length;
      const done = g.steps.filter((s) => s.done).length;
      const angle = (gi / goals.length) * Math.PI * 2 - Math.PI / 2;
      const goal = {
        id: "g" + g.id,
        type: "goal",
        goalId: g.id,
        label: upperFirst(g.mainGoal || "Без названия"),
        sub: `${done}/${total}`,
        r: 9 + Math.min(total, 12) * 0.35,
        active: g.id === data.activeGoalId,
        finished: total > 0 && done === total,
        x: Math.cos(angle) * 200,
        y: Math.sin(angle) * 200,
      };
      nodes.push(goal);
      edges.push({ a: root, b: goal, len: 230, kind: "trunk" });

      const current = g.steps.findIndex((s) => !s.done);
      g.steps.forEach((s, i) => {
        // start steps fanned out away from the hub so the layout settles quickly
        const spread = total > 1 ? (i / (total - 1) - 0.5) * 2.2 : 0;
        const a = angle + spread;
        const step = {
          id: `s${g.id}_${s.id}`,
          type: "step",
          goalId: g.id,
          stepId: s.id,
          label: s.title,
          r: 5,
          state: s.done ? "done" : i === current ? "current" : "locked",
          finish: !!s.finish,
          x: goal.x + Math.cos(a) * 100,
          y: goal.y + Math.sin(a) * 100,
        };
        nodes.push(step);
        edges.push({ a: goal, b: step, len: 100, kind: "leaf" });
      });
    });

    nodes.forEach((n) => {
      n.vx = 0;
      n.vy = 0;
    });
    neighbors = new Map(nodes.map((n) => [n.id, new Set([n.id])]));
    edges.forEach((e) => {
      neighbors.get(e.a.id).add(e.b.id);
      neighbors.get(e.b.id).add(e.a.id);
    });
  }

  function draw() {
    svg.innerHTML = `
      <defs>
        <radialGradient id="haloW"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
        <radialGradient id="haloG"><stop offset="0" stop-color="#4ade80" stop-opacity=".45"/><stop offset="1" stop-color="#4ade80" stop-opacity="0"/></radialGradient>
        <radialGradient id="haloY"><stop offset="0" stop-color="#ffd98a" stop-opacity=".5"/><stop offset="1" stop-color="#ffd98a" stop-opacity="0"/></radialGradient>
      </defs>`;
    viewport = el("g", { class: "g-viewport" });
    edgeLayer = el("g");
    nodeLayer = el("g");
    viewport.append(edgeLayer, nodeLayer);
    svg.append(viewport);

    edges.forEach((e) => {
      e.line = el("line", { class: `g-edge ${e.kind}` });
      edgeLayer.append(e.line);
    });

    nodes.forEach((n) => {
      const cls = ["g-node", n.type];
      if (n.state) cls.push(n.state);
      if (n.active) cls.push("active");
      if (n.finished) cls.push("finished");
      if (n.finish) cls.push("finish");
      const g = el("g", { class: cls.join(" ") });
      g.dataset.id = n.id;

      let halo = null;
      if (n.type === "root" || n.finished || (n.type === "step" && n.finish && n.state === "done")) halo = "haloY";
      else if (n.type === "goal" || n.state === "current") halo = "haloW";
      else if (n.state === "done") halo = "haloG";
      if (halo) g.append(el("circle", { class: "g-halo", r: n.r * 3.2, fill: `url(#${halo})` }));
      if (n.state === "current") g.append(el("circle", { class: "g-ring", r: n.r + 5 }));
      g.append(el("circle", { class: "g-core", r: n.r }));

      const label = el("text", { class: "g-label", y: n.r + (n.type === "step" ? 14 : 18) });
      label.textContent = n.label.length > 34 ? n.label.slice(0, 33) + "…" : n.label;
      g.append(label);
      if (n.type === "goal") {
        const sub = el("text", { class: "g-sub", y: n.r + 32 });
        sub.textContent = n.sub;
        g.append(sub);
      }
      n.el = g;
      nodeLayer.append(g);
    });
  }

  function tick() {
    const n = nodes.length;
    // repulsion between every pair (fine for a few hundred nodes)
    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          d2 = 1;
        }
        const strength = a.type === "step" && b.type === "step" ? 900 : 4200;
        const f = (strength * alpha) / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }
    // links behave like springs
    edges.forEach((e) => {
      const dx = e.b.x - e.a.x;
      const dy = e.b.y - e.a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = ((d - e.len) / d) * 0.12 * alpha;
      e.a.vx += dx * f;
      e.a.vy += dy * f;
      e.b.vx -= dx * f;
      e.b.vy -= dy * f;
    });
    nodes.forEach((p) => {
      if (p.fixed) {
        p.vx = p.vy = 0;
        return;
      }
      p.vx -= p.x * 0.004 * alpha;
      p.vy -= p.y * 0.004 * alpha;
      p.vx *= 0.6;
      p.vy *= 0.6;
      p.x += p.vx;
      p.y += p.vy;
    });
    alpha *= 0.985;
  }

  function paint() {
    edges.forEach((e) => {
      e.line.setAttribute("x1", e.a.x);
      e.line.setAttribute("y1", e.a.y);
      e.line.setAttribute("x2", e.b.x);
      e.line.setAttribute("y2", e.b.y);
    });
    nodes.forEach((n) => n.el.setAttribute("transform", `translate(${n.x},${n.y})`));
    viewport.setAttribute("transform", `translate(${view.x},${view.y}) scale(${view.k})`);
    svg.classList.toggle("far", view.k < 0.7);
  }

  // keep everything in frame until the user takes over panning/zooming
  function fitTarget() {
    const w = svg.clientWidth;
    const h = svg.clientHeight;
    if (!w || !h) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach((n) => {
      minX = Math.min(minX, n.x - 80);
      maxX = Math.max(maxX, n.x + 80);
      minY = Math.min(minY, n.y - 30);
      maxY = Math.max(maxY, n.y + 50);
    });
    const topPad = 110;
    const k = Math.min(1.35, (w - 60) / (maxX - minX), (h - topPad - 60) / (maxY - minY));
    return {
      k,
      x: w / 2 - ((minX + maxX) / 2) * k,
      y: topPad + (h - topPad) / 2 - ((minY + maxY) / 2) * k,
    };
  }

  function loop() {
    if (alpha > 0.004) tick();
    if (!userMoved) {
      const t = fitTarget();
      if (t) {
        view.k += (t.k - view.k) * 0.12;
        view.x += (t.x - view.x) * 0.12;
        view.y += (t.y - view.y) * 0.12;
      }
    }
    paint();
    const settled = alpha <= 0.004 && (userMoved || isFitted());
    raf = settled && !drag ? null : requestAnimationFrame(loop);
  }

  function isFitted() {
    const t = fitTarget();
    return !t || (Math.abs(t.k - view.k) < 0.002 && Math.abs(t.x - view.x) < 0.5 && Math.abs(t.y - view.y) < 0.5);
  }

  function run(heat) {
    alpha = Math.max(alpha, heat);
    if (!raf) raf = requestAnimationFrame(loop);
  }

  function toGraph(e) {
    const r = svg.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k };
  }

  function highlight(id) {
    svg.classList.toggle("hovering", !!id);
    const near = id ? neighbors.get(id) : null;
    nodes.forEach((n) => n.el.classList.toggle("hl", !!near && near.has(n.id)));
    edges.forEach((e) => e.line.classList.toggle("hl", !!id && (e.a.id === id || e.b.id === id)));
  }

  // two fingers on the glass zoom the graph instead of dragging it
  const touches = new Map(); // pointerId -> {x, y}
  let pinch = null; // { dist, mx, my }

  function pinchState() {
    const [a, b] = [...touches.values()];
    const r = svg.getBoundingClientRect();
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top };
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    svg.setPointerCapture(e.pointerId);
    if (e.pointerType === "touch") {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        drag = null;
        svg.classList.remove("dragging");
        pinch = pinchState();
        return;
      }
    }
    const g = e.target.closest(".g-node");
    const node = g ? nodes.find((n) => n.id === g.dataset.id) : null;
    drag = { node, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false, wasFixed: node && node.fixed, touch: e.pointerType === "touch" };
  }

  function onPointerMove(e) {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size === 2) {
      const now = pinchState();
      const k2 = Math.min(3, Math.max(0.3, (view.k * now.dist) / pinch.dist));
      // zoom about the point between the fingers, and follow that point as it moves
      view.x = now.mx - ((pinch.mx - view.x) * k2) / view.k;
      view.y = now.my - ((pinch.my - view.y) * k2) / view.k;
      view.k = k2;
      pinch = now;
      userMoved = true;
      if (!raf) raf = requestAnimationFrame(loop);
      return;
    }
    if (!drag) {
      const g = e.target.closest(".g-node");
      highlight(g ? g.dataset.id : null);
      return;
    }
    const dx = e.clientX - drag.sx;
    const dy = e.clientY - drag.sy;
    // a fingertip wobbles more than a mouse, so a tap gets a bigger allowance
    if (!drag.moved && Math.hypot(dx, dy) < (drag.touch ? 9 : 4)) return;
    drag.moved = true;
    svg.classList.add("dragging");
    if (drag.node) {
      const p = toGraph(e);
      drag.node.fixed = true;
      drag.node.x = p.x;
      drag.node.y = p.y;
      run(0.25);
    } else {
      userMoved = true;
      view.x = drag.vx + dx;
      view.y = drag.vy + dy;
      if (!raf) raf = requestAnimationFrame(loop);
    }
  }

  function onPointerUp(e) {
    touches.delete(e.pointerId);
    if (pinch) {
      // lifting one of two fingers ends the pinch; the other one must not jerk the view
      if (touches.size < 2) pinch = null;
      drag = null;
      svg.classList.remove("dragging");
      return;
    }
    if (!drag) return;
    const { node, moved, wasFixed } = drag;
    drag = null;
    svg.classList.remove("dragging");
    if (node && moved && !wasFixed) node.fixed = false;
    if (node && !moved) activate(node);
    if (!raf) raf = requestAnimationFrame(loop);
  }

  function activate(node) {
    if (node.type === "goal") switchGoal(node.goalId);
    else if (node.type === "step") {
      switchGoal(node.goalId).then(() => openStepCard(node.stepId));
    }
  }

  function onWheel(e) {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const k2 = Math.min(3, Math.max(0.3, view.k * Math.exp(-e.deltaY * 0.0015)));
    view.x = mx - ((mx - view.x) * k2) / view.k;
    view.y = my - ((my - view.y) * k2) / view.k;
    view.k = k2;
    userMoved = true;
    if (!raf) raf = requestAnimationFrame(loop);
  }

  function mount(svgEl, data) {
    stop();
    svg = svgEl;
    userMoved = false;
    build(data);
    draw();
    const t = fitTarget();
    if (t) view = { ...t, k: t.k * 0.85 };
    svg.addEventListener("pointerdown", onPointerDown);
    svg.addEventListener("pointermove", onPointerMove);
    svg.addEventListener("pointerup", onPointerUp);
    svg.addEventListener("pointercancel", onPointerUp);
    svg.addEventListener("pointerleave", () => !drag && highlight(null));
    svg.addEventListener("wheel", onWheel, { passive: false });
    run(1);
  }

  function refit() {
    userMoved = false;
    if (svg && !raf) raf = requestAnimationFrame(loop);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    drag = null;
    touches.clear();
    pinch = null;
  }

  return { mount, stop, refit };
})();
