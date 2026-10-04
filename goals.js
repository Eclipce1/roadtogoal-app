// "My goals" screen: every goal as a tree branch with its steps underneath.

const navRail = document.getElementById("navRail");
const goalsEl = document.getElementById("goalsView");
const goalsPanel = goalsEl.querySelector(".goals-panel");
const expandedGoals = new Set();
let goalsMode = "graph";
let goalsSection = "goals"; // "goals" | "plan" — the nav-rail tabs

// section is optional: pass it to jump straight to a tab, or omit to keep the current one
function openGoals(section) {
  if (!lastData) return;
  if (section) goalsSection = section;
  expandedGoals.add(lastData.activeGoalId);
  renderGoals();
  goalsEl.classList.add("open");
  updateNavRail();
}

function closeGoals() {
  goalsEl.classList.remove("open");
  Graph.stop();
  updateNavRail();
}

// highlights whichever nav-rail item matches what's on screen right now
function updateNavRail() {
  const active = goalsEl.classList.contains("open") ? goalsSection : "road";
  navRail.querySelectorAll("[data-nav]").forEach((b) => b.classList.toggle("on", b.dataset.nav === active));
  // the rail dot flags work waiting in "Планирование": red once a past day was
  // left unfinished, plain sky while it's only today's list that's still open
  const dot = document.getElementById("planNavDot");
  if (dot && lastData) {
    const overdue = overdueInfo().items > 0;
    const todayLeft = agendaItems(todayISO()).some((it) => !it.done);
    dot.hidden = !overdue && !todayLeft;
    dot.classList.toggle("alert", overdue);
  }
}

navRail.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-nav]");
  if (!btn) return;
  navRail.classList.remove("open");
  if (btn.dataset.nav === "road") closeGoals();
  else openGoals(btn.dataset.nav);
});

/* ---------- making the hidden panel findable ---------- */

// Hovering the edge is the quick way in, but nothing on screen says so. The tab
// at the edge can also be clicked, and the panel closes when the cursor leaves.
document.getElementById("navHandle").addEventListener("click", (e) => {
  e.stopPropagation();
  navRail.classList.toggle("open");
  markRailSeen();
});
navRail.addEventListener("mouseleave", () => navRail.classList.remove("open"));

const RAIL_SEEN_KEY = "roadtogoal_rail_seen";
const RAIL_SHOWN_KEY = "roadtogoal_rail_shown";
const RAIL_PEEKS = 3; // how many launches may demo the panel before it gives up

function railSeen() {
  try {
    return localStorage.getItem(RAIL_SEEN_KEY) === "1";
  } catch {
    return true; // no storage: just don't nag
  }
}

function markRailSeen() {
  navRail.classList.remove("unseen");
  try {
    localStorage.setItem(RAIL_SEEN_KEY, "1");
  } catch {}
}

// On the first launches the panel slides out by itself for a moment: movement is
// what makes someone notice it at all. Until it has been opened once the tab also
// breathes softly — both stop for good as soon as the panel is used.
function introduceRail() {
  if (railSeen()) return;
  navRail.classList.add("unseen");
  let shown = 0;
  try {
    shown = +localStorage.getItem(RAIL_SHOWN_KEY) || 0;
    localStorage.setItem(RAIL_SHOWN_KEY, String(shown + 1));
  } catch {}
  if (shown >= RAIL_PEEKS) return;
  setTimeout(() => {
    navRail.classList.add("peek");
    setTimeout(() => navRail.classList.remove("peek"), 2600);
  }, 900);
}

navRail.addEventListener("mouseenter", markRailSeen);

function goalDeadlineText(g) {
  if (!g.deadline) return "";
  const left = daysBetween(todayISO(), g.deadline);
  if (left < 0) return "срок прошёл";
  if (left === 0) return "срок сегодня";
  return `${left} ${plural(left, "день", "дня", "дней")}`;
}

