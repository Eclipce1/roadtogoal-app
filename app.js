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
    st.subjects = Array.isArray(st.subjects) ? st.subjects : [];
    st.deletedSubjects = st.deletedSubjects || {};
    st.version = st.version || 3;
    st.goals.forEach((g) => (g.updatedAt = g.updatedAt || 0));
    return st;
  };
  const readStore = () => {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (raw && raw.goals && raw.goals.length) return withSyncFields(raw);
    // "fresh" marks this demo goal as nothing of the user's own: syncing replaces it
    // with the real data instead of merging it in or pushing it anywhere
    return withSyncFields({
      fresh: true,
      // an id no goal made on the computer will ever have: if this demo goal gets edited
      // before the first sync, it must not overwrite a real goal that happens to be number 1
      activeGoalId: 99999,
      goals: [
        newGoal(99999, { mainGoal: "Моя цель" }),
      ],
    });
  };
  // The store (photos included) can run to hundreds of KB. Parsing and rewriting all of it
  // on every tap is what a phone feels as a stutter, so it is read once, kept in memory, and
  // written back a moment after the last change (and whenever the page is put away).
  let cache = null;
  let dirty = false;
  let flushTimer = 0;
  const load = () => cache || (cache = readStore());
  let storageWarned = false;
  const flush = () => {
    clearTimeout(flushTimer);
    flushTimer = 0;
    if (!dirty || !cache) return;
    dirty = false;
    try {
      localStorage.setItem(KEY, JSON.stringify(cache));
    } catch (e) {
      // a phone browser gives each app only a few MB; losing changes silently would be worse
      if (!storageWarned) {
        storageWarned = true;
        alert("Не удалось сохранить: у приложения на этом устройстве закончилось место. Удали несколько фото из шагов.");
      }
    }
  };
  const save = (st) => {
    cache = st;
    dirty = true;
    if (!flushTimer) flushTimer = setTimeout(flush, 400);
  };
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
  // another window of the app wrote to the same storage: forget what we remembered
  window.addEventListener("storage", (e) => {
    if (e.key === KEY && !dirty) cache = null;
  });
  // a copy that shares the (immutable) strings: photos are not duplicated byte by byte
  const filesDb = (mode, fn) =>
    new Promise((resolve, reject) => {
      const open = indexedDB.open("roadtogoal_files", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("files");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("files", mode);
        const req = fn(tx.objectStore("files"));
        tx.oncomplete = () => {
          db.close();
          resolve(req && req.result);
        };
        tx.onerror = tx.onabort = () => reject(tx.error);
      };
    });
  // forget the stored bytes of files no task mentions any more (the cloud keeps its copy)
  const dropUnusedFiles = (st) => {
    const used = new Set(st.subjects.flatMap((s) => s.tasks.flatMap((t) => (t.files || []).map((f) => f.id))));
    filesDb("readonly", (s) => s.getAllKeys())
      .then((keys) => (keys || []).filter((k) => !used.has(k)))
      .then((stale) => stale.length && filesDb("readwrite", (s) => stale.forEach((k) => s.delete(k))))
      .catch(() => {});
  };
  const newId = () => Math.random().toString(16).slice(2, 10).padEnd(8, "0");
  const copy = (x) =>
    Array.isArray(x)
      ? x.map(copy)
      : x && typeof x === "object"
      ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, copy(v)]))
      : x;
  const settingsOf = (st) => ({
    reminder: { enabled: false, time: "20:00" },
    planReminder: { enabled: false, time: "21:30" },
    autostart: false,
    ...(st.settings || {}),
  });
  const view = (st) => {
    const g = st.goals.find((x) => x.id === st.activeGoalId);
    return {
      ...copy(g),
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
      subjects: copy(st.subjects || []),
    };
  };
  // goalId is optional: the analytics screen addresses goals other than the active one.
  // A change to a goal stamps it, so the sync knows which device touched it last.
  const change = (fn, goalId) => {
    const st = load();
    const goal = (goalId && st.goals.find((x) => x.id === goalId)) || st.goals.find((x) => x.id === st.activeGoalId);
    try {
      fn(goal, st);
    } catch (e) {
      cache = null; // half-applied: go back to what was saved
      throw e;
    }
    goal.updatedAt = Date.now();
    delete st.fresh;
    save(st);
    return view(st);
  };
  // changes to the store itself (goal list, day plans) stamp what they touch on their own
  const edit = (fn) => {
    const st = load();
    try {
      fn(st);
    } catch (e) {
      cache = null;
      throw e;
    }
    delete st.fresh;
    save(st);
    return view(st);
  };
  // looking at things or per-device settings: not a change anyone else needs to hear about
  const quiet = (fn) => {
    const st = load();
    try {
      fn(st);
    } catch (e) {
      cache = null;
      throw e;
    }
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
    reorder_goals: async (order) =>
      edit((st) => {
        const byId = new Map(st.goals.map((g) => [g.id, g]));
        const seen = order.filter((i) => byId.has(i));
        const next = [...seen.map((i) => byId.get(i)), ...st.goals.filter((g) => !seen.includes(g.id))];
        if (next.every((g, k) => g === st.goals[k])) return;
        st.goals = next;
        st.orderAt = Date.now();
      }),
    // ---- study: subjects and their tasks (ids are random, so two devices never collide) ----
    add_subject: async (name) =>
      edit((st) => {
        name = String(name || "").trim().slice(0, 80);
        if (name) st.subjects.push({ id: newId(), name, updatedAt: Date.now(), tasks: [] });
      }),
    rename_subject: async (id, name) =>
      edit((st) => {
        const sub = st.subjects.find((x) => x.id === id);
        name = String(name || "").trim().slice(0, 80);
        if (sub && name) {
          sub.name = name;
          sub.updatedAt = Date.now();
        }
      }),
    delete_subject: async (id) =>
      edit((st) => {
        if (!st.subjects.some((x) => x.id === id)) return;
        st.subjects = st.subjects.filter((x) => x.id !== id);
        st.deletedSubjects[id] = Date.now();
        dropUnusedFiles(st);
      }),
    add_task: async (subjectId, title, text = "", due = "") =>
      edit((st) => {
        const sub = st.subjects.find((x) => x.id === subjectId);
        title = String(title || "").trim().slice(0, 200);
        if (!sub || !title) return;
        sub.tasks.push({
          id: newId(), title, text: String(text || "").slice(0, 20000),
          due: /^20\d\d-\d\d-\d\d$/.test(due) ? due : "", status: "new", doneAt: "", files: [],
        });
        sub.updatedAt = Date.now();
      }),
    update_task: async (subjectId, taskId, patch) =>
      edit((st) => {
        const sub = st.subjects.find((x) => x.id === subjectId);
        const task = sub && sub.tasks.find((t) => t.id === taskId);
        if (!task || !patch) return;
        if ("title" in patch && String(patch.title).trim()) task.title = String(patch.title).trim().slice(0, 200);
        if ("text" in patch) task.text = String(patch.text).slice(0, 20000);
        if ("due" in patch) task.due = /^20\d\d-\d\d-\d\d$/.test(patch.due) ? patch.due : "";
        if (["new", "doing", "done"].includes(patch.status)) {
          task.status = patch.status;
          task.doneAt = patch.status === "done" ? today() : "";
        }
        sub.updatedAt = Date.now();
      }),
    delete_task: async (subjectId, taskId) =>
      edit((st) => {
        const sub = st.subjects.find((x) => x.id === subjectId);
        if (!sub) return;
        sub.tasks = sub.tasks.filter((t) => t.id !== taskId);
        sub.updatedAt = Date.now();
        dropUnusedFiles(st);
      }),
    // the bytes of a task's files live in IndexedDB (localStorage is far too small for them);
    // the task keeps only {id, name, type, size}
    put_file: async (id, dataUrl) => {
      try {
        await filesDb("readwrite", (s) => s.put(dataUrl, id));
        return true;
      } catch (e) {
        return false;
      }
    },
    get_file: async (id) => {
      try {
        return (await filesDb("readonly", (s) => s.get(id))) || "";
      } catch (e) {
        return "";
      }
    },
    add_task_file: async (subjectId, taskId, meta) =>
      edit((st) => {
        const sub = st.subjects.find((x) => x.id === subjectId);
        const task = sub && sub.tasks.find((t) => t.id === taskId);
        if (!task || !meta || !/^[0-9a-f]{24}$/.test(String(meta.id))) return;
        task.files = task.files || [];
        if (task.files.length >= 12 || task.files.some((f) => f.id === meta.id)) return;
        task.files.push({
          id: meta.id, name: String(meta.name || "файл").slice(0, 200),
          type: String(meta.type || "").slice(0, 100), size: Number(meta.size) || 0,
        });
        sub.updatedAt = Date.now();
      }),
    remove_task_file: async (subjectId, taskId, fileId) =>
      edit((st) => {
        const sub = st.subjects.find((x) => x.id === subjectId);
        const task = sub && sub.tasks.find((t) => t.id === taskId);
        if (!task) return;
        task.files = (task.files || []).filter((f) => f.id !== fileId);
        sub.updatedAt = Date.now();
        dropUnusedFiles(st);
      }),
    // how this device looks and behaves (the road picture, the camera): kept with the other settings
    set_ui_pref: async (key, value) => quiet((st) => (st.settings = { ...settingsOf(st), [key]: value })),
    set_reminder: async (enabled, time) =>
      quiet((st) => (st.settings = { ...settingsOf(st), reminder: { enabled: !!enabled, time } })),

    // ---- sync: the page merges, the store only hands data over and takes it back ----
    export_store: async () => copy(load()),
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
            // a finished step has all its "how to do it" actions done
            if (s.actions) s.actions = s.actions.map((a) => ({ ...a, done: true }));
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
        if (typeof day !== "string" || day > today()) return;
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
    move_plan_item: async (fromDay, itemId, toDay) =>
      edit((st) => {
        const cutoff = (() => {
          const d = new Date();
          d.setDate(d.getDate() - 60);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        })();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(toDay) || toDay === fromDay || toDay < cutoff) return;
        const item = (st.plans[fromDay] || []).find((it) => it.id === itemId);
        if (!item) return;
        st.plans[fromDay] = st.plans[fromDay].filter((it) => it.id !== itemId);
        (st.plans[toDay] = st.plans[toDay] || []).push(item);
        st.daysAt[fromDay] = st.daysAt[toDay] = Date.now();
      }),
    clear_overdue_plan: async () =>
      edit((st) => {
        const t = today();
        Object.keys(st.plans).forEach((day) => {
          if (day >= t) return;
          const kept = st.plans[day].filter((it) => it.done);
          if (kept.length === st.plans[day].length) return;
          st.plans[day] = kept;
          st.daysAt[day] = Date.now();
        });
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
  "set_reminder", "set_plan_reminder", "set_autostart", "set_ui_pref", "put_file", "get_file", "open_file",
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
let trackAreaBg = null;
let trackArea = null;
let litRect = null;
let trackGlow = null;
let trackFill = null;
let fillLen = 0;

// A node is taller below its circle (step number, title, actions) than above it
// (the "now" tag), so the circles sit a bit above the middle to centre the whole block.
const NODE_BLOCK_SHIFT = 28;
// room a node needs besides the wave itself: tag above + circle + labels below
const NODE_BLOCK_HEIGHT = 268;

// The camera: the road scrolls by itself after him as he walks. Can be switched off in the settings.
const CAMERA_KEY = "roadtogoal_camera";
// How the app looks is kept in the app's own settings (the desktop app's page has a different
// address every launch, so the browser's storage there is forgotten each time); the browser's
// storage is only the fallback, and what a phone started with before this was kept.
function uiPref(key, storageKey) {
  const fromData = lastData && lastData.settings ? lastData.settings[key] : undefined;
  if (fromData !== undefined) return fromData;
  try {
    return localStorage.getItem(storageKey);
  } catch (e) {
    return null;
  }
}

function saveUiPref(key, storageKey, value) {
  try {
    localStorage.setItem(storageKey, String(value));
  } catch (e) {}
  if (lastData) lastData.settings = { ...(lastData.settings || {}), [key]: value };
  api.set_ui_pref(key, value).then((d) => {
    if (d && d.settings) lastData.settings = d.settings;
  }).catch(() => {});
}

function cameraOn() {
  const v = uiPref("camera", CAMERA_KEY);
  return v !== false && v !== "off" && v !== "false";
}

function setCamera(on) {
  saveUiPref("camera", CAMERA_KEY, !!on);
}

// The road can be drawn two ways, chosen in the settings and kept on this device:
// "road" is the winding line, "stairs" a staircase with a little man climbing it.
const ROAD_THEME_KEY = "roadtogoal_road_theme";
function roadTheme() {
  return uiPref("roadTheme", ROAD_THEME_KEY) === "stairs" ? "stairs" : "road";
}

function setRoadTheme(theme) {
  saveUiPref("roadTheme", ROAD_THEME_KEY, theme);
  climber.state = null; // a new picture: start the man in place, do not walk him across
  if (lastData) render(lastData, { scrollToCurrent: true });
}

// stairs: room above the highest step for the man, room below the lowest for the labels
const STAIRS_TOP = 92;
const STAIRS_BOTTOM = 128;
const STAIR_H_MAX = 22; // every small stair is this high at most, and all of them equally high
const STAIR_W_MAX = 26;
const LANDING_HALF = 46;
const LEAD = 44; // a little level ground before the first flight and after the last landing
const DEFAULT_STAIRS = 1;
const MAX_STAIRS = 8;

// The flight of small stairs that leads up to a step has as many stairs as the step has actions
// ("how to do it" in its card): think big, act small. A step with no actions has a single stair.
function stairsInto(step) {
  const n = ((step && step.actions) || []).filter((a) => a.text).length;
  return n ? Math.min(MAX_STAIRS, n) : DEFAULT_STAIRS;
}

// how many of the step's stairs he has climbed: its done actions, spread over its stairs
function stairsClimbed(step, k) {
  const acts = ((step && step.actions) || []).filter((a) => a.text);
  if (!acts.length) return 0;
  return Math.min(k, Math.round((acts.filter((a) => a.done).length / acts.length) * k));
}

// `ks` is how many small stairs lead up to each step. All stairs share one height (and one width):
// a longer flight simply rises further, a shorter one is followed by more level ground.
function stairsLayout(count, height, ks) {
  const room = Math.max(0, height - STAIRS_TOP - STAIRS_BOTTOM);
  const total = ks.reduce((a, b) => a + b, 0);
  const h = total ? Math.max(3, Math.min(STAIR_H_MAX, room / total)) : 0;
  const w = Math.min(STAIR_W_MAX, (STEP_X - 2 * LANDING_HALF) / Math.max(1, ...ks.slice(1)));
  const x0 = Math.max(SIDE_PAD, LANDING_HALF + LEAD + ks[0] * w + 20); // room for the first flight
  const used = STAIRS_TOP + STAIRS_BOTTOM + total * h;
  const ground = Math.max(0, (height - used) / 2) + STAIRS_TOP + total * h;
  const points = [];
  let up = 0;
  for (let i = 0; i < count; i++) {
    up += ks[i];
    points.push({ x: x0 + i * STEP_X, y: ground - up * h, h, w });
  }
  points.ground = ground;
  return points;
}

// `upTo` stops in the middle of that landing; without it the whole stairs are drawn
function stairsPath(points, upTo) {
  if (!points.length) return "";
  const last = upTo === undefined ? points.length - 1 : upTo;
  const first = points[0];
  let d = `M ${first.x - LANDING_HALF - first.k * first.w - LEAD} ${points.ground}`;
  for (let i = 0; i <= last; i++) {
    const p = points[i];
    const yPrev = i ? points[i - 1].y : points.ground;
    const start = p.x - LANDING_HALF - p.k * p.w; // each flight stands right in front of its landing
    d += ` H ${start}`;
    for (let j = 1; j <= p.k; j++) d += ` V ${yPrev - p.h * j} H ${start + p.w * j}`;
    d += i === last && upTo !== undefined ? ` H ${p.x}` : ` H ${p.x + LANDING_HALF}`;
  }
  if (upTo === undefined) d += ` H ${points[last].x + LANDING_HALF + LEAD}`;
  return d;
}

// the same outline closed down to the bottom of the picture: a soft light under the stairs
function stairsArea(points, upTo, bottom) {
  if (!points.length) return "";
  const first = points[0];
  return `${stairsPath(points, upTo)} V ${bottom} H ${first.x - LANDING_HALF - first.k * first.w - LEAD} Z`;
}

function layout(count, height, ks) {
  if (roadTheme() === "stairs") return stairsLayout(count, height, ks);
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
  svg.innerHTML =
    '<defs><clipPath id="litClip"><rect id="litRect" x="0" y="-20" width="99999" height="2000"/></clipPath><linearGradient id="stairsLight" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--white)" stop-opacity=".16"/><stop offset="1" style="stop-color:var(--white)" stop-opacity="0"/></linearGradient></defs>' +
    '<path class="track-area-bg" d="" /><path class="track-area" d="" />' +
    '<path class="track-bg" d="" /><path class="track-glow" d="" /><path class="track-fill" d="" />';
  trackAreaBg = svg.querySelector(".track-area-bg");
  trackArea = svg.querySelector(".track-area");
  trackBg = svg.querySelector(".track-bg");
  trackGlow = svg.querySelector(".track-glow");
  trackFill = svg.querySelector(".track-fill");
  litRect = svg.querySelector("#litRect");
  // the lit part of the stairs is shown through this clip: on the stairs it follows the man
  [trackArea, trackGlow, trackFill].forEach((p) => p.setAttribute("clip-path", "url(#litClip)"));
}

function drawTrack(points, reachIndex, animate, finished, litWidth = 99999) {
  ensureTrackPaths();
  const width = points.length ? points[points.length - 1].x + SIDE_PAD : 0;
  svg.setAttribute("width", width);
  svg.setAttribute("height", roadWrap.clientHeight);
  nodesLayer.style.width = width + "px";

  const stairs = roadTheme() === "stairs";
  // the clip left over from a walk on the stairs must not cut a road drawn afterwards
  if (climber.lit) {
    climber.lit.cancel();
    climber.lit = null;
  }
  litRect.setAttribute("width", String(litWidth));
  litRect.setAttribute("height", roadWrap.clientHeight + 40);
  if (stairs) animate = false; // the lit trail is drawn by the walk itself (see placeClimber)
  trackBg.setAttribute("d", stairs ? stairsPath(points) : pathFromPoints(points));
  if (!stairs) {
    trackAreaBg.setAttribute("d", "");
    trackArea.setAttribute("d", "");
  }
  if (!points.length) {
    trackFill.setAttribute("d", "");
    trackGlow.setAttribute("d", "");
    fillLen = 0;
    return;
  }

  const doneD = stairs ? stairsPath(points, finished ? undefined : reachIndex) : pathFromPoints(points.slice(0, reachIndex + 1));
  if (stairs) {
    const bottom = roadWrap.clientHeight;
    trackAreaBg.setAttribute("d", stairsArea(points, undefined, bottom));
    trackArea.setAttribute("d", stairsArea(points, finished ? undefined : reachIndex, bottom));
  }
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
  roadWrap.classList.toggle("theme-stairs", roadTheme() === "stairs");
  document.body.classList.toggle("road-stairs", roadTheme() === "stairs");
  const stairsOn = roadTheme() === "stairs" && total > 0;
  const stairCounts = data.subGoals.map(stairsInto);
  const points = layout(total, roadWrap.clientHeight, stairCounts);
  points.forEach((p, i) => (p.k = stairCounts[i]));
  const firstNotDone = data.subGoals.findIndex((g) => !g.done);
  // on the stairs the man's place follows the work done in the step, and the lit trail follows him
  let track = null;
  let st = null;
  let climb = null;
  if (stairsOn) {
    track = stairsTrack(points);
    st = stairsState(points, data);
    climb = planClimb(points, track, data, opts, st);
  }
  const plan = climb && climb.plan;
  let litReach = firstNotDone === -1 ? total - 1 : firstNotDone;
  let litFin = total > 0 && firstNotDone === -1;
  let litWidth = 99999;
  if (stairsOn) {
    litReach = st.c;
    litFin = st.fin;
    if (plan && climber.state) {
      // while he walks the trail is drawn as far as it reaches before or after, and clipped to him
      litReach = Math.max(st.c, climber.state.c);
      litFin = st.fin || climber.state.fin;
    }
    litWidth = st.fin ? points[points.length - 1].x + LANDING_HALF + LEAD : track[climb.newIdx].x + 10;
  }
  drawTrack(points, litReach, !!opts.justCompleted, litFin, litWidth);

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
      ${stairsOn && isFinish && plan && plan.liftAt[g.id] !== undefined ? `<div class="stair-flag big"><svg class="stair-flag-svg" viewBox="0 0 22 36" width="22" height="36"><path d="M3 35V2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/><path class="flag-cloth" d="M3 3 L20 8.5 L3 15Z" fill="#4ade80"/></svg></div>` : ""}
      ${stairsOn && (g.done || isFinish || (plan && plan.liftAt[g.id] !== undefined)) ? `<div class="stair-flag${isFinish ? " big" : ""}${g.done || (plan && plan.liftAt[g.id] !== undefined) ? " planted" : ""}${plan && plan.flagAt[g.id] !== undefined ? " planting" : ""}${plan && plan.liftAt[g.id] !== undefined ? " lifting" : ""}"${plan && plan.flagAt[g.id] !== undefined ? ` style="animation-delay:${plan.flagAt[g.id]}ms"` : plan && plan.liftAt[g.id] !== undefined ? ` style="animation-delay:${plan.liftAt[g.id]}ms"` : ""}><svg class="stair-flag-svg" viewBox="0 0 22 36" width="22" height="36"><path d="M3 35V2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/><path class="flag-cloth" d="M3 3 L20 8.5 L3 15Z" fill="#4ade80"/></svg></div>` : ""}
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
  placeClimber(points, track, data, st, climb);
  const walking = plan ? plan.tl[plan.tl.length - 1].t : 0;
  if (plan) followClimber(walking); // the camera goes with him
  const sceneOn = !!(opts.justCompleted || (opts.justReset && opts.justReset.length));
  // road theme and the first placement: one glide to the step, unless the camera is off for scenes
  const scrollTo = (x) => {
    if (plan) return; // the follow loop is doing it
    if (sceneOn && !cameraOn()) return;
    scrollRoadTo(x);
  };
  const flashIndex = data.subGoals.findIndex((g) => g.id === opts.flashId);
  if (flashIndex !== -1) {
    scrollTo(points[flashIndex].x - roadWrap.clientWidth / 2);
  } else if (opts.scrollToCurrent && firstNotDone !== -1) {
    scrollTo(points[firstNotDone].x - roadWrap.clientWidth / 2);
  }
  updateNavRail();
  updateDayClock();
}

/* ---------- the little man on the stairs ---------- */

// 44 x 70 box, feet on the bottom edge. Limbs are separate so they can swing while he walks.
const CLIMBER_SVG = `
  <svg viewBox="0 0 44 70" width="44" height="70" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
    <g class="cl-leg cl-leg-b"><path d="M20 42 L31 50 L31 66" stroke-width="7.5"/></g>
    <g class="cl-arm cl-arm-b">
      <path d="M24 23 L32 27 L37 20" stroke-width="5.5"/>
      <g class="cl-flag">
        <path d="M37 24 V-4" stroke-width="2.2"/>
        <path class="flag-cloth" d="M37.5 -3 L54 2.5 L37.5 9Z" fill="#4ade80" stroke="none"/>
      </g>
    </g>
    <path d="M24 19 L20 42" stroke-width="9.5"/>
    <g class="cl-head"><circle cx="27" cy="8" r="7.5" fill="currentColor" stroke="none"/></g>
    <g class="cl-qs" fill="currentColor" stroke="none" font-weight="800" font-size="14" text-anchor="middle">
      <g transform="translate(6 -1) rotate(-18)"><g class="cl-q cl-q1"><text class="cl-qt">?</text></g></g>
      <g transform="translate(24 -12)"><g class="cl-q cl-q2"><text class="cl-qt">?</text></g></g>
      <g transform="translate(42 -3) rotate(18)"><g class="cl-q cl-q3"><text class="cl-qt">?</text></g></g>
    </g>
    <g class="cl-leg cl-leg-a"><path d="M20 42 L14 67" stroke-width="7.5"/></g>
    <g class="cl-arm cl-arm-a"><path d="M24 23 L15 31 L14 41" stroke-width="5.5"/></g>
    <g class="cl-cheer">
      <path d="M24 24 L10 10 M24 24 L39 12" stroke-width="5.5"/>
      <path d="M40 14 V-14" stroke-width="2.2"/>
      <path class="flag-cloth" d="M40.5 -13 L58 -7.5 L40.5 -1Z" fill="#4ade80" stroke="none"/>
    </g>
    <g class="cl-props" stroke="none">
      <g transform="translate(38 28)"><g class="cl-prop cl-book">
        <path d="M-13 -7 L0 -4 L13 -7 L13 6 L0 9 L-13 6 Z" fill="#3b82f6"/>
        <path d="M-11.5 -5.6 L0 -2.8 L11.5 -5.6 L11.5 4.8 L0 7.6 L-11.5 4.8 Z" fill="#e2e8f0"/>
        <path d="M0 -2.8 V7.6" stroke="#64748b" stroke-width="1" fill="none"/>
        <g class="cl-page"><path d="M0 -2.8 L11.5 -5.6 L11.5 4.8 L0 7.6 Z" fill="#f8fafc" stroke="#94a3b8" stroke-width=".6"/></g>
      </g></g>
      <g transform="translate(42 25)"><g class="cl-prop cl-glass"><g class="cl-sweep">
        <circle r="7" fill="#93c5fd" fill-opacity=".25" stroke="#fbbf24" stroke-width="2.4"/>
        <path d="M5 5 L11.5 11.5" stroke="#fbbf24" stroke-width="3.2" stroke-linecap="round" fill="none"/>
        <path d="M-3.6 -2.4 A4.4 4.4 0 0 1 -0.6 -4.6" stroke="#fff" stroke-width="1.2" stroke-linecap="round" fill="none"/>
      </g></g></g>
      <g transform="translate(40 26)"><g class="cl-prop cl-pad">
        <rect x="-8" y="-10" width="16" height="20" rx="2" fill="#fde68a"/>
        <rect x="-8" y="-10" width="16" height="3.5" rx="1.5" fill="#f59e0b"/>
        <path class="cl-ln cl-ln1" pathLength="1" d="M-5 -3 H5" stroke="#92400e" stroke-width="1.2" stroke-linecap="round" fill="none"/>
        <path class="cl-ln cl-ln2" pathLength="1" d="M-5 1.5 H5" stroke="#92400e" stroke-width="1.2" stroke-linecap="round" fill="none"/>
        <path class="cl-ln cl-ln3" pathLength="1" d="M-5 6 H2" stroke="#92400e" stroke-width="1.2" stroke-linecap="round" fill="none"/>
        <g class="cl-pen"><path d="M3 4 L10 -3" stroke="#f97316" stroke-width="2.2" stroke-linecap="round" fill="none"/></g>
      </g></g>
      <g transform="translate(38 25)"><g class="cl-prop cl-phone">
        <rect x="-5" y="-9" width="10" height="18" rx="2.2" fill="#0f172a" stroke="#94a3b8" stroke-width="1.2"/>
        <g class="cl-screen"><rect x="-3.4" y="-6.4" width="6.8" height="12" rx="1" fill="#38bdf8"/><path d="M-2 -3 H2 M-2 0 H2 M-2 3 H1" stroke="#e0f2fe" stroke-width="1" stroke-linecap="round" fill="none"/></g>
      </g></g>
      <g transform="translate(38 28)"><g class="cl-prop cl-mug"><g class="cl-sip">
        <rect x="-5" y="-4" width="10" height="9" rx="1.6" fill="#f59e0b"/>
        <path d="M5 -2 C9 -2 9 3 5 3" stroke="#f59e0b" stroke-width="1.6" fill="none"/>
        <g class="cl-steam" stroke="#e5e7eb" stroke-width="1.2" stroke-linecap="round" fill="none">
          <path class="cl-st cl-st1" d="M-2.5 -6 C-4 -8 -1 -10 -2.5 -12"/><path class="cl-st cl-st2" d="M0.5 -6 C-1 -8 2 -10 0.5 -12"/><path class="cl-st cl-st3" d="M3.5 -6 C2 -8 5 -10 3.5 -12"/>
        </g>
      </g></g></g>
      <g transform="translate(25 -15)"><g class="cl-prop cl-bulb">
        <g stroke="#fde047" stroke-width="1.6" stroke-linecap="round" fill="none"><path d="M0 -12 V-9 M-9 -8 L-7 -6.5 M9 -8 L7 -6.5 M-12 0 H-9 M12 0 H9"/></g>
        <circle r="6" fill="#fde047"/><rect x="-3" y="5" width="6" height="3.4" rx="1" fill="#a8a29e"/>
      </g></g>
      <g transform="translate(25 -15)"><g class="cl-prop cl-bang"><text text-anchor="middle" font-size="17" font-weight="800" fill="#fbbf24" y="4">!</text></g></g>
      <g transform="translate(36 11) rotate(-20)"><g class="cl-prop cl-scope"><g class="cl-pan">
        <rect x="-2" y="-3.2" width="22" height="6.4" rx="2" fill="#14b8a6"/>
        <rect x="15" y="-4.2" width="6" height="8.4" rx="1.6" fill="#0f766e"/>
        <rect x="-3" y="-2.2" width="3" height="4.4" rx="1" fill="#99f6e4"/>
      </g></g></g>
      <g transform="translate(9 3)" fill="#93c5fd" font-weight="800" text-anchor="middle">
        <g class="cl-prop cl-z cl-z1"><text font-size="8">z</text></g>
        <g class="cl-prop cl-z cl-z2"><text font-size="10">z</text></g>
        <g class="cl-prop cl-z cl-z3"><text font-size="13">Z</text></g>
      </g>
    </g>
  </svg>`;

const climber = { el: null, state: null, goal: null, px: 0, py: 0, timers: [], lit: null };

// While he stands still he does something now and then, never the same twice in a row.
const IDLE_MOVES = Object.fromEntries(["think", "scratch", "wave", "stretch", "sway", "hop", "read", "search", "notes", "phone", "coffee", "idea", "scope", "sleep", "jacks"].map((k) => [k, 15000])); // ms; each ends back in his usual pose
let idleLast = "";
let idleBag = [];
function climberIdleTick() {
  const el = climber.el;
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const walking = el && el.getAnimations().some((a) => a.playState === "running");
  const busy = !el || el.hidden || calm || document.hidden || walking || /\b(walking|planting|back|win|idle-\w+)\b/.test(el.className) || goalsEl.classList.contains("open");
  let wait = 3000;
  if (!busy) {
    // a shuffled round of all six, so every move comes up before any of them repeats
    if (!idleBag.length) {
      idleBag = Object.keys(IDLE_MOVES).sort(() => Math.random() - 0.5);
      if (idleBag[idleBag.length - 1] === idleLast) idleBag.unshift(idleBag.pop());
    }
    const kind = idleBag.pop();
    idleLast = kind;
    el.classList.add("idle-" + kind);
    // the class stays exactly as long as the move lasts, so a move is never cut off half way
    climber.timers.push(setTimeout(() => el.classList.remove("idle-" + kind), IDLE_MOVES[kind] + 30));
    wait = IDLE_MOVES[kind] + 1500 + Math.random() * 2000; // and a short rest before the next one
  }
  setTimeout(climberIdleTick, wait);
}

const FLAG_STAND = 17; // where he stands to plant a flag (the pole is a little further right)
const FINISH_STAND = 76; // after the last flag he steps beyond it, onto the level ground

// Finishing a step on the stairs is told in order: the card goes, he climbs the stairs that are
// left, walks to the flag spot, plants the flag, and walks on to the foot of the next flight.
// Undoing is the same backwards: he turns round, takes the flags up and walks down again.
const CARD_WAIT = 450; // the step card fades out first
const FLAT_SPEED = 110; // px per second on the level
const STEP_TIME = 340; // ms for one small stair
const PLANT_TIME = 1000; // the flag grows out of the ground
const PICK_TIME = 700;

// every place he can stand, in the order along the stairs: the foot of a flight, each of its
// stairs, the flag spot, the end of the landing (and beyond the last flag, the level ground)
function stairsTrack(points) {
  const W = [];
  points.forEach((p, i) => {
    const yPrev = i ? points[i - 1].y : points.ground;
    const start = p.x - LANDING_HALF - p.k * p.w;
    const prevEnd = i ? points[i - 1].x + LANDING_HALF : start - LEAD;
    W.push({ kind: "base", i, x: Math.max(start - 24, prevEnd), y: yPrev });
    for (let j = 1; j <= p.k; j++) W.push({ kind: "tread", i, j, x: start + p.w * (j - 0.5), y: yPrev - p.h * j });
    W.push({ kind: "flag", i, x: p.x + FLAG_STAND, y: p.y });
    W.push({ kind: "end", i, x: p.x + LANDING_HALF - 4, y: p.y });
    if (i === points.length - 1) W.push({ kind: "fin", i, x: p.x + FINISH_STAND, y: p.y });
  });
  return W;
}

// where the work stands: the step in hand and how many of its stairs are climbed
function stairsState(points, data) {
  const c = data.subGoals.findIndex((g) => !g.done);
  if (c === -1) return { c: points.length - 1, d: 0, fin: true };
  return { c, d: stairsClimbed(data.subGoals[c], points[c].k), fin: false };
}

function stateIndex(W, state) {
  if (state.fin) return W.length - 1;
  const base = W.findIndex((e) => e.kind === "base" && e.i === state.c);
  const k = W.filter((e) => e.kind === "tread" && e.i === state.c).length;
  return base + Math.max(0, Math.min(k, state.d));
}

// the timeline of a move: where he is and when; `marks` switch poses on and off along the way
function planClimb(points, W, data, opts, st) {
  const newIdx = stateIndex(W, st);
  const old = climber.state;
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!old || climber.goal !== data.activeGoalId || calm || old.c >= points.length) return { newIdx, plan: null };
  const oldIdx = stateIndex(W, old);

  const resetIds = opts.justReset || [];
  const doneIdx = opts.justCompleted ? data.subGoals.findIndex((g) => g.id === opts.justCompleted) : -1;
  let mode = null;
  if (resetIds.length) mode = "undo";
  else if (doneIdx !== -1 && !old.fin && old.c === doneIdx) mode = "complete";
  else if (oldIdx !== newIdx) mode = "live";
  if (!mode || (mode !== "complete" && oldIdx === newIdx)) return { newIdx, plan: null };

  // he may be in the middle of an earlier move: go on from where he is now
  const el = climber.el;
  let start = { x: climber.px, y: climber.py };
  if (el && el.getAnimations().length) {
    const m = new DOMMatrix(getComputedStyle(el).transform);
    start = { x: m.m41 + 22, y: m.m42 + 3 + 69 };
  }
  const tl = [{ t: 0, ...start }];
  const marks = [];
  const flagAt = {};
  const liftAt = {};
  const last = () => tl[tl.length - 1];
  const hold = (ms) => tl.push({ t: last().t + ms, x: last().x, y: last().y });
  const step = (e) => {
    const prev = last();
    if (Math.abs(e.y - prev.y) < 1) {
      // level ground: a plain walk
      tl.push({ t: prev.t + Math.max(150, (Math.abs(e.x - prev.x) / FLAT_SPEED) * 1000), x: e.x, y: e.y });
    } else {
      // a stair: a little lift on the way
      tl.push({ t: prev.t + STEP_TIME / 2, x: (prev.x + e.x) / 2, y: Math.min(prev.y, e.y) - 7 });
      tl.push({ t: prev.t + STEP_TIME, x: e.x, y: e.y });
    }
  };
  const on = (cls, v) => marks.push([last().t, cls, v]);
  let leaveAt = 0;

  if (mode === "complete") {
    const flagIdx = W.findIndex((e) => e.kind === "flag" && e.i === doneIdx);
    hold(CARD_WAIT);
    on("walking", true);
    for (let q = oldIdx + 1; q <= flagIdx; q++) step(W[q]);
    on("walking", false);
    on("planting", true);
    flagAt[opts.justCompleted] = last().t;
    hold(PLANT_TIME);
    leaveAt = last().t;
    on("planting", false);
    on("walking", true);
    for (let q = flagIdx + 1; q <= newIdx; q++) step(W[q]);
    on("walking", false);
    if (st.fin) on("win", true);
  } else if (mode === "undo") {
    hold(CARD_WAIT);
    on("back", true);
    on("walking", true);
    for (let q = oldIdx - 1; q >= newIdx; q--) {
      step(W[q]);
      const e = W[q];
      if (e.kind === "end" && resetIds.includes(data.subGoals[e.i].id)) {
        on("walking", false);
        on("planting", true);
        liftAt[data.subGoals[e.i].id] = last().t + 120;
        hold(PICK_TIME);
        on("planting", false);
        on("walking", true);
      }
    }
    on("walking", false);
    on("back", false);
  } else {
    on("walking", true);
    const dir = newIdx > oldIdx ? 1 : -1;
    for (let q = oldIdx + dir; q !== newIdx + dir; q += dir) step(W[q]);
    on("walking", false);
  }

  const oldWidth = old.fin ? points[points.length - 1].x + LANDING_HALF + LEAD : start.x + 10;
  return { newIdx, plan: { mode, tl, marks, flagAt, liftAt, leaveAt, oldWidth, newWidth: st.fin ? points[points.length - 1].x + LANDING_HALF + LEAD : W[newIdx].x + 10 } };
}

function placeClimber(points, W, data, st, climb) {
  if (!st) {
    if (climber.el) climber.el.hidden = true;
    climber.state = null;
    return;
  }
  if (!climber.el) {
    climber.el = document.createElement("div");
    climber.el.className = "climber";
    climber.el.innerHTML = `<div class="cl-flip">${CLIMBER_SVG}</div>`;
    setTimeout(climberIdleTick, 3000);
  }
  if (climber.el.parentNode !== nodesLayer) nodesLayer.appendChild(climber.el);
  const el = climber.el;
  el.hidden = false;

  const at = W[climb.newIdx];
  const place = (p) => `translate(${p.x - 22}px, ${p.y - 3 - 69}px)`;
  const plan = climb.plan;

  climber.timers.forEach(clearTimeout);
  climber.timers = [];
  if (climber.lit) climber.lit.cancel();
  climber.lit = null;
  el.getAnimations().forEach((a) => a.cancel());
  el.classList.remove("walking", "planting", "back", ...Object.keys(IDLE_MOVES).map((k) => "idle-" + k));
  el.classList.toggle("win", st.fin && !(plan && plan.mode === "complete"));
  el.style.transform = place(at);

  if (plan) {
    const total = plan.tl[plan.tl.length - 1].t;
    const walk = el.animate(
      plan.tl.map((f) => ({ transform: place(f), offset: f.t / total })),
      { duration: total, fill: "both", easing: "linear" }
    );
    walk.onfinish = () => el.classList.remove("walking", "planting", "back");
    plan.marks.forEach(([t, cls, on]) => {
      const apply = () => el.classList.toggle(cls, on);
      if (t <= 0) apply();
      else climber.timers.push(setTimeout(apply, t));
    });
    if (litRect) {
      // the glowing trail grows (or is taken in) with him: its front edge is where he is
      const lo = Math.min(plan.oldWidth, plan.newWidth);
      const hi = Math.max(plan.oldWidth, plan.newWidth);
      const whole = total + 300;
      const frames = plan.tl.map((f) => ({ width: `${Math.min(hi, Math.max(lo, f.x + 10))}px`, offset: f.t / whole }));
      frames.push({ width: `${plan.newWidth}px`, offset: 1 });
      climber.lit = litRect.animate(frames, { duration: whole, fill: "both", easing: "linear" });
    }
  }
  climber.state = st;
  climber.goal = data.activeGoalId;
  climber.px = at.x;
  climber.py = at.y;
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

// On a phone the bar shows just the text field and "Добавить"; the icon and "where" options
// come out while you are typing. A tap on a button doesn't focus it on iOS, so :focus-within
// can't be trusted here: the bar waits a moment before folding back.
function setBarExpanded(on) {
  addForm.classList.toggle("expanded", on);
}
titleInput.addEventListener("focus", () => setBarExpanded(true));
titleInput.addEventListener("input", () => setBarExpanded(true));
titleInput.addEventListener("blur", () => {
  setTimeout(() => {
    const stillInUse =
      titleInput.value.trim() ||
      document.activeElement === titleInput ||
      iconPicker.classList.contains("open") ||
      (typeof whereMenu !== "undefined" && whereMenu.classList.contains("open"));
    if (!stillInUse) setBarExpanded(false);
  }, 250);
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
  let frames = 0;
  const tick = () => {
    if (momentum) {
      scrollTarget = clampScroll(scrollTarget + momentum);
      momentum *= 0.92;
      if (Math.abs(momentum) < 0.3) momentum = 0;
    }
    const cur = roadWrap.scrollLeft;
    const diff = scrollTarget - cur;
    // A browser that rounds scrollLeft to whole pixels can leave a gap of a pixel or two that
    // the easing never closes, and the loop would then run (and block syncing) forever:
    // a smooth glide is over well within two seconds, so stop there and land on the target.
    if ((Math.abs(diff) < 0.5 && !momentum) || ++frames > 150) {
      roadWrap.scrollLeft = scrollTarget;
      momentum = 0;
      scrollAnim = null;
      return;
    }
    roadWrap.scrollLeft = cur + diff * 0.2;
    scrollAnim = requestAnimationFrame(tick);
  };
  scrollAnim = requestAnimationFrame(tick);
}

// While he walks the camera glides after him: every frame it closes a small part of the distance to
// where he is, so it starts and stops softly instead of jumping to a place.
let cameraFollowing = false;
let cameraRaf = null;
function followClimber(ms) {
  if (cameraRaf) cancelAnimationFrame(cameraRaf);
  const el = climber.el;
  if (!el || !cameraOn()) {
    cameraFollowing = false;
    cameraRaf = null;
    return;
  }
  cameraFollowing = true;
  const t0 = performance.now();
  const tick = () => {
    const userHasIt = drag || Date.now() - lastTouchAt < 1500;
    if (!userHasIt) {
      const m = new DOMMatrix(getComputedStyle(el).transform);
      const target = clampScroll(m.m41 + 22 - roadWrap.clientWidth * 0.45);
      const cur = roadWrap.scrollLeft;
      roadWrap.scrollLeft = Math.abs(target - cur) < 0.4 ? target : cur + (target - cur) * 0.06;
    }
    if (performance.now() - t0 < ms + 900) cameraRaf = requestAnimationFrame(tick);
    else {
      cameraFollowing = false;
      cameraRaf = null;
    }
  };
  cameraRaf = requestAnimationFrame(tick);
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

/* ---------- light / dark ---------- */

function currentTheme() {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function applyTheme(theme) {
  if (theme === "light") document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#f6f6f3" : "#000000");
  try {
    localStorage.setItem("roadtogoal_theme", theme);
  } catch (e) {}
  document.querySelectorAll(".theme-toggle").forEach(paintThemeButton);
}

const THEME_ICONS = {
  // the icon shows what a click switches to
  toSun: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  toMoon: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>',
};

function paintThemeButton(btn) {
  const light = currentTheme() === "light";
  btn.innerHTML = light ? THEME_ICONS.toMoon : THEME_ICONS.toSun;
  btn.title = light ? "Тёмная тема" : "Светлая тема";
}

function toggleTheme() {
  applyTheme(currentTheme() === "light" ? "dark" : "light");
}

function setupThemeToggle() {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "theme-toggle";
  btn.addEventListener("click", toggleTheme);
  paintThemeButton(btn);
  document.body.appendChild(btn);
}

// A button that is always there on the computer: full screen on, full screen off.
// F11 does the same, and Esc leaves full screen when nothing else is open.
function setupFullscreenToggle(startFull) {
  let full = startFull;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "fs-toggle";
  const paint = () => {
    btn.classList.toggle("on", full);
    btn.title = full ? "Свернуть в окно (Esc)" : "На весь экран (F11)";
    btn.innerHTML = full
      ? '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v4H3M13 3v4h4M7 17v-4H3M13 17v-4h4"/></svg>'
      : '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V3h4M17 7V3h-4M3 13v4h4M17 13v4h-4"/></svg>';
  };
  const toggle = async () => {
    try {
      const state = await api.toggle_fullscreen();
      full = !!(state && state.fullscreen);
    } catch (e) {}
    paint();
  };
  btn.addEventListener("click", toggle);
  document.addEventListener("keydown", (e) => {
    if (e.key === "F11") {
      e.preventDefault();
      toggle();
    } else if (e.key === "Escape" && full && !document.querySelector(".overlay.open:not(#greetScreen)") && !document.querySelector(".remind-wrap.open")) {
      toggle();
    }
  });
  paint();
  document.body.appendChild(btn);
}

// The "?" in the corner: what can be done on the screen that is open, said once and out of the way.
const HELP = {
  road: [
    ["Главная цель", "Название цели вверху можно изменить: нажми на него и печатай."],
    ["Добавить шаг", "Шаг — один этап на пути к цели. Впиши его в строку внизу и нажми «Добавить»."],
    ["Куда встанет шаг", "Кнопка «перед финишем» меняет место нового шага: сразу за пройденными, перед финишем или сам финиш."],
    ["Открыть шаг", "Нажми на кружок шага на дорожке. В карточке можно отметить шаг выполненным, разбить его на действия, записать минимум на трудный день и прикрепить фото."],
    ["Удалить шаг", "Крестик над шагом удаляет его."],
  ],
  graph: [
    ["Что на картинке", "Большая точка — цель, маленькие вокруг — её шаги. Цвета объяснены внизу слева."],
    ["Открыть", "Нажми на цель — откроется её дорожка. Нажми на шаг — откроется его карточка."],
    ["Подвинуть", "Зажми точку и потяни — она сместится. Потяни пустое место — сдвинется весь граф. Колесо мыши приближает и отдаляет."],
    ["Кнопки сверху", "«+ Новая цель» создаёт цель. «Граф / Список» переключает вид."],
  ],
  list: [
    ["Открыть цель", "Нажми на название цели — откроется её дорожка."],
    ["Посмотреть шаги", "Стрелка слева от цели раскрывает её шаги. Нажми на шаг — откроется его карточка."],
    ["Поменять порядок", "Зажми значок ⠿ на карточке цели и перетащи её выше или ниже."],
    ["Новая цель", "Кнопка «+ Новая цель» создаёт цель. «Граф / Список» переключает вид."],
  ],
  plan: [
    ["Выбрать день", "Нажми на день в ленте недели или в календаре."],
    ["Добавить дело", "Впиши его в строку «+ добавить пункт» и нажми Enter."],
    ["Отметить", "Кружок слева от дела отмечает его выполненным, крестик справа удаляет."],
    ["Перенести", "Зажми значок ⠿ и перетащи дело: выше или ниже в списке, а чтобы перенести на другой день — на этот день в ленте или в календаре."],
    ["Важный день", "Кнопка «☆ Отметить важным днём» выделяет день в календаре."],
    ["Плашка «Осталось незакрытым»", "Показывает невыполненные дела за последние две недели. Нажми на неё — откроется самый ранний такой день."],
  ],
  study: [
    ["Предметы", "Каждая плитка — предмет. Нажми на неё, чтобы увидеть задания. «+ Предмет» добавляет новый."],
    ["Задание", "Внутри предмета нажми «+ Новое задание»: впиши название, срок сдачи и текст. Файлы можно прикрепить к уже созданному заданию."],
    ["Отметить", "Кружок слева от задания отмечает его сделанным."],
    ["Сроки", "Кнопка «Сроки» показывает все задания списком по датам. Чем ближе срок, тем заметнее подсветка; у просроченных она красная."],
  ],
  day: [
    ["Что здесь", "Не больше трёх самых важных дел на сегодня: ближайшие учебные задания, дела из плана и следующий шаг к цели."],
    ["Отметить", "Кружок слева отмечает дело сделанным. Нажми на название — откроется само дело."],
    ["Ещё", "Кнопка «Ещё N →» открывает остальные дела в «Планировании»."],
    ["Отметить день", "Засчитывает сегодняшний день в серию. Кнопка появляется, если цель идёт по шагам."],
  ],
  settings: [
    ["Как устроено", "Слева разделы, справа настройки выбранного."],
    ["Напоминание", "Раз в день Windows напомнит открыть приложение."],
    ["Синхронизация", "Связывает компьютер и телефон: цели и дела одинаковы на обоих."],
    ["Закрыть", "Крестик в углу или клавиша Esc."],
  ],
};
const HELP_NAMES = { road: "Дорожка", graph: "Цели", list: "Цели", plan: "Планирование", study: "Учёба", day: "Сегодня", settings: "Настройки" };

function helpKey() {
  if (!goalsEl.classList.contains("open")) return "road";
  return goalsSection === "goals" ? (goalsMode === "graph" ? "graph" : "list") : goalsSection;
}

// Esc puts the hint away first. This listener is registered at load, before the ones that
// close "Мои цели" or leave full screen, so the same keystroke does not also do that.
let helpClose = null;
document.addEventListener(
  "keydown",
  (e) => {
    const card = document.querySelector(".help-card");
    if (e.key === "Escape" && card && !card.hidden && helpClose) {
      helpClose();
      e.stopImmediatePropagation();
    }
  },
  true
);

function setupHelpButton() {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "help-btn";
  btn.title = "Подсказка";
  btn.setAttribute("aria-label", "Подсказка");
  // a speech bubble with a question mark
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 3.4c-4.8 0-8.6 3.2-8.6 7.4 0 2.2 1 4.2 2.8 5.6l-1 3.9 4.2-1.6c.8.2 1.7.3 2.6.3 4.8 0 8.6-3.2 8.6-7.2S16.8 3.4 12 3.4z" stroke-width="1.9"/>' +
    '<path d="M9.6 9.3a2.4 2.4 0 1 1 3.5 2.1c-.8.5-1.1.9-1.1 1.8" stroke-width="2"/>' +
    '<circle cx="12" cy="15.9" r="1" fill="currentColor" stroke="none"/></svg>';
  const card = document.createElement("div");
  card.className = "help-card";
  card.hidden = true;
  const close = () => {
    card.hidden = true;
    btn.classList.remove("on");
  };
  const open = () => {
    const key = helpKey();
    const keys = [["Esc", "переключает дорожку и список целей"]];
    if (IN_DESKTOP && !PREVIEW) keys.push(["F11", "включает и выключает весь экран"]);
    card.innerHTML = `
      <div class="help-title">Как пользоваться: ${HELP_NAMES[key]}</div>
      <dl>${HELP[key].map(([name, text]) => `<dt>${name}</dt><dd>${text}</dd>`).join("")}</dl>
      <div class="help-keys">
        ${keys.map(([k, t]) => `<span><kbd>${k}</kbd> ${t}</span>`).join("")}
        <span>Меню слева выезжает, когда подвести курсор к левому краю экрана.</span>
      </div>`;
    card.classList.toggle("high", !!document.querySelector(".fs-toggle"));
    card.hidden = false;
    btn.classList.add("on");
  };
  btn.addEventListener("click", () => (card.hidden ? open() : close()));
  document.addEventListener("mousedown", (e) => {
    if (!card.hidden && !card.contains(e.target) && e.target !== btn) close();
  });
  helpClose = close;
  document.body.append(card, btn);
}

// start only after every script on the page (quotes, icons, goal plan) has loaded
window.addEventListener("DOMContentLoaded", async () => {
  const data = await api.get_data();
  render(data, { scrollToCurrent: true });
  if (typeof Sync !== "undefined") Sync.start();
  setupHelpButton();
  // opened over the whole screen by Windows: offer the way back to a normal window
  if (IN_DESKTOP && !PREVIEW) {
    try {
      const launch = await api.get_launch();
      setupFullscreenToggle(!!(launch && launch.fullscreen));
    } catch (e) {}
  }
  // with a server configured, a visitor first signs in (or chooses to go on without an account)
  if (typeof Auth !== "undefined" && Auth.enabled() && !Auth.signedIn() && !Auth.skipped()) await Auth.showScreen("login");
  // The welcome with its choice of tabs appears once a day. Later starts the same day go
  // straight back to the tab that was open last.
  const GREETED_KEY = "roadtogoal_greeted_on";
  let greetedToday = false;
  let lastTab = "";
  try {
    greetedToday = localStorage.getItem(GREETED_KEY) === todayISO();
    lastTab = localStorage.getItem("roadtogoal_last_tab") || "";
  } catch (e) {}
  if (greetedToday) {
    if (lastTab && lastTab !== "road") openGoals(lastTab);
    afterStart(data);
    return;
  }
  showGreetScreen((section) => {
    try {
      localStorage.setItem(GREETED_KEY, todayISO());
    } catch (e) {}
    openGoals(section);
    afterStart(data);
  });
});
