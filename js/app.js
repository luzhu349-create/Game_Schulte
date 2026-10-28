"use strict";

const STORE_KEY = "schulte.v1";

const state = {
  screen: "home",
  size: 5,
  level: "basic",
  shareOrigin: "",
  mode: "limit",
  phase: "idle",
  seed: 1,
  board: [],
  next: 1,
  found: new Set(),
  mistakes: 0,
  startedAt: 0,
  pausedAccum: 0,
  pauseStarted: 0,
  pauseCount: 0,
  timerId: 0,
  token: 0,
  activeChallenge: null,
  incoming: null,
  lastResult: null,
  resultBack: "home",
  pendingDialog: null,
  cardBlob: null,
  cardUrl: "",
  sharing: false,
  composing: false,
  pointer: null,
  seq: 0,
};

function $(id) {
  return document.getElementById(id);
}

function defaults() {
  return {
    name: "",
    size: 5,
    level: "basic",
    mode: "limit",
    theme: "auto",
    strict: false,
    hideNext: false,
    vibrate: true,
    history: [],
  };
}

function load() {
  const base = defaults();
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return base;
    const data = JSON.parse(raw);
    const size = Schulte.SIZES.some((item) => item.size === data.size) ? data.size : base.size;
    const theme = ["auto", "light", "dark"].includes(data.theme) ? data.theme : base.theme;
    const mode = data.mode === "count" || data.mode === "limit" ? data.mode : base.mode;
    const level = ["basic", "mid", "high"].includes(data.level) ? data.level : Schulte.levelForSize(size).id;
    return {
      name: Schulte.sanitizeName(data.name || ""),
      size: Schulte.levelInfo(level).size,
      level,
      mode,
      theme,
      strict: Boolean(data.strict),
      hideNext: Boolean(data.hideNext),
      vibrate: data.vibrate !== false,
      history: Array.isArray(data.history) ? data.history : [],
    };
  } catch (error) {
    return base;
  }
}

function save(data) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
    return true;
  } catch (error) {
    return false;
  }
}

function isHttp() {
  return location.protocol === "http:" || location.protocol === "https:";
}

function showScreen(name) {
  state.screen = name;
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.hidden = screen.id !== `view-${name}`;
  });
  document.body.dataset.screen = name;
  document.body.classList.toggle("lock", name === "play");
  updateTabs();
  window.scrollTo(0, 0);
}

function updateTabs() {
  document.querySelectorAll(".tabbar button").forEach((button) => {
    if (button.dataset.tab === state.screen) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

function applyTheme() {
  const pref = load().theme;
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = pref === "dark" || (pref === "auto" && systemDark);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#12110f" : "#e8e1d4");
  renderTheme();
}

function renderTheme() {
  const theme = load().theme;
  document.querySelectorAll("[data-theme-value]").forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.themeValue === theme ? "true" : "false");
  });
}

function renderSwitches() {
  const store = load();
  document.querySelectorAll("[data-switch]").forEach((button) => {
    button.setAttribute("aria-checked", store[button.dataset.switch] ? "true" : "false");
  });
}

function renderSizePicker() {
  const box = $("size-picker");
  box.replaceChildren();
  Schulte.SIZES.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "num";
    button.dataset.action = "pick-size";
    button.dataset.size = String(item.size);
    button.textContent = `${item.size}×${item.size}`;
    button.setAttribute("aria-label", `${item.size}×${item.size} ${item.name}`);
    box.appendChild(button);
  });
}

function refreshBanner() {
  const banner = $("home-banner");
  const incoming = state.incoming;
  if (!incoming) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  const who = incoming.name || "有朋友";
  const miss = incoming.mistakes === 0 ? "没有点错" : `点错 ${incoming.mistakes} 次`;
  const levelName = Schulte.levelInfo(incoming.level).name;
  $("banner-text").textContent = `${who}用 ${Schulte.formatTime(incoming.ms)} 秒完成了${levelName} ${incoming.size}×${incoming.size}，${miss}。`;
}

function refreshHome() {
  const store = load();
  const today = Schulte.dayKey(Date.now());
  const days = store.history.map((item) => Schulte.dayKey(item.t));
  $("stat-today").textContent = `${Schulte.countToday(store.history, today)} 局`;
  $("stat-streak").textContent = `${Schulte.computeStreak(days, today)} 天`;
  const info = Schulte.levelInfo(state.level);
  const best = Schulte.bestFor(store.history, info.size);
  $("stat-best").textContent = best ? `${Schulte.formatTime(best.ms)} 秒` : "暂无";
  const modeText = state.mode === "limit" ? `限时 ${Schulte.formatLimit(info.limit)}` : "计时";
  const lookText = state.level === "basic"
    ? "单色方格"
    : state.level === "mid"
      ? "多种颜色和形状"
      : "在格子里放大缩小";
  $("size-caption").textContent = `${info.name} · ${info.size}×${info.size} · ${lookText} · ${modeText}`;
  document.querySelectorAll("[data-level-value]").forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.levelValue === state.level ? "true" : "false");
  });
  document.querySelectorAll("[data-mode-value]").forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.modeValue === state.mode ? "true" : "false");
  });
  refreshBanner();
}