function goalRow(g, isFirst, isLast) {
  const total = g.steps.length;
  const done = g.steps.filter((s) => s.done).length;
  const current = g.steps.findIndex((s) => !s.done);
  const finished = total > 0 && done === total;
  const classes = [
    "tree-goal",
    expandedGoals.has(g.id) ? "open" : "",
    g.id === lastData.activeGoalId ? "active" : "",
    finished ? "finished" : "",
  ].join(" ");

  const steps = total
    ? g.steps
        .map((s, i) => {
          const state = s.done ? "done" : i === current ? "current" : "locked";
          const isFinish = !!s.finish;
          return `
          <div class="tree-row step-row ${state}${isFinish ? " finish" : ""}" data-act="step" data-step="${s.id}">
            <span class="tree-dot">${s.done ? "✓" : ""}</span>
            <span class="tree-step-icon">${escapeHtml(s.reward)}</span>
            <span class="tree-name">${escapeHtml(s.title)}</span>
            ${state === "current" ? '<span class="tree-now">сейчас</span>' : ""}
          </div>`;
        })
        .join("")
    : '<div class="tree-empty">Шагов пока нет — добавь их на дорожке</div>';

  return `
    <div class="${classes}" data-goal="${g.id}">
      <div class="tree-row goal-row" data-act="goto">
        <button type="button" class="tree-caret" data-act="toggle" title="Показать шаги">
          <svg viewBox="0 0 10 10" width="10" height="10"><path d="M3 1.5 L7 5 L3 8.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <span class="tree-icon">${escapeHtml(g.icon)}</span>
        <span class="tree-name">${escapeHtml(upperFirst(g.mainGoal || "Без названия"))}</span>
        <span class="tree-meta">${goalDeadlineText(g)}</span>
        <span class="tree-bar"><i style="transform: scaleX(${total ? done / total : 0})"></i></span>
        <span class="tree-count">${done}/${total}</span>
        <span class="tree-order">
          <button type="button" class="tree-move" data-act="move-up" title="Переместить выше" ${isFirst ? "disabled" : ""}>↑</button>
          <button type="button" class="tree-move" data-act="move-down" title="Переместить ниже" ${isLast ? "disabled" : ""}>↓</button>
        </span>
        <button type="button" class="tree-del" data-act="delete" title="Удалить цель">✕</button>
      </div>
      <div class="tree-children"><div class="tree-children-inner">${steps}</div></div>
    </div>`;
}

function goalsMainHtml() {
  const goals = lastData.goals;
  const body =
    goalsMode === "graph"
      ? `<div class="graph-wrap">
           <svg class="graph"></svg>
           <div class="graph-legend">
             <span><i class="lg-goal"></i>цель</span><span><i class="lg-done"></i>пройден</span>
             <span><i class="lg-cur"></i>сейчас</span><span><i class="lg-lock"></i>впереди</span>
           </div>
           <div class="graph-hint">Клик — открыть · тяни точку или фон · колесо — масштаб</div>
         </div>`
      : `<div class="goals-list">
           <div class="tree">${goals.map((g, i) => goalRow(g, i === 0, i === goals.length - 1)).join("")}</div>
         </div>`;
  return `
    <div class="goals-top">
      <div>
        <div class="goals-title">Мои цели</div>
        <div class="goals-sub">${goals.length} ${plural(goals.length, "цель", "цели", "целей")}</div>
      </div>
      <div class="goals-tools">
        ${reminderControl()}
        ${autostartControl()}
        ${typeof Sync !== "undefined" ? Sync.controlHtml() : ""}
        <div class="seg">
          <button type="button" data-act="mode" data-mode="graph" class="${goalsMode === "graph" ? "on" : ""}">Граф</button>
          <button type="button" data-act="mode" data-mode="list" class="${goalsMode === "list" ? "on" : ""}">Список</button>
        </div>
        <button type="button" class="goals-new-btn" data-act="new">+ Новая цель</button>
      </div>
    </div>
    ${body}`;
}

