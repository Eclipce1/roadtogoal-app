// The desktop app always talks to Python through window.pywebview.api, which is
// injected a moment after the page starts, so every call waits for it.
// The in-browser fake storage exists only for UI previews opened with ?preview.
const PREVIEW = new URLSearchParams(location.search).has("preview");
// The desktop app is a WebView2 window with a Python bridge. Anywhere else (Safari on
// a phone, an installed home-screen app) the same screens run on data kept in the browser.
const IN_DESKTOP = !!(window.chrome && window.chrome.webview) || !!window.pywebview;
const LOCAL_MODE = PREVIEW || !IN_DESKTOP;
// reminders and autostart are Windows features: hidden wherever the app isn't the Windows one
if (LOCAL_MODE) document.body.classList.add("local");

function previewApi() {
  // mirrors main.py: several goals, every call acts on the active one
  const KEY = PREVIEW ? "roadtogoal_preview_v2" : "roadtogoal_local_v1";
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const newGoal = (id, fields = {}) => ({
    id,
    mainGoal: "Новая цель",
    subGoals: [],
    woop: { wish: "", outcome: "", obstacle: "", plan: "" },
    deadline: "",
    createdAt: today(),
    returnShownOn: "",
    wizardDismissed: false,
    checkins: [],
    reviews: [],
    reviewSnoozedOn: "",
    mode: "steps",
    tracker: { name: "", unit: "", target: "" },
    log: {},
    relapses: [],
    hideFromAnalytics: false,
    updatedAt: 0,
    ...fields,
  });
  // same sync bookkeeping as main.py: per-goal and per-day change times, deleted goals
  const withSyncFields = (st) => {
    st.orderAt = Number(st.orderAt) || 0;
    st.deletedGoals = st.deletedGoals || {};
    st.daysAt = st.daysAt || {};
    st.plans = st.plans || {};
    st.marks = st.marks || {};
    st.nextPlanId = st.nextPlanId || 1;
    st.version = st.version || 3;
    st.goals.forEach((g) => (g.updatedAt = g.updatedAt || 0));
    return st;
  };
  const load = () => {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (raw && raw.goals && raw.goals.length) return withSyncFields(raw);
    // "fresh" marks this demo goal as nothing of the user's own: syncing replaces it
    // with the real data instead of merging it in or pushing it anywhere
    return withSyncFields({
      fresh: true,
      activeGoalId: 1,
      goals: [
        newGoal(1, {
          mainGoal: "Моя цель",
          subGoals: [
            { id: 1, title: "Первый шаг", reward: "🎯", done: false },
            { id: 2, title: "Второй шаг", reward: "📘", done: false },
            { id: 3, title: "Третий шаг", reward: "🏆", done: false },
          ],
        }),
      ],
    });
  };
  let storageWarned = false;
  const save = (st) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(st));
    } catch (e) {
      // a phone browser gives each app only a few MB; losing changes silently would be worse
      if (!storageWarned) {
        storageWarned = true;
        alert("Не удалось сохранить: у приложения на этом устройстве закончилось место. Удали несколько фото из шагов.");
      }
    }
  };
  const settingsOf = (st) => ({
    reminder: { enabled: false, time: "20:00" },
    planReminder: { enabled: false, time: "21:30" },
    autostart: false,
    ...(st.settings || {}),
  });
  const view = (st) => {
    const g = st.goals.find((x) => x.id === st.activeGoalId);
    return {
      ...JSON.parse(JSON.stringify(g)),
      activeGoalId: st.activeGoalId,
      fresh: !!st.fresh,
      settings: settingsOf(st),
      goals: st.goals.map((x) => ({
        id: x.id,
        mainGoal: x.mainGoal,
        deadline: x.deadline,
        createdAt: x.createdAt,
        icon: x.subGoals.length ? x.subGoals[x.subGoals.length - 1].reward : "🎯",
        mode: x.mode || "steps",
        tracker: { ...(x.tracker || { name: "", unit: "", target: "" }) },
        log: { ...(x.log || {}) },
        relapses: (x.relapses || []).map((r) => ({ ...r })),
        checkins: [...(x.checkins || [])],
        hideFromAnalytics: !!x.hideFromAnalytics,
        steps: x.subGoals.map((s) => ({ id: s.id, title: s.title, reward: s.reward, done: s.done, finish: !!s.finish })),
      })),
      plans: st.plans || {},
      marks: st.marks || {},
    };
  };
  // goalId is optional: the analytics screen addresses goals other than the active one.
  // A change to a goal stamps it, so the sync knows which device touched it last.
  const change = (fn, goalId) => {
    const st = load();
    const goal = (goalId && st.goals.find((x) => x.id === goalId)) || st.goals.find((x) => x.id === st.activeGoalId);
    fn(goal, st);
    goal.updatedAt = Date.now();
    delete st.fresh;
    save(st);
    return view(st);
  };
  // changes to the store itself (goal list, day plans) stamp what they touch on their own
  const edit = (fn) => {
    const st = load();
    fn(st);
    delete st.fresh;
    save(st);
    return view(st);
  };
  // looking at things or per-device settings: not a change anyone else needs to hear about
  const quiet = (fn) => {
    const st = load();
    fn(st);
    save(st);
    return view(st);
  };
  const META = ["mainGoal", "woop", "deadline", "returnShownOn", "wizardDismissed", "reviewSnoozedOn"];
  const STEP = ["title", "note", "actions", "minimum", "reward"];
  return {
    get_data: async () => quiet(() => {}),
    select_goal: async (id) =>
      quiet((st) => {
        if (st.goals.some((x) => x.id === id)) st.activeGoalId = id;
      }),
    create_goal: async () =>
      edit((st) => {
        // 100000+ keeps ids made on a phone clear of the ones made on the computer
        const id = Math.max(100000, ...st.goals.map((x) => x.id)) + 1;
        st.goals.push(newGoal(id, { updatedAt: Date.now() }));
        st.activeGoalId = id;
        st.orderAt = Date.now();
      }),
    delete_goal: async (id) =>
      edit((st) => {
        st.goals = st.goals.filter((x) => x.id !== id);
        st.deletedGoals[String(id)] = st.orderAt = Date.now();
        if (!st.goals.length) st.goals = [newGoal(1, { updatedAt: Date.now() })];
        if (!st.goals.some((x) => x.id === st.activeGoalId)) st.activeGoalId = st.goals[0].id;
      }),
    move_goal: async (id, delta) =>
      edit((st) => {
        const i = st.goals.findIndex((x) => x.id === id);
        const j = i + delta;
        if (i === -1 || j < 0 || j >= st.goals.length) return;
        [st.goals[i], st.goals[j]] = [st.goals[j], st.goals[i]];
        st.orderAt = Date.now();
      }),
    set_reminder: async (enabled, time) =>
      quiet((st) => (st.settings = { ...settingsOf(st), reminder: { enabled: !!enabled, time } })),

    // ---- sync: the page merges, the store only hands data over and takes it back ----
    export_store: async () => JSON.parse(JSON.stringify(load())),
    import_store: async (incoming) => {
      if (!incoming || !Array.isArray(incoming.goals) || !incoming.goals.length) return view(load());
      const cur = load();
      try {
        localStorage.setItem(KEY + "_presync", JSON.stringify(cur)); // one copy of what this replaced
      } catch (e) {}
      const st = withSyncFields({ ...incoming, settings: cur.settings || {} });
      delete st.fresh;
      st.activeGoalId = st.goals.some((g) => g.id === cur.activeGoalId) ? cur.activeGoalId : st.goals[0].id;
      save(st);
      return view(st);
    },
    get_sync_config: async () => JSON.parse(localStorage.getItem("roadtogoal_sync") || "{}"),
    set_sync_config: async (cfg) => {
      if (cfg) {
        const keep = {};
        ["token", "repo", "baseSha", "lastSyncAt", "apiBase"].forEach((k) => k in cfg && (keep[k] = cfg[k]));
        localStorage.setItem("roadtogoal_sync", JSON.stringify(keep));
        return keep;
      }
      localStorage.removeItem("roadtogoal_sync");
      return {};
    },
    set_main_goal: async (title) => change((g) => (g.mainGoal = title)),
    update_meta: async (patch) => change((g) => META.forEach((k) => k in patch && (g[k] = patch[k]))),
    add_subgoal: async (title, reward, where = "end") =>
      change((g) => {
        const steps = g.subGoals;
        const id = Math.max(0, ...steps.map((s) => s.id)) + 1;
        const step = { id, title, reward: reward || "🎯", done: false };
        const finishAt = steps.findIndex((s) => s.finish);
        if (where === "finish") {
          steps.forEach((s) => delete s.finish);
          steps.push({ ...step, finish: true });
        } else if (where === "start") {
          const open = steps.findIndex((s) => !s.done);
          steps.splice(open === -1 ? steps.length : open, 0, step);
        } else steps.splice(finishAt === -1 ? steps.length : finishAt, 0, step);
      }),
    move_subgoal: async (id, delta) =>
      change((g) => {
        const steps = g.subGoals;
        const i = steps.findIndex((s) => s.id === id);
        const j = i + delta;
        if (i === -1 || j < 0 || j >= steps.length) return;
        const [a, b] = [steps[i], steps[j]];
        if (a.done || b.done || a.finish || b.finish) return;
        steps[i] = b;
        steps[j] = a;
      }),
    set_finish: async (id) =>
      change((g) => {
        const steps = g.subGoals;
        const step = steps.find((s) => s.id === id);
        if (!step || (step.done && steps.some((s) => s !== step && !s.done))) return;
        steps.forEach((s) => delete s.finish);
        steps.splice(steps.indexOf(step), 1);
        steps.push({ ...step, finish: true });
      }),
    complete_subgoal: async (id) =>
      change((g) => {
        g.subGoals.forEach((s) => {
          if (s.id === id) {
            s.done = true;
            s.doneAt = today();
          }
        });
        if (!g.checkins.includes(today())) g.checkins = [...g.checkins, today()].sort();
      }),
    reset_subgoal: async (id) =>
      change((g) => {
        const from = g.subGoals.findIndex((s) => s.id === id);
        g.subGoals.forEach((s, i) => {
          if (from !== -1 && i >= from) {
            s.done = false;
            delete s.doneAt;
          }
        });
      }),
    update_subgoal: async (id, patch) =>
      change((g) => g.subGoals.forEach((s) => s.id === id && STEP.forEach((k) => k in patch && (s[k] = patch[k])))),
    delete_subgoal: async (id) => change((g) => (g.subGoals = g.subGoals.filter((s) => s.id !== id))),
    add_step_image: async (stepId, dataUrl) =>
      change((g) => {
        if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/") || dataUrl.length > 4000000) return;
        g.subGoals.forEach((s) => {
          if (s.id !== stepId) return;
          s.images = s.images || [];
          const id = Math.max(0, ...s.images.map((im) => im.id)) + 1;
          s.images.push({ id, src: dataUrl });
        });
      }),
    delete_step_image: async (stepId, imageId) =>
      change((g) => g.subGoals.forEach((s) => s.id === stepId && (s.images = (s.images || []).filter((im) => im.id !== imageId)))),
    toggle_checkin: async (day) =>
      change((g) => {
        g.checkins = g.checkins.includes(day) ? g.checkins.filter((x) => x !== day) : [...g.checkins, day].sort();
      }),
    add_review: async (r) =>
      change((g) =>
        g.reviews.push({ date: today(), helped: r.helped || "", hindered: r.hindered || "", next: r.next || "" })
      ),
    add_plan_item: async (day, text) =>
      edit((st) => {
        text = (text || "").trim();
        if (!text) return;
        st.plans[day] = st.plans[day] || [];
        const id = st.nextPlanId || 1;
        st.plans[day].push({ id, text, done: false });
        st.nextPlanId = id + 1;
        st.daysAt[day] = Date.now();
      }),
    toggle_plan_item: async (day, itemId) =>
      edit((st) => {
        (st.plans[day] || []).forEach((it) => {
          if (it.id !== itemId) return;
          it.done = !it.done;
          st.daysAt[day] = Date.now();
        });
      }),
    delete_plan_item: async (day, itemId) =>
      edit((st) => {
        if (!st.plans[day]) return;
        st.plans[day] = st.plans[day].filter((it) => it.id !== itemId);
        st.daysAt[day] = Date.now();
      }),
    reorder_plan: async (day, order) =>
      edit((st) => {
        const items = st.plans[day];
        if (!items) return;
        const byId = new Map(items.map((it) => [it.id, it]));
        const seen = new Set(order.filter((id) => byId.has(id)));
        st.plans[day] = [...order.map((id) => byId.get(id)).filter(Boolean), ...items.filter((it) => !seen.has(it.id))];
        st.daysAt[day] = Date.now();
      }),
    set_day_mark: async (day, label) =>
      edit((st) => {
        if (label === null || label === undefined) delete st.marks[day];
        else st.marks[day] = String(label).trim();
        st.daysAt[day] = Date.now();
      }),
    set_plan_reminder: async (enabled, time) =>
      quiet((st) => (st.settings = { ...settingsOf(st), planReminder: { enabled: !!enabled, time } })),
    set_autostart: async (enabled) =>
      quiet((st) => (st.settings = { ...settingsOf(st), autostart: !!enabled })),
    set_tracker: async (patch, goalId) =>
      change(
        (g) => ["name", "unit", "target"].forEach((k) => k in patch && (g.tracker[k] = String(patch[k]).trim())),
        goalId
      ),
    log_value: async (day, value, goalId) =>
      change((g) => {
        if (value === null || value === undefined || String(value).trim() === "") {
          delete g.log[day];
          return;
        }
        const n = parseFloat(String(value).replace(",", "."));
        if (!Number.isNaN(n)) g.log[day] = n;
      }, goalId),
    set_mode: async (mode, goalId) =>
      change((g) => (g.mode = ["steps", "number", "clean"].includes(mode) ? mode : "steps"), goalId),
    add_relapse: async (day, trigger = "", goalId) =>
      change((g) => {
        g.relapses = g.relapses.filter((r) => r.date !== day);
        g.relapses.push({ date: day, trigger: String(trigger).trim() });
        g.relapses.sort((a, b) => a.date.localeCompare(b.date));
      }, goalId),
    delete_relapse: async (day, goalId) =>
      change((g) => (g.relapses = g.relapses.filter((r) => r.date !== day)), goalId),
    set_analytics_visibility: async (hidden, goalId) => change((g) => (g.hideFromAnalytics = !!hidden), goalId),
  };
}

