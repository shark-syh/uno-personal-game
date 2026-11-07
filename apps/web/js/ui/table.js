import { renderPlayers } from "./players.js";
import { renderHand } from "./hand.js";
import { renderHud } from "./hud.js";

// N4a（v2.2 契约 §3.3）：#turn-stamp/#phase-label 改由 index.html 静态提供。
// ensureArena 只保留幂等装饰注入（内圈 arena-rail + 荧光轨道点 .arena-orbit），
// 原「缺失则创建 .table-status」分支删除（骨架里已无 #turn-stamp 于 table-center 内的旧结构）。
function ensureArena() {
  const area = document.querySelector("#table-area");
  if (!area) return;
  area.classList.add("arena");
  if (!area.querySelector(".arena-rail")) {
    const rail = document.createElement("div");
    rail.className = "arena-rail";
    rail.setAttribute("aria-hidden", "true");
    area.prepend(rail);
  }
  if (!area.querySelector(".arena-orbit")) {
    const orbit = document.createElement("span");
    orbit.className = "arena-orbit";
    orbit.setAttribute("aria-hidden", "true");
    area.querySelector("#table-center")?.append(orbit);
  }
}

// N4a（契约 §3.3/§7.2）：特殊阶段中文文案（#phase-label）；#turn-stamp 改纯行动者名。
const PHASE_LABELS = {
  "choose-color": () => "选择颜色",
  "stack-response": (view) => `叠牌响应 · +${view.table?.stack?.total || 0}`,
  "challenge-decide": () => "+4 挑战",
  "uno-window": () => "UNO 窗口",
};

// N4a（契约 §3.3）：phase → rail 步进条 done 数量映射（await-play 2 / 特殊阶段 3 / round-end 4）。
const PHASE_STEPS = {
  "await-play": 2,
  "choose-color": 3,
  "stack-response": 3,
  "challenge-decide": 3,
  "uno-window": 3,
  "round-end": 4,
};

// N4a（契约 Q3）：回合数 UI 派生——按 currentSeat/phase 变化计数，进对局归零，不入协议。
let turnCounter = 0;
let lastTurnKey = null;
export function resetTurnCounter() {
  turnCounter = 0;
  lastTurnKey = null;
}

function currentPlayer(view) {
  return view.players.find((player) => player.seat === view.currentSeat) || null;
}

// N4a/N4b（契约 §3.3/§7.2）：可出牌数——按「可出的不同卡牌」计数，
// 不是按合法动作计数：万能牌会为每种颜色各给一条 PLAY_CARD（同一 cardId 多条）。
function playableCount(view) {
  const cardTypes = ["PLAY_CARD", "PLAY_DRAWN", "STACK_PLAY"];
  const ids = new Set();
  for (const item of view.human?.legalActions || []) {
    if (cardTypes.includes(item.type) && !item.disabled && item.cardId) ids.add(item.cardId);
  }
  return ids.size;
}

