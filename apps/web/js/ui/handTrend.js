// U2（2026-11-07）：右栏「各玩家手牌数走势」折线图。
//
// 数据：从引擎事件历史（DEAL / PLAY / DRAW / STACK_RESOLVE / CHALLENGE_FAIL /
// UNO_CAUGHT / PLAYER_OUT）按动作步重放各座位手牌数时间序列；联机只取公开数量
// （sanitizeEventsForSeat 已脱敏，本模块只读 count/seat，不碰任何牌面）。
// 视图：纯 SVG 折线层（不引图表库，沿用结算页做法）；荧光绿主色标记「你」，
// 其余座位按相对座位取扩展调色板区分；动画关闭 / reduced-motion 下静态渲染。
//
// 红线：不新增引擎字段、不改 GameView / UiAction / 协议；只读 view.events 与 view.players。

const SVG_NS = "http://www.w3.org/2000/svg";

// 相对座位着色：viewer 用荧光绿主色，其余按相对座位取扩展调色板（四色系 + 区分度）。
const VIEWER_COLOR = "#d9ff4b";
const OTHER_COLORS = [
  "#ff5f55", "#ffd23f", "#7d9bff", "#c98bff",
  "#ff9d2e", "#5be3c8", "#ff7eb6", "#9fe05b", "#b0b8c0",
];

export function seatColor(seat, viewer, total) {
  if (seat === viewer) return VIEWER_COLOR;
  const rel = ((seat - viewer) % total + total) % total;
  return OTHER_COLORS[(rel - 1 + OTHER_COLORS.length) % OTHER_COLORS.length];
}

/**
 * 从事件历史重放各座位手牌数时间序列（纯函数，无 DOM 依赖，便于单测）。
 * @param {Array} events 完整事件日志（view.events）
 * @param {Array} players view.players（含 seat / name / handCount / isHuman）
 * @param {number} viewer 视角座位（view.human.seat）
 * @returns {{ seats: Array, samples: number[][], maxHand: number }}
 *   seats: [{ seat, name, color, isViewer }]（顺序即 samples 每行的列序）
 *   samples: 每个样本 = 各座位手牌数的快照数组（按 seats 顺序）
 */
export function buildHandTrend(events, players, viewer) {
  const seats = players.map((player) => player.seat);
  const total = players.length;
  const counts = Object.fromEntries(seats.map((seat) => [seat, 0]));
  const samples = [];
  const snapshot = () => seats.map((seat) => counts[seat]);

  for (const event of events || []) {
    switch (event.type) {
      case "DEAL": counts[event.seat] = (counts[event.seat] || 0) + (event.count || 0); break;
      case "PLAY": counts[event.seat] = Math.max(0, (counts[event.seat] || 0) - 1); break;
      case "DRAW": counts[event.seat] = (counts[event.seat] || 0) + (event.count || 0); break;
      case "STACK_RESOLVE": counts[event.seat] = (counts[event.seat] || 0) + (event.total || 0); break;
      case "CHALLENGE_FAIL": counts[event.challenger] = (counts[event.challenger] || 0) + (event.penalty || 0); break;
      case "UNO_CAUGHT": counts[event.seat] = (counts[event.seat] || 0) + (event.penalty || 0); break;
      case "PLAYER_OUT": counts[event.seat] = 0; break;
      default: continue; // COLOR_SET / SKIP / REVERSE / PILE_RESHUFFLE / ROUND_END / UNO_CALLED 等不改变手牌数
    }
    samples.push(snapshot());
  }

  // 用权威当前值覆盖末样本，保证末点与 #hand / 对手「N 张」完全一致
  for (const player of players) counts[player.seat] = player.handCount;
  if (samples.length) samples[samples.length - 1] = snapshot();
  else if (players.length) samples.push(snapshot()); // 无事件（理论不出现）至少给一帧

  const maxHand = Math.max(1, ...samples.flat());
  const meta = players.map((player) => ({
    seat: player.seat,
    name: player.name,
    color: seatColor(player.seat, viewer, total),
    isViewer: player.seat === viewer,
  }));
  return { seats: meta, samples, maxHand };
}

