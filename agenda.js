// Planning: a checklist for any day — near or far — plus days marked as important.
// Lives as a nav-rail tab: the month grid picks the day, the panel beside it holds
// that day's list. No times on purpose: it's a checklist, not a timetable.

const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const CAL_WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

let agendaDay = null; // ISO date whose checklist is open
let agendaMonth = null; // ISO first day of the month the grid shows
let markSaveTimer = null;

function monthStart(iso) {
  return iso.slice(0, 8) + "01";
}

function shiftMonth(monthISO, delta) {
  const [y, m] = monthISO.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function agendaItems(iso) {
  return (lastData.plans && lastData.plans[iso]) || [];
}

// the label of an important day, or undefined when the day isn't marked
function agendaMark(iso) {
  return lastData.marks ? lastData.marks[iso] : undefined;
}

function weekdayLong(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("ru-RU", { weekday: "long" });
}

// "Сегодня" / "Завтра" / "Вчера" for the days that deserve a name
function agendaRelLabel(iso) {
  const t = todayISO();
  if (iso === t) return "Сегодня";
  if (iso === shiftISO(t, 1)) return "Завтра";
  if (iso === shiftISO(t, -1)) return "Вчера";
  return "";
}

// "на сегодня" / "на завтра" / "на этот день" for the add-item placeholder
function agendaForPhrase(iso) {
  const t = todayISO();
  if (iso === t) return "на сегодня";
  if (iso === shiftISO(t, 1)) return "на завтра";
  return "на этот день";
}

// How a day reads in the calendar: everything done / part of it / nothing at all.
// A future day owes nothing yet, and today isn't over — neither goes red.
function dayStatus(iso, items) {
  if (!items.length) return "";
  const done = items.filter((it) => it.done).length;
  if (done === items.length) return "done-all";
  if (iso >= todayISO()) return done ? "done-part" : "";
  return done ? "done-part" : "done-none";
}

function agendaCalendarHtml() {
  const [y, m] = agendaMonth.split("-").map(Number);
  const today = todayISO();
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Monday-first grid
  const total = new Date(y, m, 0).getDate();

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<i class="cal-blank"></i>');
  for (let d = 1; d <= total; d++) {
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const items = agendaItems(iso);
    const done = items.filter((it) => it.done).length;
    const mark = agendaMark(iso);
    const cls = [
      "cal-day",
      iso === agendaDay ? "on" : "",
      iso === today ? "is-today" : "",
      items.length ? "has-items" : "",
      dayStatus(iso, items),
      mark !== undefined ? "marked" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const tip = [mark ? mark : "", items.length ? `${done} из ${items.length}` : ""].filter(Boolean).join(" · ");
    cells.push(`
      <button type="button" class="${cls}" data-act="agenda-day" data-day="${iso}"${tip ? ` title="${escapeHtml(tip)}"` : ""}>
        <span class="cal-num">${d}</span>
        ${mark !== undefined ? '<i class="cal-star">★</i>' : ""}
        ${items.length ? '<i class="cal-dot"></i>' : ""}
      </button>`);
  }

  const atToday = agendaMonth === monthStart(today) && agendaDay === today;
  return `
    <div class="cal">
      <div class="cal-head">
        <button type="button" class="cal-nav" data-act="agenda-month" data-delta="-1" title="Предыдущий месяц">‹</button>
        <div class="cal-month">${MONTH_NAMES[m - 1]} ${y}</div>
        <button type="button" class="cal-nav" data-act="agenda-month" data-delta="1" title="Следующий месяц">›</button>
      </div>
      <div class="cal-wd">${CAL_WEEKDAYS.map((w) => `<span>${w}</span>`).join("")}</div>
      <div class="cal-grid">${cells.join("")}</div>
      <div class="cal-legend">
        <span><i class="lg-all"></i>всё сделано</span>
        <span><i class="lg-part"></i>часть</span>
        <span><i class="lg-none"></i>ничего</span>
      </div>
      ${atToday ? "" : '<button type="button" class="cal-today" data-act="agenda-today">Вернуться к сегодня</button>'}
    </div>`;
}

// Days that have passed with items still unticked. Kept to the same two-week
// window as the chart, so it stays something you can actually act on.
function overdueInfo() {
  const today = todayISO();
  const from = shiftISO(today, -(CHART_DAYS - 1));
  const days = Object.keys(lastData.plans || {})
    .filter((d) => d >= from && d < today && agendaItems(d).some((it) => !it.done))
    .sort();
  const items = days.reduce((n, d) => n + agendaItems(d).filter((it) => !it.done).length, 0);
  return { days, items };
}

function agendaOverdueHtml() {
  const { days, items } = overdueInfo();
  if (!items) return "";
  return `
    <button type="button" class="overdue" data-act="agenda-day" data-day="${days[0]}"
            title="За последние две недели. Нажми, чтобы открыть самый ранний такой день.">
      <i></i>
      <span>Осталось незакрытым: <b>${items} ${plural(items, "дело", "дела", "дел")}</b> за ${days.length} ${plural(
    days.length,
    "прошедший день",
    "прошедших дня",
    "прошедших дней"
  )}</span>
    </button>`;
}

/* ---------- "как я держу план": a score that walks up and down ---------- */

const CHART_DAYS = 14;
// viewBox geometry; the svg itself stretches to the column width
const CH = { w: 520, h: 138, left: 26, right: 10, top: 14, bottom: 22 };
const DOT_R = 4;

// The score starts at zero at the left edge of the window and walks from there:
// +1 for every finished item, -1 for every one left undone. A day with no list
// leaves it flat. So the line always begins bottom-left and climbs to the right
// as long as the plan is kept.
// Today's undone items are not subtracted yet — the day isn't over, same rule the
// day streak uses. Otherwise the line would dip every morning before you started.
function chartSeries() {
  const points = [{ iso: null, score: 0, total: 0, done: 0 }];
  let score = 0;
  for (let i = CHART_DAYS - 1; i >= 0; i--) {
    const iso = shiftISO(todayISO(), -i);
    const items = agendaItems(iso);
    const done = items.filter((it) => it.done).length;
    score += done - (i === 0 ? 0 : items.length - done);
    points.push({ iso, score, total: items.length, done, isToday: i === 0 });
  }
  return points;
}

function agendaChartHtml() {
  const points = chartSeries();
  const planned = points.filter((p) => p.total);

  if (!planned.length) {
    return `
      <div class="chart">
        <div class="chart-head"><span class="chart-title">Как я держу план</span></div>
        <div class="chart-empty">Отмечай выполненные пункты — и здесь появится линия. Каждый сделанный пункт поднимает её, каждый забытый опускает.</div>
      </div>`;
  }

  const scores = points.map((p) => p.score);
  const lo = Math.min(0, ...scores);
  const hi = Math.max(lo + 1, ...scores);

  const x = (i) => CH.left + (i * (CH.w - CH.left - CH.right)) / (points.length - 1);
  // DOT_R of inset top and bottom keeps the end markers from being clipped
  const plotTop = CH.top + DOT_R;
  const plotBottom = CH.h - CH.bottom - DOT_R;
  const y = (score) => plotBottom - ((score - lo) / (hi - lo)) * (plotBottom - plotTop);

  const line = points.map((p, i) => `${x(i)} ${y(p.score)}`).join(" L ");
  const area = `M ${x(0)} ${CH.h - CH.bottom} L ${line} L ${x(points.length - 1)} ${CH.h - CH.bottom} Z`;

  // markers only where something was planned, plus the zero the line starts from
  const last = points[points.length - 1];
  const dots = points
    .map((p, i) => {
      if (i !== 0 && !p.total && i !== points.length - 1) return "";
      const isLast = i === points.length - 1;
      const tip = p.iso
        ? `${fmtDate(p.iso, { day: "numeric", month: "long" })} — ${p.done} из ${p.total}, счёт ${signed(p.score)}` +
          (p.isToday ? " (день ещё не кончился)" : "")
        : "начало отсчёта";
      return `
        <circle class="chart-dot${isLast ? " last" : ""}${i === 0 ? " start" : ""}" cx="${x(i)}" cy="${y(p.score)}" r="${DOT_R}">
          <title>${tip}</title>
        </circle>`;
    })
    .join("");

  const zeroLine =
    lo < 0
      ? `<line class="chart-zero" x1="${CH.left}" y1="${y(0)}" x2="${CH.w - CH.right}" y2="${y(0)}" />
         <text class="chart-axis" x="${CH.left - 6}" y="${y(0) + 3}" text-anchor="end">0</text>`
      : `<text class="chart-axis" x="${CH.left - 6}" y="${y(0) + 3}" text-anchor="end">0</text>`;

  const doneItems = planned.reduce((s, p) => s + p.done, 0);
  // today can't owe anything yet, so it stays out of both tallies
  const past = planned.filter((p) => !p.isToday);
  const missedItems = past.reduce((s, p) => s + p.total - p.done, 0);
  const fullDays = past.filter((p) => p.done === p.total).length;

  return `
    <div class="chart">
      <div class="chart-head">
        <span class="chart-title">Как я держу план</span>
        <span class="chart-stat">сделано ${doneItems} · забыто ${missedItems} · без долгов: ${fullDays} из ${past.length} ${plural(past.length, "дня", "дней", "дней")}</span>
      </div>
      <svg viewBox="0 0 ${CH.w} ${CH.h}" role="img" aria-label="Счёт выполнения плана за две недели: ${signed(last.score)}">
        <defs>
          <linearGradient id="chartFade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#7dd3fc" stop-opacity="0.22" />
            <stop offset="100%" stop-color="#7dd3fc" stop-opacity="0" />
          </linearGradient>
        </defs>
        <line class="chart-grid" x1="${CH.left}" y1="${CH.h - CH.bottom}" x2="${CH.w - CH.right}" y2="${CH.h - CH.bottom}" />
        <path class="chart-area" d="${area}" />
        <path class="chart-line" d="M ${line}" />
        ${zeroLine}
        ${dots}
        <text class="chart-label" x="${x(points.length - 1) - 2}" y="${y(last.score) - 11}" text-anchor="end">${signed(last.score)}</text>
        <text class="chart-axis" x="${CH.left}" y="${CH.h - 6}">${fmtDate(points[1].iso, { day: "numeric", month: "short" })}</text>
        <text class="chart-axis" x="${CH.w - CH.right}" y="${CH.h - 6}" text-anchor="end">сегодня</text>
      </svg>
      <div class="chart-hint">Каждый выполненный пункт поднимает линию на один, каждый несделанный опускает. Сегодняшние ещё не опускают — день не кончился. Дни без записей линию не двигают.</div>
    </div>`;
}

function signed(n) {
  return n > 0 ? `+${n}` : String(n);
}


/* ---------- tomorrow, under the calendar ---------- */

function agendaTomorrowHtml() {
  const iso = shiftISO(todayISO(), 1);
  if (agendaDay === iso) return ""; // that day's own list is already open on the left
  const items = agendaItems(iso);
  const mark = agendaMark(iso);

  return `
    <div class="tmr" data-act="agenda-day" data-day="${iso}" title="Открыть завтрашний день">
      <div class="tmr-head">
        <span class="tmr-label">Завтра</span>
        <span class="tmr-date">${fmtDate(iso, { day: "numeric", month: "long" })}</span>
      </div>
      ${mark !== undefined ? `<div class="tmr-mark">★ ${escapeHtml(mark || "важный день")}</div>` : ""}
      ${
        items.length
          ? `<div class="tmr-list">${items
              .map((it) => `<div class="tmr-item${it.done ? " done" : ""}"><i></i>${escapeHtml(it.text)}</div>`)
              .join("")}</div>`
          : '<div class="tmr-empty">Пока ничего не записано.</div>'
      }
    </div>`;
}

function agendaDayPanelHtml() {
  const items = agendaItems(agendaDay);
  const doneCount = items.filter((it) => it.done).length;
  const mark = agendaMark(agendaDay);
  const rel = agendaRelLabel(agendaDay);
  const today = todayISO();

  const list = items.length
    ? items
        .map(
          (it) => `
        <div class="agenda-item${it.done ? " done" : ""}" data-id="${it.id}" draggable="true">
          <span class="agenda-grip" title="Перетащи, чтобы поменять порядок">⠿</span>
          <button type="button" class="agenda-check" data-act="agenda-toggle" title="${it.done ? "Снять отметку" : "Готово"}">${it.done ? "✓" : ""}</button>
          <div class="agenda-text">${escapeHtml(it.text)}</div>
          <button type="button" class="agenda-del" data-act="agenda-remove" title="Удалить">✕</button>
        </div>`
        )
        .join("")
    : `<div class="agenda-empty">${
        agendaDay < today
          ? "На этот день ничего не было записано."
          : agendaDay === today
          ? "На сегодня пока пусто. Вечером удобно набросать план на завтра — с утра проще начать."
          : "Пока пусто. Запиши, что нужно сделать в этот день — и не придётся держать это в голове."
      }</div>`;

  return `
    <div class="agenda-pane">
      ${agendaOverdueHtml()}
      <div class="agenda-day-head">
        <div class="agenda-day-name">
          <b>${upperFirst(weekdayLong(agendaDay))}, ${fmtDate(agendaDay, { day: "numeric", month: "long" })}</b>
          ${rel ? `<span class="agenda-rel">${rel}</span>` : ""}
        </div>
        ${items.length ? `<span class="agenda-count">${doneCount}/${items.length}</span>` : ""}
      </div>

      ${
        mark !== undefined
          ? `<div class="mark-row">
               <span class="mark-star">★</span>
               <input class="mark-label" value="${escapeHtml(mark)}" placeholder="Чем важен этот день?" maxlength="60" />
               <button type="button" class="mark-del" data-act="agenda-unmark" title="Снять отметку важного дня">✕</button>
             </div>`
          : `<button type="button" class="mark-add" data-act="agenda-mark">☆ Отметить важным днём</button>`
      }

      <div class="agenda-list">${list}</div>
      <div class="agenda-new-row">
        <input class="agenda-new" placeholder="+ добавить пункт ${agendaForPhrase(agendaDay)}" />
        <button type="button" class="agenda-send" data-act="agenda-add" title="Добавить" aria-label="Добавить пункт" disabled>
          <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 16V4M4.5 9.5 10 4l5.5 5.5"/></svg>
        </button>
      </div>
      ${agendaChartHtml()}
    </div>`;
}

function agendaMainHtml() {
  if (!agendaDay) agendaDay = todayISO();
  if (!agendaMonth) agendaMonth = monthStart(agendaDay);

  const pr = (lastData.settings && lastData.settings.planReminder) || { enabled: false, time: "21:30" };
  return `
    <div class="goals-top agenda-top">
      <div class="agenda-heading">
        <div class="goals-title">Планирование</div>
        <div class="goals-sub">Что сделать, чтобы не забыть</div>
      </div>
      <div class="goals-tools">
        <div class="remind-wrap">
          <button type="button" class="remind-btn${pr.enabled ? " on" : ""}" data-act="plan-remind-open" title="Напомнить вечером">
            <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M15.5 12.5A6.5 6.5 0 0 1 7.5 4.5a6.5 6.5 0 1 0 8 8Z"/>
            </svg>
            ${pr.enabled ? pr.time : "Напомнить вечером"}
          </button>
          <div class="remind-pop">
            <div class="remind-row">
              <span>Напоминать спланировать завтра</span>
              <button type="button" class="switch${pr.enabled ? " on" : ""}" data-act="plan-remind-switch" aria-label="Включить напоминание"><i></i></button>
            </div>
            <label class="remind-row">
              <span>Во сколько</span>
              <input type="time" class="plan-remind-time" value="${pr.time}" />
            </label>
            <p class="remind-note">Вечером придёт уведомление, если на завтра ещё ничего не записано. Если план уже есть — не потревожит.</p>
            <p class="remind-error" hidden>Не получилось включить напоминание в Windows. Попробуй ещё раз.</p>
          </div>
        </div>
      </div>
    </div>
    <div class="agenda-body">
      <div class="agenda-cols">
        ${agendaDayPanelHtml()}
        <div class="agenda-side">
          ${agendaCalendarHtml()}
          ${agendaTomorrowHtml()}
        </div>
      </div>
    </div>`;
}

goalsPanel.addEventListener("change", (e) => {
  if (!e.target.classList.contains("plan-remind-time")) return;
  const pr = lastData.settings && lastData.settings.planReminder;
  if (pr && pr.enabled) applyPlanReminder(true);
});

// clicking outside the popover closes it
goalsPanel.addEventListener("mousedown", (e) => {
  const wrap = goalsPanel.querySelector(".remind-wrap.open");
  if (wrap && !wrap.contains(e.target)) wrap.classList.remove("open");
});

async function applyPlanReminder(enabled) {
  const field = goalsPanel.querySelector(".plan-remind-time");
  lastData = await api.set_plan_reminder(enabled, (field && field.value) || "21:30");
  renderGoals();
  const wrap = goalsPanel.querySelector(".remind-wrap");
  if (wrap) {
    wrap.classList.add("open"); // keep the popover in place so the switch can be seen flipping
    if (lastData.reminderError) wrap.querySelector(".remind-error").hidden = false;
  }
}

function selectAgendaDay(iso) {
  agendaDay = iso;
  agendaMonth = monthStart(iso);
  renderGoals();
}

async function saveMarkLabel(render) {
  clearTimeout(markSaveTimer);
  const input = goalsPanel.querySelector(".mark-label");
  if (!input) return;
  lastData = await api.set_day_mark(agendaDay, input.value);
  if (render) renderGoals();
}

goalsPanel.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;

  if (act === "plan-remind-open") {
    el.closest(".remind-wrap").classList.toggle("open");
  } else if (act === "plan-remind-switch") {
    await applyPlanReminder(!el.classList.contains("on"));
  } else if (act === "agenda-add") {
    submitAgendaItem();
  } else if (act === "agenda-day") {
    selectAgendaDay(el.dataset.day);
  } else if (act === "agenda-month") {
    agendaMonth = shiftMonth(agendaMonth, +el.dataset.delta);
    renderGoals();
  } else if (act === "agenda-today") {
    selectAgendaDay(todayISO());
  } else if (act === "agenda-mark") {
    lastData = await api.set_day_mark(agendaDay, "");
    renderGoals();
    const input = goalsPanel.querySelector(".mark-label");
    if (input) input.focus();
  } else if (act === "agenda-unmark") {
    clearTimeout(markSaveTimer);
    lastData = await api.set_day_mark(agendaDay, null);
    renderGoals();
  } else if (act === "agenda-toggle" || act === "agenda-remove") {
    const row = el.closest(".agenda-item");
    const id = +row.dataset.id;
    if (act === "agenda-toggle") {
      const wasDone = row.classList.contains("done");
      lastData = await api.toggle_plan_item(agendaDay, id);
      if (!wasDone) tone(659.25, 0, { volume: 0.035, decay: 0.35 });
    } else {
      lastData = await api.delete_plan_item(agendaDay, id);
    }
    renderGoals();
  }
});

