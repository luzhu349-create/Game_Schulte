(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.Schulte = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SIZES = [
    { size: 4, name: "入门" },
    { size: 5, name: "标准" },
    { size: 6, name: "强化" },
    { size: 7, name: "挑战" },
    { size: 8, name: "极限" },
  ];

  const LEVELS = [
    { id: "basic", name: "初级", size: 5 },
    { id: "mid", name: "中级", size: 6 },
    { id: "high", name: "高级", size: 7 },
  ];

  // 训练参考，单位毫秒：卓越 / 优秀 / 良好。计时模式按这三档评级。
  const BENCH = {
    3: [6000, 9000, 13000],
    4: [12000, 18000, 26000],
    5: [20000, 30000, 45000],
    6: [36000, 52000, 75000],
    7: [55000, 80000, 120000],
    8: [90000, 130000, 180000],
  };

  // 限时模式的倒计时，收在优秀线内侧，走完仍可拿到卓越或优秀。
  const LIMIT = {
    4: 18000,
    5: 30000,
    6: 48000,
    7: 75000,
    8: 110000,
  };

  // 颜色种数和跳动档随等级增加。字号仍由切块大小决定。
  const LOOK = {
    4: { tones: 2, hops: [0, 1] },
    5: { tones: 3, hops: [0, 1, 2] },
    6: { tones: 4, hops: [1, 2] },
    7: { tones: 4, hops: [1, 2, 3] },
    8: { tones: 5, hops: [2, 3] },
  };

  // 底盘外形、站点抖动和最小间距。等级越高，切得越碎、大小差越大。
  const CUT = {
    4: { outline: "square", jitter: 0.62, relax: 0, gap: 0.52 },
    5: { outline: "octagon", jitter: 0.7, relax: 0, gap: 0.48 },
    6: { outline: "circle", jitter: 0.78, relax: 0, gap: 0.46 },
    7: { outline: "hex", jitter: 0.86, relax: 0, gap: 0.5 },
    8: { outline: "pentagon", jitter: 0.94, relax: 0, gap: 0.48 },
  };

  function limit(size) {
    if (LIMIT[size]) return LIMIT[size];
    const bench = BENCH[size] || BENCH[5];
    return bench[1];
  }

  function packSize(size, name) {
    return { size, name, count: size * size, limit: limit(size) };
  }

  function sizeInfo(size) {
    const found = SIZES.find((item) => item.size === size);
    if (found) return packSize(found.size, found.name);
    if (BENCH[size]) return packSize(size, "记录");
    return packSize(5, "标准");
  }

  function levelById(id) {
    return LEVELS.find((item) => item.id === id) || LEVELS[0];
  }

  function levelForSize(size) {
    if (size <= 5) return LEVELS[0];
    if (size === 6) return LEVELS[1];
    return LEVELS[2];
  }

  function levelInfo(id) {
    const level = levelById(id);
    const info = sizeInfo(level.size);
    return { ...info, id: level.id, name: level.name };
  }

  function cellLook(level, index) {
    if (level !== "mid" && level !== "high") return { tone: 0, shade: 1, drift: false };
    const tones = level === "high" ? 5 : 4;
    return {
      tone: index % tones,
      shade: (index * 2 + 1) % 3,
      drift: level === "high",
    };
  }

  function squareGrid(size) {
    const gap = 0.016;
    const cell = (1 - gap * (size + 1)) / size;
    const parts = [];
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        const x = gap + col * (cell + gap);
        const y = gap + row * (cell + gap);
        parts.push({
          points: [
            { x, y },
            { x: x + cell, y },
            { x: x + cell, y: y + cell },
            { x, y: y + cell },
          ],
          area: cell * cell,
          cx: x + cell / 2,
          cy: y + cell / 2,
          radius: cell * 0.36,
        });
      }
    }
    return parts;
  }

  function regularOutline(sides, radius, rotation) {
    const points = [];
    for (let i = 0; i < sides; i += 1) {
      const angle = rotation + (i / sides) * Math.PI * 2;
      points.push({
        x: 0.5 + Math.cos(angle) * radius,
        y: 0.5 + Math.sin(angle) * radius,
      });
    }
    return points;
  }

  function outlineFor(kind) {
    if (kind === "octagon") return regularOutline(8, 0.48, Math.PI / 8);
    if (kind === "circle") return regularOutline(48, 0.47, 0);
    if (kind === "hex") return regularOutline(6, 0.48, -Math.PI / 2);
    if (kind === "pentagon") return regularOutline(5, 0.48, -Math.PI / 2);
    const margin = 0.03;
    return [
      { x: margin, y: margin },
      { x: 1 - margin, y: margin },
      { x: 1 - margin, y: 1 - margin },
      { x: margin, y: 1 - margin },
    ];
  }

  function contains(poly, x, y) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
      const pi = poly[i];
      const pj = poly[j];
      const cross = (pi.y > y) !== (pj.y > y);
      if (cross && x < ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y) + pi.x) inside = !inside;
    }
    return inside;
  }

  function pullInside(poly, x, y) {
    if (contains(poly, x, y)) return { x, y };
    let low = 0;
    let high = 1;
    for (let step = 0; step < 14; step += 1) {
      const mid = (low + high) / 2;
      const px = 0.5 + (x - 0.5) * mid;
      const py = 0.5 + (y - 0.5) * mid;
      if (contains(poly, px, py)) low = mid;
      else high = mid;
    }
    const scale = low * 0.64;
    return { x: 0.5 + (x - 0.5) * scale, y: 0.5 + (y - 0.5) * scale };
  }

  function separateSites(sites, minDist, poly) {
    for (let iter = 0; iter < 14; iter += 1) {
      let moved = false;
      for (let i = 0; i < sites.length; i += 1) {
        for (let j = i + 1; j < sites.length; j += 1) {
          let dx = sites[j].x - sites[i].x;
          let dy = sites[j].y - sites[i].y;
          let dist = Math.hypot(dx, dy);
          if (dist < 1e-6) {
            dx = 0.01;
            dy = 0;
            dist = 0.01;
          }
          if (dist >= minDist) continue;
          const push = (minDist - dist) / 2;
          const ux = dx / dist;
          const uy = dy / dist;
          sites[i].x -= ux * push;
          sites[i].y -= uy * push;
          sites[j].x += ux * push;
          sites[j].y += uy * push;
          moved = true;
        }
      }
      for (let i = 0; i < sites.length; i += 1) {
        const next = pullInside(poly, sites[i].x, sites[i].y);
        sites[i].x = next.x;
        sites[i].y = next.y;
      }
      if (!moved) break;
    }
    return sites;
  }

  function clipHalfPlane(poly, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const limit = (bx * bx + by * by - (ax * ax + ay * ay)) / 2;
    const side = (point) => point.x * dx + point.y * dy - limit;
    const hit = (left, right) => {
      const leftSide = side(left);
      const rightSide = side(right);
      const denom = leftSide - rightSide;
      const t = Math.abs(denom) < 1e-12 ? 0 : leftSide / denom;
      return {
        x: left.x + (right.x - left.x) * t,
        y: left.y + (right.y - left.y) * t,
      };
    };
    const next = [];
    for (let i = 0; i < poly.length; i += 1) {
      const current = poly[i];
      const previous = poly[(i + poly.length - 1) % poly.length];
      const currentIn = side(current) <= 1e-8;
      const previousIn = side(previous) <= 1e-8;
      if (currentIn) {
        if (!previousIn) next.push(hit(previous, current));
        next.push(current);
      } else if (previousIn) {
        next.push(hit(previous, current));
      }
    }
    return next;
  }

  function measureCell(poly) {
    let signed = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < poly.length; i += 1) {
      const current = poly[i];
      const next = poly[(i + 1) % poly.length];
      const cross = current.x * next.y - next.x * current.y;
      signed += cross;
      cx += (current.x + next.x) * cross;
      cy += (current.y + next.y) * cross;
    }
    signed *= 0.5;
    if (Math.abs(signed) < 1e-8) return null;
    cx /= 6 * signed;
    cy /= 6 * signed;
    if (!contains(poly, cx, cy)) {
      cx = 0;
      cy = 0;
      poly.forEach((point) => {
        cx += point.x;
        cy += point.y;
      });
      cx /= poly.length;
      cy /= poly.length;
    }
    let radius = Infinity;
    for (let i = 0; i < poly.length; i += 1) {
      const current = poly[i];
      const next = poly[(i + 1) % poly.length];
      const dx = next.x - current.x;
      const dy = next.y - current.y;
      const length = Math.hypot(dx, dy) || 1;
      const distance = Math.abs((cx - current.x) * dy - (cy - current.y) * dx) / length;
      if (distance < radius) radius = distance;
    }
    return {
      points: poly,
      area: Math.abs(signed),
      cx,
      cy,
      radius: Number.isFinite(radius) ? radius : 0.02,
    };
  }

  function voronoi(sites, outline) {
    return sites.map((site, index) => {
      let poly = outline.map((point) => ({ x: point.x, y: point.y }));
      for (let other = 0; other < sites.length; other += 1) {
        if (other === index) continue;
        poly = clipHalfPlane(poly, site.x, site.y, sites[other].x, sites[other].y);
        if (poly.length < 3) return null;
      }
      return measureCell(poly);
    });
  }

  function fallbackCell(site) {
    const radius = 0.035;
    return measureCell([
      { x: site.x, y: site.y - radius },
      { x: site.x + radius, y: site.y },
      { x: site.x, y: site.y + radius },
      { x: site.x - radius, y: site.y },
    ]);
  }

  function partition(size, seed, outlineKind) {
    const spec = CUT[size] || CUT[5];
    const width = CUT[size] ? size : 5;
    const rand = mulberry32((seed ^ 0xa5a5a5a5) >>> 0);
    const outline = outlineFor(outlineKind || spec.outline);
    const pitch = 1 / width;
    const sites = [];
    for (let row = 0; row < width; row += 1) {
      for (let col = 0; col < width; col += 1) {
        const x = (col + 0.5) * pitch + (rand() - 0.5) * spec.jitter * pitch;
        const y = (row + 0.5) * pitch + (rand() - 0.5) * spec.jitter * pitch;
        sites.push(pullInside(outline, x, y));
      }
    }
    separateSites(sites, spec.gap * pitch, outline);
    for (let pass = 0; pass < spec.relax; pass += 1) {
      const cells = voronoi(sites, outline);
      for (let i = 0; i < sites.length; i += 1) {
        const cell = cells[i];
        if (!cell) continue;
        const next = pullInside(outline, cell.cx, cell.cy);
        sites[i].x = next.x;
        sites[i].y = next.y;
      }
      separateSites(sites, spec.gap * pitch, outline);
    }
    return voronoi(sites, outline).map((cell, index) => cell || fallbackCell(sites[index]));
  }

  function mulberry32(seed) {
    let a = seed | 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(size, seed) {
    const total = size * size;
    const arr = [];
    for (let i = 1; i <= total; i += 1) arr.push(i);
    const rand = mulberry32(seed);
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function newSeed() {
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      const buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      return buf[0] === 0 ? 1 : buf[0];
    }
    return Math.floor(Math.random() * 0xffffffff) + 1;
  }

  function grade(size, ms) {
    const bench = BENCH[size] || BENCH[5];
    if (ms <= bench[0]) return { id: "great", label: "卓越" };
    if (ms <= bench[1]) return { id: "good", label: "优秀" };
    if (ms <= bench[2]) return { id: "ok", label: "良好" };
    return { id: "done", label: "完成" };
  }

  function formatTime(ms) {
    const totalTenths = Math.max(0, Math.round(ms / 100));
    const tenths = totalTenths % 10;
    const totalSeconds = Math.floor(totalTenths / 10);
    const seconds = totalSeconds % 60;
    const minutes = Math.floor(totalSeconds / 60);
    if (minutes > 0) return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
    return `${seconds}.${tenths}`;
  }

  function formatLimit(ms) {
    const seconds = Math.round(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    if (minutes <= 0) return `${seconds} 秒`;
    if (rest === 0) return `${minutes} 分钟`;
    return `${minutes} 分 ${rest} 秒`;
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function dayKey(ts) {
    const date = new Date(ts);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function prevDay(key) {
    const parts = key.split("-").map(Number);
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    date.setDate(date.getDate() - 1);
    return dayKey(date.getTime());
  }

  function formatWhen(ts, now) {
    const key = dayKey(ts);
    const today = dayKey(now);
    const date = new Date(ts);
    const hm = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    if (key === today) return `今天 ${hm}`;
    if (key === prevDay(today)) return `昨天 ${hm}`;
    return `${date.getMonth() + 1}月${date.getDate()}日 ${hm}`;
  }

  function countToday(history, today) {
    return history.reduce((sum, item) => sum + (dayKey(item.t) === today ? 1 : 0), 0);
  }

  function computeStreak(dayKeys, today) {
    const set = new Set(dayKeys);
    let cursor = today;
    if (!set.has(cursor)) {
      cursor = prevDay(cursor);
      if (!set.has(cursor)) return 0;
    }
    let count = 0;
    while (set.has(cursor)) {
      count += 1;
      cursor = prevDay(cursor);
    }
    return count;
  }

  function bestFor(history, size) {
    let best = null;
    history.forEach((item) => {
      if (!item || item.timedOut || item.size !== size || typeof item.ms !== "number") return;
      if (!best || item.ms < best.ms) best = item;
    });
    return best;
  }

  function compare(ms, other) {
    const delta = other - ms;
    if (Math.abs(delta) < 100) return { kind: "tie", delta: 0 };
    if (delta > 0) return { kind: "faster", delta };
    return { kind: "slower", delta: -delta };
  }

  function sanitizeName(name) {
    return String(name || "").replace(/\s+/g, " ").trim().slice(0, 12);
  }

  function encodeName(name) {
    const clean = sanitizeName(name);
    if (!clean) return "";
    const bytes = new TextEncoder().encode(clean);
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function decodeName(encoded) {
    if (!encoded) return "";
    try {
      const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
      const padded = base64 + "===".slice((base64.length + 3) % 4);
      const binary = atob(padded);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return sanitizeName(new TextDecoder().decode(bytes));
    } catch (error) {
      return "";
    }
  }

  function buildChallengeHash(input) {
    const name = encodeName(input.name || "");
    const ms = Math.round(input.ms);
    const code = { basic: 1, mid: 2, high: 3 }[input.level] || 1;
    return `#c/${code}/${input.size}/${input.seed}/${ms}/${input.mistakes}/${name}`;
  }

  function readChallenge(level, size, seed, ms, mistakes, name) {
    if (!Number.isInteger(seed) || seed < 1 || seed > 0xffffffff) return null;
    if (!Number.isInteger(ms) || ms <= 0 || ms > 30 * 60 * 1000) return null;
    if (!Number.isInteger(mistakes) || mistakes < 0 || mistakes > 999) return null;
    return { level, size, seed, ms, mistakes, name };
  }

  function parseChallenge(hash) {
    const modern = /^#c\/([123])\/(4|5|6|7|8)\/(\d+)\/(\d+)\/(\d+)\/([A-Za-z0-9_-]*)$/.exec(hash || "");
    if (modern) {
      const level = ["basic", "mid", "high"][Number(modern[1]) - 1];
      return readChallenge(
        level,
        Number(modern[2]),
        Number(modern[3]),
        Number(modern[4]),
        Number(modern[5]),
        decodeName(modern[6])
      );
    }
    const legacy = /^#c\/(4|5|6|7|8)\/(\d+)\/(\d+)\/(\d+)\/([A-Za-z0-9_-]*)$/.exec(hash || "");
    if (!legacy) return null;
    const size = Number(legacy[1]);
    return readChallenge(
      levelForSize(size).id,
      size,
      Number(legacy[2]),
      Number(legacy[3]),
      Number(legacy[4]),
      decodeName(legacy[5])
    );
  }

  return {
    SIZES,
    LEVELS,
    levelById,
    levelForSize,
    levelInfo,
    sizeInfo,
    squareGrid,
    shuffle,
    newSeed,
    grade,
    limit,
    cellLook,
    partition,
    formatTime,
    formatLimit,
    dayKey,
    prevDay,
    formatWhen,
    countToday,
    computeStreak,
    bestFor,
    compare,
    sanitizeName,
    encodeName,
    decodeName,
    buildChallengeHash,
    parseChallenge,
  };
});
