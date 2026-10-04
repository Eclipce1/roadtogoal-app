// Daily check-in with the "never miss twice" rule, and the weekly review.

const WEEKDAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const REVIEW_EVERY_DAYS = 7;

function shiftISO(iso, delta) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// A single missed day is forgiven; the chain only breaks after two missed days in a row.
// Today never counts as missed — the day isn't over yet.
function streakInfo(checkins) {
  const days = new Set(checkins || []);
  const today = todayISO();
  const earliest = days.size ? [...days].sort()[0] : today;
  let count = days.has(today) ? 1 : 0;
  let missedInRow = 0;
  for (let d = shiftISO(today, -1); d >= earliest; d = shiftISO(d, -1)) {
    if (days.has(d)) {
      count++;
      missedInRow = 0;
    } else if (++missedInRow >= 2) {
      break;
    }
  }
  return {
    count,
    doneToday: days.has(today),
    yesterdayMissed: !days.has(shiftISO(today, -1)),
  };
}

/* ---------- today strip ---------- */

const todayEl = document.getElementById("today");

/* ---------- "clean days": no forgiveness, a slip really does reset it ---------- */

function cleanStart(data) {
  const last = (data.relapses || []).map((r) => r.date).sort().pop();
  return last ? shiftISO(last, 1) : data.createdAt || todayISO();
}

function cleanDays(data) {
  const start = cleanStart(data);
  const today = todayISO();
  if (start > today) return 0; // slipped today: the count starts again tomorrow
  return daysBetween(start, today) + 1;
}

function renderCleanToday(data) {
  const n = cleanDays(data);
  const start = cleanStart(data);
  const slipped = (data.relapses || []).some((r) => r.date === todayISO());

  const dots = [];
  for (let i = 6; i >= 0; i--) {
    const iso = shiftISO(todayISO(), -i);
    const clean = iso >= start && iso <= todayISO();
    const slipped = (data.relapses || []).some((r) => r.date === iso);
    const wd = WEEKDAYS[new Date(iso + "T00:00:00").getDay()];
    const state = slipped ? "miss" : clean ? "on" : "off";
    dots.push(`<div class="day ${state}${i === 0 ? " is-today" : ""}"${slipped ? ' title="Срыв"' : ""}><i></i><span>${wd}</span></div>`);
  }

  const title = slipped
    ? "Счёт начинается заново"
    : `<b>${n}</b>-й ${plural(n, "день", "день", "день")} без срыва`;
  const hint = slipped
    ? "Срыв — это данные, а не приговор. Завтра счёт пойдёт с первого дня"
    : n < 3
    ? "Первые дни самые тяжёлые. Держись сегодняшнего"
    : "Каждый день делает следующий чуть легче";

  todayEl.innerHTML = `
    <div class="days">${dots.join("")}</div>
    <div class="today-text"><div class="today-title">${title}</div><div class="today-hint">${hint}</div></div>
    <button type="button" class="today-btn relapse-btn" data-act="relapse">Был срыв</button>`;
}

function renderToday(data, popToday = false) {
  if (data.mode === "clean") return renderCleanToday(data);
  if (data.mode === "number") return renderNumberToday(data);
  return renderHabitToday(data, popToday);
}

/* ---------- "number" mode: today's row for whatever this goal measures ---------- */

function trackerOf(data) {
  return data.tracker || { name: "", unit: "", target: "" };
}

function meterNum(v, unit) {
  // whole numbers stay whole; the rest keep one decimal
  const s = Math.abs(v % 1) < 0.05 ? String(Math.round(v)) : v.toFixed(1);
  return unit ? `${s} ${unit}` : s;
}

function meterSigned(v, unit) {
  return (v > 0 ? "+" : v < 0 ? "−" : "") + meterNum(Math.abs(v), unit);
}

// The plain day-over-day change: today's number minus the last one logged before
// it — "взвесился, вписал, увидел +0.9 кг с прошлого раза".
function dayDelta(goal) {
  const log = goal.log || {};
  const today = todayISO();
  if (log[today] === undefined) return null;
  const prevDay = Object.keys(log)
    .filter((d) => d < today)
    .sort()
    .pop();
  if (!prevDay) return null;
  return { delta: +(log[today] - log[prevDay]).toFixed(2), prevDay, prevValue: log[prevDay] };
}

