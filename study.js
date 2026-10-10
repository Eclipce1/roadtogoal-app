/* The "Учёба" tab: subjects, and for each one a row of squares — one square per task. */

let studySel = null; // { sid, tid } — the task whose card is open
let studyAdding = null; // subject id whose "new task" form is open
let studyNewSubject = false; // the "new subject" field at the top is open

// how the page is looked at — kept on this device only
const STUDY_PREFS_KEY = "roadtogoal_study_prefs";
function loadStudyPrefs() {
  try {
    return JSON.parse(localStorage.getItem(STUDY_PREFS_KEY) || "{}") || {};
  } catch (e) {
    return {};
  }
}
const studyPrefs = loadStudyPrefs();
let studyView = studyPrefs.view === "deadlines" ? "deadlines" : "subjects"; // "subjects" | "deadlines"
let studyHideDone = !!studyPrefs.hideDone;
let studySortDue = !!studyPrefs.sortDue;
function saveStudyPrefs() {
  try {
    localStorage.setItem(STUDY_PREFS_KEY, JSON.stringify({ view: studyView, hideDone: studyHideDone, sortDue: studySortDue }));
  } catch (e) {
    /* storage blocked: the choice simply isn't remembered */
  }
}

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

const STUDY_MAX_FILE = 8 * 1024 * 1024;

function fileSizeText(n) {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1).replace(".", ",") + " МБ";
  return Math.max(1, Math.round(n / 1024)) + " КБ";
}

function studyFilesHtml(t) {
  const files = t.files || [];
  return `
    <div class="study-files">
      ${files
        .map(
          (f) => `
        <div class="study-file" data-fid="${f.id}">
          <button type="button" class="study-file-open" data-act="study-file-open" title="Открыть">
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 9.5l-5.6 5.6a3.2 3.2 0 0 1-4.5-4.5l6-6a2.1 2.1 0 0 1 3 3l-6 6a1 1 0 0 1-1.5-1.5l5.4-5.4"/></svg>
            <span class="study-file-name">${escapeHtml(f.name)}</span>
          </button>
          <span class="study-file-size">${fileSizeText(f.size)}</span>
          <button type="button" class="study-x" data-act="study-file-del" title="Убрать файл">✕</button>
        </div>`
        )
        .join("")}
      <label class="study-btn study-attach">+ Прикрепить файл
        <input type="file" class="study-file-input" multiple hidden />
      </label>
      <p class="study-file-msg" hidden></p>
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
      ${studyFilesHtml(t)}
      <div class="study-actions">
        ${buttons}
        <button type="button" class="study-btn danger" data-act="study-del-task">Удалить</button>
      </div>
    </div>`;
}

// nearest date first, finished ones after the unfinished, no date last
function byDue(a, b) {
  const done = (a.status === "done") - (b.status === "done");
  if (done) return done;
  return (a.due || "9999-99-99").localeCompare(b.due || "9999-99-99");
}