async function submitAgendaItem() {
  const input = goalsPanel.querySelector(".agenda-new");
  const text = input ? input.value.trim() : "";
  if (!text) return;
  input.value = "";
  lastData = await api.add_plan_item(agendaDay, text);
  renderGoals();
  // stay in the field, so several items can go in one after another
  const fresh = goalsPanel.querySelector(".agenda-new");
  if (fresh) fresh.focus();
}

// the send button wakes up once there is something to send
goalsPanel.addEventListener("input", (e) => {
  if (!e.target.classList.contains("agenda-new")) return;
  const send = goalsPanel.querySelector(".agenda-send");
  if (send) send.disabled = !e.target.value.trim();
});

goalsPanel.addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  if (e.target.classList.contains("agenda-new")) {
    submitAgendaItem();
  } else if (e.target.classList.contains("mark-label")) {
    e.preventDefault();
    e.target.blur(); // the blur handler saves and refreshes the lists
  }
});

// the label of an important day saves as you type, without redrawing under the cursor
goalsPanel.addEventListener("input", (e) => {
  if (!e.target.classList.contains("mark-label")) return;
  clearTimeout(markSaveTimer);
  markSaveTimer = setTimeout(() => saveMarkLabel(false), 500);
});

goalsPanel.addEventListener(
  "blur",
  (e) => {
    if (e.target.classList && e.target.classList.contains("mark-label")) saveMarkLabel(true);
  },
  true
);