function stopTimer() {
  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = 0;
  }
}

function elapsed() {
  if (!state.startedAt) return 0;
  const end = state.pauseCount > 0 ? state.pauseStarted : performance.now();
  return Math.max(0, end - state.startedAt - state.pausedAccum);
}

function pause() {
  if (state.phase !== "running") return;
  if (state.pauseCount === 0) state.pauseStarted = performance.now();
  state.pauseCount += 1;
}

function resume() {
  if (state.pauseCount === 0) return;
  state.pauseCount -= 1;
  if (state.pauseCount === 0 && state.pauseStarted) {
    state.pausedAccum += performance.now() - state.pauseStarted;
    state.pauseStarted = 0;
  }
}

function setPlayChrome(running) {
  $("play-center").hidden = running;
  $("play-timer").hidden = !running;
  $("play-prompt").hidden = !running;
  $("bar").hidden = !running;
  $("play-count").hidden = !running;
  $("play-ready").hidden = running;
  $("board").hidden = !running;
  if (!running) $("play-miss").textContent = "";
}

function renderReady() {
  const info = Schulte.levelInfo(state.level);
  const challenge = matchingChallenge();
  $("ready-kicker").textContent = challenge ? "接受挑战" : info.name;
  $("ready-title").textContent = `${state.size}×${state.size}`;
  const who = challenge && challenge.name ? challenge.name : "对方";
  const budget = Schulte.formatLimit(info.limit);
  if (state.mode === "limit") {
    $("ready-desc").textContent = challenge
      ? `${who}用了 ${Schulte.formatTime(challenge.ms)} 秒。限时 ${budget}。`
      : `数字 1 到 ${info.count}。限时 ${budget}。`;
  } else {
    $("ready-desc").textContent = challenge
      ? `${who}用了 ${Schulte.formatTime(challenge.ms)} 秒。开始后计时。`
      : `数字 1 到 ${info.count}。开始后计时。`;
  }
  const best = Schulte.bestFor(load().history, state.size);
  $("ready-best").textContent = best ? `你的最佳 ${Schulte.formatTime(best.ms)} 秒` : "这个尺寸还没有记录";
  $("play-center").textContent = "准备";
}

function svgEl(name) {
  return document.createElementNS("http://www.w3.org/2000/svg", name);
}

function toPoints(points) {
  return points.map((point) => `${(point.x * 1000).toFixed(1)},${(point.y * 1000).toFixed(1)}`).join(" ");
}

function renderBoard() {
  const board = $("board");
  board.replaceChildren();
  board.dataset.size = String(state.size);
  board.dataset.level = state.level;
  const parts = state.level === "basic"
    ? Schulte.squareGrid(state.size)
    : Schulte.partition(state.size, state.seed, state.level === "mid" ? "octagon" : "pentagon");
  const svg = svgEl("svg");
  svg.setAttribute("class", "mosaic");
  svg.setAttribute("viewBox", "0 0 1000 1000");
  svg.appendChild(svgEl("defs"));
  svg.appendChild(shellFrom(parts));
  state.board.forEach((number, index) => {
    const part = parts[index];
    const look = Schulte.cellLook(state.level, index);
    const group = svgEl("g");
    group.setAttribute("class", state.level === "basic"
      ? "cell num"
      : `cell num tone-${look.tone} shade-${look.shade}`);
    group.dataset.n = String(number);
    group.setAttribute("role", "button");
    group.setAttribute("tabindex", "0");
    group.setAttribute("aria-label", String(number));
    const polygon = svgEl("polygon");
    const points = toPoints(part.points);
    polygon.setAttribute("points", points);
    const text = svgEl("text");
    if (look.drift) {
      const clip = svgEl("clipPath");
      clip.setAttribute("id", `cut-${index}`);
      const clipShape = svgEl("polygon");
      clipShape.setAttribute("points", points);
      clip.appendChild(clipShape);
      svg.querySelector("defs").appendChild(clip);
      text.setAttribute("clip-path", `url(#cut-${index})`);
      text.setAttribute("class", "drift");
      text.style.setProperty("--hop-delay", `${-((index * 0.07) % 1).toFixed(2)}s`);
    }
    text.setAttribute("x", (part.cx * 1000).toFixed(1));
    text.setAttribute("y", (part.cy * 1000).toFixed(1));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "central");
    const font = look.drift
      ? Math.max(16, Math.min(150, part.radius * 1000 * 1.22))
      : Math.max(18, Math.min(180, part.radius * 1000 * 1.4));
    text.setAttribute("font-size", font.toFixed(1));
    text.textContent = String(number);
    group.append(polygon, text);
    svg.appendChild(group);
  });
  board.appendChild(svg);
}