const apiReady = new Promise((resolve) => {
  if (LOCAL_MODE) return resolve(previewApi());
  const bridgeReady = () => window.pywebview && window.pywebview.api && window.pywebview.api.get_data;
  if (bridgeReady()) return resolve(window.pywebview.api);
  window.addEventListener("pywebviewready", () => resolve(window.pywebview.api), { once: true });
  // in case the ready event fired before this script attached its listener
  const poll = setInterval(() => {
    if (bridgeReady()) {
      clearInterval(poll);
      resolve(window.pywebview.api);
    }
  }, 100);
});

// The app has its own zoom where zoom makes sense (the graph). A stray pinch anywhere else
// would just scale the whole page and leave it stuck there, so Safari's page zoom is switched off.
["gesturestart", "gesturechange", "gestureend"].forEach((t) => document.addEventListener(t, (e) => e.preventDefault()));

// calls that only look at things, or touch this device's own settings, are no news to the other device
const NOT_A_CHANGE = new Set([
  "get_data", "select_goal", "export_store", "import_store", "get_sync_config", "set_sync_config",
  "set_reminder", "set_plan_reminder", "set_autostart",
]);

const api = new Proxy({}, {
  get: (_, name) => async (...args) => {
    const result = await (await apiReady)[name](...args);
    if (!NOT_A_CHANGE.has(name) && typeof Sync !== "undefined") Sync.touch();
    return result;
  },
});

