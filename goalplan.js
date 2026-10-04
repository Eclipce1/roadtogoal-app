// Goal setup wizard (WOOP), the plan line under the goal, and the
// gentle "welcome back" card after a pause.

const RETURN_AFTER_DAYS = 3;

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysBetween(fromISO, toISO) {
  const a = new Date(fromISO + "T00:00:00");
  const b = new Date(toISO + "T00:00:00");
  return Math.round((b - a) / 86400000);
}

function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function fmtDate(iso, opts = { day: "numeric", month: "short" }) {
  return new Date(iso + "T00:00:00").toLocaleDateString("ru-RU", opts);
}

// names the app gives a goal before the user has named it
function isPlaceholderGoal(name) {
  return !name || !name.trim() || name.trim() === "Моя цель" || name.trim() === "Новая цель";
}

function lowerFirst(s) {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

// people often type "если…" / "я…" themselves although the UI already says it
function cleanObstacle(t) {
  return (t || "").trim().replace(/[.!,]+$/, "").replace(/^если\s+/i, "");
}

function cleanAction(t) {
  return (t || "").trim().replace(/[.!,]+$/, "").replace(/^то\s+/i, "").replace(/^я\s+/i, "");
}

function upperFirst(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function planSentence(woop) {
  if (!woop || !woop.obstacle || !woop.plan) return "";
  return `Если ${lowerFirst(cleanObstacle(woop.obstacle))}, то я ${lowerFirst(cleanAction(woop.plan))}.`;
}

function hasPlan(data) {
  return !!(data.woop && data.woop.obstacle && data.woop.plan);
}

/* ---------- header chips + "why" above the road ---------- */

const deadlineEl = document.getElementById("goalDeadline");
const whyEl = document.getElementById("whyStrip");

function renderGoalMeta(data) {
  const chips = [];
  if (data.deadline) {
    const left = daysBetween(todayISO(), data.deadline);
    const date = fmtDate(data.deadline, { day: "numeric", month: "long" });
    let rest;
    if (left > 0) rest = `осталось <b>${left}</b> ${plural(left, "день", "дня", "дней")}`;
    else if (left === 0) rest = "<b>срок сегодня</b>";
    else rest = "срок прошёл — можно перенести";
    chips.push(`<button type="button" class="chip" data-step="deadline" title="Изменить срок"><span class="chip-when">до ${escapeHtml(date)}<i></i></span>${rest}</button>`);
  }

  const w = data.woop || {};
  if (hasPlan(data)) {
    chips.push(`
      <div class="plan-wrap">
        <button type="button" class="chip plan-toggle" title="Мой план на трудный день"><span class="long-label">Мой план на трудный день</span><span class="short-label">Мой план</span></button>
        <div class="plan-pop">
          <div class="plan-pop-label">Если захочется бросить</div>
          <p class="plan-pop-text"><span>Если</span> ${escapeHtml(lowerFirst(cleanObstacle(w.obstacle)))},</p>
          <p class="plan-pop-text"><span>то я</span> ${escapeHtml(lowerFirst(cleanAction(w.plan)))}.</p>
          ${latestDecision(data) ? `<div class="plan-pop-label plan-pop-week">Решение на эту неделю</div><p class="plan-pop-text">${escapeHtml(upperFirst(latestDecision(data)))}</p>` : ""}
          <div class="plan-pop-actions">
            <button type="button" class="plan-pop-edit" data-step="plan">Изменить план</button>
            <button type="button" class="plan-pop-edit plan-pop-review">Подвести итоги недели</button>
          </div>
        </div>
      </div>`);
    whyEl.innerHTML = `
      <button type="button" class="why-btn" data-step="outcome" title="Изменить">
        <span class="why-label">Ради чего я иду</span>
        <span class="why-text">${escapeHtml(upperFirst((w.outcome || "").trim().replace(/[.!]+$/, "")))}</span>
      </button>`;
  } else {
    whyEl.innerHTML = `
      <button type="button" class="why-btn why-empty" data-step="wish">
        <span class="why-label">Ради чего я иду</span>
        <span class="why-text">Ответь на 5 коротких вопросов, и здесь будет видно, ради чего ты идёшь</span>
        <span class="why-cta">Настроить цель →</span>
      </button>`;
  }
  deadlineEl.innerHTML = chips.join("");
}

deadlineEl.addEventListener("click", (e) => {
  const toggle = e.target.closest(".plan-toggle");
  if (toggle) toggle.parentElement.classList.toggle("open");
  if (e.target.closest(".plan-pop-review") && lastData) {
    e.target.closest(".plan-wrap").classList.remove("open");
    openReview(lastData);
  }
});

document.addEventListener("mousedown", (e) => {
  const wrap = deadlineEl.querySelector(".plan-wrap.open");
  if (wrap && !wrap.contains(e.target)) wrap.classList.remove("open");
});

function openWizardAt(key) {
  if (!lastData) return;
  openWizard(lastData, Math.max(0, WIZ_STEPS.findIndex((s) => s.key === key)));
}

[deadlineEl, whyEl].forEach((el) =>
  el.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-step]");
    if (btn) openWizardAt(btn.dataset.step);
  })
);