function studyShownTasks(s) {
  const open = studySel && studySel.sid === s.id ? studySel.tid : null;
  let list = s.tasks.filter((t) => !(studyHideDone && t.status === "done" && t.id !== open));
  if (studySortDue) list = list.slice().sort(byDue);
  return list;
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
        ${studyShownTasks(s).map((t) => studySquareHtml(s, t)).join("")}
        <button type="button" class="study-sq add" data-act="study-add" title="Новое задание" aria-label="Новое задание">+</button>
      </div>
      ${studyAdding === s.id ? studyFormHtml(s) : ""}
      ${picked ? studyDetailHtml(s, picked) : ""}
    </section>`;
}

function studyBarHtml() {
  const chip = (act, on, text) => `<button type="button" class="study-chip${on ? " on" : ""}" data-act="${act}">${text}</button>`;
  return `
    <div class="study-bar">
      <div class="seg">
        <button type="button" data-act="study-view" data-to="subjects" class="${studyView === "subjects" ? "on" : ""}">Предметы</button>
        <button type="button" data-act="study-view" data-to="deadlines" class="${studyView === "deadlines" ? "on" : ""}">Сроки</button>
      </div>
      <div class="study-chips">
        ${chip("study-hide-done", studyHideDone, "Без сделанных")}
        ${studyView === "subjects" ? chip("study-sort-due", studySortDue, "По сроку") : ""}
      </div>
    </div>`;
}

// every task of every subject in one list, grouped by how soon it is due
function studyDeadlinesHtml() {
  const today = todayISO();
  const rows = [];
  for (const s of studySubjects()) for (const t of s.tasks) rows.push({ s, t });
  const groups = [
    ["late", "Просрочено", (r) => taskState(r.t) === "late"],
    ["today", "Сегодня", (r) => r.t.status !== "done" && r.t.due === today],
    ["tomorrow", "Завтра", (r) => r.t.status !== "done" && r.t.due === shiftISO(today, 1)],
    ["week", "В ближайшую неделю", (r) => r.t.status !== "done" && r.t.due > shiftISO(today, 1) && r.t.due <= shiftISO(today, 7)],
    ["later", "Позже", (r) => r.t.status !== "done" && r.t.due > shiftISO(today, 7)],
    ["none", "Без срока", (r) => r.t.status !== "done" && !r.t.due],
  ];
  if (!studyHideDone) groups.push(["done", "Сделано", (r) => r.t.status === "done"]);

  const html = groups
    .map(([key, title, test]) => {
      const list = rows.filter(test).sort((a, b) => byDue(a.t, b.t) || a.s.name.localeCompare(b.s.name));
      if (!list.length) return "";
      return `
        <div class="study-group ${key}">
          <div class="study-group-title">${title} <span>${list.length}</span></div>
          ${list
            .map(
              ({ s, t }) => `
            <button type="button" class="study-row" data-act="study-jump" data-sid="${s.id}" data-tid="${t.id}">
              <i class="study-dot ${taskState(t)}"></i>
              <span class="study-row-main">
                <span class="study-row-title">${escapeHtml(t.title)}</span>
                <span class="study-row-sub">${escapeHtml(s.name)} · ${escapeHtml(dueText(t))}</span>
              </span>
            </button>`
            )
            .join("")}
        </div>`;
    })
    .join("");
  return html || `<div class="study-empty"><p>Здесь пока пусто: все задания сделаны.</p></div>`;
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
      ${subjects.length ? studyBarHtml() : ""}
      ${studyView === "deadlines" && subjects.length ? studyDeadlinesHtml() : ""}
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
        studyView === "deadlines" && subjects.length
          ? ""
          : subjects.length
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

  if (act === "study-view") {
    studyView = el.dataset.to;
    saveStudyPrefs();
    studyRender();
  } else if (act === "study-hide-done") {
    studyHideDone = !studyHideDone;
    saveStudyPrefs();
    studyRender();
  } else if (act === "study-sort-due") {
    studySortDue = !studySortDue;
    saveStudyPrefs();
    studyRender();
  } else if (act === "study-jump") {
    studyView = "subjects";
    studySel = { sid: el.dataset.sid, tid: el.dataset.tid };
    studyAdding = null;
    saveStudyPrefs();
    studyRender();
    const card = goalsPanel.querySelector(`.study-sub[data-sid="${el.dataset.sid}"]`);
    if (card) card.scrollIntoView({ block: "start" });
  } else if (act === "study-new-subject") {
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

/* ---------- files ---------- */

function studyFileMsg(text) {
  const m = goalsPanel.querySelector(".study-file-msg");
  if (!m) return;
  m.textContent = text;
  m.hidden = !text;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

// the same short fingerprint the sync uses for photos: 24 hex digits of SHA-256
async function fileId(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

async function studyAttach(input) {
  const { sid, tid } = studyIds(input);
  const files = [...input.files];
  input.value = "";
  let problem = "";
  for (const file of files) {
    if (file.size > STUDY_MAX_FILE) {
      problem = `«${file.name}» больше 8 МБ — такой файл не прикрепить.`;
      continue;
    }
    try {
      let url = await readAsDataUrl(file);
      // some phones report no type for a file; the data URL then claims "application/octet-stream" or nothing
      if (file.type && !url.startsWith("data:" + file.type)) url = url.replace(/^data:[^;,]*/, "data:" + file.type);
      const id = await fileId(url);
      if (!(await api.put_file(id, url))) {
        problem = "Не получилось сохранить файл на этом устройстве (не хватает места).";
        continue;
      }
      await studyCall("add_task_file", sid, tid, { id, name: file.name, type: file.type, size: file.size });
    } catch (e) {
      problem = "Не получилось прочитать файл.";
    }
  }
  studyRender();
  if (problem) studyFileMsg(problem);
}

function saveBlob(dataUrl, name) {
  const [head, b64] = dataUrl.split(",", 2);
  const type = (head.match(/^data:([^;]*)/) || [])[1] || "application/octet-stream";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function studyOpenFile(f) {
  studyFileMsg("");
  try {
    if (IN_DESKTOP) {
      if (await api.open_file(f.id, f.name)) return;
    } else {
      const text = await api.get_file(f.id);
      if (text) return saveBlob(text, f.name);
    }
    // not on this device yet: it was attached on the other one, so bring it over first
    studyFileMsg("Загружаю файл…");
    const text = typeof Sync !== "undefined" ? await Sync.fetchFile(f.id) : "";
    if (!text) {
      studyFileMsg("Файла нет на этом устройстве. Подождите синхронизацию на другом устройстве или подключите её здесь.");
      return;
    }
    await api.put_file(f.id, text);
    studyFileMsg("");
    if (IN_DESKTOP) await api.open_file(f.id, f.name);
    else saveBlob(text, f.name);
  } catch (e) {
    studyFileMsg("Не получилось открыть файл.");
  }
}

goalsPanel.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || !["study-file-open", "study-file-del"].includes(el.dataset.act)) return;
  const { sid, tid } = studyIds(el);
  const fid = el.closest(".study-file").dataset.fid;
  const sub = studySubjects().find((x) => x.id === sid);
  const task = sub && sub.tasks.find((x) => x.id === tid);
  const file = task && (task.files || []).find((x) => x.id === fid);
  if (!file) return;
  if (el.dataset.act === "study-file-open") studyOpenFile(file);
  else {
    await studyCall("remove_task_file", sid, tid, fid);
    studyRender();
  }
});

goalsPanel.addEventListener("change", (e) => {
  if (e.target.matches(".study-file-input")) studyAttach(e.target);
});