/* ---------- dragging a plan item to reorder the day's list ---------- */

let dragItemId = null;

function clearDragMarks() {
  goalsPanel
    .querySelectorAll(".agenda-item.drag-over-top, .agenda-item.drag-over-bottom")
    .forEach((el) => el.classList.remove("drag-over-top", "drag-over-bottom"));
}

goalsPanel.addEventListener("dragstart", (e) => {
  const row = e.target.closest(".agenda-item");
  if (!row) return;
  dragItemId = +row.dataset.id;
  row.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", String(dragItemId)); // some engines require this to allow the drag
});

goalsPanel.addEventListener("dragend", (e) => {
  const row = e.target.closest(".agenda-item");
  if (row) row.classList.remove("dragging");
  clearDragMarks();
  dragItemId = null;
});

goalsPanel.addEventListener("dragover", (e) => {
  const row = e.target.closest(".agenda-item");
  if (!row || dragItemId === null) return;
  e.preventDefault(); // required for the row to accept a drop at all
  if (+row.dataset.id === dragItemId) return;
  const before = e.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
  row.classList.toggle("drag-over-top", before);
  row.classList.toggle("drag-over-bottom", !before);
});

goalsPanel.addEventListener("dragleave", (e) => {
  const row = e.target.closest(".agenda-item");
  if (row && !row.contains(e.relatedTarget)) row.classList.remove("drag-over-top", "drag-over-bottom");
});