function renderTurnStatus(view) {
  const humanSeat = view.human?.seat ?? 0;
  const current = currentPlayer(view);

  // 回合数：换「行动者 + 阶段」即 +1（进对局由 resetTurnCounter 归零）。
  const turnKey = `${view.currentSeat}-${view.phase}`;
  if (lastTurnKey !== null && turnKey !== lastTurnKey) turnCounter += 1;
  lastTurnKey = turnKey;

  // #turn-stamp（game-meta 左）：纯行动者名（行动中/思考中）。
  const stamp = document.querySelector("#turn-stamp");
  if (stamp) {
    if (current) {
      const who = current.seat === humanSeat ? "你" : current.name;
      stamp.textContent = current.thinking ? `${who} · 思考中` : who;
    } else {
      stamp.textContent = "";
    }
  }

  // phase-rail：大号回合数字 + 阶段文案 + 步进条。
  const railNo = document.querySelector("#rail-turn-no");
  const railPhase = document.querySelector("#rail-turn-phase");
  if (railNo) {
    const no = String(turnCounter).padStart(2, "0");
    railNo.textContent = no;
    railNo.setAttribute("aria-label", `第 ${turnCounter} 回合`);
  }
  if (railPhase) {
    railPhase.textContent = current
      ? current.seat === humanSeat
        ? "你的回合"
        : current.thinking
          ? "思考中"
          : `${current.name}的回合`
      : "";
  }
  const steps = document.querySelectorAll(".phase-rail .rail-step");
  const doneCount = PHASE_STEPS[view.phase] ?? 2;
  steps.forEach((step, index) => step.classList.toggle("done", index < doneCount));
  // 说明文字：步进条不是分段控件，用「阶段 x / 4」直白解释进度
  const stepLabel = document.querySelector("#rail-step-label");
  if (stepLabel) stepLabel.textContent = `阶段 ${doneCount} / 4`;

  // phase-banner 只承担特殊阶段中文提示：常规回合整条隐藏（避免 AI THINKING 之类常驻提示条），
  // 与 game-meta 的 #turn-stamp、phase-rail 不再重复。
  const playable = playableCount(view);
  const banner = document.querySelector("#phase-banner");
  const label = document.querySelector("#phase-label");
  const labelText = PHASE_LABELS[view.phase]?.(view) || "";
  if (label) {
    label.textContent = labelText;
    label.hidden = !labelText;
  }
  if (banner) banner.hidden = !labelText;

  // 手牌头 / #hand 数据属性（供 right-rail 与断言读取）。
  const handCount = (view.human?.hand || []).length;
  const handHeadCount = document.querySelector("#hand-head-count");
  const handHeadPlayable = document.querySelector("#hand-head-playable");
  if (handHeadCount) handHeadCount.textContent = String(handCount).padStart(2, "0");
  if (handHeadPlayable) handHeadPlayable.textContent = `${playable} 张可出`;
  const hand = document.querySelector("#hand");
  if (hand) {
    hand.dataset.playable = String(playable);
    hand.dataset.count = String(handCount);
  }

  // right-rail「CURRENT PRESSURE」：当前玩家手牌数 + 名字。
  const pressureCount = document.querySelector("#rail-pressure-count");
  const pressureName = document.querySelector("#rail-pressure-name");
  if (pressureCount) pressureCount.textContent = String(current?.handCount ?? 0);
  if (pressureName) {
    pressureName.textContent = current
      ? current.seat === humanSeat
        ? "你"
        : current.name
      : "—";
  }

  // right-rail「你的手牌 / 可出牌 / 牌堆剩余」。
  const railMyHand = document.querySelector("#rail-my-hand");
  const railPlayable = document.querySelector("#rail-playable");
  const railDrawCount = document.querySelector("#rail-draw-count");
  if (railMyHand) railMyHand.textContent = `${handCount} 张`;
  if (railPlayable) {
    railPlayable.textContent = `${playable} 张`;
    railPlayable.dataset.playable = String(playable);
  }
  if (railDrawCount) railDrawCount.textContent = String(view.table?.drawPileCount ?? 0);

  // right-rail「RECENT EVENTS」：上一手牌 / 上一位玩家 / 状态。
  const lastPlay = document.querySelector("#rail-last-play");
  const lastPlayer = document.querySelector("#rail-last-player");
  const lastStatus = document.querySelector("#rail-status");
  if (lastPlay) lastPlay.textContent = view.table?.discardTop ? cardLabel(view.table.discardTop) : "—";
  if (lastPlayer) {
    // 上一位出牌者：取最近一条 PLAY/COLOR_SET 事件的 seat；无则用弃牌来源兜底为「—」。
    const playEvents = [...(view.events || [])].reverse();
    const latest = playEvents.find((event) => ["PLAY", "PLAY_DRAWN", "STACK_PLAY"].includes(event.type));
    if (latest && latest.seat !== undefined) {
      const who = latest.seat === humanSeat ? "你" : (view.players.find((p) => p.seat === latest.seat)?.name || "玩家");
      lastPlayer.textContent = who;
    } else {
      lastPlayer.textContent = "—";
    }
  }
  if (lastStatus) {
    lastStatus.textContent = current
      ? current.thinking
        ? "思考中"
        : current.seat === humanSeat
          ? "你的回合"
          : "等待"
      : "—";
  }

  // game-meta 右：ROOM 标签。
  const room = document.querySelector("#game-room");
  if (room) room.textContent = `ROOM ${view.config?.playerCount ?? view.players.length}P`;
}