/* ---------- wizard ---------- */

const WIZ_STEPS = [
  {
    key: "wish",
    q: "Чего ты хочешь достичь?",
    hint: "Конкретно и так, чтобы потом можно было проверить. Трудно, но реально.",
    bad: "Стать спортивным",
    good: "Пробежать 10 км без остановки",
    check: "Сможешь ли ты однажды ответить «да, сделал» или «нет»?",
    placeholder: "Например: пробежать 10 км без остановки",
  },
  {
    key: "deadline",
    type: "date",
    q: "К какому сроку?",
    hint: "Прикинь, сколько реально успеть за неделю, и возьми срок с небольшим запасом. Слишком близкий срок быстро превращается в «всё равно не успею».",
    check: "Если пока не знаешь, как быстро пойдёт, — пропусти, срок можно поставить позже.",
  },
  {
    key: "outcome",
    q: "Что будет, когда получится?",
    hint: "Это твоё «ради чего» — оно будет гореть над дорожкой. Пиши про себя и свои ощущения.",
    bad: "Будет хорошо",
    good: "Перестану задыхаться на лестнице",
    check: "Читаешь свой ответ — и что-то внутри откликается? Если нет, перепиши.",
    placeholder: "Например: буду спокойно общаться в поездках",
  },
  {
    key: "obstacle",
    q: "Что внутри тебя может помешать?",
    hint: "Только твоё: привычка, эмоция, мысль. Одно, главное. И лучше с ситуацией — когда это обычно случается.",
    bad: "Нет времени",
    good: "Вечером после учёбы ложусь и залипаю в телефон",
    check: "Спроси себя: а что я делаю вместо дела? Ответь честно — это видишь только ты.",
    placeholder: "Например: вечером устаю и сижу в телефоне",
  },
  {
    key: "plan",
    type: "ifthen",
    q: "Что ты сделаешь, когда это случится?",
    hint: "Маленькое действие, которое можно сделать прямо в тот момент. Решив заранее, не придётся себя уговаривать.",
    bad: "Возьму себя в руки",
    good: "Уберу телефон в другую комнату и надену кроссовки",
    check: "Можно ли это сделать за 1–2 минуты, не уговаривая себя?",
    placeholder: "например: сразу открою учебник на 10 минут",
  },
];

const wizEl = document.getElementById("wizard");
const wizCard = wizEl.querySelector(".wiz-card");
let wiz = null;

function openWizard(data, startStep = 0) {
  wiz = {
    step: startStep,
    values: {
      wish: isPlaceholderGoal(data.mainGoal) ? "" : data.mainGoal,
      deadline: data.deadline || "",
      outcome: (data.woop && data.woop.outcome) || "",
      obstacle: (data.woop && data.woop.obstacle) || "",
      plan: (data.woop && data.woop.plan) || "",
    },
  };
  renderWizard();
  wizEl.classList.add("open");
  setTimeout(() => focusWizardInput(), 250);
}

function closeWizard() {
  wizEl.classList.remove("open");
  wiz = null;
}

function focusWizardInput() {
  const input = wizCard.querySelector("input");
  if (input) input.focus();
}