function convexHull(points) {
  const unique = [];
  const seen = new Set();
  points.forEach((point) => {
    const key = `${point.x.toFixed(4)},${point.y.toFixed(4)}`;
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(point);
  });
  unique.sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (origin, a, b) => (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
  const build = (source) => {
    const chain = [];
    source.forEach((point) => {
      while (chain.length >= 2 && cross(chain[chain.length - 2], chain[chain.length - 1], point) <= 0) chain.pop();
      chain.push(point);
    });
    return chain;
  };
  const lower = build(unique);
  const upper = build(unique.slice().reverse());
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function shellFrom(parts) {
  const shell = svgEl("polygon");
  shell.setAttribute("class", "shell");
  const points = [];
  parts.forEach((part) => part.points.forEach((point) => points.push(point)));
  shell.setAttribute("points", toPoints(convexHull(points)));
  return shell;
}

function fitBoard() {}

function updateTimer() {
  const timer = $("play-timer");
  if (state.mode !== "limit") {
    timer.classList.remove("urgent");
    timer.textContent = Schulte.formatTime(elapsed());
    return;
  }
  const left = Math.max(0, Schulte.limit(state.size) - elapsed());
  timer.textContent = Schulte.formatTime(left);
  timer.classList.toggle("urgent", left > 0 && left <= 10000);
  if (left <= 0 && state.phase === "running") finishRun(true);
}

function updateHud() {
  const total = state.size * state.size;
  const hideNext = load().hideNext;
  $("prompt-label").textContent = hideNext ? "按顺序找" : "下一个";
  $("play-next").hidden = hideNext;
  $("play-next").textContent = hideNext ? "" : String(state.next);
  $("play-count").textContent = `${state.found.size} / ${total}`;
  $("bar-fill").style.width = `${(state.found.size / total) * 100}%`;
  const miss = $("play-miss");
  if (state.mistakes === 0) {
    miss.textContent = "";
    miss.removeAttribute("aria-label");
  } else {
    miss.textContent = `误 ${state.mistakes}`;
    miss.setAttribute("aria-label", `点错 ${state.mistakes} 次`);
  }
}

function matchingChallenge() {
  const challenge = state.activeChallenge;
  if (!challenge) return null;
  if (challenge.level && challenge.level !== state.level) return null;
  if (challenge.size !== state.size || challenge.seed !== state.seed) return null;
  return challenge;
}

function openReady(options) {
  stopTimer();
  state.token += 1;
  state.level = options.level || state.level;
  state.size = options.size;
  state.seed = options.seed;
  state.phase = "ready";
  state.board = Schulte.shuffle(options.size, options.seed);
  state.next = 1;
  state.found = new Set();
  state.mistakes = 0;
  state.startedAt = 0;
  state.pausedAccum = 0;
  state.pauseStarted = 0;
  state.pauseCount = 0;
  state.pointer = null;
  showScreen("play");
  setPlayChrome(false);
  renderReady();
  renderBoard();
}

function beginRun() {
  if (state.phase !== "ready") return;
  state.phase = "running";
  state.startedAt = performance.now();
  setPlayChrome(true);
  updateTimer();
  updateHud();
  state.timerId = window.setInterval(updateTimer, 100);
  window.requestAnimationFrame(() => fitBoard());
}

function registerMistake(cell) {
  state.mistakes += 1;
  updateHud();
  if (cell) {
    cell.classList.remove("wrong");
    void cell.getBoundingClientRect();
    cell.classList.add("wrong");
    const token = state.token;
    window.setTimeout(() => {
      if (token !== state.token) return;
      cell.classList.remove("wrong");
    }, 320);
  }
  const store = load();
  if (store.vibrate && navigator.vibrate) navigator.vibrate(20);
}

function markFound(cell) {
  if (load().strict) {
    const token = state.token;
    cell.classList.add("hit");
    window.setTimeout(() => {
      if (token !== state.token) return;
      cell.classList.remove("hit");
    }, 180);
    return;
  }
  cell.classList.add("found");
  cell.disabled = true;
}

function tapCell(number, cell) {
  if (state.phase !== "running" || state.pauseCount > 0) return;
  if (state.found.has(number) || number !== state.next) {
    registerMistake(cell);
    return;
  }
  state.found.add(number);
  markFound(cell);
  state.next += 1;
  if (state.next > state.size * state.size) {
    finishRun();
    return;
  }
  updateHud();
}

function finishRun(timedOut) {
  if (state.phase !== "running") return;
  const limited = state.mode === "limit";
  const budget = Schulte.limit(state.size);
  let ms = Math.round(elapsed() / 100) * 100;
  if (limited && (timedOut || ms > budget)) ms = budget;
  stopTimer();
  state.phase = "done";
  const store = load();
  const previous = timedOut ? null : Schulte.bestFor(store.history, state.size);
  let personal = "first";
  let deltaMs = 0;
  if (previous) {
    const current = Math.round(ms / 100);
    const prior = Math.round(previous.ms / 100);
    if (current < prior) personal = "best";
    else if (current === prior) personal = "tie-best";
    else {
      personal = "delta";
      deltaMs = ms - previous.ms;
    }
  }
  const challenge = matchingChallenge();
  const record = {
    id: `${Date.now()}-${state.seq}`,
    t: Date.now(),
    size: state.size,
    level: state.level,
    seed: state.seed,
    ms,
    mistakes: state.mistakes,
    found: state.found.size,
    timedOut: Boolean(timedOut),
    challenge: challenge
      ? {
          name: challenge.name || "",
          ms: challenge.ms,
          mistakes: challenge.mistakes,
        }
      : null,
  };
  state.seq += 1;
  store.history.unshift(record);
  if (store.history.length > 100) store.history.length = 100;
  store.size = state.size;
  store.level = state.level;
  const saved = save(store);
  state.lastResult = { ...record, fresh: true, personal: timedOut ? "timeout" : personal, deltaMs };
  state.resultBack = "home";
  showResult();
  if (!saved) toast("这一局已完成，但这台设备没能保存记录");
}

function showResult() {
  const result = state.lastResult;
  const info = result.level ? Schulte.levelInfo(result.level) : Schulte.sizeInfo(result.size);
  const grade = $("result-grade");
  const share = document.querySelector('#view-result [data-action="share"]');
  $("result-kicker").textContent = `${info.name} · ${result.size}×${result.size}`;
  $("result-time-row").classList.remove("compact");

  if (result.timedOut) {
    $("result-time").textContent = String(result.found || 0);
    $("result-unit").textContent = `/ ${info.count}`;
    grade.textContent = "时间到";
    grade.dataset.grade = "timeout";
    $("result-detail").textContent = "倒计时结束，这一局没有记入最佳";
    share.hidden = true;
    const compare = $("result-compare");
    compare.hidden = false;
    compare.dataset.kind = "timeout";
    compare.textContent = "没有在限时内找完";
    $("result-back").textContent = state.resultBack === "records" ? "返回记录" : "回到首页";
    showScreen("result");
    $("live").textContent = `时间到，找到 ${result.found || 0} 个`;
    return;
  }

  const level = Schulte.grade(result.size, result.ms);
  const timeText = Schulte.formatTime(result.ms);
  $("result-time").textContent = timeText;
  $("result-unit").textContent = "秒";
  $("result-time-row").classList.toggle("compact", timeText.includes(":"));
  grade.textContent = level.label;
  grade.dataset.grade = level.id;
  share.hidden = false;

  const miss = result.mistakes === 0 ? "没有点错" : `点错 ${result.mistakes} 次`;
  let extra = Schulte.formatWhen(result.t, Date.now());
  if (result.fresh) {
    if (result.personal === "first") extra = "第一次完成这个尺寸";
    else if (result.personal === "best") extra = "新的最佳";
    else if (result.personal === "tie-best") extra = "与最佳相同";
    else extra = `比最佳慢 ${Schulte.formatTime(result.deltaMs)} 秒`;
  }
  $("result-detail").textContent = `${miss} · ${extra}`;

  const compare = $("result-compare");
  if (result.challenge) {
    const outcome = Schulte.compare(result.ms, result.challenge.ms);
    const who = result.challenge.name || "对方";
    const their = Schulte.formatTime(result.challenge.ms);
    if (outcome.kind === "tie") compare.textContent = `和${who}的 ${their} 秒几乎一样`;
    else if (outcome.kind === "faster") compare.textContent = `比${who}的 ${their} 秒快了 ${Schulte.formatTime(outcome.delta)} 秒`;
    else compare.textContent = `比${who}的 ${their} 秒慢了 ${Schulte.formatTime(outcome.delta)} 秒`;
    compare.dataset.kind = outcome.kind;
    compare.hidden = false;
  } else {
    compare.hidden = true;
    delete compare.dataset.kind;
  }
  $("result-back").textContent = state.resultBack === "records" ? "返回记录" : "回到首页";
  showScreen("result");
  $("live").textContent = `完成，用时 ${timeText} 秒，${level.label}`;
}

function abandon() {
  stopTimer();
  state.token += 1;
  state.phase = "idle";
  state.pauseCount = 0;
  state.pauseStarted = 0;
}

function sparkline(values) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 280 48");
  svg.setAttribute("class", "spark");
  svg.setAttribute("aria-hidden", "true");
  if (!values.length) return svg;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const points = values.map((value, index) => {
    const x = values.length === 1 ? 140 : 8 + (index / (values.length - 1)) * 264;
    const y = span === 0 ? 24 : 6 + ((value - min) / span) * 36;
    return [x, y];
  });
  if (values.length > 1) {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.setAttribute("points", points.map((point) => point.join(",")).join(" "));
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "currentColor");
    line.setAttribute("stroke-width", "2");
    line.setAttribute("stroke-linejoin", "round");
    line.setAttribute("stroke-linecap", "round");
    svg.appendChild(line);
  }
  const last = points[points.length - 1];
  const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  dot.setAttribute("cx", String(last[0]));
  dot.setAttribute("cy", String(last[1]));
  dot.setAttribute("r", "3.5");
  dot.setAttribute("fill", "currentColor");
  svg.appendChild(dot);
  return svg;
}