export function renderTable(view, context) {
  ensureArena();
  const gameScreen = document.querySelector("#game-screen");
  if (gameScreen) {
    gameScreen.dataset.phase = view.phase || "";
    gameScreen.dataset.currentSeat = String(view.currentSeat ?? "");
  }
  renderHud(view, context);
  renderPlayers(view);
  renderHand(view, context);
  renderTurnStatus(view);
  const feed = document.querySelector("#event-feed");
  const names = Object.fromEntries(view.players.map((player) => [player.seat, player.name]));
  const nameOf = (seat) => names[seat] || "玩家";
  const eventText = (event) => {
    switch (event.type) {
      case "DEAL": return `${nameOf(event.seat)} 起手 ${event.count} 张`;
      case "START_CARD": return `起始牌：${cardLabel(event.card)}`;
      case "START_CARD_IGNORED": return `起始牌 ${cardLabel(event.card)} 被忽略，重新翻牌`;
      case "PLAY": return `${nameOf(event.seat)} 打出 ${event.card ? cardLabel(event.card) : "一张牌"}`;
      case "DRAW": return `${nameOf(event.seat)} 摸了 ${event.count} 张`;
      case "COLOR_SET": return `${nameOf(event.seat)} 选择了${colorLabel(event.color)}`;
      case "SKIP": return `${nameOf(event.seat)} 被跳过`;
      case "REVERSE": return "方向改变";
      case "PILE_RESHUFFLE": return "牌堆重新洗牌";
      case "PLAYER_OUT": return `${nameOf(event.seat)} 出完了手牌`;
      case "ROUND_END": return event.winnerSeat === null
        ? (event.reason === "deck-empty" ? "牌堆耗尽，平局" : "平局")
        : event.reason === "deck-empty"
          ? `牌堆耗尽，${nameOf(event.winnerSeat)} 手牌最少获胜`
          : `${nameOf(event.winnerSeat)} 获胜`;
      case "STACK_PUSH": return `${nameOf(event.seat)} 叠牌，累计需摸 ${event.total} 张`;
      case "STACK_RESOLVE": return `${nameOf(event.seat)} 摸 ${event.total} 张（叠牌结算）`;
      case "CHALLENGE_SUCCESS": return `挑战成功：${nameOf(event.challenger)} 查看 ${nameOf(event.target)} 的手牌`;
      case "CHALLENGE_FAIL": return `挑战失败：${nameOf(event.challenger)} 摸 ${event.penalty} 张`;
      case "UNO_CALLED": return `${nameOf(event.seat)} 喊了 UNO`;
      case "UNO_CAUGHT": return `${nameOf(event.seat)} 被抓 UNO，罚 ${event.penalty} 张`;
      case "PENALTY": return `${nameOf(event.seat)} 被罚 ${event.count} 张`;
      default: return "牌桌状态更新";
    }
  };
  feed.replaceChildren(...(view.events || []).slice(-3).map((event) => { const node = document.createElement("div"); node.className = "event-item"; node.textContent = eventText(event); return node; }));
  const hint = document.querySelector("#hint-bar");
  hint.textContent = view.settings?.showHint === false ? "" : context.hintFor(view);
}

export function cardLabel(card) { if (!card) return ""; if (card.kind === "wild") return "万能牌"; if (card.kind === "wild4") return "+4"; if (card.kind === "draw2") return `${colorLabel(card.color)}+2`; if (card.kind === "reverse") return `${colorLabel(card.color)}反转`; if (card.kind === "skip") return `${colorLabel(card.color)}跳过`; return `${colorLabel(card.color)}${card.value}`; }
export function colorLabel(color) { return { red: "红色", yellow: "黄色", green: "绿色", blue: "蓝色" }[color] || ""; }
