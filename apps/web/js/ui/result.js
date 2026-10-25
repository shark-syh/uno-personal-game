import { renderCard } from "./hand.js";
import { isResultTransitionRunning, playResultTransition } from "../animation/resultTransition.js";

/**
 * 结算页（2026-10-18 用户要求：取消分数计算，保留最终结算，改为数据图表总结操作）。
 * 数据全部来自 result.players[]（plays / draws / stackPlays / unoCalls / unoCaught / challenges）
 * 与 result.turns / actions / draws / plays / stackPlays / unoCalls / challenges / durationMs；
 * UI 只做展示与图表布局，不算分、不写规则。
 */
const OPS = [
  { key: "plays", label: "出牌", color: "#ffb300" },
  { key: "draws", label: "摸牌", color: "#7fd1ae" },
  { key: "stackPlays", label: "叠牌", color: "#ff8a65" },
  { key: "unoCalls", label: "喊 UNO", color: "#b39ddb" },
  { key: "challenges", label: "挑战", color: "#90caf9" },
];
const HAND_COLORS = [
  { key: "red", label: "红", color: "var(--red)" },
  { key: "yellow", label: "黄", color: "var(--yellow)" },
  { key: "green", label: "绿", color: "var(--green)" },
  { key: "blue", label: "蓝", color: "var(--blue)" },
  { key: "wild", label: "万能", color: "#e6e6e6" },
];

function num(value) {
  return Number.isFinite(value) ? value : 0;
}

/** 某玩家剩余手牌按颜色统计（wild/wild4 归入「万能」） */
function countHandColors(cards = []) {
  const counts = { red: 0, yellow: 0, green: 0, blue: 0, wild: 0 };
  for (const card of cards) {
    if (card.color && card.color in counts) counts[card.color] += 1;
    else counts.wild += 1;
  }
  return counts;
}

/** 小标题 + 说明文字 */
function chartHeader(title, note) {
  const heading = document.createElement("h3");
  heading.textContent = title;
  const caption = document.createElement("small");
  caption.textContent = note;
  return [heading, caption];
}

/** 图例（label + color 小方块） */
function legend(items, labels) {
  const root = document.createElement("div");
  root.className = "chart-legend";
  for (const item of items) {
    const entry = document.createElement("span");
    const dot = document.createElement("i");
    dot.className = "chart-dot";
    dot.style.background = item.color;
    entry.append(dot, document.createTextNode(labels ? labels(item) : item.label));
    root.append(entry);
  }
  return root;
}