function renderNumberToday(data) {
  const t = trackerOf(data);
  const log = data.log || {};
  const today = todayISO();
  const logged = log[today] !== undefined;
  const delta = dayDelta(data);
  const name = upperFirst(t.name || "Число");

  const dots = [];
  for (let i = 6; i >= 0; i--) {
    const iso = shiftISO(today, -i);
    const wd = WEEKDAYS[new Date(iso + "T00:00:00").getDay()];
    const missed = i > 0 && log[iso] === undefined && (!data.createdAt || iso >= data.createdAt);
    const cls = log[iso] !== undefined ? "on" : missed ? "miss" : i === 0 ? "is-today" : "off";
    dots.push(`<div class="day ${cls}"${missed ? ' title="Пропущен: числа за этот день нет"' : ""}><i></i><span>${wd}</span></div>`);
  }

  let title, hint;
  if (logged) {
    title = `${escapeHtml(name)} сегодня: <b>${meterNum(log[today], t.unit)}</b>`;
    hint = delta
      ? `${meterSigned(delta.delta, t.unit)} с ${fmtDate(delta.prevDay, { day: "numeric", month: "long" })}`
      : "Это первый замер — изменение станет видно после следующего.";
  } else {
    title = `${escapeHtml(name)} сегодня`;
    hint = "Впиши сегодняшнее число — дальше приложение само посчитает разницу.";
  }

  todayEl.innerHTML = `
    <div class="days">${dots.join("")}</div>
    <div class="today-text"><div class="today-title">${title}</div><div class="today-hint">${hint}</div></div>
    <div class="num-today-row">
      <input type="text" inputmode="decimal" class="num-today-input" id="numTodayInput"
             value="${logged ? log[today] : ""}" placeholder="${t.unit ? "напр. 60" : "число"}" />
      ${t.unit ? `<span class="meter-unit">${escapeHtml(t.unit)}</span>` : ""}
      <button type="button" class="today-btn" data-act="num-save">${logged ? "Изменить" : "Записать"}</button>
    </div>`;
}

async function saveTodayNumber() {
  const input = document.getElementById("numTodayInput");
  if (!input) return;
  const wasLogged = (lastData.log || {})[todayISO()] !== undefined;
  lastData = await api.log_value(todayISO(), input.value);
  if (!wasLogged) Sound.step();
  render(lastData);
}

function renderHabitToday(data, popToday = false) {
  const days = new Set(data.checkins || []);
  const today = todayISO();
  const s = streakInfo(data.checkins);

  const dots = [];
  for (let i = 6; i >= 0; i--) {
    const iso = shiftISO(today, -i);
    const wd = WEEKDAYS[new Date(iso + "T00:00:00").getDay()];
    // an earlier day (since the goal began) can be ticked afterwards, for the day you forgot to mark
    const tappable = i > 0 && (!data.createdAt || iso >= data.createdAt);
    const missed = tappable && !days.has(iso);
    // One missed day is forgiven and leaves the streak alone, so it gets a pale cross; it is
    // two in a row that break the streak, and those stay bright.
    const isMissed = (d) => d < today && (!data.createdAt || d >= data.createdAt) && !days.has(d);
    const forgiven = missed && !isMissed(shiftISO(iso, -1)) && !isMissed(shiftISO(iso, 1));
    const cls = days.has(iso) ? "on" : missed ? (forgiven ? "miss soft" : "miss") : i === 0 ? "is-today" : "off";
    const pop = popToday && i === 0 && days.has(iso) ? " pop" : "";
    const missTip = forgiven
      ? "Пропуск прощён — серия не прервалась. Нажми, если на самом деле делал"
      : "Два пропуска подряд — серия прервалась. Нажми, если на самом деле делал";
    const attrs = tappable ? ` data-day="${iso}" title="${days.has(iso) ? "Снять отметку с этого дня" : missTip}"` : "";
    dots.push(`<div class="day ${cls}${pop}${tappable ? " tap" : ""}"${attrs}><i></i><span>${wd}</span></div>`);
  }

  let title, hint;
  if (s.count === 0) {
    title = "Начни серию";
    hint = "Сделай сегодня хоть что-то для цели — даже 10 минут считаются";
  } else {
    title = `Серия: <b>${s.count}</b> ${plural(s.count, "день", "дня", "дней")}`;
    if (s.doneToday) hint = "Сегодня отмечено. Так держать";
    else if (s.yesterdayMissed) hint = "Вчера был пропуск — сегодня важно не пропустить второй";
    else hint = "Отметь сегодняшний день, чтобы серия продолжилась";
  }
  const minimum = currentMinimum(data);
  if (!s.doneToday && minimum) hint += `. Нет сил — сделай минимум: ${escapeHtml(lowerFirst(minimum))}`;

  todayEl.innerHTML = `
    <div class="days">${dots.join("")}</div>
    <div class="today-text"><div class="today-title">${title}</div><div class="today-hint" title="${hint.replace(/<[^>]+>/g, "")}">${hint}</div></div>
    <button type="button" class="today-btn${s.doneToday ? " done" : ""}" title="${s.doneToday ? "Снять отметку за сегодня" : ""}">
      ${s.doneToday ? "✓ Сегодня отмечено" : "Сегодня сделал шаг к цели"}
    </button>`;
}