const svg = document.getElementById("roadSvg");
const nodesLayer = document.getElementById("nodesLayer");
const roadWrap = document.querySelector(".road-wrap");
const progressFill = document.getElementById("progressFill");
const progressText = document.getElementById("progressText");
const mainGoalInput = document.getElementById("mainGoalInput");

const STEP_X = 210;
const SIDE_PAD = 130;
const AMP = 40;
// node box is 168px wide; the circle centre sits 38px from its top
const NODE_HALF_W = 84;
const CIRCLE_CY = 38;

let trackBg = null;
let trackGlow = null;
let trackFill = null;
let fillLen = 0;

// A node is taller below its circle (step number, title, actions) than above it
// (the "now" tag), so the circles sit a bit above the middle to centre the whole block.
const NODE_BLOCK_SHIFT = 28;
// room a node needs besides the wave itself: tag above + circle + labels below
const NODE_BLOCK_HEIGHT = 268;

function layout(count, height) {
  const centerY = height / 2 - NODE_BLOCK_SHIFT;
  // flatten the wave when the window is short so nodes never spill out of the road
  const amp = Math.max(0, Math.min(AMP, (height - NODE_BLOCK_HEIGHT) / 2));
  const points = [];
  for (let i = 0; i < count; i++) {
    points.push({
      x: SIDE_PAD + i * STEP_X,
      y: centerY + Math.sin(i * 1.15) * amp,
    });
  }
  return points;
}