function svgEl(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

/**
 * 把折线图渲染进 #hand-trend。无样本或无人时显示占位。
 * 同时把末值与座位名写进 dataset，供 verify:ui 一致性断言读取。
 */
export function renderHandTrend(view) {
  const mount = document.querySelector("#hand-trend");
  if (!mount) return;
  const players = view.players || [];
  const viewer = view.human?.seat ?? 0;
  // 优先用 UI 层累积的全量事件历史（引擎/服务端每次动作都重置 events，单帧只有本批事件）
  const { seats, samples, maxHand } = buildHandTrend(view.eventHistory || view.events, players, viewer);

  mount.replaceChildren();
  mount.classList.remove("is-empty");
  // 图例放在画布外的独立容器（.hand-trend 内、canvas 之后），避免被绝对定位的 SVG 盖住
  const legendHost = document.querySelector("#hand-trend-legend");
  if (legendHost) legendHost.replaceChildren();

  if (!samples.length || !seats.length) {
    mount.classList.add("is-empty");
    const empty = document.createElement("p");
    empty.className = "hand-trend__empty";
    empty.textContent = "等待发牌…";
    mount.append(empty);
    mount.dataset.sampleCount = "0";
    mount.dataset.seatCount = "0";
    return;
  }

  // viewBox 坐标（CSS 负责缩放到容器宽度，保证窄屏不横向溢出）
  const W = 300, H = 172;
  const padL = 20, padR = 8, padT = 10, padB = 18;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = samples.length;
  const xFor = (i) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yFor = (v) => padT + plotH - (v / maxHand) * plotH;

  const svg = svgEl("svg", {
    viewBox: `0 0 ${W} ${H}`,
    class: "hand-trend__svg",
    preserveAspectRatio: "none",
    role: "img",
    "aria-label": `各玩家手牌数走势，共 ${n} 个回合样本`,
  });

  // y 轴网格 + 刻度（0 / 中点 / 峰值）
  for (const frac of [0, 0.5, 1]) {
    const y = padT + plotH - frac * plotH;
    svg.append(svgEl("line", {
      x1: padL, x2: W - padR, y1: y, y2: y, class: "hand-trend__grid",
    }));
    const label = svgEl("text", {
      x: padL - 4, y: y + 3, class: "hand-trend__axis", "text-anchor": "end",
    });
    label.textContent = String(Math.round(frac * maxHand));
    svg.append(label);
  }

  // 每条座位一条折线 + 末点圆点
  seats.forEach((s, si) => {
    const pts = samples.map((row, i) => `${xFor(i).toFixed(1)},${yFor(row[si]).toFixed(1)}`).join(" ");
    svg.append(svgEl("polyline", {
      points: pts, fill: "none", stroke: s.color,
      "stroke-width": s.isViewer ? "2.4" : "1.6",
      class: `hand-trend__line${s.isViewer ? " is-viewer" : ""}`,
      "stroke-linejoin": "round", "stroke-linecap": "round",
    }));
    const last = samples[n - 1][si];
    svg.append(svgEl("circle", {
      cx: xFor(n - 1).toFixed(1), cy: yFor(last).toFixed(1),
      r: s.isViewer ? "2.6" : "1.8", fill: s.color,
    }));
  });
  mount.append(svg);

  // 图例（座位名 → 颜色），与 players 顺序一致；viewer 标注「你」。
  // 渲染到 #hand-trend-legend（画布外），无该容器时兜底追加进 mount。
  const legend = document.createElement("div");
  legend.className = "hand-trend__legend";
  seats.forEach((s) => {
    const item = document.createElement("span");
    item.className = "hand-trend__legend-item";
    const dot = document.createElement("i");
    dot.style.background = s.color;
    const label = document.createElement("span");
    label.dataset.seat = String(s.seat);
    label.textContent = s.isViewer ? `${s.name}（你）` : s.name;
    item.append(dot, label);
    legend.append(item);
  });
  (legendHost || mount).append(legend);

  // 暴露给断言：末值 / 座位名 / 样本数 / 座位总数
  const last = samples[n - 1];
  mount.dataset.lastValues = JSON.stringify(Object.fromEntries(seats.map((s, i) => [s.seat, last[i]])));
  mount.dataset.seatNames = JSON.stringify(Object.fromEntries(seats.map((s) => [s.seat, s.name])));
  mount.dataset.seatCount = String(seats.length);
  mount.dataset.sampleCount = String(n);
}
