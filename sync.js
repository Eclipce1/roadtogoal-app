// Keeps the phone and the computer in step through a private GitHub repository.
//
// The same code runs in the Windows app and on the phone. It never talks to a server of
// ours: each device reads and writes one JSON file in the user's own repo, merges what it
// finds with what it has, and hands the result back to its local store through
// api.export_store() / api.import_store().
//
// The unit of merging is a goal (whole), a day's plan (whole) and the goal list's order:
// whichever device changed it last wins. Photos are kept out of the main file, in
// blobs/<hash>.txt, so the history of the main file stays small.

const Sync = (() => {
  const DEFAULT_REPO = "Eclipce1/roadtogoal-data";
  const GITHUB = "https://api.github.com";
  const FILE = "data.json";
  const PLAN_PAST_DAYS = 60; // same cutoff main.py applies
  const POLL_MS = 90 * 1000;
  const DEBOUNCE_MS = 4000;

  let cfg = {}; // {token, repo, baseSha, lastSyncAt}
  const state = { syncing: false, error: "", at: 0 };
  let debounce = null;
  let running = false;
  let again = false;
  let remoteCache = null; // {etag, sha, core}
  let lastFp = ""; // fingerprint of the local data at the end of the last sync
  const hashOf = new Map(); // photo data URL -> short hash

  /* ---------- small helpers ---------- */

  const clone = (x) => JSON.parse(JSON.stringify(x));
  const num = (x) => Number(x) || 0;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  // JSON with sorted keys, so two equal stores always compare equal as text
  function stable(x) {
    if (Array.isArray(x)) return "[" + x.map(stable).join(",") + "]";
    if (x && typeof x === "object") {
      return (
        "{" +
        Object.keys(x)
          .sort()
          .filter((k) => x[k] !== undefined)
          .map((k) => JSON.stringify(k) + ":" + stable(x[k]))
          .join(",") +
        "}"
      );
    }
    return JSON.stringify(x);
  }

  // what actually has to match between devices: not this device's settings or open goal
  const fingerprint = (store) => stable({ ...store, settings: undefined, activeGoalId: undefined, fresh: undefined });

  function utf8ToB64(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function b64ToUtf8(b64) {
    const bin = atob(b64.replace(/\s/g, ""));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }

  async function shortHash(text) {
    if (hashOf.has(text)) return hashOf.get(text);
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
    hashOf.set(text, hex);
    return hex;
  }

  /* ---------- merging two copies of the data ---------- */

  function cutoffDay() {
    const d = new Date();
    d.setDate(d.getDate() - PLAN_PAST_DAYS);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // Both devices run this on the same two inputs and must reach the same answer, or they
  // would keep overwriting each other. So every tie is broken by comparing the content.
  function pickNewer(a, b, stampOf) {
    const ta = num(stampOf(a));
    const tb = num(stampOf(b));
    if (ta !== tb) return ta > tb ? a : b;
    return stable(a) >= stable(b) ? a : b;
  }

  function mergeStores(local, remote) {
    const out = clone(local);
    delete out.fresh;

    // goals: whole goals, the later change wins; a deletion wins over an older edit
    const tomb = { ...(remote.deletedGoals || {}) };
    for (const [id, ts] of Object.entries(local.deletedGoals || {})) tomb[id] = Math.max(num(tomb[id]), num(ts));
    const byId = new Map(local.goals.map((g) => [g.id, g]));
    for (const g of remote.goals) {
      const mine = byId.get(g.id);
      byId.set(g.id, mine ? pickNewer(mine, g, (x) => x.updatedAt) : g);
    }
    for (const [id, ts] of Object.entries(tomb)) {
      const g = byId.get(Number(id));
      if (g && num(g.updatedAt) <= num(ts)) byId.delete(Number(id));
    }

    // order follows whichever device last changed it (a tie is settled by the order itself)
    const ordKey = (s) => s.goals.map((g) => g.id).join(",");
    const ta = num(local.orderAt);
    const tb = num(remote.orderAt);
    const localFirst = ta !== tb ? ta > tb : ordKey(local) >= ordKey(remote);
    const [first, second] = localFirst ? [local, remote] : [remote, local];
    const order = [];
    for (const g of [...first.goals, ...second.goals]) if (byId.has(g.id) && !order.includes(g.id)) order.push(g.id);
    out.goals = order.map((id) => clone(byId.get(id)));
    if (!out.goals.length) out.goals = clone(local.goals); // never end up with nothing
    out.deletedGoals = tomb;
    out.orderAt = Math.max(num(local.orderAt), num(remote.orderAt));

    // each day's plan and mark travel together
    const cutoff = cutoffDay();
    const days = new Set(
      [local, remote].flatMap((s) => [...Object.keys(s.plans || {}), ...Object.keys(s.marks || {}), ...Object.keys(s.daysAt || {})])
    );
    out.plans = {};
    out.marks = {};
    out.daysAt = {};
    for (const day of days) {
      if (day < cutoff) continue;
      const lt = num((local.daysAt || {})[day]);
      const rt = num((remote.daysAt || {})[day]);
      const snap = (s) => stable({ p: (s.plans || {})[day], m: (s.marks || {})[day] });
      const src = lt !== rt ? (rt > lt ? remote : local) : snap(local) >= snap(remote) ? local : remote;
      if ((src.plans || {})[day] !== undefined) out.plans[day] = clone(src.plans[day]);
      if ((src.marks || {})[day] !== undefined) out.marks[day] = src.marks[day];
      if (Math.max(lt, rt)) out.daysAt[day] = Math.max(lt, rt);
    }

    out.nextPlanId = Math.max(num(local.nextPlanId) || 1, num(remote.nextPlanId) || 1);
    out.version = Math.max(num(local.version), num(remote.version)) || 3;
    return out;
  }

  /* ---------- photos live outside the main file ---------- */

  async function externalize(store) {
    const core = clone(store);
    // what each device keeps for itself never goes to the cloud
    delete core.settings;
    delete core.activeGoalId;
    delete core.fresh;
    const blobs = new Map();
    for (const g of core.goals) {
      for (const step of g.subGoals || []) {
        for (const im of step.images || []) {
          if (!im.src) continue;
          const key = await shortHash(im.src);
          blobs.set(key, im.src);
          im.ref = key;
          delete im.src;
        }
      }
    }
    return { core, blobs };
  }

  async function localPhotoIndex(store) {
    const index = new Map();
    for (const g of store.goals) {
      for (const step of g.subGoals || []) {
        for (const im of step.images || []) if (im.src) index.set(await shortHash(im.src), im.src);
      }
    }
    return index;
  }

  async function internalize(core, index) {
    const store = clone(core);
    for (const g of store.goals) {
      for (const step of g.subGoals || []) {
        if (!step.images) continue;
        const kept = [];
        for (const im of step.images) {
          if (!im.src && im.ref) {
            im.src = index.get(im.ref) || (await fetchBlob(im.ref));
            if (im.src) hashOf.set(im.src, im.ref);
          }
          delete im.ref;
          if (im.src) kept.push(im);
        }
        step.images = kept;
      }
    }
    return store;
  }

  /* ---------- talking to GitHub ---------- */

  class SyncError extends Error {}
  class Conflict extends Error {}

  async function call(method, path, body, accept, extraHeaders) {
    let res;
    try {
      res = await fetch(`${cfg.apiBase || GITHUB}/repos/${cfg.repo || DEFAULT_REPO}/contents/${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          Accept: accept || "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(extraHeaders || {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
    } catch (e) {
      throw new SyncError("Нет связи с интернетом");
    }
    if (res.status === 401) throw new SyncError("Токен не подошёл. Создай новый и подключи заново.");
    if (res.status === 403) {
      const left = res.headers.get("x-ratelimit-remaining");
      throw new SyncError(left === "0" ? "GitHub просит подождать (слишком много запросов)." : "Нет доступа: у токена должно быть право Contents → Read and write.");
    }
    return res;
  }

  async function fetchBlob(ref) {
    const res = await call("GET", `blobs/${ref}.txt`, null, "application/vnd.github.raw+json");
    return res.ok ? await res.text() : "";
  }

  async function getCore() {
    const res = await call("GET", FILE, null, null, remoteCache && remoteCache.etag ? { "If-None-Match": remoteCache.etag } : null);
    if (res.status === 304 && remoteCache) return remoteCache;
    if (res.status === 404) return null;
    if (!res.ok) throw new SyncError(`GitHub ответил ошибкой ${res.status}`);
    const json = await res.json();
    let text;
    if (json.content) text = b64ToUtf8(json.content);
    else {
      const raw = await call("GET", FILE, null, "application/vnd.github.raw+json");
      text = await raw.text();
    }
    remoteCache = { etag: res.headers.get("etag") || "", sha: json.sha, core: JSON.parse(text) };
    return remoteCache;
  }

  async function listBlobs() {
    const res = await call("GET", "blobs");
    if (res.status === 404) return new Set();
    if (!res.ok) throw new SyncError(`GitHub ответил ошибкой ${res.status}`);
    return new Set((await res.json()).map((f) => f.name.replace(/\.txt$/, "")));
  }

  async function putFile(path, text, sha, message) {
    const res = await call("PUT", path, { message, content: utf8ToB64(text), ...(sha ? { sha } : {}) });
    if (res.status === 409 || res.status === 422) throw new Conflict(path);
    if (!res.ok) throw new SyncError(`Не удалось записать в GitHub (ошибка ${res.status})`);
    return (await res.json()).content.sha;
  }

  async function push(store, sha) {
    const { core, blobs } = await externalize(store);
    if (blobs.size) {
      const have = await listBlobs();
      for (const [key, src] of blobs) {
        if (have.has(key)) continue;
        try {
          await putFile(`blobs/${key}.txt`, src, null, "photo");
        } catch (e) {
          if (!(e instanceof Conflict)) throw e; // already there: fine
        }
      }
    }
    const newSha = await putFile(FILE, JSON.stringify(core), sha, "sync " + new Date().toISOString());
    remoteCache = null; // our own write changed the file; re-read next time
    return newSha;
  }

  /* ---------- one round of syncing ---------- */

  function busy() {
    const a = document.activeElement;
    const typing = a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA") && !a.classList.contains("sync-token");
    const roadMoving = (typeof drag !== "undefined" && drag) || (typeof scrollAnim !== "undefined" && scrollAnim);
    return (typeof card !== "undefined" && card) || typing || roadMoving;
  }

  async function applyImport(merged) {
    const view = await api.import_store(merged);
    lastData = view;
    render(view, { scrollToCurrent: false });
    if (document.getElementById("goalsView").classList.contains("open")) renderGoals();
  }

  async function round() {
    const remote = await getCore();
    const local = await api.export_store();
    const isFresh = !!local.fresh;

    if (!remote) {
      // nothing in the cloud yet: the first device to connect puts its data there
      if (isFresh) throw new SyncError("В облаке пока пусто, а на телефоне только пример. Сначала подключи компьютер.");
      const sha = await push(local, null);
      cfg = { ...cfg, baseSha: sha };
      lastFp = fingerprint(local);
      return;
    }

    if (remote.sha === cfg.baseSha && fingerprint(local) === lastFp) return; // nothing new on either side

    const remoteStore = await internalize(remote.core, await localPhotoIndex(local));
    let merged;
    if (isFresh) {
      merged = remoteStore; // the phone's demo goal is not data: take the real thing as it is
    } else if (!cfg.baseSha && typeof confirmDialog === "function" && LOCAL_MODE && !PREVIEW) {
      const ok = await confirmDialog({
        title: "Заменить цели на телефоне?",
        text: "На телефоне уже есть свои цели. Если подключить синхронизацию, они заменятся данными с компьютера (копия останется на телефоне).",
        yes: "Заменить",
        no: "Отмена",
      });
      if (!ok) throw new SyncError("Подключение отменено");
      merged = remoteStore;
    } else {
      merged = mergeStores(local, remoteStore);
    }

    // Changes from the other device wait while the user is in the middle of editing;
    // pushing our own side never has to wait.
    let deferred = false;
    if (fingerprint(merged) !== fingerprint(local)) {
      if (busy()) deferred = true;
      else await applyImport(merged);
    }

    let sha = remote.sha;
    if (fingerprint(merged) !== fingerprint(remoteStore)) sha = await push(merged, remote.sha);
    cfg = { ...cfg, baseSha: sha };
    // measured after the import: the store may have tidied the data on its way in
    lastFp = deferred ? "" : fingerprint(await api.export_store());
    if (deferred) schedule(5000);
  }

  async function syncNow() {
    if (!cfg.token) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    state.syncing = true;
    refreshUi();
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await round();
          state.error = "";
          state.at = Date.now();
          cfg = { ...cfg, lastSyncAt: state.at };
          await api.set_sync_config(cfg);
          break;
        } catch (e) {
          if (e instanceof Conflict && attempt < 2) {
            remoteCache = null; // someone wrote in between: read again and merge again
            continue;
          }
          throw e;
        }
      }
    } catch (e) {
      state.error = e instanceof SyncError ? e.message : "Не получилось синхронизировать: " + (e.message || e);
    } finally {
      running = false;
      state.syncing = false;
      refreshUi();
      if (again) {
        again = false;
        schedule(500);
      }
    }
  }

  function schedule(ms) {
    clearTimeout(debounce);
    debounce = setTimeout(syncNow, ms);
  }

  /* ---------- the "Синхронизация" button in "Мои цели" ---------- */

  const hhmm = (ms) => new Date(ms).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

  function controlHtml() {
    const on = !!cfg.token;
    let body;
    if (!on) {
      body = `
        <div class="remind-row"><span>Связать телефон и компьютер</span></div>
        <p class="remind-note">Цели хранятся в твоём приватном репозитории GitHub и подтягиваются на оба устройства. Вставь токен доступа — один раз на каждом устройстве.</p>
        <input type="password" class="sync-token" placeholder="github_pat_…" autocomplete="off" autocapitalize="off" spellcheck="false" />
        <button type="button" class="sync-go" data-act="sync-connect">Подключить</button>
        <p class="remind-error sync-msg" hidden></p>`;
    } else {
      const line = state.syncing
        ? "Синхронизирую…"
        : state.error
        ? `<span class="sync-err">${esc(state.error)}</span>`
        : state.at || cfg.lastSyncAt
        ? `Синхронизировано в ${hhmm(state.at || cfg.lastSyncAt)}`
        : "Подключено";
      body = `
        <div class="remind-row"><span>${line}</span></div>
        <div class="sync-actions">
          <button type="button" data-act="sync-now">Синхронизировать сейчас</button>
          <button type="button" class="sync-off" data-act="sync-off">Отключить</button>
        </div>`;
    }
    return `
      <div class="remind-wrap sync-wrap">
        <button type="button" class="remind-btn${on && !state.error ? " on" : ""}" data-act="sync-open" title="Синхронизация между телефоном и компьютером">
          <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 10a6 6 0 0 1 10.2-4.3L16 7.5M16 10a6 6 0 0 1-10.2 4.3L4 12.5"/><path d="M16 4v3.5h-3.5M4 16v-3.5h3.5"/>
          </svg>
          Синхронизация${on && state.error ? " ⚠" : ""}
        </button>
        <div class="remind-pop">${body}</div>
      </div>`;
  }

  function refreshUi() {
    const wrap = document.querySelector(".sync-wrap");
    if (!wrap) return;
    const open = wrap.classList.contains("open");
    const keep = wrap.querySelector(".sync-token") ? wrap.querySelector(".sync-token").value : "";
    wrap.outerHTML = controlHtml();
    const fresh = document.querySelector(".sync-wrap");
    if (open) fresh.classList.add("open");
    if (keep && fresh.querySelector(".sync-token")) fresh.querySelector(".sync-token").value = keep;
  }

  function showMsg(text) {
    const m = document.querySelector(".sync-wrap .sync-msg");
    if (!m) return;
    m.textContent = text;
    m.hidden = !text;
  }

  async function connect() {
    const input = document.querySelector(".sync-wrap .sync-token");
    const token = input ? input.value.trim() : "";
    if (!token) return showMsg("Вставь токен.");
    cfg = { token, repo: DEFAULT_REPO, baseSha: "", lastSyncAt: 0, ...(cfg.apiBase ? { apiBase: cfg.apiBase } : {}) };
    showMsg("");
    remoteCache = null;
    lastFp = "";
    state.error = "";
    // check the token before saving it: the repo's folder listing needs read access
    try {
      const res = await call("GET", "");
      if (res.status === 404) throw new SyncError("Репозиторий roadtogoal-data не найден или у токена нет к нему доступа.");
      if (!res.ok) throw new SyncError(`GitHub ответил ошибкой ${res.status}`);
    } catch (e) {
      cfg = {};
      return showMsg(e instanceof SyncError ? e.message : "Не получилось проверить токен.");
    }
    await api.set_sync_config(cfg);
    refreshUi();
    await syncNow();
    if (!state.error) bindTriggers();
    if (state.error) {
      // a failed first round (e.g. "connect the computer first") must not leave a half-connected state
      const msg = state.error;
      cfg = {};
      await api.set_sync_config(null);
      state.error = "";
      refreshUi();
      showMsg(msg);
    }
  }

  async function disconnect() {
    cfg = {};
    remoteCache = null;
    lastFp = "";
    state.error = "";
    await api.set_sync_config(null);
    refreshUi();
  }

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act^='sync-']");
    if (!el) return;
    const act = el.dataset.act;
    if (act === "sync-open") el.closest(".remind-wrap").classList.toggle("open");
    else if (act === "sync-connect") connect();
    else if (act === "sync-now") syncNow();
    else if (act === "sync-off") disconnect();
  });

  /* ---------- when to sync ---------- */

  function touch() {
    if (cfg.token) schedule(DEBOUNCE_MS);
  }

  let bound = false;
  function bindTriggers() {
    if (bound) return;
    bound = true;
    setInterval(() => cfg.token && document.visibilityState === "visible" && syncNow(), POLL_MS);
    document.addEventListener("visibilitychange", () => {
      if (!cfg.token) return;
      if (document.visibilityState === "visible") schedule(500);
      else syncNow(); // best effort before the phone puts the app to sleep
    });
    window.addEventListener("focus", () => cfg.token && schedule(500));
  }

  async function start() {
    cfg = (await api.get_sync_config()) || {};
    refreshUi();
    if (!cfg.token) return;
    state.at = cfg.lastSyncAt || 0;
    bindTriggers();
    schedule(1500);
  }

  // opens the connection window by itself, for a phone that has nothing of its own yet
  function openSetup() {
    if (cfg.token) return;
    setTimeout(() => {
      const wrap = document.querySelector(".sync-wrap");
      if (wrap) wrap.classList.add("open");
    }, 350);
  }

  return { start, touch, syncNow, openSetup, controlHtml, mergeStores, fingerprint };
})();