function renderRecords() {
  const store = load();
  const sizes = $("record-sizes");
  sizes.replaceChildren();
  Schulte.SIZES.forEach((item) => {
    const runs = store.history.filter((entry) => entry.size === item.size);
    const best = Schulte.bestFor(store.history, item.size);
    const card = document.createElement("article");
    card.className = "record-card";

    const head = document.createElement("div");
    head.className = "record-head";
    const titles = document.createElement("div");
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = item.name;
    const heading = document.createElement("h2");
    heading.className = "num";
    heading.textContent = `${item.size}×${item.size}`;
    titles.append(eyebrow, heading);

    const bestText = document.createElement("p");
    bestText.className = "num";
    bestText.textContent = best ? `${Schulte.formatTime(best.ms)} 秒` : (runs.length ? "尚未完成" : "尚未练习");
    if (!best) bestText.style.color = "var(--faint)";
    head.append(titles, bestText);
    card.appendChild(head);

    if (runs.length) {
      const meta = document.createElement("p");
      meta.className = "record-meta";
      const finished = runs.filter((entry) => !entry.timedOut);
      const clean = finished.filter((entry) => entry.mistakes === 0);
      const cleanBest = clean.reduce((winner, entry) => (!winner || entry.ms < winner.ms ? entry : winner), null);
      meta.textContent = cleanBest
        ? `${runs.length} 次 · 零失误 ${Schulte.formatTime(cleanBest.ms)} 秒`
        : `${runs.length} 次`;
      card.appendChild(meta);
      const recent = finished.slice(0, 12).reverse().map((entry) => entry.ms);
      if (recent.length) {
        card.appendChild(sparkline(recent));
        if (recent.length > 1) {
          const note = document.createElement("p");
          note.className = "spark-note";
          note.textContent = "最近成绩，越靠上越快";
          card.appendChild(note);
        }
      }
    }
    sizes.appendChild(card);
  });

  const list = $("recent-list");
  list.replaceChildren();
  if (!store.history.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "完成一局后，成绩会留在这里。";
    list.appendChild(empty);
    return;
  }
  store.history.slice(0, 20).forEach((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "recent-item";
    button.dataset.action = "open-history";
    button.dataset.id = entry.id;
    const level = entry.timedOut ? { label: "时间到" } : Schulte.grade(entry.size, entry.ms);
    const top = document.createElement("span");
    top.className = "recent-top";
    const left = document.createElement("span");
    left.textContent = `${entry.size}×${entry.size} · ${level.label}`;
    const right = document.createElement("span");
    right.className = "num";
    right.textContent = entry.timedOut ? `找到 ${entry.found || 0} 个` : `${Schulte.formatTime(entry.ms)} 秒`;
    top.append(left, right);
    const sub = document.createElement("span");
    sub.className = "recent-sub";
    const miss = entry.mistakes === 0 ? "没有点错" : `点错 ${entry.mistakes} 次`;
    sub.textContent = `${Schulte.formatWhen(entry.t, Date.now())} · ${miss}`;
    button.append(top, sub);
    const summary = entry.timedOut ? "时间到" : `${Schulte.formatTime(entry.ms)} 秒`;
    button.setAttribute("aria-label", `${entry.size}×${entry.size}，${summary}，查看成绩`);
    list.appendChild(button);
  });
}

