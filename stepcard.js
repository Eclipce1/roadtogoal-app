// Side panel with a step's own plan: description, checklist of actions and a
// "minimum for a hard day". Everything autosaves.

const cardEl = document.getElementById("stepCard");
const cardPanel = cardEl.querySelector(".step-panel");
let card = null; // { id, step }
let cardSaveTimer = null;

function stepState(data, id) {
  const i = data.subGoals.findIndex((g) => g.id === id);
  const firstNotDone = data.subGoals.findIndex((g) => !g.done);
  const g = data.subGoals[i];
  return {
    index: i,
    state: g.done ? "done" : i === firstNotDone ? "current" : "locked",
    isFinish: !!g.finish,
  };
}

function openStepCard(id) {
  if (!lastData) return;
  const g = lastData.subGoals.find((x) => x.id === id);
  if (!g) return;
  card = {
    id,
    step: {
      title: g.title,
      reward: g.reward,
      note: g.note || "",
      minimum: g.minimum || "",
      actions: (g.actions || []).map((a) => ({ text: a.text, done: !!a.done, icon: a.icon || "" })),
    },
  };
  cardPanel.classList.remove("icons-open");
  card.emojiRow = null;
  card.newActionIcon = "";
  renderStepCard();
  cardEl.classList.add("open");
}

function renderStepCard() {
  const g = lastData.subGoals.find((x) => x.id === card.id);
  const { index, state, isFinish } = stepState(lastData, card.id);
  const s = card.step;
  const label = `${isFinish ? "Финиш" : "Шаг " + String(index + 1).padStart(2, "0")} · ${
    state === "done" ? "пройден" : state === "current" ? "сейчас" : "впереди"
  }`;

  let footer;
  if (state === "current") {
    footer = `<button type="button" class="step-complete" data-act="complete">Шаг выполнен ✓</button>`;
  } else if (state === "done") {
    footer = `<div class="step-done-note">Пройден ${g.doneAt ? fmtDate(g.doneAt, { day: "numeric", month: "long" }) : ""}</div>
      <button type="button" class="step-undo" data-act="undo">Отменить выполнение</button>`;
  } else {
    footer = `<div class="step-locked-note">Этот шаг откроется, когда пройдёшь предыдущие. План можно составить уже сейчас.</div>`;
  }

  cardPanel.innerHTML = `
    <button type="button" class="wiz-close" data-act="close" title="Закрыть">✕</button>
    <div class="step-label ${state}${isFinish ? " finish" : ""}">${label}</div>
    <div class="step-head">
      <button type="button" class="step-icon" data-act="icon" title="Сменить значок">${escapeHtml(s.reward)}</button>
      <textarea class="step-title" data-field="title" rows="1">${escapeHtml(s.title)}</textarea>
    </div>
    <div class="step-icons">
      ${ICON_GROUPS.map(
        (grp) => `
        <div class="icon-group-label">${grp.label}</div>
        <div class="step-icon-grid">
          ${grp.icons
            .map((ic) => `<button type="button" class="icon-opt${ic === s.reward ? " selected" : ""}" data-act="pick" data-icon="${ic}">${ic}</button>`)
            .join("")}
        </div>`
      ).join("")}
    </div>
    ${orderControls(index, state, isFinish)}

    <textarea class="step-note" data-field="note" rows="2" placeholder="Коротко: что это за шаг и зачем он нужен">${escapeHtml(s.note)}</textarea>

    ${stepImagesHtml(g.images || [])}

    <div class="step-section">
      <div class="step-section-title">Как выполнить<span>${s.actions.filter((a) => a.text && a.done).length}/${s.actions.filter((a) => a.text).length}</span></div>
      <div class="step-actions">
        ${s.actions
          .map(
            (a, i) => `
          <div class="act${a.done ? " done" : ""}" data-i="${i}">
            <button type="button" class="act-check" data-act="toggle" title="${a.done ? "Снять отметку" : "Готово"}">${a.done ? "✓" : ""}</button>
            <button type="button" class="act-emoji${a.icon ? " chosen" : ""}" data-act="act-emoji" title="Добавить эмодзи">${a.icon || "🙂"}</button>
            <textarea class="act-text" data-act-text="${i}" rows="1">${escapeHtml(a.text)}</textarea>
            <button type="button" class="act-del" data-act="remove" title="Удалить">✕</button>
          </div>
          ${card.emojiRow === i ? actionIconsHtml(i, a.icon) : ""}`
          )
          .join("")}
      </div>
      <div class="act-new-wrap">
        <button type="button" class="act-emoji${card.newActionIcon ? " chosen" : ""}" data-act="new-emoji" title="Добавить эмодзи">${card.newActionIcon || "🙂"}</button>
        <input class="act-new" placeholder="+ Добавить действие и нажать Enter" />
      </div>
      ${card.emojiRow === "new" ? actionIconsHtml("new", card.newActionIcon) : ""}
      ${s.actions.length ? "" : '<div class="step-hint">Разбей шаг на 2–4 маленьких действия. Первое должно занимать не больше 5 минут — так проще начать.</div>'}
    </div>

    <div class="step-section">
      <div class="step-section-title">Минимум на трудный день</div>
      <input class="step-min" data-field="minimum" value="${escapeHtml(s.minimum)}" placeholder="Например: хотя бы выйти и пройти 1 км" />
      <div class="step-hint">Если совсем нет сил — сделай хотя бы это. Лучше чуть-чуть, чем ничего: так серия не прервётся.</div>
    </div>

    <div class="step-footer">${footer}</div>
    <button type="button" class="step-delete" data-act="delete">Удалить шаг</button>
  `;
  autoGrowTitle();
}