function renderWizard() {
  const s = WIZ_STEPS[wiz.step];
  const v = wiz.values;
  const last = wiz.step === WIZ_STEPS.length - 1;

  let field;
  if (s.type === "date") {
    field = `<input class="wiz-input" type="date" data-key="deadline" value="${v.deadline}" min="${todayISO()}" />`;
  } else if (s.type === "ifthen") {
    const obstacle = v.obstacle ? escapeHtml(lowerFirst(cleanObstacle(v.obstacle))) : "это случится";
    field = `
      <div class="wiz-ifthen">
        <div class="wiz-if"><span>Если</span> ${obstacle},</div>
        <div class="wiz-then"><span>то я</span>
          <input class="wiz-input" type="text" data-key="plan" value="${escapeHtml(v.plan)}" placeholder="${s.placeholder}" />
        </div>
      </div>`;
  } else {
    field = `<input class="wiz-input" type="text" data-key="${s.key}" value="${escapeHtml(v[s.key])}" placeholder="${s.placeholder}" />`;
  }

  wizCard.innerHTML = `
    <button type="button" class="wiz-close" title="Закрыть">✕</button>
    <div class="wiz-top">
      <div class="wiz-count">Вопрос ${wiz.step + 1} из ${WIZ_STEPS.length}</div>
      <div class="wiz-dots">${WIZ_STEPS.map((_, i) => `<i class="${i < wiz.step ? "past" : i === wiz.step ? "now" : ""}"></i>`).join("")}</div>
    </div>
    <div class="wiz-body">
      <h2 class="wiz-q">${s.q}</h2>
      <p class="wiz-hint">${s.hint}</p>
      ${
        s.bad
          ? `<div class="wiz-examples">
              <div class="wiz-ex bad"><i>✕</i>${s.bad}</div>
              <div class="wiz-ex good"><i>✓</i>${s.good}</div>
            </div>`
          : ""
      }
      ${field}
    </div>
    ${s.check ? `<div class="wiz-check">${s.check}</div>` : ""}
    <div class="wiz-actions">
      ${wiz.step > 0 ? '<button type="button" class="wiz-back">Назад</button>' : "<span></span>"}
      <div class="wiz-right">
        ${s.type === "date" ? '<button type="button" class="wiz-skip">Пропустить</button>' : ""}
        <button type="button" class="wiz-next">${last ? "Готово" : "Далее"}</button>
      </div>
    </div>
    <div class="wiz-method">Методика WOOP — научно проверенный способ доводить цели до конца</div>
  `;
}

function collectWizardInput() {
  wizCard.querySelectorAll(".wiz-input").forEach((inp) => {
    wiz.values[inp.dataset.key] = inp.value.trim();
  });
}

function wizardStepValid() {
  const s = WIZ_STEPS[wiz.step];
  if (s.type === "date") return true;
  return !!wiz.values[s.key];
}

async function wizardNext(skip = false) {
  collectWizardInput();
  if (skip) wiz.values.deadline = "";
  if (!skip && !wizardStepValid()) {
    const inp = wizCard.querySelector(".wiz-input");
    inp.classList.remove("shake");
    void inp.offsetWidth;
    inp.classList.add("shake");
    inp.focus();
    return;
  }
  if (wiz.step < WIZ_STEPS.length - 1) {
    wiz.step++;
    swapWizardStep();
    return;
  }
  const v = wiz.values;
  const data = await api.update_meta({
    mainGoal: upperFirst(v.wish),
    deadline: v.deadline,
    woop: { wish: v.wish, outcome: v.outcome, obstacle: cleanObstacle(v.obstacle), plan: cleanAction(v.plan) },
    wizardDismissed: true,
  });
  closeWizard();
  render(data);
}

function swapWizardStep() {
  wizCard.classList.add("swap");
  setTimeout(() => {
    renderWizard();
    wizCard.classList.remove("swap");
    focusWizardInput();
  }, 160);
}

wizCard.addEventListener("click", (e) => {
  if (e.target.closest(".wiz-next")) wizardNext();
  else if (e.target.closest(".wiz-skip")) wizardNext(true);
  else if (e.target.closest(".wiz-back")) {
    collectWizardInput();
    wiz.step--;
    swapWizardStep();
  } else if (e.target.closest(".wiz-close")) dismissWizard();
});

wizCard.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    wizardNext();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && wiz) dismissWizard();
});

wizEl.addEventListener("mousedown", (e) => {
  if (e.target === wizEl) dismissWizard();
});