function renderGoals() {
  // rebuilding the panel replaces its scrollable body with a fresh element, which
  // starts at scrollTop 0 — that read as the screen "jumping to the top" on every
  // click inside it. Carry the scroll position across the rebuild.
  const oldScroller = goalsPanel.querySelector(".an-body, .agenda-body, .goals-list");
  const scrollTop = oldScroller ? oldScroller.scrollTop : 0;

  goalsPanel.innerHTML =
    goalsSection === "plan" ? agendaMainHtml() : goalsMainHtml();
  if (goalsSection === "goals" && goalsMode === "graph") Graph.mount(goalsPanel.querySelector(".graph"), lastData);
  else Graph.stop();
  updateNavRail();

  const newScroller = goalsPanel.querySelector(".an-body, .agenda-body, .goals-list");
  if (newScroller) newScroller.scrollTop = scrollTop;
}

function reminderControl() {
  const r = (lastData.settings && lastData.settings.reminder) || { enabled: false, time: "20:00" };
  return `
    <div class="remind-wrap">
      <button type="button" class="remind-btn${r.enabled ? " on" : ""}" data-act="remind-open" title="Напоминание">
        <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 8a5 5 0 0 1 10 0c0 5 2 6 2 6H3s2-1 2-6"/><path d="M8.5 17a1.6 1.6 0 0 0 3 0"/>
        </svg>
        ${r.enabled ? r.time : "Напоминание"}
      </button>
      <div class="remind-pop">
        <div class="remind-row">
          <span>Напоминать каждый день</span>
          <button type="button" class="switch${r.enabled ? " on" : ""}" data-act="remind-switch" aria-label="Включить напоминание"><i></i></button>
        </div>
        <label class="remind-row">
          <span>Во сколько</span>
          <input type="time" class="remind-time" value="${r.time}" />
        </label>
        <p class="remind-note">Если в этот день по цели ещё не было шага, придёт уведомление Windows с подсказкой, что сделать. Работает, даже когда приложение закрыто.</p>
        <p class="remind-error" hidden>Не получилось включить напоминание в Windows. Попробуй ещё раз.</p>
      </div>
    </div>`;
}

async function applyReminder(enabled) {
  const time = goalsPanel.querySelector(".remind-time").value || "20:00";
  const data = await api.set_reminder(enabled, time);
  lastData = data;
  const wrap = goalsPanel.querySelector(".remind-wrap");
  const wasOpen = wrap.classList.contains("open");
  wrap.outerHTML = reminderControl();
  const fresh = goalsPanel.querySelector(".remind-wrap");
  if (wasOpen) fresh.classList.add("open");
  if (data.reminderError) fresh.querySelector(".remind-error").hidden = false;
}

function autostartControl() {
  const on = !!(lastData.settings && lastData.settings.autostart);
  return `
    <div class="remind-wrap autostart-wrap">
      <button type="button" class="remind-btn${on ? " on" : ""}" data-act="autostart-open" title="Запуск с Windows">
        <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="10" cy="10" r="7"/><path d="M10 6.3v4l2.6 1.8"/>
        </svg>
        Автозапуск
      </button>
      <div class="remind-pop">
        <div class="remind-row">
          <span>Запускать при входе в Windows</span>
          <button type="button" class="switch${on ? " on" : ""}" data-act="autostart-switch" aria-label="Включить автозапуск"><i></i></button>
        </div>
        <p class="remind-note">Приложение само откроется, когда ты включишь компьютер и войдёшь в Windows.</p>
        <p class="remind-error" hidden>Не получилось включить автозапуск в Windows. Попробуй ещё раз.</p>
      </div>
    </div>`;
}

async function applyAutostart(enabled) {
  const data = await api.set_autostart(enabled);
  lastData = data;
  const wrap = goalsPanel.querySelector(".autostart-wrap");
  const wasOpen = wrap.classList.contains("open");
  wrap.outerHTML = autostartControl();
  const fresh = goalsPanel.querySelector(".autostart-wrap");
  if (wasOpen) fresh.classList.add("open");
  if (data.autostartError) fresh.querySelector(".remind-error").hidden = false;
}