// The same emoji arsenal used for a step's own icon, offered per action item so
// a checklist can carry a bit of its own color ("🎬 Запустить Premiere Pro").
function actionIconsHtml(i, current) {
  return `
    <div class="act-icons">
      ${ICON_GROUPS.map(
        (grp) => `
        <div class="icon-group-label">${grp.label}</div>
        <div class="step-icon-grid">
          ${grp.icons
            .map(
              (ic) =>
                `<button type="button" class="icon-opt${ic === current ? " selected" : ""}" data-act="act-pick" data-i="${i}" data-icon="${ic}">${ic}</button>`
            )
            .join("")}
        </div>`
      ).join("")}
    </div>`;
}

// Reference photos for a step — a meal plan, a workout chart, anything worth a
// glance while doing the step. Stored as small resized JPEGs right in the step's
// own data, so no separate file storage or serving route is needed.
function stepImagesHtml(images) {
  return `
    <div class="step-images">
      ${images
        .map(
          (im) => `
        <div class="step-img" data-img="${im.id}">
          <img src="${im.src}" data-act="img-view" alt="" />
          <button type="button" class="step-img-del" data-act="img-del" title="Удалить фото">✕</button>
        </div>`
        )
        .join("")}
      <button type="button" class="step-img-add" data-act="img-add" title="Прикрепить фото">+ фото</button>
    </div>
    <input type="file" id="stepImgInput" accept="image/*" hidden />`;
}