function fillSettings() {
  $("name-input").value = load().name;
  renderTheme();
  renderSwitches();
}

function persistName() {
  const store = load();
  store.name = Schulte.sanitizeName($("name-input").value);
  save(store);
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function drawMark(ctx, cx, cy) {
  const size = 14;
  const gap = 8;
  const originX = cx - (size * 3 + gap * 2) / 2;
  const originY = cy - (size * 3 + gap * 2) / 2;
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      ctx.fillStyle = row === 1 && col === 1 ? "#1a6842" : "rgba(27,25,21,0.16)";
      roundRect(ctx, originX + col * (size + gap), originY + row * (size + gap), size, size, 3);
      ctx.fill();
    }
  }
}

function drawCard(result) {
  const width = 1080;
  const height = 1440;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#e8e1d4";
  ctx.fillRect(0, 0, width, height);
  roundRect(ctx, 72, 72, width - 144, height - 144, 48);
  ctx.fillStyle = "#f7f3eb";
  ctx.fill();

  drawMark(ctx, width / 2, 168);
  ctx.textAlign = "center";
  ctx.fillStyle = "#5e574c";
  ctx.font = '500 36px "PingFang SC", "Songti SC", sans-serif';
  ctx.fillText("舒尔特方格", width / 2, 280);

  const info = Schulte.sizeInfo(result.size);
  ctx.font = '400 40px "PingFang SC", sans-serif';
  ctx.fillText(`${info.name}   ${result.size}×${result.size}`, width / 2, 390);

  ctx.fillStyle = "#1b1915";
  const timeText = Schulte.formatTime(result.ms);
  let timeSize = 200;
  const family = '"Avenir Next", "PingFang SC", sans-serif';
  do {
    ctx.font = `500 ${timeSize}px ${family}`;
    if (ctx.measureText(timeText).width <= 820) break;
    timeSize -= 6;
  } while (timeSize > 96);
  ctx.fillText(timeText, width / 2, 640);
  ctx.fillStyle = "#5e574c";
  ctx.font = '400 40px "PingFang SC", sans-serif';
  ctx.fillText("秒", width / 2, 720);

  const level = Schulte.grade(result.size, result.ms);
  ctx.fillStyle = level.id === "great" || level.id === "good" ? "#1a6842" : "#1b1915";
  ctx.font = '600 72px "Songti SC", "PingFang SC", serif';
  ctx.fillText(level.label, width / 2, 860);

  ctx.fillStyle = "#5e574c";
  ctx.font = '400 36px "PingFang SC", sans-serif';
  ctx.fillText(result.mistakes === 0 ? "没有点错" : `点错 ${result.mistakes} 次`, width / 2, 960);

  let cursor = 1080;
  if (result.challenge) {
    const outcome = Schulte.compare(result.ms, result.challenge.ms);
    const who = result.challenge.name || "对方";
    let line = `和${who}用时几乎一样`;
    if (outcome.kind === "faster") line = `比${who}快 ${Schulte.formatTime(outcome.delta)} 秒`;
    if (outcome.kind === "slower") line = `比${who}慢 ${Schulte.formatTime(outcome.delta)} 秒`;
    ctx.fillStyle = "#1b1915";
    ctx.font = '500 40px "PingFang SC", sans-serif';
    ctx.fillText(line, width / 2, cursor);
    cursor += 70;
  }

  const name = load().name;
  ctx.fillStyle = "#5e574c";
  ctx.font = '400 34px "PingFang SC", sans-serif';
  if (name) ctx.fillText(`${name} 的成绩`, width / 2, 1180);
  ctx.fillText("目光停在中心", width / 2, name ? 1248 : 1180);
  ctx.fillText("用同一张方格来挑战", width / 2, name ? 1316 : 1248);
  return canvas;
}

function canvasBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

function challengeUrl(result) {
  const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const origin = local && state.shareOrigin ? state.shareOrigin.replace(/\/$/, "") : location.origin;
  const url = new URL(location.pathname, `${origin}/`);
  url.search = "";
  url.hash = Schulte.buildChallengeHash({
    level: result.level || state.level,
    size: result.size,
    seed: result.seed,
    ms: result.ms,
    mistakes: result.mistakes,
    name: load().name,
  });
  return url.href;
}

function shareText(result) {
  const grade = Schulte.grade(result.size, result.ms);
  const tier = result.level ? Schulte.levelInfo(result.level).name : "";
  const miss = result.mistakes === 0 ? "没有点错" : `点错 ${result.mistakes} 次`;
  let text = `我用 ${Schulte.formatTime(result.ms)} 秒完成了舒尔特方格${tier ? `${tier} ` : ""}${result.size}×${result.size}，${grade.label}，${miss}。`;
  if (result.challenge) {
    const outcome = Schulte.compare(result.ms, result.challenge.ms);
    const who = result.challenge.name || "对方";
    if (outcome.kind === "faster") text += `比${who}快 ${Schulte.formatTime(outcome.delta)} 秒。`;
    else if (outcome.kind === "slower") text += `比${who}慢 ${Schulte.formatTime(outcome.delta)} 秒。`;
    else text += `和${who}用时几乎一样。`;
  }
  text += "打开链接，用同一张方格来挑战。";
  return text;
}

function toast(message) {
  const node = $("toast");
  node.textContent = message;
  node.hidden = false;
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => {
    node.hidden = true;
  }, 2400);
}

function fallbackCopy(text) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch (error) {
    ok = false;
  }
  area.remove();
  toast(ok ? "已复制" : "请长按链接文字复制");
}

async function copyText(text, success) {
  try {
    await navigator.clipboard.writeText(text);
    toast(success);
  } catch (error) {
    fallbackCopy(text);
  }
}

async function openShare() {
  const result = state.lastResult;
  if (!result || result.timedOut || state.sharing) return;
  state.sharing = true;
  try {
    const blob = await canvasBlob(drawCard(result));
    if (!blob) {
      toast("成绩卡没有生成");
      return;
    }
    if (state.cardUrl) URL.revokeObjectURL(state.cardUrl);
    state.cardBlob = blob;
    state.cardUrl = URL.createObjectURL(blob);
    const image = $("sheet-image");
    image.src = state.cardUrl;
    image.alt = `舒尔特方格 ${result.size}×${result.size}，用时 ${Schulte.formatTime(result.ms)} 秒`;
    const link = isHttp() ? challengeUrl(result) : "";
    $("sheet-lead").textContent = link
      ? "朋友打开链接后，会挑战同一张方格。长按图片可以保存到相册。"
      : "长按图片保存成绩卡，就可以发给朋友。页面放到网上之后，链接也能打开同一张方格。";
    const urlNode = $("sheet-url");
    urlNode.textContent = link;
    urlNode.hidden = !link;
    $("copy-link").textContent = link ? "复制挑战链接" : "复制成绩文字";
    $("sheet-share").hidden = typeof navigator.share !== "function";
    $("sheet").hidden = false;
  } finally {
    state.sharing = false;
  }
}

