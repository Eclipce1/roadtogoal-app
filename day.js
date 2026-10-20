/* "Сегодня" — a calm first screen: the few things worth doing today, a quiet count of what
   already got done, and a soft way back after a break. It only reads what the other tabs
   keep (plan, study, steps); nothing here is stored on its own. */

let myMsg = ""; // the line under the title; changes as things get ticked
let myReturnSeen = null; // decided once per launch: ticking a task shouldn't make the welcome-back card vanish

const MY_MAX_ITEMS = 3;
const MY_RETURN_AFTER_DAYS = 3;
const MY_HIDE_KEY = "roadtogoal_return_hidden";

function myGreeting() {
  const h = new Date().getHours();
  const part = h < 5 ? "Доброй ночи" : h < 12 ? "Доброе утро" : h < 18 ? "Добрый день" : "Добрый вечер";
  return part;
}

// the days since anything was last changed in the app: the nearest thing to "last used"
function myIdleDays() {
  if (!lastData) return 0;
  const stamps = [];
  Object.values(lastData.daysAt || {}).forEach((t) => stamps.push(Number(t) || 0));
  (lastData.subjects || []).forEach((s) => stamps.push(Number(s.updatedAt) || 0));
  (lastData.checkins || []).forEach((d) => stamps.push(new Date(d + "T12:00:00").getTime()));
  const last = Math.max(0, ...stamps);
  if (!last) return 0;
  return Math.floor((Date.now() - last) / 86400000);
}

function myReturnHidden() {
  try {
    return localStorage.getItem(MY_HIDE_KEY) === todayISO();
  } catch (e) {
    return false;
  }
}

// up to three things, in the order that matters: what is due soon, today's list, the next step
function myItems() {
  const today = todayISO();
  const items = [];

  const hot = [];
  for (const s of studySubjects()) for (const t of s.tasks) {
    const u = taskUrgency(t);
    if (u) hot.push({ s, t, u });
  }
  hot.sort((a, b) => URGENCY_RANK[a.u] - URGENCY_RANK[b.u] || (a.t.due || "").localeCompare(b.t.due || ""));
  hot.slice(0, 2).forEach(({ s, t, u }) =>
    items.push({ kind: "study", sid: s.id, tid: t.id, title: t.title, sub: `${s.name} · ${dueText(t)}`, tag: u })
  );

  agendaItems(today)
    .filter((it) => !it.done)
    .forEach((it) => items.push({ kind: "plan", id: it.id, title: it.text, sub: "Дело на сегодня" }));

  const step = (lastData.subGoals || []).find((s) => !s.done);
  if (step) items.push({ kind: "step", id: step.id, title: step.title, sub: `Шаг цели «${lastData.mainGoal || "цель"}»` });

  return { shown: items.slice(0, MY_MAX_ITEMS), more: Math.max(0, items.length - MY_MAX_ITEMS) };
}

// what already got done in the last seven days, said as good news
function myWins() {
  const today = todayISO();
  const from = shiftISO(today, -6);
  let plan = 0;
  for (let i = 0; i < 7; i++) plan += agendaItems(shiftISO(today, -i)).filter((it) => it.done).length;
  let tasks = 0;
  for (const s of studySubjects()) for (const t of s.tasks) if (t.status === "done" && t.doneAt && t.doneAt >= from) tasks++;
  const steps = (lastData.subGoals || []).filter((g) => g.doneAt && g.doneAt >= from).length;
  const days = lastData.mode === "steps" ? (lastData.checkins || []).filter((d) => d >= from).length : 0;
  return { plan, tasks, steps, days };
}

function myWinsText(w) {
  const parts = [];
  if (w.plan) parts.push(`${w.plan} ${plural(w.plan, "дело", "дела", "дел")}`);
  if (w.tasks) parts.push(`${w.tasks} ${plural(w.tasks, "задание", "задания", "заданий")} по учёбе`);
  if (w.steps) parts.push(`${w.steps} ${plural(w.steps, "шаг", "шага", "шагов")} к цели`);
  if (w.days) parts.push(`${w.days} ${plural(w.days, "день", "дня", "дней")} с отметкой`);
  return parts.length ? `За последние 7 дней: ${parts.join(", ")}.` : "Начни с одного маленького дела — этого уже достаточно.";
}

function myItemHtml(it) {
  const key = `data-kind="${it.kind}" data-id="${it.id || ""}" data-sid="${it.sid || ""}" data-tid="${it.tid || ""}"`;
  return `
    <div class="my-item">
      <button type="button" class="my-check" data-act="my-done" ${key} title="${it.kind === "step" ? "Открыть шаг" : "Сделано"}" aria-label="${it.kind === "step" ? "Открыть шаг" : "Отметить сделанным"}"></button>
      <button type="button" class="my-main" data-act="my-open" ${key}>
        <span class="my-title">${escapeHtml(it.title)}</span>
        <span class="my-sub">${escapeHtml(it.sub)}</span>
      </button>
      ${it.tag ? `<span class="study-tag u-${it.tag}">${URGENCY_TAG[it.tag]}</span>` : ""}
    </div>`;
}