function pathFromPoints(points) {
  if (!points.length) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const midX = (p0.x + p1.x) / 2;
    d += ` C ${midX} ${p0.y}, ${midX} ${p1.y}, ${p1.x} ${p1.y}`;
  }
  return d;
}

function ensureTrackPaths() {
  if (trackBg) return;
  svg.innerHTML = '<path class="track-bg" d="" /><path class="track-glow" d="" /><path class="track-fill" d="" />';
  trackBg = svg.querySelector(".track-bg");
  trackGlow = svg.querySelector(".track-glow");
  trackFill = svg.querySelector(".track-fill");
}

function drawTrack(points, reachIndex, animate) {
  ensureTrackPaths();
  const width = points.length ? points[points.length - 1].x + SIDE_PAD : 0;
  svg.setAttribute("width", width);
  svg.setAttribute("height", roadWrap.clientHeight);
  nodesLayer.style.width = width + "px";

  trackBg.setAttribute("d", pathFromPoints(points));
  if (!points.length) {
    trackFill.setAttribute("d", "");
    trackGlow.setAttribute("d", "");
    fillLen = 0;
    return;
  }

  const doneD = pathFromPoints(points.slice(0, reachIndex + 1));
  trackFill.setAttribute("d", doneD);
  trackGlow.setAttribute("d", doneD);
  const len = trackFill.getTotalLength();
  trackFill.style.strokeDasharray = len;
  trackGlow.style.strokeDasharray = len;

  // grow the new segment out of the previous one instead of snapping to it
  const from = animate ? Math.min(fillLen, len) : len;
  trackFill.style.transition = "none";
  trackGlow.style.transition = "none";
  trackFill.style.strokeDashoffset = len - from;
  trackGlow.style.strokeDashoffset = len - from;
  void trackFill.getBoundingClientRect();
  trackFill.style.transition = "";
  trackGlow.style.transition = "";
  trackFill.style.strokeDashoffset = 0;
  trackGlow.style.strokeDashoffset = 0;
  fillLen = len;
}