function closeSheet() {
  $("sheet").hidden = true;
}

async function systemShare() {
  const result = state.lastResult;
  if (!result || !state.cardBlob) return;
  const text = shareText(result);
  const url = isHttp() ? challengeUrl(result) : "";
  const file = new File([state.cardBlob], "舒尔特方格.png", { type: "image/png" });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "舒尔特方格", text });
      return;
    }
  } catch (error) {
    if (error && error.name === "AbortError") return;
  }
  try {
    if (navigator.share) {
      await navigator.share({ title: "舒尔特方格", text, url: url || undefined });
      return;
    }
  } catch (error) {
    if (error && error.name === "AbortError") return;
  }
  await copyLink();
}

async function copyLink() {
  const result = state.lastResult;
  if (!result) return;
  const text = shareText(result);
  const url = isHttp() ? challengeUrl(result) : "";
  await copyText(url ? `${text}\n${url}` : text, url ? "挑战链接已复制" : "成绩已复制");
}

function saveImage() {
  if (!state.cardUrl) return;
  const link = document.createElement("a");
  link.href = state.cardUrl;
  link.download = "舒尔特方格.png";
  link.click();
}

function ask(options) {
  return new Promise((resolve) => {
    state.pendingDialog = resolve;
    $("dialog-title").textContent = options.title;
    $("dialog-body").textContent = options.body;
    $("dialog-ok").textContent = options.ok;
    $("dialog-cancel").textContent = options.cancel;
    $("dialog-ok").classList.toggle("danger", Boolean(options.danger));
    $("dialog").hidden = false;
  });
}

function closeDialog(value) {
  $("dialog").hidden = true;
  const resolve = state.pendingDialog;
  state.pendingDialog = null;
  if (resolve) resolve(value);
}

async function requestLeave() {
  if (state.screen !== "play") return;
  if (state.phase === "running") {
    pause();
    const ok = await ask({
      title: "离开这一局？",
      body: "离开后，这一局不会记入成绩。",
      ok: "离开",
      cancel: "继续训练",
      danger: true,
    });
    if (!ok) {
      resume();
      return;
    }
  }
  abandon();
  showScreen("home");
  refreshHome();
}

function startPractice() {
  const info = Schulte.levelInfo(state.level);
  state.size = info.size;
  const store = load();
  store.level = state.level;
  store.size = info.size;
  save(store);
  state.activeChallenge = null;
  openReady({ size: info.size, seed: Schulte.newSeed(), level: state.level });
}

function acceptChallenge() {
  const incoming = state.incoming;
  if (!incoming) return;
  state.activeChallenge = incoming;
  state.level = incoming.level;
  state.size = incoming.size;
  const store = load();
  store.level = incoming.level;
  store.size = incoming.size;
  save(store);
  openReady({ size: incoming.size, seed: incoming.seed, level: incoming.level });
}

function againNew() {
  if (state.lastResult) {
    state.level = state.lastResult.level || Schulte.levelForSize(state.lastResult.size).id;
  }
  startPractice();
}

function retrySame() {
  const result = state.lastResult;
  if (!result) return;
  state.level = result.level || Schulte.levelForSize(result.size).id;
  state.size = result.size;
  state.activeChallenge = result.challenge
    ? {
        size: result.size,
        seed: result.seed,
        ms: result.challenge.ms,
        mistakes: result.challenge.mistakes,
        name: result.challenge.name || "",
      }
    : null;
  openReady({ size: result.size, seed: result.seed, level: state.level });
}

function leaveResult() {
  const dest = state.resultBack === "records" ? "records" : "home";
  showScreen(dest);
  if (dest === "home") refreshHome();
  else renderRecords();
}

function openHistory(id) {
  const entry = load().history.find((item) => item.id === id);
  if (!entry) return;
  state.lastResult = { ...entry, fresh: false };
  state.resultBack = "records";
  showResult();
}

function pickSize(size) {
  if (!Schulte.SIZES.some((item) => item.size === size)) return;
  state.size = size;
  const store = load();
  store.size = size;
  save(store);
  refreshHome();
}

function setTheme(theme) {
  if (!["auto", "light", "dark"].includes(theme)) return;
  const store = load();
  store.theme = theme;
  save(store);
  applyTheme();
}

function toggleSetting(key) {
  const store = load();
  if (!["strict", "hideNext", "vibrate"].includes(key)) return;
  store[key] = !store[key];
  save(store);
  renderSwitches();
}

async function clearStore() {
  const ok = await ask({
    title: "清除记录？",
    body: "这台设备上的成绩、称呼和设置会一起清掉。",
    ok: "清除",
    cancel: "取消",
    danger: true,
  });
  if (!ok) return;
  try {
    localStorage.removeItem(STORE_KEY);
  } catch (error) {
    toast("没有清除成功");
    return;
  }
  state.size = 5;
  state.level = "basic";
  state.activeChallenge = null;
  applyTheme();
  fillSettings();
  toast("已清除这台设备上的记录");
  showScreen("home");
  refreshHome();
}