// Shrinks whatever the user picked to something reasonable before it goes into
// the JSON store — a phone photo straight off a camera would otherwise bloat
// data.json (and, since it lives on a synced cloud folder, slow every save).
function resizeImageFile(file, maxSide = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("not an image"));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxSide || height > maxSide) {
          const scale = maxSide / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const imageViewEl = document.getElementById("imageView");

function openImageView(src) {
  imageViewEl.querySelector("img").src = src;
  imageViewEl.classList.add("open");
}

function closeImageView() {
  imageViewEl.classList.remove("open");
  imageViewEl.querySelector("img").src = "";
}

imageViewEl.addEventListener("mousedown", (e) => {
  if (e.target === imageViewEl) closeImageView();
});
imageViewEl.querySelector(".wiz-close").addEventListener("click", closeImageView);
document.addEventListener(
  "keydown",
  (e) => {
    if (e.key !== "Escape" || !imageViewEl.classList.contains("open")) return;
    closeImageView();
    // the lightbox sits on top of the step card; without this, the step card's own
    // Escape handler (below) fires on the very same keystroke and closes that too
    e.stopImmediatePropagation();
  },
  true
);

// reordering rules mirror main.py: done steps and the finish never move
function orderControls(index, state, isFinish) {
  const steps = lastData.subGoals;
  const cur = steps[index];
  const movable = (s) => s && !s.done && !s.finish;
  const canLeft = movable(cur) && movable(steps[index - 1]);
  const canRight = movable(cur) && movable(steps[index + 1]);
  const canFinish = !(cur.done && steps.some((s) => s !== cur && !s.done));
  return `
    <div class="step-order">
      <button type="button" data-act="left" ${canLeft ? "" : "disabled"}>← раньше</button>
      <button type="button" data-act="right" ${canRight ? "" : "disabled"}>позже →</button>
      ${
        isFinish
          ? '<span class="step-finish-tag">🏁 это финиш</span>'
          : `<button type="button" class="make-finish" data-act="finish" ${canFinish ? "" : "disabled"}>🏁 сделать финишем</button>`
      }
    </div>`;
}

// the title wraps whenever the panel gets narrower (e.g. a scrollbar appears)
new ResizeObserver(() => autoGrowTitle()).observe(cardPanel);

// the title and every action are textareas that grow with their text instead of clipping it
function autoGrowTitle() {
  cardPanel.querySelectorAll(".step-title, .act-text").forEach(growField);
}

function growField(t) {
  t.style.height = "auto";
  t.style.height = t.scrollHeight + "px";
}

function refreshActionsCounter() {
  const acts = card.step.actions.filter((a) => a.text);
  const el = cardPanel.querySelector(".step-section-title span");
  if (el) el.textContent = `${acts.filter((a) => a.done).length}/${acts.length}`;
}

function scheduleCardSave() {
  clearTimeout(cardSaveTimer);
  cardSaveTimer = setTimeout(saveStepCard, 400);
}

async function saveStepCard() {
  clearTimeout(cardSaveTimer);
  if (!card) return;
  const s = card.step;
  lastData = await api.update_subgoal(card.id, {
    title: s.title.trim() || "Без названия",
    reward: s.reward,
    note: s.note.trim(),
    minimum: s.minimum.trim(),
    actions: s.actions.filter((a) => a.text.trim()).map((a) => ({ text: a.text.trim(), done: a.done, icon: a.icon || "" })),
  });
}

async function closeStepCard() {
  if (!card) return;
  await saveStepCard();
  card = null;
  cardEl.classList.remove("open");
  render(lastData);
}

cardPanel.addEventListener("input", (e) => {
  if (!card) return;
  const field = e.target.dataset.field;
  if (field) card.step[field] = e.target.value;
  if (e.target.matches(".step-title, .act-text")) growField(e.target);
  if (e.target.dataset.actText !== undefined) card.step.actions[+e.target.dataset.actText].text = e.target.value;
  scheduleCardSave();
});

cardPanel.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || !card) return;
  if (e.target.classList.contains("act-new")) {
    e.preventDefault();
    const text = e.target.value.trim();
    if (!text) return;
    card.step.actions.push({ text, done: false, icon: card.newActionIcon || "" });
    card.newActionIcon = "";
    renderStepCard();
    cardPanel.querySelector(".act-new").focus();
    scheduleCardSave();
  } else if (e.target.matches("input, .step-title, .act-text")) {
    e.preventDefault();
    e.target.blur();
  }
});

// clicking anywhere outside the emoji grid (or its own trigger button) closes it,
// the way any other dropdown would — otherwise it just sits open in the way
document.addEventListener("mousedown", (e) => {
  if (!card || card.emojiRow === null) return;
  if (e.target.closest(".act-icons") || e.target.closest(".act-emoji")) return;
  card.emojiRow = null;
  renderStepCard();
});