function myReturnHtml() {
  if (myReturnSeen === null) myReturnSeen = myIdleDays() >= MY_RETURN_AFTER_DAYS;
  if (!myReturnSeen || myReturnHidden()) return "";
  const stale = overdueInfo().items;
  return `
    <div class="my-card my-return">
      <div class="my-card-title">Рад, что вы вернулись</div>
      <p>Перерыв — это нормально, он ничего не ломает. Не нужно навёрстывать всё сразу: достаточно одного маленького дела сегодня.</p>
      <div class="my-actions">
        ${stale ? `<button type="button" class="study-btn primary" data-act="my-clear">Начать с чистого листа</button>` : ""}
        <button type="button" class="study-btn" data-act="my-hide-return">Спасибо, дальше сам(а)</button>
      </div>
      ${stale ? `<p class="my-note">«Чистый лист» уберёт ${stale} ${plural(stale, "невыполненное дело", "невыполненных дела", "невыполненных дел")} из прошлых дней. Сделанное и учёба останутся.</p>` : ""}
    </div>`;
}

function myReminderHtml() {
  const r = (lastData.settings && lastData.settings.reminder) || {};
  if (LOCAL_MODE || r.enabled) return "";
  return `
    <div class="my-card">
      <div class="my-card-title">Чтобы не забывать</div>
      <p>Напоминание раз в день поможет заходить сюда без усилий воли.</p>
      <div class="my-actions"><button type="button" class="study-btn" data-act="my-remind">Включить напоминание в 20:00</button></div>
    </div>`;
}

function dayMainHtml() {
  const { shown, more } = myItems();
  const today = todayISO();
  const dateText = new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
  const checkedIn = lastData.mode === "steps" && (lastData.checkins || []).includes(today);
  const stale = overdueInfo().items;

  const streak = lastData.mode === "steps" ? streakInfo(lastData.checkins).count : 0;
  return `
    <div class="goals-top">
      <div>
        <div class="goals-title">Сегодня</div>
        <div class="goals-sub">${escapeHtml(upperFirst(dateText))}</div>
      </div>
      ${streak ? `<div class="my-streak" title="Дней подряд с отметкой">Серия <b>${streak}</b></div>` : ""}
    </div>
    <div class="goals-list my-day">
      ${myMsg ? `<div class="my-line">${escapeHtml(myMsg)}</div>` : ""}
      <div class="my-items">${shown.length ? shown.map(myItemHtml).join("") : `<div class="my-empty">На сегодня всё.</div>`}</div>
      ${more ? `<button type="button" class="my-more" data-act="my-more">Ещё ${more} →</button>` : ""}
      ${
        lastData.mode === "steps"
          ? `<button type="button" class="my-checkin${checkedIn ? " on" : ""}" data-act="my-checkin">${checkedIn ? "✓ День отмечен" : "Отметить день"}</button>`
          : ""
      }
      ${stale ? `<button type="button" class="my-more my-clear" data-act="my-clear">Убрать старые невыполненные дела (${stale})</button>` : ""}
    </div>`;
}

/* ---------- actions ---------- */

function myAfterTick() {
  const { shown, more } = myItems();
  const left = shown.length + more;
  myMsg = left ? `Осталось: ${left}` : "На сегодня всё!";
  renderGoals();
}

goalsPanel.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || !String(el.dataset.act).startsWith("my-")) return;
  const act = el.dataset.act;
  const { kind, id, sid, tid } = el.dataset;

  if (act === "my-done") {
    if (kind === "step") {
      closeGoals();
      openStepCard(+id);
      return;
    }
    if (kind === "plan") lastData = await api.toggle_plan_item(todayISO(), +id);
    else if (kind === "study") lastData = await api.update_task(sid, tid, { status: "done" });
    Sound.step();
    myAfterTick();
  } else if (act === "my-open") {
    if (kind === "step") {
      closeGoals();
      openStepCard(+id);
    } else if (kind === "plan") {
      agendaDay = todayISO();
      agendaMonth = monthStart(agendaDay);
      openGoals("plan");
    } else {
      studyView = "subjects";
      studySel = { sid, tid };
      studyAdding = null;
      openGoals("study");
      const card = goalsPanel.querySelector(`.study-sub[data-sid="${sid}"]`);
      if (card) card.scrollIntoView({ block: "start" });
    }
  } else if (act === "my-more") {
    openGoals("plan");
  } else if (act === "my-checkin") {
    const was = (lastData.checkins || []).includes(todayISO());
    lastData = await api.toggle_checkin(todayISO());
    if (was) Sound.undo();
    else Sound.step();
    myMsg = "";
    renderGoals();
    if (typeof render === "function") render(lastData, { scrollToCurrent: false });
  } else if (act === "my-hide-return") {
    try {
      localStorage.setItem(MY_HIDE_KEY, todayISO());
    } catch (err) {}
    renderGoals();
  } else if (act === "my-clear") {
    const ok = await confirmDialog({
      title: "Убрать старые дела?",
      text: "Невыполненные дела прошлых дней пропадут из планирования. Сделанное и учёба останутся.",
      yes: "Убрать",
      no: "Отмена",
    });
    if (!ok) return;
    lastData = await api.clear_overdue_plan();
    myReturnSeen = false;
    myMsg = "Готово.";
    renderGoals();
  } else if (act === "my-remind") {
    lastData = await api.set_reminder(true, "20:00");
    if (lastData.reminderError) myMsg = "Не получилось включить напоминание в Windows.";
    else myMsg = "Напоминание включено на 20:00.";
    renderGoals();
  }
});
