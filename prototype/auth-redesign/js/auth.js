/* ============================================================
   万象 · 准入登记 — page behaviour
   Local validation only. This prototype never submits credentials.
   ============================================================ */
(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- toast ---------- */
  var toastEl = $("#toast");
  var toastTimer = null;
  function toast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.hidden = false;
    requestAnimationFrame(function () { toastEl.classList.add("is-show"); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("is-show");
      setTimeout(function () { toastEl.hidden = true; }, 220);
    }, 3400);
  }

  function hideToast() {
    if (!toastEl) return;
    clearTimeout(toastTimer);
    toastEl.classList.remove("is-show");
    toastEl.hidden = true;
  }

  /* ---------- dom ---------- */
  var tabs = $$(".mode-tab");
  var panel = $("#auth-panel");
  var authCopy = $("#auth-copy");
  var authTitle = $("#auth-title");
  var authLead = $("#auth-lead");
  var loginForm = $("#form-login");
  var registerForm = $("#form-register");
  var loginInput = $("#login-id");
  var loginPass = $("#login-pass");
  var loginRemember = $("#login-remember");
  var loginSubmit = $("#login-submit");
  var loginError = $("#login-error");
  var loginDemo = $("#login-demo");
  var registerInput = $("#reg-username");
  var emailInput = $("#reg-email");
  var registerPass = $("#reg-pass");
  var confirmInput = $("#reg-confirm");
  var nameInput = $("#reg-name");
  var identitySelect = $("#reg-identity");
  var registerSubmit = $("#register-submit");
  var registerError = $("#register-error");
  var registerDemo = $("#register-demo");
  var strength = $("#reg-strength");
  var strengthLabel = $(".strength__label", strength);
  var forgotToggle = $("#forgot-toggle");
  var forgotNote = $("#forgot-note");
  var pass = $("#pass");
  var passFront = $(".pass__front");
  var passBack = $("#pass-back");
  var passName = $("#pass-name");
  var passMonogram = $("#pass-monogram");
  var passRoleEn = $("#pass-role-en");
  var passRoleCn = $("#pass-role-cn");
  var passEntry = $("#pass-entry");
  var passStatus = $("#pass-status");
  var passNo = $("#pass-no");
  var passBackNo = $("#pass-back-no");
  var passBarcode = $("#pass-barcode");
  var passStamp = $("#pass-stamp");
  var flipBtn = $("#flip-pass");

  var COPY = {
    login: {
      title: "欢迎回来，<br>实验还开着。",
      lead: "验证身份，回到个人空间或题目实验室。账号现在保存显示名与默认入口；材料与实验仍按当前浏览器会话保留。",
      docTitle: "登录 · 准入登记 · 万象题目实验室",
      roleEn: "RETURNING MEMBER",
      roleCn: "回访者",
      entry: "个人空间（可设）",
      status: "回访",
      stamp: "再次入场",
      busy: "正在验证…",
      original: "进入实验室",
      toast: "本地校验通过 · 演示页未提交任何数据。"
    },
    register: {
      title: '建一份档案，<br>把问题<span class="u">留下</span>。',
      lead: "注册后会直接进入个人空间。先用一个名字和一组密码，留下自己的显示名、默认入口与账号资料。",
      docTitle: "注册 · 准入登记 · 万象题目实验室",
      roleEn: "NEW RECORD",
      roleCn: "新档案",
      entry: "建立后可设置",
      status: "待建档",
      stamp: "新档案",
      busy: "正在建档…",
      original: "建立档案",
      toast: "本地校验通过 · 演示页没有创建账号。"
    }
  };

  var state = {
    mode: "login",
    flipped: false,
    login: { identifier: "", password: "", remember: false },
    register: {
      username: "",
      email: "",
      password: "",
      confirmPassword: "",
      displayName: "",
      identityTag: ""
    }
  };

  var busyTimer = null;

  /* ---------- helpers ---------- */
  function characters(text) { return Array.from(text).length; }

  var LETTER = /^\p{L}$/u;
  var DECIMAL = /^\p{Nd}$/u;
  var WHITESPACE = /\s/u;

  function hashString(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function field(input) { return input ? input.closest(".field") : null; }

  function setFieldError(input, message) {
    if (!input) return;
    var error = document.getElementById(input.id + "-error");
    var wrap = field(input);
    if (!error) return;
    if (message) {
      error.textContent = message;
      error.hidden = false;
      if (wrap) wrap.classList.add("is-invalid");
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-describedby", error.id);
    } else {
      error.textContent = "";
      error.hidden = true;
      if (wrap) wrap.classList.remove("is-invalid");
      input.removeAttribute("aria-invalid");
      input.removeAttribute("aria-describedby");
    }
  }

  function clearErrors() {
    $$(".field.is-invalid").forEach(function (wrap) { wrap.classList.remove("is-invalid"); });
    $$(".field__error").forEach(function (error) { error.textContent = ""; error.hidden = true; });
    $$(".form-error").forEach(function (error) { error.textContent = ""; error.hidden = true; });
    $$(".auth-form input, .auth-form select").forEach(function (input) {
      input.removeAttribute("aria-invalid");
      input.removeAttribute("aria-describedby");
    });
    $$(".caps-hint").forEach(function (hint) { hint.hidden = true; });
    $$(".demo-note").forEach(function (note) { note.hidden = true; });
    $$(".help-note").forEach(function (note) { note.hidden = true; });
    if (forgotToggle) forgotToggle.setAttribute("aria-expanded", "false");
  }

  function clearField(input) {
    setFieldError(input, "");
    var summary = input && input.closest("form") === loginForm ? loginError : registerError;
    if (summary) { summary.textContent = ""; summary.hidden = true; }
    var demo = input && input.closest("form") === loginForm ? loginDemo : registerDemo;
    if (demo) demo.hidden = true;
  }

  function showSummary(element, count) {
    if (!element) return;
    element.textContent = "请检查 " + count + " 个字段。";
    element.hidden = false;
  }

  function setBusy(mode, busy) {
    var form = mode === "login" ? loginForm : registerForm;
    var button = mode === "login" ? loginSubmit : registerSubmit;
    var label = $("[data-label]", button);
    if (!button || !label) return;
    if (busy) {
      button.disabled = true;
      button.classList.add("is-busy");
      form.setAttribute("aria-busy", "true");
      label.textContent = COPY[mode].busy;
    } else {
      button.disabled = false;
      button.classList.remove("is-busy");
      form.removeAttribute("aria-busy");
      label.textContent = COPY[mode].original;
    }
  }

  /* ---------- password strength ---------- */
  function passwordStrength(value) {
    if (value === "") return 0;
    if (characters(value) < 8) return 1;
    var score = 2;
    if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
    if (/\d/.test(value)) score += 1;
    if (/[^A-Za-z0-9]/.test(value)) score += 1;
    return Math.min(4, score);
  }

  var STRENGTH_LABELS = { 0: "至少 8 位", 1: "太短", 2: "较弱", 3: "良好", 4: "很强" };

  function updateStrength() {
    if (!strength) return;
    var level = passwordStrength(state.register.password);
    strength.setAttribute("data-level", String(level));
    if (strengthLabel) strengthLabel.textContent = STRENGTH_LABELS[level];
  }

  /* ---------- live pass ---------- */
  function passNameValue() {
    if (state.mode === "login") {
      var identifier = state.login.identifier.trim();
      if (!identifier) return "";
      return identifier.indexOf("@") >= 0 ? identifier.split("@")[0] : identifier;
    }
    return state.register.displayName.trim() || state.register.username.trim();
  }

  function serialFor(name) {
    if (!name) return "NO. WX-2026-••••";
    var number = hashString(name.toLowerCase()) % 9000 + 1000;
    return "NO. WX-2026-" + String(number);
  }

  function renderBarcode(seed) {
    if (!passBarcode) return;
    var value = hashString(seed || "wanxiang") || 1;
    var html = "";
    for (var i = 0; i < 32; i++) {
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
      var width = 1 + (value % 3);
      var height = 72 + ((value >>> 9) % 29);
      html += '<i style="width:' + width + "px;height:" + height + '%"></i>';
    }
    passBarcode.innerHTML = html;
  }

  function updatePass() {
    if (!passName) return;
    var conf = COPY[state.mode];
    var name = passNameValue();
    var hasName = name.length > 0;

    passName.textContent = hasName ? name : "待填写";
    passName.classList.toggle("is-empty", !hasName);
    passName.title = hasName ? name : "登记名会随输入更新";

    var first = hasName ? Array.from(name)[0] : "万";
    if (/[a-z]/i.test(first)) first = first.toUpperCase();
    passMonogram.textContent = first;

    passRoleEn.textContent = conf.roleEn;
    passRoleCn.textContent = conf.roleCn;
    passEntry.textContent = conf.entry;
    passStatus.textContent = conf.status;
    passStamp.textContent = conf.stamp;

    var serial = serialFor(name);
    passNo.textContent = serial;
    passBackNo.textContent = serial;
    renderBarcode(name);
  }

  /* ---------- flip ---------- */
  function setFlipped(flipped) {
    state.flipped = flipped;
    pass.classList.toggle("is-flipped", flipped);
    if (flipBtn) {
      flipBtn.setAttribute("aria-pressed", flipped ? "true" : "false");
      flipBtn.innerHTML = flipped
        ? '翻回正面 <span aria-hidden="true">↺</span>'
        : '翻到背面 · 使用边界 <span aria-hidden="true">↻</span>';
    }
    if (passFront) passFront.setAttribute("aria-hidden", flipped ? "true" : "false");
    if (passBack) passBack.setAttribute("aria-hidden", flipped ? "false" : "true");
  }

  if (flipBtn) {
    flipBtn.addEventListener("click", function () { setFlipped(!state.flipped); });
  }

  /* ---------- mode switch ---------- */
  function setMode(mode, options) {
    if (!COPY[mode]) return;
    var opts = options || {};
    if (busyTimer !== null) {
      clearTimeout(busyTimer);
      busyTimer = null;
      setBusy("login", false);
      setBusy("register", false);
    }
    state.mode = mode;
    var conf = COPY[mode];

    tabs.forEach(function (tab) {
      var active = tab.getAttribute("data-mode") === mode;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
      tab.tabIndex = active ? 0 : -1;
      if (active && opts.focusTab) tab.focus();
    });

    authTitle.innerHTML = conf.title;
    authLead.textContent = conf.lead;
    if (!opts.silent) {
      authCopy.classList.remove("is-swapping");
      void authCopy.offsetWidth;
      authCopy.classList.add("is-swapping");
    }

    loginForm.hidden = mode !== "login";
    registerForm.hidden = mode !== "register";
    panel.setAttribute("aria-labelledby", "tab-" + mode);

    clearErrors();
    hideToast();
    if (state.flipped) setFlipped(false);
    updatePass();
    document.title = conf.docTitle;

    if (!opts.skipHistory) {
      try {
        var next = window.location.pathname + window.location.search + "#" + mode;
        window.history.replaceState(null, "", next);
      } catch (error) { /* file previews may restrict history; the page still works */ }
    }

    if (opts.focusField) {
      window.requestAnimationFrame(function () {
        var target = mode === "login" ? loginInput : registerInput;
        if (target) target.focus();
      });
    }
  }

  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      setMode(tab.getAttribute("data-mode"));
    });
    tab.addEventListener("keydown", function (event) {
      var index = tabs.indexOf(tab);
      var next = null;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % tabs.length;
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      if (next === null) return;
      event.preventDefault();
      setMode(tabs[next].getAttribute("data-mode"), { focusTab: true });
    });
  });

  $$("[data-switch]").forEach(function (button) {
    button.addEventListener("click", function () {
      setMode(button.getAttribute("data-switch"), { focusField: true });
    });
  });

  /* ---------- inputs ---------- */
  function bindInput(input, target, key, after) {
    if (!input) return;
    input.addEventListener("input", function () {
      target[key] = input.value;
      clearField(input);
      if (after) after();
    });
  }

  bindInput(loginInput, state.login, "identifier", updatePass);
  bindInput(loginPass, state.login, "password");
  bindInput(registerInput, state.register, "username", updatePass);
  bindInput(emailInput, state.register, "email");
  bindInput(registerPass, state.register, "password", updateStrength);
  bindInput(confirmInput, state.register, "confirmPassword");
  bindInput(nameInput, state.register, "displayName", updatePass);
  if (identitySelect) {
    identitySelect.addEventListener("change", function () {
      state.register.identityTag = identitySelect.value;
    });
  }
  if (loginRemember) {
    loginRemember.addEventListener("change", function () {
      state.login.remember = loginRemember.checked;
    });
  }

  /* ---------- password visibility ---------- */
  $$(".eye").forEach(function (button) {
    button.addEventListener("click", function () {
      var input = document.getElementById(button.getAttribute("data-eye"));
      if (!input) return;
      var show = input.type === "password";
      input.type = show ? "text" : "password";
      button.textContent = show ? "隐藏" : "显示";
      button.setAttribute("aria-pressed", show ? "true" : "false");
      var isConfirm = input.id === "reg-confirm";
      button.setAttribute("aria-label", (show ? "隐藏" : "显示") + (isConfirm ? "确认密码" : "密码"));
    });
  });

  /* ---------- caps lock ---------- */
  var capsMap = {
    "login-pass": "login-caps",
    "reg-pass": "reg-caps",
    "reg-confirm": "reg-confirm-caps"
  };
  Object.keys(capsMap).forEach(function (id) {
    var input = document.getElementById(id);
    var hint = document.getElementById(capsMap[id]);
    if (!input || !hint) return;
    function update(event) {
      var active = typeof event.getModifierState === "function" && event.getModifierState("CapsLock");
      hint.hidden = !active;
    }
    input.addEventListener("keydown", update);
    input.addEventListener("keyup", update);
    input.addEventListener("blur", function () { hint.hidden = true; });
  });

  /* ---------- forgot ---------- */
  if (forgotToggle && forgotNote) {
    forgotToggle.addEventListener("click", function () {
      var open = forgotToggle.getAttribute("aria-expanded") === "true";
      forgotToggle.setAttribute("aria-expanded", open ? "false" : "true");
      forgotNote.hidden = open;
    });
  }

  /* ---------- validation ---------- */
  function validateLogin() {
    var errors = [];
    var identifier = state.login.identifier.trim();
    if (!identifier) {
      setFieldError(loginInput, "请输入用户名或邮箱");
      errors.push(loginInput);
    } else {
      setFieldError(loginInput, "");
    }
    if (!state.login.password) {
      setFieldError(loginPass, "请输入密码");
      errors.push(loginPass);
    } else {
      setFieldError(loginPass, "");
    }
    return errors;
  }

  function validateRegister() {
    var errors = [];
    var username = state.register.username.trim();
    var usernameLength = characters(username);

    if (usernameLength < 3 || usernameLength > 20) {
      setFieldError(registerInput, "用户名长度需为 3–20 个字符");
      errors.push(registerInput);
    } else {
      var chars = Array.from(username);
      var first = chars[0] || "";
      if (!LETTER.test(first)) {
        setFieldError(registerInput, "用户名需以字母开头");
        errors.push(registerInput);
      } else {
        var bad = false;
        for (var i = 1; i < chars.length; i++) {
          var ch = chars[i];
          if (LETTER.test(ch) || DECIMAL.test(ch) || ch === "_" || ch === "-") continue;
          bad = true;
          break;
        }
        if (bad) {
          setFieldError(registerInput, "用户名只能包含字母、数字、下划线或短横线");
          errors.push(registerInput);
        } else {
          setFieldError(registerInput, "");
        }
      }
    }

    var email = state.register.email.trim();
    var emailLength = characters(email);
    var emailMessage = "";
    if (emailLength < 3 || emailLength > 320) {
      emailMessage = "邮箱长度需为 3–320 个字符";
    } else {
      var atCount = 0;
      for (var j = 0; j < email.length; j++) if (email[j] === "@") atCount += 1;
      if (atCount !== 1) {
        emailMessage = "邮箱必须且只能包含一个 @";
      } else {
        var at = email.indexOf("@");
        var local = email.slice(0, at);
        var domain = email.slice(at + 1);
        var localLength = characters(local);
        if (localLength < 1 || localLength > 64 || WHITESPACE.test(local)) {
          emailMessage = "邮箱 @ 前的部分需为 1–64 个字符且不含空格";
        } else if (
          WHITESPACE.test(domain) ||
          domain.indexOf("@") >= 0 ||
          domain.indexOf(".") < 0 ||
          domain.indexOf(".") === 0 ||
          domain.lastIndexOf(".") === domain.length - 1 ||
          domain.indexOf("..") >= 0
        ) {
          emailMessage = "邮箱域名格式不合法";
        } else {
          var tld = domain.slice(domain.lastIndexOf(".") + 1);
          if (characters(tld) < 2) emailMessage = "邮箱域名末段至少需要 2 个字符";
        }
      }
    }
    if (emailMessage) {
      setFieldError(emailInput, emailMessage);
      errors.push(emailInput);
    } else {
      setFieldError(emailInput, "");
    }

    var passwordLength = characters(state.register.password);
    if (passwordLength < 8 || passwordLength > 128) {
      setFieldError(registerPass, "密码长度需为 8–128 个字符");
      errors.push(registerPass);
    } else {
      setFieldError(registerPass, "");
    }

    if (state.register.confirmPassword !== state.register.password) {
      setFieldError(confirmInput, "两次输入的密码不一致");
      errors.push(confirmInput);
    } else {
      setFieldError(confirmInput, "");
    }

    if (characters(state.register.displayName.trim()) > 64) {
      setFieldError(nameInput, "称呼最多 64 个字符");
      errors.push(nameInput);
    } else {
      setFieldError(nameInput, "");
    }

    return errors;
  }

  /* ---------- submit (local demo only) ---------- */
  function finishDemo(mode) {
    var demo = mode === "login" ? loginDemo : registerDemo;
    var submit = mode === "login" ? loginSubmit : registerSubmit;
    setBusy(mode, false);
    if (demo) demo.hidden = false;
    if (state.flipped) setFlipped(false);
    if (passStamp) {
      passStamp.classList.remove("is-pressed");
      void passStamp.offsetWidth;
      passStamp.classList.add("is-pressed");
    }
    toast(COPY[mode].toast);
    if (submit) submit.focus({ preventScroll: true });
  }

  function runSubmit(mode) {
    if (busyTimer !== null) return;
    var errors = mode === "login" ? validateLogin() : validateRegister();
    var summary = mode === "login" ? loginError : registerError;
    var demo = mode === "login" ? loginDemo : registerDemo;

    if (errors.length > 0) {
      hideToast();
      showSummary(summary, errors.length);
      if (demo) demo.hidden = true;
      errors[0].focus();
      return;
    }

    if (summary) { summary.textContent = ""; summary.hidden = true; }
    if (demo) demo.hidden = true;
    setBusy(mode, true);
    busyTimer = window.setTimeout(function () {
      busyTimer = null;
      finishDemo(mode);
    }, reduceMotion ? 80 : 560);
  }

  loginForm.addEventListener("submit", function (event) {
    event.preventDefault();
    runSubmit("login");
  });
  registerForm.addEventListener("submit", function (event) {
    event.preventDefault();
    runSubmit("register");
  });

  /* ---------- preview links + hash ---------- */
  var previewMode = window.location.protocol === "file:" || window.location.pathname.indexOf("/prototype/") !== -1;
  if (previewMode) {
    $$('a[data-product]').forEach(function (link) {
      link.addEventListener("click", function (event) {
        event.preventDefault();
        toast("独立预览：接入现有项目后，这里会进入 " + link.getAttribute("href") + "。");
      });
    });
  }

  var initialMode = window.location.hash === "#register" ? "register" : "login";
  setFlipped(false);
  updateStrength();
  setMode(initialMode, { skipHistory: true, silent: true });

  window.addEventListener("hashchange", function () {
    var nextMode = window.location.hash === "#register" ? "register" : "login";
    if (nextMode !== state.mode) setMode(nextMode, { skipHistory: true });
  });
})();