function render(data, opts = {}) {
  if (document.activeElement !== mainGoalInput) mainGoalInput.value = upperFirst(data.mainGoal || "");
  updateQuote(data);
  renderGoalMeta(data);
  renderToday(data);
  lastData = data;

  const total = data.subGoals.length;
  const doneCount = data.subGoals.filter((g) => g.done).length;
  progressFill.style.transform = `scaleX(${total ? doneCount / total : 0})`;
  progressText.innerHTML = `<b>${doneCount}</b>из ${total}`;

  document.getElementById("roadEmpty").hidden = total > 0;
  const points = layout(total, roadWrap.clientHeight);
  const firstNotDone = data.subGoals.findIndex((g) => !g.done);
  drawTrack(points, firstNotDone === -1 ? total - 1 : firstNotDone, !!opts.justCompleted);

  nodesLayer.querySelectorAll(".node").forEach((n) => n.remove());
  const frag = document.createDocumentFragment();
  let burstTarget = null;

  data.subGoals.forEach((g, i) => {
    const state = g.done ? "done" : i === firstNotDone ? "current" : "locked";
    const anim =
      g.id === opts.justCompleted ? " pop" : (opts.justReset || []).includes(g.id) ? " undo" : "";
    const el = document.createElement("div");
    const isFinish = !!g.finish;
    const flash = g.id === opts.flashId ? ` flash-${opts.flash}` : "";
    el.className = `node ${state}${isFinish ? " finish" : ""}${anim}${flash}`;
    el.style.transform = `translate(${points[i].x - NODE_HALF_W}px, ${points[i].y - CIRCLE_CY}px)`;
    el.innerHTML = `
      ${state === "current" ? '<div class="node-now">сейчас</div>' : ""}
      <button class="node-del" title="Удалить шаг">✕</button>
      <div class="node-circle" title="Открыть шаг">
        <span class="node-icon">${escapeHtml(g.reward)}</span>
        ${g.done ? '<div class="node-badge">✓</div>' : ""}
      </div>
      <div class="node-step">${isFinish ? "Финиш" : "Шаг " + String(i + 1).padStart(2, "0")}${g.done && g.doneAt ? " · " + fmtDate(g.doneAt) : ""}</div>
      <div class="node-title" title="${escapeHtml(g.title)}">${escapeHtml(g.title)}</div>
      ${actionsProgress(g)}
    `;

    const circle = el.querySelector(".node-circle");
    circle.addEventListener("click", () => openStepCard(g.id));
    if (g.id === opts.justCompleted) burstTarget = circle;

    el.querySelector(".node-del").addEventListener("click", (e) => {
      e.stopPropagation();
      deleteGoal(g.id);
    });
    frag.appendChild(el);
  });
  nodesLayer.appendChild(frag);

  if (burstTarget) burst(burstTarget);
  const flashIndex = data.subGoals.findIndex((g) => g.id === opts.flashId);
  if (flashIndex !== -1) {
    scrollRoadTo(points[flashIndex].x - roadWrap.clientWidth / 2);
  } else if (opts.scrollToCurrent && firstNotDone !== -1) {
    scrollRoadTo(points[firstNotDone].x - roadWrap.clientWidth / 2);
  }
  updateNavRail();
  updateDayClock();
}