async function dismissWizard() {
  closeWizard();
  if (lastData && !lastData.wizardDismissed) {
    lastData = await api.update_meta({ wizardDismissed: true });
  }
}

/* ---------- greeting screen ---------- */

const greetEl = document.getElementById("greetScreen");

function showGreetScreen(onContinue) {
  // no goal picked yet on this screen, so only phrases that don't name one
  const quote = quoteOfTheDay("", "", false, {}, 13);
  greetEl.querySelector(".greet-card").innerHTML = `
    <div class="greet-stars">
      <svg viewBox="0 0 24 24"><path d="M12 2c.5 4.5 2.5 6.5 7 7-4.5.5-6.5 2.5-7 7-.5-4.5-2.5-6.5-7-7 4.5-.5 6.5-2.5 7-7Z"/></svg>
      <svg viewBox="0 0 24 24"><path d="M12 2c.5 4.5 2.5 6.5 7 7-4.5.5-6.5 2.5-7 7-.5-4.5-2.5-6.5-7-7 4.5-.5 6.5-2.5 7-7Z"/></svg>
      <svg viewBox="0 0 24 24"><path d="M12 2c.5 4.5 2.5 6.5 7 7-4.5.5-6.5 2.5-7 7-.5-4.5-2.5-6.5-7-7 4.5-.5 6.5-2.5 7-7Z"/></svg>
    </div>
    <p class="greet-quote">«${escapeHtml(quote)}»</p>
    <button type="button" class="greet-go">Начнём</button>
  `;
  greetEl.classList.add("open");
  const onClick = (e) => {
    if (e.target !== greetEl && !e.target.closest(".greet-go")) return;
    greetEl.classList.remove("open");
    greetEl.removeEventListener("click", onClick);
    // while the greeting fades out it still swallows taps: a second tap on "Начнём" must not
    // fall through and open whichever goal now sits under the finger
    greetEl.classList.add("leaving");
    setTimeout(() => greetEl.classList.remove("leaving"), 450);
    onContinue();
  };
  greetEl.addEventListener("click", onClick);
}

/* ---------- welcome back card ---------- */

const backEl = document.getElementById("welcomeBack");

function daysSinceProgress(data) {
  const dates = data.subGoals
    .filter((g) => g.doneAt)
    .map((g) => g.doneAt)
    .concat(data.checkins || [])
    .sort();
  const last = dates.length ? dates[dates.length - 1] : data.createdAt;
  return last ? daysBetween(last, todayISO()) : 0;
}

function maybeShowWelcomeBack(data) {
  const next = data.subGoals.find((g) => !g.done);
  if (!next || data.returnShownOn === todayISO()) return false;
  const days = daysSinceProgress(data);
  if (days < RETURN_AFTER_DAYS) return false;

  const plan = planSentence(data.woop);
  const outcome = data.woop && data.woop.outcome;
  backEl.querySelector(".back-card").innerHTML = `
    <div class="back-label">С возвращением</div>
    <h2 class="back-title">Перерыв — это нормально. Главное — вернуться.</h2>
    <p class="back-text">С последнего шага прошло ${days} ${plural(days, "день", "дня", "дней")}. Это ничего не ломает — продолжим с того же места.</p>
    ${plan ? `<div class="back-block"><div class="back-block-label">Твой план</div>${escapeHtml(plan)}</div>` : ""}
    <div class="back-block back-next">
      <div class="back-block-label">Следующий шаг</div>
      <span class="back-icon">${escapeHtml(next.reward)}</span>${escapeHtml(next.title)}
    </div>
    ${outcome ? `<p class="back-why">Помни, зачем: ${escapeHtml(lowerFirst(outcome))}</p>` : ""}
    <button type="button" class="back-go">Продолжить путь</button>
  `;
  backEl.classList.add("open");
  api.update_meta({ returnShownOn: todayISO() }).then((d) => (lastData = d));
  return true;
}

backEl.addEventListener("click", (e) => {
  if (e.target === backEl || e.target.closest(".back-go")) backEl.classList.remove("open");
});

/* ---------- on start ---------- */

function afterStart(data) {
  setTimeout(() => {
    if (!hasPlan(data) && !data.wizardDismissed) openWizard(data);
    else if (!maybeShowWelcomeBack(data)) maybeShowReview(data);
  }, 700);
}