todayEl.addEventListener("click", async (e) => {
  if (!lastData) return;

  if (e.target.closest('[data-act="relapse"]')) {
    const ok = await confirmDialog({
      title: "Отметить срыв сегодня?",
      text: "Счёт дней начнётся заново с завтрашнего. Это не провал, а точка отсчёта: срывы случаются почти у всех, кто идёт долго. Важно только, что будет дальше.",
      yes: "Отметить",
      no: "Не отмечать",
    });
    if (!ok) return;
    lastData = await api.add_relapse(todayISO(), "");
    Sound.undo();
    render(lastData);
    return;
  }

  if (e.target.closest('[data-act="num-save"]')) {
    saveTodayNumber();
    return;
  }

  const dayEl = e.target.closest(".day[data-day]");
  if (dayEl) {
    const day = dayEl.dataset.day;
    const wasMarked = (lastData.checkins || []).includes(day);
    lastData = await api.toggle_checkin(day);
    if (wasMarked) Sound.undo();
    else Sound.step();
    renderToday(lastData);
    updateDayClock();
    return;
  }

  if (!e.target.closest(".today-btn")) return;
  const wasDone = streakInfo(lastData.checkins).doneToday;
  lastData = await api.toggle_checkin(todayISO());
  if (wasDone) Sound.undo();
  else Sound.step();
  renderToday(lastData, !wasDone);
  updateDayClock();
});

todayEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.id === "numTodayInput") {
    e.preventDefault();
    saveTodayNumber();
  }
});

/* ---------- weekly review ---------- */

const reviewEl = document.getElementById("weeklyReview");

function lastReviewDate(data) {
  const r = data.reviews || [];
  return r.length ? r[r.length - 1].date : data.createdAt;
}

function latestDecision(data) {
  const r = data.reviews || [];
  return r.length ? r[r.length - 1].next : "";
}

function reviewDue(data) {
  if (!data.createdAt || data.reviewSnoozedOn === todayISO()) return false;
  return daysBetween(lastReviewDate(data), todayISO()) >= REVIEW_EVERY_DAYS;
}

function weekStats(data) {
  const from = shiftISO(todayISO(), -6);
  let days;
  if (data.mode === "clean") days = Math.min(7, cleanDays(data));
  else if (data.mode === "number") days = Object.keys(data.log || {}).filter((d) => d >= from).length;
  else days = (data.checkins || []).filter((d) => d >= from).length;
  const steps = data.subGoals.filter((g) => g.doneAt && g.doneAt >= from).length;
  return { days, steps };
}

function openReview(data) {
  const st = weekStats(data);
  reviewEl.querySelector(".review-card").innerHTML = `
    <button type="button" class="wiz-close" data-act="later" title="Позже">✕</button>
    <div class="back-label">Итоги недели</div>
    <h2 class="back-title">Неделя позади. Две минуты на разбор</h2>
    <div class="review-stats">
      <div><b>${st.days}</b> из 7 дней с отметкой</div>
      <div><b>${st.steps}</b> ${plural(st.steps, "шаг", "шага", "шагов")} пройдено</div>
    </div>
    <label class="review-q">Что помогло двигаться к цели?
      <input class="wiz-input" data-key="helped" placeholder="Например: бегал сразу после учёбы" />
    </label>
    <label class="review-q">Что помешало?
      <input class="wiz-input" data-key="hindered" placeholder="Например: два вечера просидел в телефоне" />
    </label>
    <label class="review-q">Что сделаешь иначе на следующей неделе?
      <input class="wiz-input" data-key="next" placeholder="Например: положу кроссовки у двери с вечера" />
    </label>
    <div class="wiz-actions">
      <button type="button" class="wiz-back" data-act="later">Позже</button>
      <button type="button" class="wiz-next" data-act="save">Сохранить</button>
    </div>`;
  reviewEl.classList.add("open");
  setTimeout(() => reviewEl.querySelector("input").focus(), 250);
}

async function closeReview(save) {
  const card = reviewEl.querySelector(".review-card");
  if (save) {
    const values = {};
    card.querySelectorAll("input").forEach((i) => (values[i.dataset.key] = i.value.trim()));
    if (!values.helped && !values.hindered && !values.next) {
      const first = card.querySelector("input");
      first.classList.remove("shake");
      void first.offsetWidth;
      first.classList.add("shake");
      first.focus();
      return;
    }
    lastData = await api.add_review(values);
  } else {
    lastData = await api.update_meta({ reviewSnoozedOn: todayISO() });
  }
  reviewEl.classList.remove("open");
  render(lastData);
}

reviewEl.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (btn) closeReview(btn.dataset.act === "save");
});

reviewEl.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeReview(false);
  if (e.key === "Enter" && e.target.matches("input")) {
    e.preventDefault();
    const inputs = [...reviewEl.querySelectorAll("input")];
    const next = inputs[inputs.indexOf(e.target) + 1];
    if (next) next.focus();
    else closeReview(true);
  }
});

function maybeShowReview(data) {
  if (!reviewDue(data)) return false;
  openReview(data);
  return true;
}