const quoteEl = document.getElementById("quote");
let quoteTimer = null;

function updateQuote(data) {
  const next = data.subGoals.find((g) => !g.done);
  const finished = data.subGoals.length > 0 && !next;
  showQuote(quoteOfTheDay(data.mainGoal, next ? next.title : "", finished, data.woop));
}

function showQuote(text) {
  if (quoteEl.textContent === text) return;
  if (!quoteEl.textContent) {
    quoteEl.textContent = text;
    return;
  }
  clearTimeout(quoteTimer);
  quoteEl.classList.add("swap");
  quoteTimer = setTimeout(() => {
    quoteEl.textContent = text;
    quoteEl.classList.remove("swap");
  }, 350);
}

function actionsProgress(g) {
  const acts = (g.actions || []).filter((a) => a.text);
  if (!acts.length) return "";
  const done = acts.filter((a) => a.done).length;
  return `<div class="node-acts${done === acts.length ? " all" : ""}">${done}/${acts.length}</div>`;
}

function burst(circleEl) {
  const layer = document.createElement("div");
  layer.className = "burst";

  const ring = document.createElement("span");
  layer.appendChild(ring);

  const count = 12;
  for (let i = 0; i < count; i++) {
    const dot = document.createElement("i");
    dot.style.setProperty("--a", (360 / count) * i + Math.random() * 14 + "deg");
    dot.style.setProperty("--d", 56 + Math.random() * 26 + "px");
    dot.style.animationDelay = Math.random() * 70 + "ms";
    layer.appendChild(dot);
  }

  circleEl.appendChild(layer);
  setTimeout(() => layer.remove(), 1000);
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

async function completeGoal(id) {
  const data = await api.complete_subgoal(id);
  data.subGoals.every((g) => g.done) ? Sound.finish() : Sound.step();
  render(data, { justCompleted: id, scrollToCurrent: true });
}

async function resetGoal(id) {
  const steps = lastData.subGoals;
  const from = steps.findIndex((g) => g.id === id);
  const alsoDone = steps.slice(from + 1).filter((g) => g.done).length;
  if (alsoDone > 0 && !(await confirmUndo(steps[from], from, alsoDone))) return;
  const resetIds = steps.slice(from).filter((g) => g.done).map((g) => g.id);
  const data = await api.reset_subgoal(id);
  Sound.undo();
  render(data, { justReset: resetIds });
}

const confirmEl = document.getElementById("confirmUndo");

function confirmUndo(step, index, alsoDone) {
  return confirmDialog({
    title: `Отменить шаг ${index + 1} и ещё ${alsoDone} ${plural(alsoDone, "шаг", "шага", "шагов")} после него?`,
    text: `Дорожка идёт по порядку, поэтому вместе с «${escapeHtml(step.title)}» отменятся и все следующие пройденные шаги.`,
    yes: "Отменить шаги",
    no: "Оставить",
  });
}

function confirmDialog({ title, text, yes, no }) {
  confirmEl.querySelector(".confirm-card").innerHTML = `
    <h2 class="confirm-title">${title}</h2>
    <p class="confirm-text">${text}</p>
    <div class="confirm-actions">
      <button type="button" class="wiz-back" data-answer="no">${no}</button>
      <button type="button" class="wiz-next" data-answer="yes">${yes}</button>
    </div>`;
  confirmEl.classList.add("open");
  return new Promise((resolve) => {
    const done = (answer) => {
      confirmEl.classList.remove("open");
      confirmEl.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
      resolve(answer);
    };
    const onClick = (e) => {
      if (e.target === confirmEl) return done(false);
      const btn = e.target.closest("[data-answer]");
      if (btn) done(btn.dataset.answer === "yes");
    };
    const onKey = (e) => {
      if (e.key === "Escape") done(false);
    };
    confirmEl.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
  });
}

async function deleteGoal(id) {
  render(await api.delete_subgoal(id));
}

let saveTimer = null;
mainGoalInput.addEventListener("input", () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    lastData = await api.set_main_goal(mainGoalInput.value);
    updateQuote(lastData);
  }, 500);
});

const addForm = document.getElementById("addForm");
const titleInput = document.getElementById("newTitle");
const iconBtn = document.getElementById("iconBtn");
const iconPicker = document.getElementById("iconPicker");

let selectedIcon = DEFAULT_ICON;
let iconChosenByHand = false;

