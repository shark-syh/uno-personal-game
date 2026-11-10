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
// v2.2.1：窗口缩放 / 全屏切换 / 断点变化会让画布尺寸改变，需按新的实际像素重绘，
// 否则 viewBox 与容器不再 1:1，折线与刻度又会被拉伸。只在尺寸真正变化且处于对局屏时触发。
let lastTrendView = null;
let lastTrendSize = "";
let trendObserver = null;

export function renderHandTrend(view) {
  const mount = document.querySelector("#hand-trend");
  if (!mount) return;
  lastTrendView = view;
  lastTrendSize = `${mount.clientWidth}x${mount.clientHeight}`;
  if (!trendObserver && typeof ResizeObserver !== "undefined") {
    trendObserver = new ResizeObserver(() => {
      const node = document.querySelector("#hand-trend");
      if (!node || !lastTrendView) return;
      if (document.querySelector(".screen.is-active")?.dataset.screen !== "game") return;
      // 判据是「viewBox 与容器实际像素是否一致」，而不是「尺寸是否变过」：
      // 首次渲染时布局可能尚未稳定（读到的 clientHeight 与最终 rect.height 相差十几 px），
      // 以 viewBox 为基准可在稳定后自动补一次重绘，且两次之后必然收敛、不会死循环。
      const svg = node.querySelector(".hand-trend__svg");
      const box = (svg?.getAttribute("viewBox") || "").trim().split(/\s+/).map(Number);
      if (Math.abs((box[2] || 0) - node.clientWidth) <= 1 && Math.abs((box[3] || 0) - node.clientHeight) <= 1) return;
      renderHandTrend(lastTrendView);
    });
    trendObserver.observe(mount);
  }
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

  // 先挂图例、再量画布：图例（含 flex-wrap）会占掉 section 高度、压缩 canvas；
  // 若先量尺寸后挂图例，viewBox 会比实际画布高十几 px（旧版此处正是这么错的）。
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

  // v2.2.1：viewBox 直接取容器实际像素（1:1 映射），折线 / 网格 / 刻度文字在
  // 任何窗口高度下都保持真实比例，不再被固定的 300×172 viewBox 纵向拉伸数倍。
  // 容器在隐藏屏或首帧尚未布局时尺寸为 0，用下限兜底，ResizeObserver 会在布局完成后重绘。
  const W = Math.max(120, Math.round(mount.clientWidth));
  const H = Math.max(32, Math.round(mount.clientHeight));
  const padL = Math.min(20, Math.round(W * 0.09));
  const padR = 8;
  const padT = Math.max(4, Math.min(10, Math.round(H * 0.08)));
  const padB = Math.max(6, Math.min(18, Math.round(H * 0.14)));
  const plotW = Math.max(1, W - padL - padR);
  const plotH = Math.max(1, H - padT - padB);
  const n = samples.length;
  const xFor = (i) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yFor = (v) => padT + plotH - (v / maxHand) * plotH;

  // N6：图形摘要给读屏（色点与折线本身不可读），图例文本同屏可读，不再 aria-hidden
  const trendSummary = seats
    .map((s, si) => `${s.name}${s.isViewer ? "（你）" : ""} ${samples[n - 1][si]} 张`)
    .join("、");
  const svg = svgEl("svg", {
    viewBox: `0 0 ${W} ${H}`,
    class: "hand-trend__svg",
    preserveAspectRatio: "none",
    role: "img",
    "aria-label": `各玩家手牌数走势，共 ${n} 个回合样本；当前手牌：${trendSummary}`,
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

  // 暴露给断言：末值 / 座位名 / 样本数 / 座位总数
  const last = samples[n - 1];
  mount.dataset.lastValues = JSON.stringify(Object.fromEntries(seats.map((s, i) => [s.seat, last[i]])));
  mount.dataset.seatNames = JSON.stringify(Object.fromEntries(seats.map((s) => [s.seat, s.name])));
  mount.dataset.seatCount = String(seats.length);
  mount.dataset.sampleCount = String(n);
}