async function moveAgendaItem(itemId, targetId, before) {
  if (targetId === itemId) return;
  const items = agendaItems(agendaDay).slice();
  const fromIdx = items.findIndex((it) => it.id === itemId);
  if (fromIdx === -1) return;
  const [moved] = items.splice(fromIdx, 1);
  let toIdx = items.findIndex((it) => it.id === targetId);
  if (toIdx === -1) return;
  if (!before) toIdx += 1;
  items.splice(toIdx, 0, moved);

  lastData = await api.reorder_plan(agendaDay, items.map((it) => it.id));
  renderGoals();
}

goalsPanel.addEventListener("drop", (e) => {
  const row = e.target.closest(".agenda-item");
  if (!row || dragItemId === null) return;
  e.preventDefault();
  const before = !row.classList.contains("drag-over-bottom");
  clearDragMarks();
  moveAgendaItem(dragItemId, +row.dataset.id, before);
});

/* Fingers don't fire HTML5 drag events, so on a touchscreen the ⠿ handle is driven by
   pointer events instead: hold it, slide over another row, let go. */
let touchDrag = null; // { id, row, pointerId, targetId, before }

goalsPanel.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse") return;
  const grip = e.target.closest(".agenda-grip");
  if (!grip) return;
  const row = grip.closest(".agenda-item");
  touchDrag = { id: +row.dataset.id, row, pointerId: e.pointerId, targetId: null, before: true };
  row.classList.add("dragging");
  try {
    grip.setPointerCapture(e.pointerId);
  } catch {
    /* the pointer is already gone; the drag simply ends on the next event */
  }
  e.preventDefault();
});

goalsPanel.addEventListener("pointermove", (e) => {
  if (!touchDrag || e.pointerId !== touchDrag.pointerId) return;
  clearDragMarks();
  const over = document.elementFromPoint(e.clientX, e.clientY);
  const row = over && over.closest(".agenda-item");
  if (!row || +row.dataset.id === touchDrag.id) {
    touchDrag.targetId = null;
    return;
  }
  const r = row.getBoundingClientRect();
  touchDrag.targetId = +row.dataset.id;
  touchDrag.before = e.clientY < r.top + r.height / 2;
  row.classList.add(touchDrag.before ? "drag-over-top" : "drag-over-bottom");
});

function endTouchDrag(e, commit) {
  if (!touchDrag || e.pointerId !== touchDrag.pointerId) return;
  const { id, row, targetId, before } = touchDrag;
  touchDrag = null;
  row.classList.remove("dragging");
  clearDragMarks();
  if (commit && targetId !== null) moveAgendaItem(id, targetId, before);
}
goalsPanel.addEventListener("pointerup", (e) => endTouchDrag(e, true));
goalsPanel.addEventListener("pointercancel", (e) => endTouchDrag(e, false));