function setIcon(icon) {
  if (icon === selectedIcon) return;
  selectedIcon = icon;
  iconBtn.textContent = icon;
  iconBtn.classList.remove("bump");
  void iconBtn.offsetWidth;
  iconBtn.classList.add("bump");
  iconPicker.querySelectorAll(".icon-opt").forEach((b) =>
    b.classList.toggle("selected", b.dataset.icon === icon)
  );
}

function buildPicker() {
  iconPicker.innerHTML = ICON_GROUPS.map(
    (g) => `
      <div class="icon-group-label">${g.label}</div>
      <div class="icon-grid">
        ${g.icons
          .map(
            (ic) =>
              `<button type="button" class="icon-opt${ic === selectedIcon ? " selected" : ""}" data-icon="${ic}">${ic}</button>`
          )
          .join("")}
      </div>`
  ).join("");
}

function togglePicker(open) {
  const isOpen = open ?? !iconPicker.classList.contains("open");
  iconPicker.classList.toggle("open", isOpen);
  iconBtn.classList.toggle("active", isOpen);
}

iconBtn.addEventListener("click", () => togglePicker());

iconPicker.addEventListener("click", (e) => {
  const opt = e.target.closest(".icon-opt");
  if (!opt) return;
  iconChosenByHand = true;
  setIcon(opt.dataset.icon);
  togglePicker(false);
  titleInput.focus();
});

document.addEventListener("mousedown", (e) => {
  if (!iconPicker.contains(e.target) && e.target !== iconBtn) togglePicker(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") togglePicker(false);
});

titleInput.addEventListener("input", () => {
  if (iconChosenByHand) return;
  setIcon(suggestIcon(titleInput.value) || DEFAULT_ICON);
});

addForm.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target === titleInput) {
    e.preventDefault();
    addForm.requestSubmit();
  }
});

addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = titleInput.value.trim();
  if (!title) return;
  const where = addWhere;
  const before = new Set(lastData.subGoals.map((g) => g.id));
  const data = await api.add_subgoal(title, selectedIcon, where);
  const added = data.subGoals.find((g) => !before.has(g.id));
  setWhere("end");
  titleInput.value = "";
  iconChosenByHand = false;
  setIcon(DEFAULT_ICON);
  togglePicker(false);
  // a step put somewhere other than the usual spot flashes once so you see where it landed
  render(data, added && where !== "end" ? { flashId: added.id, flash: where } : {});
});

buildPicker();

// where a new step goes: start / end (before the finish) / as the finish
const whereBtn = document.getElementById("whereBtn");
const whereMenu = document.getElementById("whereMenu");
const WHERE_LABELS = { start: "следующим", end: "перед финишем", finish: "финишем 🏁" };
let addWhere = "end";

function setWhere(where) {
  addWhere = where;
  addForm.dataset.where = where;
  whereBtn.textContent = WHERE_LABELS[where];
  whereBtn.classList.toggle("finish", where === "finish");
  whereMenu.querySelectorAll("[data-where]").forEach((b) => b.classList.toggle("on", b.dataset.where === where));
}

whereBtn.addEventListener("click", () => {
  togglePicker(false);
  whereMenu.classList.toggle("open");
});

whereMenu.addEventListener("click", (e) => {
  const opt = e.target.closest("[data-where]");
  if (!opt) return;
  setWhere(opt.dataset.where);
  whereMenu.classList.remove("open");
  titleInput.focus();
});

document.addEventListener("mousedown", (e) => {
  if (!whereMenu.contains(e.target) && e.target !== whereBtn) whereMenu.classList.remove("open");
});

// ---------- Road scrolling: drag, momentum, wheel ----------

// every scroll goes through one animated target so drag, wheel and
// auto-centering never fight each other
let scrollTarget = 0;
let scrollAnim = null;
let momentum = 0;

function maxScroll() {
  return Math.max(0, roadWrap.scrollWidth - roadWrap.clientWidth);
}

function clampScroll(x) {
  return Math.min(maxScroll(), Math.max(0, x));
}

function runScroll() {
  if (scrollAnim) return;
  const tick = () => {
    if (momentum) {
      scrollTarget = clampScroll(scrollTarget + momentum);
      momentum *= 0.92;
      if (Math.abs(momentum) < 0.3) momentum = 0;
    }
    const cur = roadWrap.scrollLeft;
    const diff = scrollTarget - cur;
    if (Math.abs(diff) < 0.5 && !momentum) {
      roadWrap.scrollLeft = scrollTarget;
      scrollAnim = null;
      return;
    }
    roadWrap.scrollLeft = cur + diff * 0.2;
    scrollAnim = requestAnimationFrame(tick);
  };
  scrollAnim = requestAnimationFrame(tick);
}

