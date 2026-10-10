/* Accounts: the sign-in screen and the account button. Everything here stays dormant until
   RTG_CONFIG.authUrl points at a server, so the app works exactly as before without one.

   What the server is expected to offer (JSON in, JSON out):
     POST /auth/register  { email, password }  -> { token, email }
     POST /auth/login     { email, password }  -> { token, email }
     POST /auth/forgot    { email }            -> { ok: true }
     POST /auth/logout    (Bearer token)       -> { ok: true }
   Failures answer with a non-2xx status and { error: "<code>" }. */

const Auth = (() => {
  const SESSION_KEY = "rtg_session";
  const SKIP_KEY = "rtg_auth_skip";

  const url = () => {
    const cfg = (window.RTG_CONFIG && window.RTG_CONFIG.authUrl) || "";
    if (cfg) return cfg.replace(/\/$/, "");
    // a developer can point a local copy at a test server without touching the config
    try {
      if (location.hostname === "localhost") return (localStorage.getItem("rtg_dev_auth") || "").replace(/\/$/, "");
    } catch (e) {}
    return "";
  };
  const enabled = () => !!url();

  const read = (key) => {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  };
  const write = (key, value) => {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) {}
  };

  let session = (() => {
    try {
      return JSON.parse(read(SESSION_KEY) || "null");
    } catch (e) {
      return null;
    }
  })();
  const signedIn = () => !!(session && session.token);
  const email = () => (session && session.email) || "";
  const skipped = () => read(SKIP_KEY) === "1";

  const MESSAGES = {
    email_taken: "Этот адрес уже зарегистрирован. Войди или восстанови пароль.",
    bad_credentials: "Неверная почта или пароль.",
    bad_email: "Проверь адрес почты.",
    weak_password: "Пароль слишком простой: нужно не меньше 8 символов.",
    too_many: "Слишком много попыток. Подожди пару минут.",
  };

  async function call(path, body) {
    let res;
    try {
      res = await fetch(url() + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(signedIn() ? { Authorization: "Bearer " + session.token } : {}) },
        body: JSON.stringify(body || {}),
      });
    } catch (e) {
      throw new Error("Нет связи с сервером. Проверь интернет и попробуй ещё раз.");
    }
    let data = {};
    try {
      data = await res.json();
    } catch (e) {}
    if (!res.ok) throw new Error(MESSAGES[data.error] || "Не получилось. Попробуй ещё раз.");
    return data;
  }

  function startSession(data) {
    session = { token: data.token, email: data.email };
    write(SESSION_KEY, JSON.stringify(session));
    write(SKIP_KEY, null);
  }

  const register = async (e, p) => startSession(await call("/auth/register", { email: e, password: p }));
  const login = async (e, p) => startSession(await call("/auth/login", { email: e, password: p }));
  const forgot = (e) => call("/auth/forgot", { email: e });
  async function logout() {
    try {
      await call("/auth/logout");
    } catch (e) {
      /* the session is dropped here either way */
    }
    session = null;
    write(SESSION_KEY, null);
  }

  /* ---------- the sign-in screen ---------- */

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  function showScreen(mode = "login") {
    return new Promise((resolve) => {
      let el = document.getElementById("authScreen");
      if (!el) {
        el = document.createElement("div");
        el.id = "authScreen";
        el.className = "overlay auth-overlay";
        document.body.appendChild(el);
      }
      const cfg = window.RTG_CONFIG || {};
      const link = (href, text) => (href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${text}</a>` : text);

      const render = () => {
        const reg = mode === "register";
        const forgotMode = mode === "forgot";
        el.innerHTML = `
          <div class="auth-card">
            <svg class="auth-mark" viewBox="0 0 28 28" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 23c2-7 5-11 9-13s7-1 10 3"/><circle cx="4.5" cy="23" r="2" fill="currentColor" stroke="none"/><circle cx="23" cy="13" r="2.2" fill="#7dd3fc" stroke="none"/></svg>
            <h2 class="auth-title">${forgotMode ? "Восстановление пароля" : reg ? "Создай аккаунт" : "С возвращением"}</h2>
            <p class="auth-sub">${forgotMode ? "Напиши почту, и мы пришлём ссылку для нового пароля." : reg ? "Цели, задания и серия будут на всех твоих устройствах." : "Войди, чтобы твои цели были под рукой."}</p>
            <form class="auth-form" novalidate>
              <input class="wiz-input auth-email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="Почта" />
              ${forgotMode ? "" : `<input class="wiz-input auth-pass" type="password" autocomplete="${reg ? "new-password" : "current-password"}" placeholder="${reg ? "Пароль (не меньше 8 символов)" : "Пароль"}" />`}
              ${
                reg
                  ? `<label class="auth-consent"><input type="checkbox" class="auth-agree" /><span>Я согласен(на) с ${link(cfg.privacyUrl, "политикой конфиденциальности")} и ${link(cfg.termsUrl, "условиями")}, и на обработку моих персональных данных.</span></label>`
                  : ""
              }
              <p class="auth-error" role="alert" hidden></p>
              <button type="submit" class="greet-go auth-go">${forgotMode ? "Отправить ссылку" : reg ? "Создать аккаунт" : "Войти"}</button>
            </form>
            <div class="auth-links">
              ${
                forgotMode
                  ? `<button type="button" data-mode="login">Вернуться ко входу</button>`
                  : reg
                  ? `<button type="button" data-mode="login">Уже есть аккаунт? Войти</button>`
                  : `<button type="button" data-mode="register">Создать аккаунт</button><button type="button" data-mode="forgot">Забыли пароль?</button>`
              }
            </div>
            <button type="button" class="auth-skip">Продолжить без аккаунта</button>
          </div>`;
        el.classList.add("open");
      };

      const finish = () => {
        el.classList.remove("open");
        resolve();
      };
      const fail = (text) => {
        const box = el.querySelector(".auth-error");
        box.textContent = text;
        box.hidden = !text;
      };

      el.onclick = (ev) => {
        const sw = ev.target.closest("[data-mode]");
        if (sw) {
          mode = sw.dataset.mode;
          render();
        } else if (ev.target.closest(".auth-skip")) {
          write(SKIP_KEY, "1");
          finish();
        }
      };
      el.onsubmit = async (ev) => {
        ev.preventDefault();
        const mail = el.querySelector(".auth-email").value.trim();
        const passField = el.querySelector(".auth-pass");
        const pass = passField ? passField.value : "";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) return fail("Проверь адрес почты.");
        if (mode !== "forgot" && !pass) return fail("Введи пароль.");
        if (mode === "register") {
          if (pass.length < 8) return fail("Пароль слишком короткий: нужно не меньше 8 символов.");
          if (!el.querySelector(".auth-agree").checked) return fail("Нужно согласие с политикой конфиденциальности.");
        }
        const go = el.querySelector(".auth-go");
        go.disabled = true;
        fail("");
        try {
          if (mode === "forgot") {
            await forgot(mail);
            fail("");
            el.querySelector(".auth-sub").textContent = "Если такой адрес есть, мы отправили письмо со ссылкой. Проверь почту.";
            go.disabled = false;
            return;
          }
          if (mode === "register") await register(mail, pass);
          else await login(mail, pass);
          finish();
        } catch (e) {
          fail(e.message);
          go.disabled = false;
        }
      };
      render();
      setTimeout(() => {
        const f = el.querySelector(".auth-email");
        if (f) f.focus();
      }, 250);
    });
  }

  /* ---------- the account button in "Мои цели" ---------- */

  function controlHtml() {
    if (!enabled()) return "";
    const body = signedIn()
      ? `<div class="remind-row"><span class="auth-email-line">${esc(email())}</span></div>
         <div class="sync-actions"><button type="button" class="sync-off" data-act="auth-logout">Выйти</button></div>`
      : `<div class="remind-row"><span>Войди, чтобы цели были на всех устройствах</span></div>
         <div class="sync-actions"><button type="button" data-act="auth-login">Войти или создать аккаунт</button></div>`;
    return `
      <div class="remind-wrap auth-wrap">
        <button type="button" class="remind-btn${signedIn() ? " on" : ""}" data-act="auth-open" title="Аккаунт">
          <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="7" r="3.2"/><path d="M3.6 16.5c.8-3 3.2-4.5 6.4-4.5s5.6 1.5 6.4 4.5"/></svg>
          ${signedIn() ? "Аккаунт" : "Войти"}
        </button>
        <div class="remind-pop">${body}</div>
      </div>`;
  }

  document.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const act = el.dataset.act;
    if (act === "auth-open") el.closest(".remind-wrap").classList.toggle("open");
    else if (act === "auth-login") {
      el.closest(".remind-wrap").classList.remove("open");
      await showScreen("login");
      if (typeof renderGoals === "function") renderGoals();
    } else if (act === "auth-logout") {
      await logout();
      if (typeof renderGoals === "function") renderGoals();
    }
  });

  return { enabled, signedIn, skipped, email, showScreen, controlHtml, logout };
})();
