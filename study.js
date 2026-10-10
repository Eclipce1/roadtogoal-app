/* The "Учёба" tab: subjects, and for each one a row of squares — one square per task. */

let studySel = null; // { sid, tid } — the task whose card is open
let studyAdding = null; // subject id whose "new task" form is open
let studyNewSubject = false; // the "new subject" field at the top is open

const STUDY_STATE_NAME = { new: "Новое", doing: "В работе", done: "Сделано", late: "Просрочено" };

function studySubjects() {
  return (lastData && lastData.subjects) || [];
}

// "late" is not stored: it is simply an unfinished task whose date has passed
function taskState(t) {
  if (t.status === "done") return "done";
  if (t.due && t.due < todayISO()) return "late";
  return t.status === "doing" ? "doing" : "new";
}

function dueText(t) {
  if (!t.due) return "без срока";
  const left = daysBetween(todayISO(), t.due);
  const date = new Date(t.due + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  if (t.status === "done") return `срок был ${date}`;
  if (left < 0) return `просрочено на ${-left} ${plural(-left, "день", "дня", "дней")} (${date})`;
  if (left === 0) return "срок сегодня";
  if (left === 1) return "срок завтра";
  return `срок ${date} (через ${left} ${plural(left, "день", "дня", "дней")})`;
}

function studyCounts() {
  let open = 0;
  let late = 0;
  for (const s of studySubjects()) {
    for (const t of s.tasks) {
      const st = taskState(t);
      if (st === "late") late++;
      if (st !== "done") open++;
    }
  }
  return { open, late };
}

function studySquareHtml(s, t) {
  const st = taskState(t);
  const sel = studySel && studySel.sid === s.id && studySel.tid === t.id;
  const tip = `${t.title} · ${dueText(t)}`;
  return `<button type="button" class="study-sq ${st}${sel ? " sel" : ""}" data-act="study-pick" data-tid="${t.id}" title="${escapeHtml(tip)}" aria-label="${escapeHtml(tip)}"></button>`;
}

function studyFormHtml(s) {
  return `
    <div class="study-form" data-sid="${s.id}">
      <input class="wiz-input study-f-title" placeholder="Название: например, Лабораторная 4" maxlength="200" />
      <label class="study-due-label">Срок сдачи
        <input type="date" class="wiz-input study-f-due" />
      </label>
      <textarea class="wiz-input study-f-text" rows="3" placeholder="Текст задания (можно вставить целиком)"></textarea>
      <div class="study-actions">
        <button type="button" class="study-btn primary" data-act="study-save-new">Добавить</button>
        <button type="button" class="study-btn" data-act="study-cancel-new">Отмена</button>
      </div>
    </div>`;
}

function studyDetailHtml(s, t) {
  const st = taskState(t);
  const buttons =
    t.status === "done"
      ? `<button type="button" class="study-btn" data-act="study-status" data-to="doing">Вернуть в работу</button>`
      : `${t.status === "doing" ? "" : `<button type="button" class="study-btn" data-act="study-status" data-to="doing">Взять в работу</button>`}
         <button type="button" class="study-btn primary" data-act="study-status" data-to="done">Сделано</button>
         ${t.status === "doing" ? `<button type="button" class="study-btn" data-act="study-status" data-to="new">Вернуть в новые</button>` : ""}`;
  return `
    <div class="study-detail" data-sid="${s.id}" data-tid="${t.id}">
      <div class="study-detail-state ${st}">${STUDY_STATE_NAME[st]} · ${escapeHtml(dueText(t))}</div>
      <input class="wiz-input study-t-title" value="${escapeHtml(t.title)}" maxlength="200" />
      <label class="study-due-label">Срок сдачи
        <input type="date" class="wiz-input study-t-due" value="${t.due || ""}" />
      </label>
      <textarea class="wiz-input study-t-text" rows="4" placeholder="Текст задания">${escapeHtml(t.text || "")}</textarea>
      <div class="study-actions">
        ${buttons}
        <button type="button" class="study-btn danger" data-act="study-del-task">Удалить</button>
      </div>
    </div>`;
}

function studySubjectHtml(s) {
  const done = s.tasks.filter((t) => t.status === "done").length;
  const picked = studySel && studySel.sid === s.id ? s.tasks.find((t) => t.id === studySel.tid) : null;
  return `
    <section class="study-sub" data-sid="${s.id}">
      <div class="study-sub-head">
        <input class="study-name" value="${escapeHtml(s.name)}" maxlength="80" aria-label="Название предмета" />
        <span class="study-count">${done} из ${s.tasks.length}</span>
        <button type="button" class="study-x" data-act="study-del-subject" title="Удалить предмет">✕</button>
      </div>
      <div class="study-grid">
        ${s.tasks.map((t) => studySquareHtml(s, t)).join("")}
        <button type="button" class="study-sq add" data-act="study-add" title="Новое задание" aria-label="Новое задание">+</button>
      </div>
      ${studyAdding === s.id ? studyFormHtml(s) : ""}
      ${picked ? studyDetailHtml(s, picked) : ""}
    </section>`;
}

function studyMainHtml() {
  const subjects = studySubjects();
  const { open, late } = studyCounts();
  const sub = !subjects.length
    ? "Задания, лабораторные, практики"
    : `${open} ${plural(open, "задание", "задания", "заданий")} впереди${late ? ` · ${late} просрочено` : ""}`;
  return `
    <div class="goals-top">
      <div>
        <div class="goals-title">Учёба</div>
        <div class="goals-sub">${sub}</div>
      </div>
      <div class="goals-tools">
        <button type="button" class="goals-new-btn" data-act="study-new-subject">+ Предмет</button>
      </div>
    </div>
    <div class="goals-list study">
      ${
        studyNewSubject
          ? `<div class="study-newsub">
               <input class="wiz-input study-newsub-name" placeholder="Предмет: например, Базы данных" maxlength="80" />
               <button type="button" class="study-btn primary" data-act="study-save-subject">Добавить</button>
               <button type="button" class="study-btn" data-act="study-cancel-subject">Отмена</button>
             </div>`
          : ""
      }
      ${
        subjects.length
          ? subjects.map(studySubjectHtml).join("")
          : `<div class="study-empty">
               <p>Здесь будут ваши предметы и задания.</p>
               <p>Добавьте первый предмет, а в нём — задания со сроками. Каждое задание это квадратик: серый — новое, голубой — в работе, зелёный — сделано, красный — просрочено.</p>
             </div>`
      }
      <div class="study-legend">
        <span><i class="new"></i>новое</span><span><i class="doing"></i>в работе</span><span><i class="done"></i>сделано</span><span><i class="late"></i>просрочено</span>
      </div>
    </div>`;
}

/* ---------- wiring ---------- */

function studyFit() {
  goalsPanel.querySelectorAll(".study-t-text, .study-f-text").forEach((t) => {
    t.style.height = "auto";
    t.style.height = t.scrollHeight + (t.offsetHeight - t.clientHeight) + "px";
  });
}

function studyRender(focusSel) {
  renderGoals();
  studyFit();
  if (focusSel) {
    const el = goalsPanel.querySelector(focusSel);
    if (el) el.focus();
  }
}

async function studyCall(name, ...args) {
  lastData = await api[name](...args);
}

function studyIds(el) {
  const holder = el.closest("[data-sid]");
  return { sid: holder && holder.dataset.sid, tid: holder && holder.dataset.tid };
}

async function studyAddSubject() {
  const input = goalsPanel.querySelector(".study-newsub-name");
  const name = input ? input.value.trim() : "";
  if (!name) {
    if (input) input.focus();
    return;
  }
  studyNewSubject = false;
  await studyCall("add_subject", name);
  studyRender();
}

async function studyAddTask(form) {
  const title = form.querySelector(".study-f-title").value.trim();
  if (!title) {
    const f = form.querySelector(".study-f-title");
    f.classList.remove("shake");
    void f.offsetWidth;
    f.classList.add("shake");
    f.focus();
    return;
  }
  const sid = form.dataset.sid;
  const before = new Set((studySubjects().find((s) => s.id === sid) || { tasks: [] }).tasks.map((t) => t.id));
  await studyCall("add_task", sid, title, form.querySelector(".study-f-text").value, form.querySelector(".study-f-due").value);
  const subj = studySubjects().find((s) => s.id === sid);
  const made = subj && subj.tasks.find((t) => !before.has(t.id));
  studyAdding = null;
  studySel = made ? { sid, tid: made.id } : null;
  studyRender();
}

goalsPanel.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || !String(el.dataset.act).startsWith("study-")) return;
  const act = el.dataset.act;
  const { sid, tid } = studyIds(el);

  if (act === "study-new-subject") {
    studyNewSubject = true;
    studyRender(".study-newsub-name");
  } else if (act === "study-cancel-subject") {
    studyNewSubject = false;
    studyRender();
  } else if (act === "study-save-subject") {
    studyAddSubject();
  } else if (act === "study-add") {
    studyAdding = sid;
    studySel = null;
    studyRender(".study-f-title");
  } else if (act === "study-cancel-new") {
    studyAdding = null;
    studyRender();
  } else if (act === "study-save-new") {
    studyAddTask(el.closest(".study-form"));
  } else if (act === "study-pick") {
    const same = studySel && studySel.sid === sid && studySel.tid === el.dataset.tid;
    studySel = same ? null : { sid, tid: el.dataset.tid };
    studyAdding = null;
    studyRender();
  } else if (act === "study-status") {
    await studyCall("update_task", sid, tid, { status: el.dataset.to });
    studyRender();
  } else if (act === "study-del-task") {
    const sub = studySubjects().find((s) => s.id === sid);
    const t = sub && sub.tasks.find((x) => x.id === tid);
    const ok = await confirmDialog({
      title: `Удалить задание «${escapeHtml(t ? t.title : "")}»?`,
      text: "Задание исчезнет из предмета. Это нельзя отменить.",
      yes: "Удалить",
      no: "Оставить",
    });
    if (!ok) return;
    studySel = null;
    await studyCall("delete_task", sid, tid);
    studyRender();
  } else if (act === "study-del-subject") {
    const sub = studySubjects().find((s) => s.id === sid);
    const n = sub ? sub.tasks.length : 0;
    const ok = await confirmDialog({
      title: `Удалить предмет «${escapeHtml(sub ? sub.name : "")}»?`,
      text: n ? `Вместе с ним удалятся все задания (${n}). Это нельзя отменить.` : "Это нельзя отменить.",
      yes: "Удалить",
      no: "Оставить",
    });
    if (!ok) return;
    if (studySel && studySel.sid === sid) studySel = null;
    await studyCall("delete_subject", sid);
    studyRender();
  }
});