function scrollRoadTo(x) {
  momentum = 0;
  scrollTarget = clampScroll(x);
  runScroll();
}

let drag = null;
let suppressClick = false;
let userScrolled = false;

// A finger scrolls the road with the browser's own momentum scrolling, which runs off the
// main thread. A script moving scrollLeft on every frame can't match that on a phone, and
// that is what made the road stutter there. Mouse and pen keep the scripted drag below.
let lastTouchAt = 0;

roadWrap.addEventListener("pointerdown", (e) => {
  suppressClick = false;
  if (e.pointerType === "touch") {
    lastTouchAt = Date.now();
    momentum = 0;
    if (scrollAnim) {
      cancelAnimationFrame(scrollAnim);
      scrollAnim = null;
    }
    scrollTarget = roadWrap.scrollLeft;
    return;
  }
  if (e.button !== 0 || e.target.closest(".node-del")) return;
  momentum = 0;
  scrollTarget = roadWrap.scrollLeft;
  drag = { startX: e.clientX, startLeft: roadWrap.scrollLeft, lastX: e.clientX, lastT: e.timeStamp, v: 0, moved: false, id: e.pointerId };
});

roadWrap.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.startX;
  if (!drag.moved) {
    if (Math.abs(dx) < 5) return;
    drag.moved = true;
    userScrolled = true;
    roadWrap.setPointerCapture(e.pointerId);
    roadWrap.classList.add("dragging");
  }
  const dt = Math.max(1, e.timeStamp - drag.lastT);
  drag.v = 0.8 * ((drag.lastX - e.clientX) / dt) + 0.2 * drag.v;
  drag.lastX = e.clientX;
  drag.lastT = e.timeStamp;
  scrollTarget = clampScroll(drag.startLeft - dx);
  applyDragScroll();
});

// a mouse can fire pointermove far more often than the screen refreshes; writing
// scrollLeft on each one repaints the road several times per frame
let dragFrame = null;
function applyDragScroll() {
  if (dragFrame) return;
  dragFrame = requestAnimationFrame(() => {
    dragFrame = null;
    roadWrap.scrollLeft = scrollTarget;
  });
}

function endDrag(e) {
  if (!drag || (e && e.pointerId !== drag.id)) return;
  if (dragFrame) {
    cancelAnimationFrame(dragFrame);
    dragFrame = null;
    roadWrap.scrollLeft = scrollTarget;
  }
  if (drag.moved) {
    suppressClick = true;
    roadWrap.classList.remove("dragging");
    // keep gliding in the direction of the throw (px per frame ≈ px/ms * 16)
    momentum = drag.v * 16;
    runScroll();
  }
  drag = null;
}
roadWrap.addEventListener("pointerup", endDrag);
roadWrap.addEventListener("pointercancel", endDrag);

// keep the scripted scroll's target in step with where a native swipe left the road
roadWrap.addEventListener(
  "scroll",
  () => {
    if (scrollAnim || drag) return;
    scrollTarget = roadWrap.scrollLeft;
    if (Date.now() - lastTouchAt < 3000) userScrolled = true;
  },
  { passive: true }
);

// a drag must not also count as a click on the circle it started on
roadWrap.addEventListener(
  "click",
  (e) => {
    if (suppressClick) {
      e.stopPropagation();
      e.preventDefault();
      suppressClick = false;
    }
  },
  true
);

roadWrap.addEventListener(
  "wheel",
  (e) => {
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!delta) return;
    e.preventDefault();
    userScrolled = true;
    momentum = 0;
    scrollTarget = clampScroll(scrollTarget + delta * (e.deltaMode === 1 ? 40 : 1));
    runScroll();
  },
  { passive: false }
);

// re-layout whenever the road area changes size (window resize, fonts, quote height)
let lastData = null;
let lastRoadSize = "";
new ResizeObserver(() => {
  const size = roadWrap.clientWidth + "x" + roadWrap.clientHeight;
  if (lastData && size !== lastRoadSize) {
    lastRoadSize = size;
    render(lastData, { scrollToCurrent: !userScrolled });
  }
}).observe(roadWrap);

// start only after every script on the page (quotes, icons, goal plan) has loaded
window.addEventListener("DOMContentLoaded", async () => {
  const data = await api.get_data();
  render(data, { scrollToCurrent: true });
  if (typeof Sync !== "undefined") Sync.start();
  showGreetScreen(() => {
    openGoals("goals");
    // a phone that still holds only the demo goal has one job: get the real goals from the computer
    if (data.fresh && !PREVIEW && typeof Sync !== "undefined") Sync.openSetup();
    else afterStart(data);
  });
});