export function renderResult(view, { onAction }) {
  const root = document.querySelector("#result-content");
  const result = view.result || { winnerSeat: 0, players: [], turns: 0, durationMs: 0 };
  const players = result.players || [];
  const winner = players.find((player) => player.seat === result.winnerSeat);
  const isDraw = result.winnerSeat === null;
  const totals = {
    actions: num(result.actions),
    turns: num(result.turns),
    plays: num(result.plays),
    draws: num(result.draws),
    stackPlays: num(result.stackPlays),
    unoCalls: num(result.unoCalls),
    challenges: num(result.challenges),
  };

  // ---- 头部（契约 §8.2）：kicker / 标题（去 emoji，胜者名保留）/ meta 数据行 ----
  const header = document.createElement("header");
  header.className = "result-header";
  const kicker = document.createElement("p");
  kicker.className = "result-kicker";
  kicker.textContent = "本局结算";
  const title = document.createElement("h2");
  title.id = "result-title";
  if (isDraw) title.classList.add("is-draw");
  title.textContent = isDraw ? "平局" : `${winner?.name || "赢家"} 获胜`;
  const meta = document.createElement("p");
  meta.id = "result-meta";
  meta.className = "result-stats";
  const reasonText = result.reason === "deck-empty" ? " · 牌堆耗尽" : "";
  meta.textContent = `人数 ${players.length} · 手数 ${totals.turns} · 用时 ${Math.round((num(result.durationMs) || 0) / 1000)} 秒 · 行动 ${totals.actions}${reasonText}`;

  // ---- 获胜牌槽（契约 §8.1）：empty-hand 用 discardTop；平局/无牌隐藏，不飞 ----
  const winCardWrap = document.createElement("div");
  winCardWrap.id = "result-win-card";
  const winCard = !isDraw && result.reason !== "deck-empty" ? view.table?.discardTop || null : null;
  if (winCard) winCardWrap.append(renderCard(winCard));
  else winCardWrap.hidden = true;
  header.append(kicker, title, meta, winCardWrap);

  // ---- 总览数字卡（数据图表辅助数据） ----
  const summary = document.createElement("div");
  summary.className = "result-summary";
  [
    ["动作", totals.actions],
    ["出牌", totals.plays],
    ["摸牌", totals.draws],
    ["叠牌", totals.stackPlays],
    ["喊 UNO", totals.unoCalls],
    ["挑战", totals.challenges],
  ].forEach(([label, value]) => {
    const card = document.createElement("div");
    card.className = "result-stat";
    card.dataset.summary = label;
    card.dataset.value = String(value);
    const small = document.createElement("small");
    small.textContent = label;
    const strong = document.createElement("strong");
    strong.textContent = String(value);
    card.append(small, strong);
    summary.append(card);
  });

  // ---- 图表区 ----
  const charts = document.createElement("div");
  charts.id = "result-charts";
  charts.setAttribute("aria-label", "对局操作统计图表");

  // 图 1：每位玩家的操作次数（堆叠条）
  const opsChart = document.createElement("section");
  opsChart.className = "result-chart";
  opsChart.dataset.chart = "player-ops";
  opsChart.append(...chartHeader("每位玩家操作次数", "出牌 / 摸牌 / 叠牌 / 喊 UNO / 挑战（单位：次）"));
  for (const player of players) {
    const metrics = Object.fromEntries(OPS.map(({ key }) => [key, num(player[key])]));
    const total = OPS.reduce((sum, { key }) => sum + metrics[key], 0);
    const row = document.createElement("div");
    row.className = "chart-ops-row";
    row.dataset.seat = String(player.seat);
    row.dataset.metrics = JSON.stringify(metrics);
    const name = document.createElement("span");
    name.className = "chart-ops-name";
    name.textContent = player.name;
    const track = document.createElement("div");
    track.className = "chart-ops-track";
    for (const { key, label, color } of OPS) {
      if (!metrics[key]) continue;
      const segment = document.createElement("i");
      segment.className = "chart-ops-seg";
      segment.dataset.metric = key;
      segment.dataset.value = String(metrics[key]);
      segment.style.width = `${(metrics[key] / Math.max(1, total)) * 100}%`;
      segment.style.background = color;
      segment.title = `${label} ${metrics[key]} 次`;
      track.append(segment);
    }
    if (!total) {
      const empty = document.createElement("span");
      empty.className = "chart-empty";
      empty.textContent = "无操作";
      track.append(empty);
    }
    const totalText = document.createElement("span");
    totalText.className = "chart-ops-total";
    totalText.textContent = `${total} 次`;
    row.append(name, track, totalText);
    opsChart.append(row);
  }
  opsChart.append(legend(OPS));

  // 图 2：全体操作构成（环形图；按事件统计的出牌/摸牌/叠牌/喊 UNO/挑战）
  const mixChart = document.createElement("section");
  mixChart.className = "result-chart";
  mixChart.dataset.chart = "action-mix";
  mixChart.append(...chartHeader("全体操作构成", "出牌 / 摸牌 / 叠牌 / 喊 UNO / 挑战（按事件统计）"));
  const mixParts = OPS.map(({ key, label, color }) => ({ key, label, color, value: totals[key] }));
  const mixSum = mixParts.reduce((sum, part) => sum + part.value, 0);
  const mixTotal = Math.max(1, mixSum);
  mixChart.dataset.mix = JSON.stringify(
    Object.fromEntries(mixParts.map((part) => [part.key, part.value])),
  );
  let cursor = 0;
  const gradient = [];
  for (const part of mixParts) {
    const start = (cursor / mixTotal) * 100;
    cursor += part.value;
    const end = (cursor / mixTotal) * 100;
    gradient.push(`${part.color} ${start}% ${end}%`);
  }
  const mixWrap = document.createElement("div");
  mixWrap.className = "chart-mix-wrap";
  const donut = document.createElement("div");
  donut.className = "chart-donut";
  donut.style.background = `conic-gradient(${gradient.join(", ")})`;
  const center = document.createElement("div");
  center.className = "chart-donut-center";
  center.dataset.total = String(mixSum);
  const centerStrong = document.createElement("strong");
  centerStrong.textContent = String(mixSum);
  center.append(centerStrong, document.createTextNode("次操作"));
  donut.append(center);
  const mixLegend = legend(mixParts, (part) => `${part.label} ${part.value}`);
  mixWrap.append(donut, mixLegend);
  mixChart.append(mixWrap);

  // 图 3：每位玩家剩余手牌构成（颜色堆叠条）
  const handChart = document.createElement("section");
  handChart.className = "result-chart";
  handChart.dataset.chart = "hand-colors";
  handChart.append(...chartHeader("剩余手牌构成", "按颜色统计结算时剩余手牌（张）"));
  for (const player of players) {
    const counts = countHandColors(player.remaining);
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    const row = document.createElement("div");
    row.className = "chart-hand-row";
    row.dataset.seat = String(player.seat);
    row.dataset.colors = JSON.stringify(counts);
    const name = document.createElement("span");
    name.className = "chart-ops-name";
    name.textContent = player.name;
    const track = document.createElement("div");
    track.className = "chart-hand-track";
    for (const { key, label, color } of HAND_COLORS) {
      if (!counts[key]) continue;
      const segment = document.createElement("i");
      segment.className = "chart-ops-seg";
      segment.dataset.color = key;
      segment.dataset.value = String(counts[key]);
      segment.style.width = `${(counts[key] / Math.max(1, total)) * 100}%`;
      segment.style.background = color;
      segment.title = `${label} ${counts[key]} 张`;
      track.append(segment);
    }
    if (!total) {
      const empty = document.createElement("span");
      empty.className = "chart-empty";
      empty.textContent = "出完手牌";
      track.append(empty);
    }
    const totalText = document.createElement("span");
    totalText.className = "chart-ops-total";
    totalText.textContent = `${total} 张`;
    row.append(name, track, totalText);
    handChart.append(row);
  }
  handChart.append(legend(HAND_COLORS));
  charts.append(opsChart, mixChart, handChart);

  // ---- 玩家结算行（剩余手牌缩略图，不显示任何分数） ----
  const list = document.createElement("div");
  list.className = "result-list";
  for (const player of players) {
    const isWinnerRow = !isDraw && player.seat === result.winnerSeat;
    const remainingCount = (player.remaining || []).length;
    const row = document.createElement("div");
    row.className = `result-row${isWinnerRow ? " is-winner" : ""}`;
    row.dataset.seat = String(player.seat);
    const name = document.createElement("strong");
    name.textContent = player.name;
    const cards = document.createElement("span");
    cards.className = "result-cards";
    for (const card of player.remaining || []) cards.append(renderCard(card, { mini: true }));
    if (player.saidUno && remainingCount > 0) {
      const pill = document.createElement("span");
      pill.className = "status-pill result-uno-pill";
      pill.textContent = "UNO";
      cards.append(pill);
    }
    const summaryText = document.createElement("span");
    summaryText.className = "result-score";
    if (isWinnerRow && remainingCount === 0) summaryText.textContent = "0 张 · 出完手牌";
    else if (isWinnerRow) summaryText.textContent = `${remainingCount} 张 · 手牌最少获胜`;
    else summaryText.textContent = `${remainingCount} 张`;
    row.append(name, cards, summaryText);
    list.append(row);
  }

  // ---- 操作按钮（转场 running 期间忽略重复点击，契约 §8.3 规则 6） ----
  const actions = document.createElement("div");
  actions.className = "result-actions";
  const guard = (type) => () => {
    if (isResultTransitionRunning()) return;
    onAction({ type });
  };
  const restart = document.createElement("button");
  restart.className = "btn btn-primary";
  restart.type = "button";
  restart.textContent = "再来一局";
  restart.setAttribute("aria-label", "再来一局");
  restart.addEventListener("click", guard("RESTART"));
  const lobby = document.createElement("button");
  lobby.className = "btn btn-ghost";
  lobby.type = "button";
  lobby.textContent = "回大厅";
  lobby.setAttribute("aria-label", "回大厅");
  lobby.addEventListener("click", guard("BACK_TO_LOBBY"));
  actions.append(restart, lobby);

  root.replaceChildren(header, summary, charts, list, actions);
  // 结算 DOM 就绪后启动飞牌转场（源 rect 由 render() 切屏前缓存；无效则静态降级）
  playResultTransition(winCard);
}