// text and titles are saved when the field is left; they are not redrawn, so a tap on another
// square right after typing is not lost to a rebuilt page
goalsPanel.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.matches(".study-name")) {
    const { sid } = studyIds(t);
    if (!t.value.trim()) {
      const sub = studySubjects().find((s) => s.id === sid);
      t.value = sub ? sub.name : "";
      return;
    }
    await studyCall("rename_subject", sid, t.value);
  } else if (t.matches(".study-t-title")) {
    const { sid, tid } = studyIds(t);
    if (!t.value.trim()) {
      const sub = studySubjects().find((s) => s.id === sid);
      const task = sub && sub.tasks.find((x) => x.id === tid);
      t.value = task ? task.title : "";
      return;
    }
    await studyCall("update_task", sid, tid, { title: t.value });
  } else if (t.matches(".study-t-text")) {
    const { sid, tid } = studyIds(t);
    await studyCall("update_task", sid, tid, { text: t.value });
  } else if (t.matches(".study-t-due")) {
    const { sid, tid } = studyIds(t);
    await studyCall("update_task", sid, tid, { due: t.value });
    studyRender();
  }
});

goalsPanel.addEventListener("input", (e) => {
  if (e.target.matches(".study-t-text, .study-f-text")) studyFit();
});

goalsPanel.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.shiftKey) return;
  if (e.target.matches(".study-newsub-name")) {
    e.preventDefault();
    studyAddSubject();
  } else if (e.target.matches(".study-f-title")) {
    e.preventDefault();
    studyAddTask(e.target.closest(".study-form"));
  } else if (e.target.matches(".study-name, .study-t-title")) {
    e.preventDefault();
    e.target.blur();
  }
});
