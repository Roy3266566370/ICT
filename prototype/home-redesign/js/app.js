/* ============================================================
   万象 · 题目实验室 — page behaviour
   All demo computation runs locally in this page.
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
    }, 3200);
  }

  /* ---------- nav ---------- */
  var navToggle = $(".nav-toggle");
  var mobileNav = $("#mobile-nav");
  function closeNav() {
    if (!navToggle || !mobileNav) return;
    navToggle.setAttribute("aria-expanded", "false");
    navToggle.setAttribute("aria-label", "打开导航");
    mobileNav.hidden = true;
    document.body.classList.remove("nav-open");
  }
  if (navToggle && mobileNav) {
    navToggle.addEventListener("click", function () {
      var open = navToggle.getAttribute("aria-expanded") === "true";
      if (open) { closeNav(); return; }
      navToggle.setAttribute("aria-expanded", "true");
      navToggle.setAttribute("aria-label", "关闭导航");
      mobileNav.hidden = false;
      document.body.classList.add("nav-open");
    });
    $$("a", mobileNav).forEach(function (a) { a.addEventListener("click", closeNav); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeNav();
    });
    window.addEventListener("resize", function () {
      if (window.innerWidth > 820) closeNav();
    });
  }

  /* ---------- scroll ruler + spy ---------- */
  var rulerFill = $("#ruler-fill");
  var rulerNum = $("#ruler-num");
  var spyTargets = ["bench", "method", "specimens", "workshop"]
    .map(function (id) { return document.getElementById(id); })
    .filter(Boolean);
  var navLinks = $$(".site-nav a");

  var ticking = false;
  function onScrollFrame() {
    ticking = false;
    var doc = document.documentElement;
    var max = doc.scrollHeight - window.innerHeight;
    var pct = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    if (rulerFill) rulerFill.style.height = (pct * 100).toFixed(1) + "%";
    if (rulerNum) rulerNum.textContent = String(Math.round(pct * 100)).padStart(3, "0");

    var current = null;
    spyTargets.forEach(function (el) {
      if (el.getBoundingClientRect().top <= 140) current = el.id;
    });
    navLinks.forEach(function (link) {
      link.classList.toggle("is-current", link.getAttribute("href") === "#" + current);
    });
  }
  function requestScrollFrame() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(onScrollFrame);
  }
  window.addEventListener("scroll", requestScrollFrame, { passive: true });
  window.addEventListener("resize", requestScrollFrame);
  onScrollFrame();

  /* ---------- reveal ---------- */
  var revealEls = $$(".method__intro, .step, .section-head, .specimen, .workshop__head, .workshop__body, .workshop__strip, .boundaries__head, .boundary, .ask__inner");
  revealEls.forEach(function (el, i) {
    el.classList.add("reveal");
    var group = el.parentElement;
    var siblings = group ? Array.prototype.slice.call(group.children) : [];
    var index = siblings.indexOf(el);
    var delay = (index >= 0 ? index % 4 : i % 4) * 80;
    el.style.setProperty("--delay", delay + "ms");
  });

  if ("IntersectionObserver" in window && !reduceMotion) {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        el.classList.add("is-in");
        revealObserver.unobserve(el);
        setTimeout(function () {
          el.classList.remove("reveal", "is-in");
          el.style.removeProperty("--delay");
        }, 1300);
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    revealEls.forEach(function (el) { revealObserver.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.remove("reveal"); });
  }

  /* ---------- checkcard ---------- */
  var confirmBtn = $("#confirm-formula");
  var checkcard = $("#checkcard");
  var checkState = $("#check-state");
  if (confirmBtn && checkcard && checkState) {
    confirmBtn.addEventListener("click", function () {
      checkcard.classList.add("is-confirmed");
      checkState.textContent = "已确认";
      confirmBtn.textContent = "已核对";
      confirmBtn.disabled = true;
      toast("公式已核对 · 进入声明式建模。");
    });
  }
  $$("[data-demo]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      toast(btn.getAttribute("data-demo") || "该入口已在实验室内备好。");
    });
  });

  /* ---------- workshop hover ---------- */
  var workshopNodes = $$(".board__node");
  $$("#workshop-list li").forEach(function (item) {
    var key = item.getAttribute("data-node");
    function lit(on) {
      workshopNodes.forEach(function (node) {
        if (node.getAttribute("data-node") === key) node.classList.toggle("is-lit", on);
      });
    }
    item.addEventListener("mouseenter", function () { lit(true); });
    item.addEventListener("mouseleave", function () { lit(false); });
  });

  /* ---------- standalone preview links ---------- */
  if (location.protocol === "file:") {
    $$('a[href^="/labs"], a[href^="/workshop"]').forEach(function (link) {
      link.addEventListener("click", function (e) {
        e.preventDefault();
        var target = link.getAttribute("href");
        toast("独立预览：接入现有项目后，这里会进入 " + target + "。");
      });
    });
  }

  /* ---------- ask form ---------- */
  var askForm = $("#ask-form");
  var askInput = $("#ask-input");
  if (askForm && askInput) {
    askForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var value = askInput.value.trim();
      if (!value) {
        toast("先写下一道题，再开始拆。");
        askInput.focus();
        return;
      }
      toast("设计稿演示：完整拆题流程在 /labs —— 你写的题不会被上传。");
      askInput.value = "";
    });
  }

  /* ============================================================
     BENCH / 实验台
     ============================================================ */
  var benchPlot = $("#bench-plot");
  var benchControls = $("#bench-controls");
  var benchTag = $("#bench-tag");
  var benchProblem = $("#bench-problem");
  var benchOutput = $("#bench-output");
  var benchStamp = $("#bench-stamp");
  var tabs = $$(".bench__tab");

  var state = {
    mode: "integral",
    integral: { n: 12, method: "mid" },
    gradient: { lr: 0.12 },
    bfs: { step: 0 }
  };

  var PLOT = { l: 52, r: 534, t: 28, b: 258 };
  var PLOT_W = PLOT.r - PLOT.l;
  var PLOT_H = PLOT.b - PLOT.t;

  function fixed(value, digits) { return Number(value).toFixed(digits == null ? 4 : digits); }
  function svgText(x, y, text, cls, extra) {
    return '<text x="' + x + '" y="' + y + '" class="' + cls + '"' + (extra || "") + ">" + text + "</text>";
  }
  function gridMarkup(xSteps, ySteps) {
    var out = '<g class="plot-grid">';
    xSteps.forEach(function (x) {
      var px = PLOT.l + x * PLOT_W;
      out += '<line x1="' + px + '" y1="' + PLOT.t + '" x2="' + px + '" y2="' + PLOT.b + '"/>';
    });
    ySteps.forEach(function (y) {
      var py = PLOT.b - y * PLOT_H;
      out += '<line x1="' + PLOT.l + '" y1="' + py + '" x2="' + PLOT.r + '" y2="' + py + '"/>';
    });
    return out + "</g>";
  }
  function axisMarkup() {
    return '<path class="plot-axis" d="M' + PLOT.l + " " + PLOT.t + "V" + PLOT.b + "H" + PLOT.r + '"/>';
  }
  function animateStage() {
    var stage = benchPlot && benchPlot.parentElement;
    if (!stage) return;
    stage.classList.remove("is-rendering");
    void stage.offsetWidth;
    stage.classList.add("is-rendering");
  }

  /* ---- integral ---- */
  function fIntegral(x) { return x * x; }

  function renderIntegral(animate) {
    var n = state.integral.n;
    var method = state.integral.method;
    var yMax = 1.12;
    var X = function (x) { return PLOT.l + x * PLOT_W; };
    var Y = function (y) { return PLOT.b - (y / yMax) * PLOT_H; };
    var dx = 1 / n;
    var sum = 0;
    var focus = Math.floor(n * 0.62);

    var rects = "";
    var focusMark = "";
    for (var i = 0; i < n; i++) {
      var x0 = i * dx;
      var sample = method === "left" ? x0 : method === "right" ? x0 + dx : x0 + dx / 2;
      var y = fIntegral(sample);
      sum += y * dx;
      var px = X(x0);
      var pw = Math.max(X(x0 + dx) - px - 0.7, 0.7);
      var py = Y(y);
      var ph = PLOT.b - py;
      rects += '<rect class="plot-rect' + (i === focus ? " is-focus" : "") + '" x="' + px + '" y="' + py + '" width="' + pw + '" height="' + ph + '"/>';
      if (i === focus) {
        var sx = X(sample);
        focusMark =
          '<line x1="' + sx + '" y1="' + py + '" x2="' + sx + '" y2="' + PLOT.b + '" stroke="var(--red)" stroke-width=".8" stroke-dasharray="2 3"/>' +
          '<circle class="plot-dot" cx="' + sx + '" cy="' + py + '" r="2.6"/>' +
          svgText(sx + 6, py - 6, "f(ξᵢ)", "plot-label plot-label--red");
      }
    }

    var curve = "";
    for (var k = 0; k <= 80; k++) {
      var cx = k / 80;
      curve += (k === 0 ? "M" : "L") + X(cx).toFixed(2) + " " + Y(fIntegral(cx)).toFixed(2);
    }

    var svg = "";
    svg += gridMarkup([0, 0.2, 0.4, 0.6, 0.8, 1], [0, 0.25, 0.5, 0.75, 1]);
    svg += axisMarkup();
    svg += rects + focusMark;
    svg += '<path class="plot-curve" d="' + curve + '"/>';
    svg += svgText(X(0.73), Y(0.71), "y = x²", "plot-annotation");
    svg += svgText(X(0.78), Y(-0.1), "x", "plot-label");
    svg += svgText(X(0) - 34, Y(0.5) + 3, "0.5", "plot-label");
    svg += svgText(X(0) - 20, Y(1) + 3, "1", "plot-label");
    svg += svgText(X(0) - 12, Y(0) + 13, "0", "plot-label");
    svg += svgText(PLOT.l + 8, PLOT.t + 12, "AREA = Σ f(ξᵢ)Δx", "plot-label plot-label--ink");
    benchPlot.innerHTML = svg;
    benchPlot.setAttribute("aria-label",
      "函数 y=x² 在 0 到 1 上的黎曼和，分割数 " + n + "，取点方式" + methodName(method) +
      "，黎曼和约 " + fixed(sum, 4) + "，解析值三分之一");

    var err = Math.abs(sum - 1 / 3);
    benchOutput.textContent = "黎曼和 " + fixed(sum, 4) + " · 解析值 0.3333 · 误差 " + fixed(err, 4);
    var hint = $("#int-hint");
    if (hint) hint.textContent = methodName(method) + " · " + n + " 个矩形";
    if (animate) animateStage();
  }

  function methodName(m) {
    return m === "left" ? "左端点" : m === "right" ? "右端点" : "中点";
  }

  function integralControls() {
    benchControls.innerHTML =
      '<div class="ctrl">' +
        '<label class="ctrl__label" for="int-n">分割数 n</label>' +
        '<input id="int-n" type="range" min="4" max="64" step="1" value="' + state.integral.n + '" aria-label="黎曼和分割数">' +
        '<output class="ctrl__value" id="int-n-out">' + state.integral.n + "</output>" +
      "</div>" +
      '<div class="ctrl">' +
        '<span class="ctrl__label">取点方式</span>' +
        '<div class="seg" role="group" aria-label="黎曼和取点方式">' +
          '<button type="button" data-method="left" aria-pressed="' + (state.integral.method === "left") + '"' + (state.integral.method === "left" ? ' class="is-active"' : "") + ">左端</button>" +
          '<button type="button" data-method="mid" aria-pressed="' + (state.integral.method === "mid") + '"' + (state.integral.method === "mid" ? ' class="is-active"' : "") + ">中点</button>" +
          '<button type="button" data-method="right" aria-pressed="' + (state.integral.method === "right") + '"' + (state.integral.method === "right" ? ' class="is-active"' : "") + ">右端</button>" +
        "</div>" +
        '<span class="ctrl__hint" id="int-hint">' + methodName(state.integral.method) + " · " + state.integral.n + " 个矩形</span>" +
      "</div>";

    var slider = $("#int-n");
    var out = $("#int-n-out");
    slider.addEventListener("input", function () {
      state.integral.n = parseInt(slider.value, 10);
      out.textContent = state.integral.n;
      renderIntegral();
    });
    $$(".seg button", benchControls).forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.integral.method = btn.getAttribute("data-method");
        $$(".seg button", benchControls).forEach(function (b) {
          var active = b === btn;
          b.classList.toggle("is-active", active);
          b.setAttribute("aria-pressed", active ? "true" : "false");
        });
        renderIntegral();
      });
    });
  }

  /* ---- gradient descent ---- */
  function gradientPoints(lr) {
    var pts = [];
    var x = -1.68, y = 1.24;
    pts.push([x, y]);
    var norm = Math.sqrt(4 * x * x + 16 * y * y);
    var guard = 0;
    while (norm > 1e-3 && guard < 80) {
      x = x - lr * 2 * x;
      y = y - lr * 4 * y;
      pts.push([x, y]);
      norm = Math.sqrt(4 * x * x + 16 * y * y);
      guard += 1;
    }
    return { pts: pts, norm: norm };
  }

  function renderGradient(animate) {
    var lr = state.gradient.lr;
    var run = gradientPoints(lr);
    var pts = run.pts;
    var domainX = 2.35, domainY = 1.85;
    var X = function (x) { return PLOT.l + ((x + domainX) / (domainX * 2)) * PLOT_W; };
    var Y = function (y) { return PLOT.b - ((y + domainY) / (domainY * 2)) * PLOT_H; };

    var svg = "";
    svg += gridMarkup([0, 0.2, 0.4, 0.6, 0.8, 1], [0, 0.25, 0.5, 0.75, 1]);
    svg += '<path class="plot-axis" d="M' + PLOT.l + " " + Y(0) + "H" + PLOT.r + "M" + X(0) + " " + PLOT.t + "V" + PLOT.b + '"/>';

    var levels = [0.16, 0.5, 1.05, 1.85, 2.9];
    levels.forEach(function (c) {
      var rx = Math.sqrt(c) * (PLOT_W / (domainX * 2));
      var ry = Math.sqrt(c / 2) * (PLOT_H / (domainY * 2));
      svg += '<ellipse class="plot-level" cx="' + X(0) + '" cy="' + Y(0) + '" rx="' + rx.toFixed(1) + '" ry="' + ry.toFixed(1) + '"/>';
    });

    var d = pts.map(function (p, i) {
      return (i === 0 ? "M" : "L") + X(p[0]).toFixed(2) + " " + Y(p[1]).toFixed(2);
    }).join("");

    svg += '<path class="plot-trail" d="' + d + '"/>';
    svg += '<path class="plot-trail-anim" d="' + d + '" stroke-dasharray="620" stroke-dashoffset="620">' +
      (animate && !reduceMotion ? '<animate attributeName="stroke-dashoffset" from="620" to="0" dur="0.9s" fill="freeze"/>' : "") +
      "</path>";

    pts.forEach(function (p, i) {
      if (i === 0 || i === pts.length - 1) return;
      svg += '<circle cx="' + X(p[0]).toFixed(1) + '" cy="' + Y(p[1]).toFixed(1) + '" r="2" fill="var(--red)" opacity=".55"/>';
    });
    var start = pts[0];
    var end = pts[pts.length - 1];
    svg += '<circle cx="' + X(start[0]) + '" cy="' + Y(start[1]) + '" r="4.6" fill="var(--ink)"/>';
    svg += '<circle cx="' + X(end[0]) + '" cy="' + Y(end[1]) + '" r="4.4" fill="var(--red)"/>';
    svg += '<circle cx="' + X(end[0]) + '" cy="' + Y(end[1]) + '" r="9" fill="none" stroke="var(--red)" stroke-width=".8" opacity=".45"/>';

    svg += svgText(X(-2.22), PLOT.t + 12, "f(x,y) = x² + 2y²", "plot-label plot-label--ink");
    svg += svgText(X(start[0]) - 12, Y(start[1]) - 10, "起点", "plot-annotation");
    svg += svgText(X(0) + 10, Y(0) - 8, "驻点 (0,0)", "plot-label plot-label--red");
    svg += svgText(X(0.06), PLOT.b + 2, "x", "plot-label");
    svg += svgText(X(0) - 12, PLOT.t + 4, "y", "plot-label");
    svg += svgText(PLOT.r - 66, PLOT.t + 12, "等高线 · 5 级", "plot-label");

    benchPlot.innerHTML = svg;
    var converged = run.norm <= 1e-3;
    benchPlot.setAttribute("aria-label",
      "梯度下降轨迹，学习率 " + lr.toFixed(2) + "，共 " + (pts.length - 1) + " 次迭代，" +
      (converged ? "收敛到驻点附近" : "尚未完全收敛"));

    benchOutput.textContent = "迭代 " + (pts.length - 1) + " 次 · 终点 (" + fixed(end[0], 3) + ", " + fixed(end[1], 3) + ") · ‖∇f‖ = " + fixed(run.norm, 4);
    if (benchStamp) benchStamp.textContent = converged ? "已收敛" : "未收敛";
    if (animate) animateStage();
  }

  function gradientControls() {
    benchControls.innerHTML =
      '<div class="ctrl">' +
        '<label class="ctrl__label" for="grad-lr">学习率 η</label>' +
        '<input id="grad-lr" type="range" min="0.08" max="0.42" step="0.01" value="' + state.gradient.lr + '" aria-label="梯度下降学习率">' +
        '<output class="ctrl__value" id="grad-lr-out">' + state.gradient.lr.toFixed(2) + "</output>" +
      "</div>" +
      '<div class="ctrl">' +
        '<span class="ctrl__label">轨迹</span>' +
        '<button class="bench-btn bench-btn--solid" type="button" id="grad-replay">重播轨迹 ↻</button>' +
        '<span class="ctrl__hint">目标：‖∇f‖ &lt; 1e−3</span>' +
      "</div>";
    var slider = $("#grad-lr");
    var out = $("#grad-lr-out");
    slider.addEventListener("input", function () {
      state.gradient.lr = parseFloat(slider.value);
      out.textContent = state.gradient.lr.toFixed(2);
      renderGradient();
    });
    $("#grad-replay").addEventListener("click", function () {
      renderGradient(true);
      toast("轨迹已重播 · 改变学习率看看它怎么走。");
    });
  }

  /* ---- BFS ---- */
  var BFS_NODES = {
    A: { x: 280, y: 54 },
    B: { x: 150, y: 126 },
    C: { x: 412, y: 126 },
    D: { x: 88, y: 220 },
    E: { x: 236, y: 220 },
    F: { x: 400, y: 220 }
  };
  var BFS_EDGES = [["A", "B"], ["A", "C"], ["B", "D"], ["B", "E"], ["C", "F"], ["E", "F"]];
  var BFS_ADJ = {};
  Object.keys(BFS_NODES).forEach(function (k) { BFS_ADJ[k] = []; });
  BFS_EDGES.forEach(function (e) {
    BFS_ADJ[e[0]].push(e[1]);
    BFS_ADJ[e[1]].push(e[0]);
  });

  function buildBfsSnapshots() {
    var queue = ["A"];
    var visited = { A: true };
    var parents = {};
    var levels = { A: 0 };
    var order = [];
    var snapshots = [{
      queue: queue.slice(),
      visited: Object.assign({}, visited),
      parents: Object.assign({}, parents),
      levels: Object.assign({}, levels),
      order: [],
      current: null
    }];

    while (queue.length) {
      var cur = queue.shift();
      order.push(cur);
      BFS_ADJ[cur].forEach(function (next) {
        if (visited[next]) return;
        visited[next] = true;
        parents[next] = cur;
        levels[next] = levels[cur] + 1;
        queue.push(next);
      });
      snapshots.push({
        queue: queue.slice(),
        visited: Object.assign({}, visited),
        parents: Object.assign({}, parents),
        levels: Object.assign({}, levels),
        order: order.slice(),
        current: cur
      });
    }
    return snapshots;
  }
  var BFS_SNAPSHOTS = buildBfsSnapshots();

  function renderBfs(animate) {
    var step = Math.min(state.bfs.step, BFS_SNAPSHOTS.length - 1);
    var snap = BFS_SNAPSHOTS[step];
    var processed = {};
    snap.order.forEach(function (n) { processed[n] = true; });

    var svg = "";
    svg += gridMarkup([0, 0.2, 0.4, 0.6, 0.8, 1], [0, 0.25, 0.5, 0.75, 1]);

    BFS_EDGES.forEach(function (e) {
      var a = BFS_NODES[e[0]], b = BFS_NODES[e[1]];
      var tree = (snap.parents[e[0]] === e[1] || snap.parents[e[1]] === e[0]);
      var lit = tree && processed[e[0]] && processed[e[1]];
      svg += '<line class="plot-edge' + (lit ? " is-tree" : "") + '" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '"/>';
    });

    Object.keys(BFS_NODES).forEach(function (name) {
      var pos = BFS_NODES[name];
      var cls = "plot-node";
      if (processed[name]) {
        cls += name === snap.current ? " is-current" : " is-visited";
      } else if (snap.visited[name]) {
        cls += " is-frontier";
      }
      svg += '<circle class="' + cls + '" cx="' + pos.x + '" cy="' + pos.y + '" r="16"/>';
      var light = processed[name];
      svg += '<text class="plot-node-label' + (light ? " is-light" : "") + '" x="' + pos.x + '" y="' + (pos.y + 3) + '">' + name + "</text>";
      if (snap.levels[name] != null) {
        svg += svgText(pos.x + 21, pos.y - 9, "L" + snap.levels[name], "plot-label");
      }
    });

    svg += svgText(PLOT.l + 8, PLOT.t + 12, "BFS · 从 A 出发", "plot-label plot-label--ink");
    svg += svgText(PLOT.r - 74, PLOT.t + 12, "队列先进先出", "plot-label");
    svg += svgText(PLOT.l + 8, PLOT.b + 18, "蓝色已访问 · 红色当前 · 虚线在队列中", "plot-label");
    benchPlot.innerHTML = svg;

    var queue = snap.queue;
    var queueHtml = '<span class="queue__label">QUEUE</span>';
    if (!queue.length) {
      queueHtml += '<span class="queue__item is-empty">空</span>';
    } else {
      queue.forEach(function (name, i) {
        queueHtml += '<span class="queue__item' + (i === 0 ? " is-head" : "") + '">' + name + "</span>";
      });
    }
    var depth = snap.current == null ? 0 : snap.levels[snap.current];
    queueHtml += '<span class="queue__meta">当前 L' + depth + " · 已出队 " + snap.order.length + "/6</span>";

    benchControls.innerHTML =
      '<div class="ctrl" style="min-height:28px">' + queueHtml + "</div>" +
      '<div class="ctrl">' +
        '<button class="bench-btn bench-btn--solid" type="button" id="bfs-next"' + (step >= BFS_SNAPSHOTS.length - 1 ? " disabled" : "") + ">" +
          (step >= BFS_SNAPSHOTS.length - 1 ? "遍历完成" : "下一步 →") +
        "</button>" +
        '<button class="bench-btn" type="button" id="bfs-reset">重置</button>' +
        '<span class="ctrl__hint">' +
          (step === 0 ? "等待出队 A" : step >= BFS_SNAPSHOTS.length - 1 ? "全部节点已访问" : "刚出队 " + snap.current) +
        "</span>" +
      "</div>";

    var next = $("#bfs-next");
    if (next && !next.disabled) {
      next.addEventListener("click", function () {
        state.bfs.step = Math.min(state.bfs.step + 1, BFS_SNAPSHOTS.length - 1);
        renderBfs();
        var again = $("#bfs-next");
        if (again && !again.disabled) again.focus();
      });
    }
    var reset = $("#bfs-reset");
    if (reset) {
      reset.addEventListener("click", function () {
        state.bfs.step = 0;
        renderBfs();
        var fresh = $("#bfs-reset");
        if (fresh) fresh.focus();
      });
    }

    benchPlot.setAttribute("aria-label",
      "广度优先搜索图，从 A 出发，已访问 " + snap.order.length + " 个节点，队列为 " + (queue.join("、") || "空"));

    benchOutput.textContent = step >= BFS_SNAPSHOTS.length - 1
      ? "访问顺序 A → B → C → D → E → F · 共 3 层"
      : "已访问 " + snap.order.length + " / 6 · 队列 " + (queue.join(" → ") || "空");
    if (animate) animateStage();
  }

  /* ---- mode switching ---- */
  var MODES = {
    integral: {
      tag: "样题 01 / 微积分",
      problem: "计算定积分 <b>∫₀¹ x² dx</b>，并用黎曼和观察它如何逼近。",
      stamp: "可推演",
      render: renderIntegral,
      controls: integralControls
    },
    gradient: {
      tag: "样题 02 / 最优化",
      problem: "从点 (−1.6, 1.2) 出发，用梯度下降求 <b>f(x, y) = x² + 2y²</b> 的极小点。",
      stamp: "可推演",
      render: renderGradient,
      controls: gradientControls
    },
    bfs: {
      tag: "样题 03 / 数据结构",
      problem: "从 A 出发，按层遍历这张无向图，并写出队列的出队顺序。",
      stamp: "可回放",
      render: renderBfs,
      controls: null
    }
  };

  function selectMode(mode, focusTab) {
    if (!MODES[mode]) return;
    state.mode = mode;
    tabs.forEach(function (tab) {
      var active = tab.getAttribute("data-mode") === mode;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
      tab.tabIndex = active ? 0 : -1;
      if (active && focusTab) tab.focus();
    });
    var conf = MODES[mode];
    benchTag.textContent = conf.tag;
    benchProblem.innerHTML = conf.problem;
    benchStamp.textContent = conf.stamp;
    var panel = document.getElementById("bench-panel");
    if (panel) panel.setAttribute("aria-labelledby", "tab-" + mode);
    if (conf.controls) conf.controls();
    conf.render(true);
  }

  if (benchPlot) {
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () { selectMode(tab.getAttribute("data-mode")); });
      tab.addEventListener("keydown", function (e) {
        var index = tabs.indexOf(tab);
        var next = null;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % tabs.length;
        if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (index - 1 + tabs.length) % tabs.length;
        if (e.key === "Home") next = 0;
        if (e.key === "End") next = tabs.length - 1;
        if (next == null) return;
        e.preventDefault();
        selectMode(tabs[next].getAttribute("data-mode"), true);
      });
    });
    integralControls();
    renderIntegral(true);
  }
})();