function dismissChallenge() {
  const url = new URL(location.href);
  url.hash = "";
  history.replaceState(null, "", `${url.pathname}${url.search}`);
  state.incoming = null;
  state.activeChallenge = null;
  refreshBanner();
}

function readIncoming() {
  state.incoming = Schulte.parseChallenge(location.hash);
}

function onBoardPointerDown(event) {
  const cell = event.target.closest(".cell");
  if (!cell || cell.disabled) return;
  event.preventDefault();
  state.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, cell };
}

function onBoardPointerUp(event) {
  const pointer = state.pointer;
  if (!pointer || pointer.id !== event.pointerId) return;
  state.pointer = null;
  const moved = Math.abs(event.clientX - pointer.x) > 12 || Math.abs(event.clientY - pointer.y) > 12;
  if (moved || pointer.cell.disabled) return;
  state.pointerHandled = true;
  tapCell(Number(pointer.cell.dataset.n), pointer.cell);
  window.setTimeout(() => {
    state.pointerHandled = false;
  }, 0);
}

function onBoardClick(event) {
  const cell = event.target.closest(".cell");
  if (!cell || cell.disabled) return;
  if (state.pointerHandled) {
    state.pointerHandled = false;
    return;
  }
  tapCell(Number(cell.dataset.n), cell);
}

const actions = {
  home() {
    showScreen("home");
    refreshHome();
  },
  records() {
    showScreen("records");
    renderRecords();
  },
  settings() {
    fillSettings();
    showScreen("settings");
  },
  start: startPractice,
  accept: acceptChallenge,
  "dismiss-challenge": dismissChallenge,
  "pick-size"(button) {
    pickSize(Number(button.dataset.size));
  },
  level(button) {
    setLevel(button.dataset.levelValue);
  },
  mode(button) {
    setMode(button.dataset.modeValue);
  },
  leave: requestLeave,
  begin: beginRun,
  again: againNew,
  retry: retrySame,
  share: openShare,
  "result-back": leaveResult,
  "close-sheet": closeSheet,
  "system-share": systemShare,
  "copy-link": copyLink,
  "save-image": saveImage,
  theme(button) {
    setTheme(button.dataset.themeValue);
  },
  toggle(button) {
    toggleSetting(button.dataset.switch);
  },
  clear: clearStore,
  "open-history"(button) {
    openHistory(button.dataset.id);
  },
  "dialog-ok"() {
    closeDialog(true);
  },
  "dialog-cancel"() {
    closeDialog(false);
  },
};

function bind() {
  document.body.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button || !actions[button.dataset.action]) return;
    Promise.resolve(actions[button.dataset.action](button)).catch(() => {
      toast("这一步没有完成");
    });
  });

  const board = $("board");
  board.addEventListener("pointerdown", onBoardPointerDown);
  board.addEventListener("pointerup", onBoardPointerUp);
  board.addEventListener("click", onBoardClick);
  board.addEventListener("pointercancel", () => {
    state.pointer = null;
  });
  board.addEventListener("contextmenu", (event) => event.preventDefault());

  const nameInput = $("name-input");
  nameInput.addEventListener("compositionstart", () => {
    state.composing = true;
  });
  nameInput.addEventListener("compositionend", () => {
    state.composing = false;
    persistName();
  });
  nameInput.addEventListener("input", () => {
    if (!state.composing) persistName();
  });
  nameInput.addEventListener("blur", () => {
    persistName();
    nameInput.value = load().name;
  });

  window.addEventListener("hashchange", () => {
    readIncoming();
    if (state.screen === "home") refreshBanner();
  });

  window.addEventListener("resize", () => {
    if (state.screen === "play" && state.phase === "running") fitBoard();
  });

  document.addEventListener("visibilitychange", () => {
    if (state.screen !== "play" || state.phase !== "running") return;
    if (document.hidden) pause();
    else resume();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!$("dialog").hidden) closeDialog(false);
    else if (!$("sheet").hidden) closeSheet();
    else if (state.screen === "play") requestLeave();
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
}

function setMode(mode) {
  if (mode !== "count" && mode !== "limit") return;
  state.mode = mode;
  const store = load();
  store.mode = mode;
  save(store);
  refreshHome();
}

function setLevel(level) {
  if (!Schulte.LEVELS.some((item) => item.id === level)) return;
  const info = Schulte.levelInfo(level);
  state.level = info.id;
  state.size = info.size;
  const store = load();
  store.level = info.id;
  store.size = info.size;
  save(store);
  refreshHome();
}

async function loadShareOrigin() {
  try {
    const response = await fetch("share-origin.txt", { cache: "no-store" });
    if (!response.ok) return;
    const text = (await response.text()).trim();
    if (/^https?:\/\//.test(text)) state.shareOrigin = text;
  } catch (error) {
    state.shareOrigin = "";
  }
}

function init() {
  const store = load();
  state.level = store.level;
  state.size = Schulte.levelInfo(store.level).size;
  state.mode = store.mode;
  bind();
  applyTheme();
  readIncoming();
  refreshHome();
  showScreen("home");
  loadShareOrigin();
}

init();