cardPanel.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn || !card) return;
  const act = btn.dataset.act;
  const row = btn.closest(".act");
  const i = row ? +row.dataset.i : -1;

  if (act === "close") closeStepCard();
  else if (act === "icon") cardPanel.classList.toggle("icons-open");
  else if (act === "pick") {
    card.step.reward = btn.dataset.icon;
    cardPanel.querySelector(".step-icon").textContent = card.step.reward;
    cardPanel.querySelectorAll(".step-icons .icon-opt").forEach((b) => b.classList.toggle("selected", b === btn));
    cardPanel.classList.remove("icons-open");
    await saveStepCard();
    render(lastData);
  } else if (act === "left" || act === "right" || act === "finish") {
    await saveStepCard();
    lastData =
      act === "finish" ? await api.set_finish(card.id) : await api.move_subgoal(card.id, act === "left" ? -1 : 1);
    render(lastData);
    renderStepCard();
  }
  else if (act === "toggle") {
    card.step.actions[i].done = !card.step.actions[i].done;
    row.classList.toggle("done", card.step.actions[i].done);
    btn.textContent = card.step.actions[i].done ? "✓" : "";
    if (card.step.actions[i].done) tickSound();
    refreshActionsCounter();
    scheduleCardSave();
  } else if (act === "remove") {
    card.step.actions.splice(i, 1);
    renderStepCard();
    scheduleCardSave();
  } else if (act === "act-emoji") {
    card.emojiRow = card.emojiRow === i ? null : i;
    renderStepCard();
  } else if (act === "new-emoji") {
    card.emojiRow = card.emojiRow === "new" ? null : "new";
    renderStepCard();
  } else if (act === "act-pick") {
    if (btn.dataset.i === "new") {
      card.newActionIcon = card.newActionIcon === btn.dataset.icon ? "" : btn.dataset.icon;
    } else {
      const cur = card.step.actions[+btn.dataset.i];
      cur.icon = cur.icon === btn.dataset.icon ? "" : btn.dataset.icon;
      scheduleCardSave();
    }
    card.emojiRow = null;
    renderStepCard();
    if (btn.dataset.i === "new") cardPanel.querySelector(".act-new").focus();
  } else if (act === "complete") {
    const id = card.id;
    await closeStepCard();
    completeGoal(id);
  } else if (act === "undo") {
    const id = card.id;
    await closeStepCard();
    resetGoal(id);
  } else if (act === "delete") {
    const id = card.id;
    await saveStepCard();
    card = null;
    cardEl.classList.remove("open");
    deleteGoal(id);
  } else if (act === "img-add") {
    document.getElementById("stepImgInput").click();
  } else if (act === "img-view") {
    openImageView(btn.src);
  } else if (act === "img-del") {
    const imgId = +btn.closest(".step-img").dataset.img;
    lastData = await api.delete_step_image(card.id, imgId);
    renderStepCard();
  }
});

cardPanel.addEventListener("change", async (e) => {
  if (e.target.id !== "stepImgInput" || !card) return;
  const file = e.target.files[0];
  e.target.value = ""; // so picking the same file again still fires change
  if (!file) return;
  let dataUrl;
  try {
    dataUrl = await resizeImageFile(file);
  } catch {
    return; // not a readable image — quietly ignore rather than show a scary error
  }
  lastData = await api.add_step_image(card.id, dataUrl);
  renderStepCard();
});

function tickSound() {
  tone(659.25, 0, { volume: 0.035, decay: 0.35 });
}

cardEl.addEventListener("mousedown", (e) => {
  if (e.target === cardEl) closeStepCard();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && card) closeStepCard();
});

// the smallest step for today, shown in the streak line when the day isn't marked yet
function currentMinimum(data) {
  const next = data.subGoals.find((g) => !g.done);
  return next && next.minimum ? next.minimum : "";
}