async function switchGoal(id) {
  if (id !== lastData.activeGoalId) {
    const data = await api.select_goal(id);
    userScrolled = false;
    fillLen = 0;
    render(data, { scrollToCurrent: true });
  }
  closeGoals();
}

goalsPanel.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  const goalEl = el.closest(".tree-goal");
  const goalId = goalEl ? +goalEl.dataset.goal : null;

  if (act === "remind-open") {
    el.closest(".remind-wrap").classList.toggle("open");
    return;
  }
  if (act === "remind-switch") {
    applyReminder(!el.classList.contains("on"));
    return;
  }
  if (act === "autostart-open") {
    el.closest(".remind-wrap").classList.toggle("open");
    return;
  }
  if (act === "autostart-switch") {
    applyAutostart(!el.classList.contains("on"));
    return;
  }
  if (act === "mode") {
    goalsMode = el.dataset.mode;
    renderGoals();
  }
  else if (act === "toggle") {
    e.stopPropagation();
    goalEl.classList.toggle("open");
    if (goalEl.classList.contains("open")) expandedGoals.add(goalId);
    else expandedGoals.delete(goalId);
  } else if (act === "goto") switchGoal(goalId);
  else if (act === "step") {
    await switchGoal(goalId);
    openStepCard(+el.dataset.step);
  } else if (act === "move-up" || act === "move-down") {
    e.stopPropagation();
    lastData = await api.move_goal(goalId, act === "move-up" ? -1 : 1);
    renderGoals();
  } else if (act === "delete") {
    e.stopPropagation();
    const g = lastData.goals.find((x) => x.id === goalId);
    const ok = await confirmDialog({
      title: `Удалить цель «${escapeHtml(upperFirst(g.mainGoal))}»?`,
      text: "Вместе с ней удалятся все её шаги, план и серия дней. Это нельзя отменить.",
      yes: "Удалить",
      no: "Оставить",
    });
    if (!ok) return;
    const wasActive = goalId === lastData.activeGoalId;
    const data = await api.delete_goal(goalId);
    if (wasActive) {
      userScrolled = false;
      fillLen = 0;
    }
    render(data, { scrollToCurrent: wasActive });
    renderGoals();
  } else if (act === "new") {
    const data = await api.create_goal();
    userScrolled = false;
    fillLen = 0;
    render(data);
    closeGoals();
    setTimeout(() => openWizard(data), 250);
  }
});

goalsPanel.addEventListener("change", (e) => {
  if (!e.target.classList.contains("remind-time")) return;
  const r = lastData.settings && lastData.settings.reminder;
  if (r && r.enabled) applyReminder(true);
});

goalsPanel.addEventListener("mousedown", (e) => {
  goalsPanel.querySelectorAll(".remind-wrap.open").forEach((wrap) => {
    if (!wrap.contains(e.target)) wrap.classList.remove("open");
  });
});

window.addEventListener("resize", () => {
  if (goalsEl.classList.contains("open") && goalsMode === "graph") Graph.refit();
});

// Esc toggles between the road and "My goals". It runs in the capture phase so it sees
// what was open *before* other Esc handlers (step card, wizard, pickers) close things.
document.addEventListener(
  "keydown",
  (e) => {
    if (e.key !== "Escape") return;
    const isOpen = (el) => el && el.classList.contains("open");
    if (isOpen(goalsEl)) {
      if (!isOpen(confirmEl) && !document.querySelector(".remind-wrap.open")) closeGoals();
      return;
    }
    if (isOpen(whereMenu)) {
      whereMenu.classList.remove("open");
      return;
    }
    const layerOpen =
      card ||
      wiz ||
      [confirmEl, reviewEl, backEl, iconPicker].some(isOpen) ||
      document.querySelector(".plan-wrap.open");
    if (layerOpen) return;
    const active = document.activeElement;
    if (active && active.matches("input, textarea")) {
      active.blur();
      return;
    }
    openGoals();
  },
  true
);

updateNavRail();
window.addEventListener("DOMContentLoaded", introduceRail);
