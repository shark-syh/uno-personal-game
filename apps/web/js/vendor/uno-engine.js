/* 自动生成文件：npm run build:web-engine（源 packages/game-core + packages/ai），请勿手改。 */

// packages/game-core/src/config.ts
var DEFAULT_GAME_CONFIG = {
  playerCount: 4,
  humanSeat: 0,
  names: null,
  aiDifficulty: "realistic",
  aiMode: "auto",
  startingPlayer: "random",
  startCardRule: "classic",
  stacking: "loose",
  twoPlayerRules: true,
  deckExhaustion: "reshuffle",
  challengeWild4: true,
  wild4Legality: "color-only",
  unoPenalty: 2,
  autoCallUno: false,
  seed: void 0
};
var DIFFICULTIES = /* @__PURE__ */ new Set(["casual", "easy", "realistic", "hardcore"]);
var AI_MODES = /* @__PURE__ */ new Set(["zhipu", "local", "auto"]);
var STARTING_PLAYERS = /* @__PURE__ */ new Set(["random", "human"]);
var START_CARD_RULES = /* @__PURE__ */ new Set(["classic", "ignore-action"]);
var STACKING_MODES = /* @__PURE__ */ new Set(["loose", "classic", "none"]);
var DECK_EXHAUSTIONS = /* @__PURE__ */ new Set(["reshuffle", "end-by-fewest"]);
var WILD4_LEGALITIES = /* @__PURE__ */ new Set(["color-only", "new-version"]);
function normalizeGameConfig(partial = {}) {
  const merged = { ...DEFAULT_GAME_CONFIG, ...partial };
  if (!Number.isInteger(merged.playerCount) || merged.playerCount < 2 || merged.playerCount > 10) {
    throw new RangeError(`playerCount \u5FC5\u987B\u662F 2~10 \u7684\u6574\u6570\uFF0C\u6536\u5230 ${merged.playerCount}`);
  }
  if (!Number.isInteger(merged.humanSeat) || merged.humanSeat < 0 || merged.humanSeat >= merged.playerCount) {
    throw new RangeError(`humanSeat \u5FC5\u987B\u5728 0~${merged.playerCount - 1} \u4E4B\u95F4\uFF0C\u6536\u5230 ${merged.humanSeat}`);
  }
  if (merged.names && merged.names.length !== merged.playerCount) {
    throw new RangeError(`names \u957F\u5EA6\u5FC5\u987B\u7B49\u4E8E playerCount\uFF08${merged.playerCount}\uFF09\uFF0C\u6536\u5230 ${merged.names.length}`);
  }
  if (!DIFFICULTIES.has(merged.aiDifficulty)) {
    throw new RangeError(`\u672A\u77E5 AI \u96BE\u5EA6\uFF1A${merged.aiDifficulty}`);
  }
  if (!AI_MODES.has(merged.aiMode)) {
    throw new RangeError(`\u672A\u77E5 AI \u6A21\u5F0F\uFF1A${merged.aiMode}`);
  }
  if (!STARTING_PLAYERS.has(merged.startingPlayer)) {
    throw new RangeError(`\u672A\u77E5\u5148\u624B\u65B9\u5F0F\uFF1A${merged.startingPlayer}`);
  }
  if (!START_CARD_RULES.has(merged.startCardRule)) {
    throw new RangeError(`\u672A\u77E5\u8D77\u624B\u7FFB\u724C\u89C4\u5219\uFF1A${merged.startCardRule}`);
  }
  if (!STACKING_MODES.has(merged.stacking)) {
    throw new RangeError(`\u672A\u77E5\u53E0\u52A0\u6A21\u5F0F\uFF1A${merged.stacking}`);
  }
  if (!DECK_EXHAUSTIONS.has(merged.deckExhaustion)) {
    throw new RangeError(`\u672A\u77E5\u724C\u5806\u8017\u5C3D\u7B56\u7565\uFF1A${merged.deckExhaustion}`);
  }
  if (!WILD4_LEGALITIES.has(merged.wild4Legality)) {
    throw new RangeError(`\u672A\u77E5 Wild+4 \u5224\u5B9A\u53E3\u5F84\uFF1A${merged.wild4Legality}`);
  }
  if (!Number.isInteger(merged.unoPenalty) || merged.unoPenalty < 0) {
    throw new RangeError(`unoPenalty \u5FC5\u987B\u662F\u975E\u8D1F\u6574\u6570\uFF0C\u6536\u5230 ${merged.unoPenalty}`);
  }
  return { ...merged, names: merged.names ? [...merged.names] : null };
}

// packages/game-core/src/rng.ts
function hashSeed(input) {
  if (typeof input === "number" && Number.isFinite(input)) {
    return Math.trunc(input) >>> 0 || 2654435769;
  }
  const text = String(input);
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}
function createSeed() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function createRng(seedInput) {
  const seed = hashSeed(seedInput ?? createSeed());
  return { seed, value: seed };
}
function nextFloat(rng) {
  rng.value = rng.value + 1831565813 >>> 0;
  let t = rng.value;
  t = Math.imul(t ^ t >>> 15, t | 1);
  t ^= t + Math.imul(t ^ t >>> 7, t | 61);
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
function nextInt(rng, maxExclusive) {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new RangeError(`nextInt \u7684 maxExclusive \u5FC5\u987B\u662F\u6B63\u6574\u6570\uFF0C\u6536\u5230 ${maxExclusive}`);
  }
  return Math.floor(nextFloat(rng) * maxExclusive);
}
function shuffle(items, rng) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = nextInt(rng, i + 1);
    const current = result[i];
    result[i] = result[j];
    result[j] = current;
  }
  return result;
}

// packages/game-core/src/deck.ts
var ALL_COLORS = ["red", "yellow", "green", "blue"];
var COLOR_CODE = {
  red: "R",
  yellow: "Y",
  green: "G",
  blue: "B"
};
var COLOR_NAME = {
  red: "\u7EA2",
  yellow: "\u9EC4",
  green: "\u7EFF",
  blue: "\u84DD"
};
function createDeck() {
  const cards = [];
  const counters = /* @__PURE__ */ new Map();
  const push = (kind, color, value, faceCode) => {
    const index = counters.get(faceCode) ?? 0;
    counters.set(faceCode, index + 1);
    cards.push({ id: `${faceCode}#${index}`, kind, color, value, faceCode });
  };
  for (const color of ALL_COLORS) {
    const prefix = COLOR_CODE[color];
    push("number", color, 0, `${prefix}0`);
    for (let value = 1; value <= 9; value += 1) {
      for (let copy = 0; copy < 2; copy += 1) {
        push("number", color, value, `${prefix}${value}`);
      }
    }
    for (let copy = 0; copy < 2; copy += 1) {
      push("draw2", color, null, `${prefix}A2`);
      push("reverse", color, null, `${prefix}R`);
      push("skip", color, null, `${prefix}S`);
    }
  }
  for (let copy = 0; copy < 4; copy += 1) {
    push("wild", null, null, "WC");
    push("wild4", null, null, "W4");
  }
  if (cards.length !== 108) {
    throw new Error(`\u724C\u7EC4\u751F\u6210\u9519\u8BEF\uFF1A\u671F\u671B 108 \u5F20\uFF0C\u5B9E\u9645 ${cards.length} \u5F20`);
  }
  return cards;
}
function cardLabel(card) {
  if (card.kind === "wild") return "Wild";
  if (card.kind === "wild4") return "Wild+4";
  const color = card.color ? COLOR_NAME[card.color] : "";
  switch (card.kind) {
    case "number":
      return `${color}${card.value ?? ""}`;
    case "draw2":
      return `${color}+2`;
    case "reverse":
      return `${color}\u53CD\u8F6C`;
    case "skip":
      return `${color}\u8DF3\u8FC7`;
  }
}

// packages/game-core/src/setup.ts
var AI_NAME_POOL = ["\u8001\u738B", "\u5C0F\u7F8E", "\u963F\u5F3A", "\u963F\u73CD", "\u5927\u718A", "\u5C0F\u4E03", "\u963F\u9EC4", "\u8C46\u8C46", "\u94C1\u86CB"];
function nextSeat(seat, playerCount, direction) {
  return (seat + direction + playerCount) % playerCount;
}
function prevSeat(seat, playerCount) {
  return (seat - 1 + playerCount) % playerCount;
}
function buildPlayerNames(config) {
  const names = [];
  let aiIndex = 0;
  for (let seat = 0; seat < config.playerCount; seat += 1) {
    if (seat === config.humanSeat) {
      names.push("\u4F60");
    } else {
      names.push(AI_NAME_POOL[aiIndex % AI_NAME_POOL.length]);
      aiIndex += 1;
    }
  }
  return names;
}
function countCards(state) {
  return state.players.reduce((sum, player) => sum + player.hand.length, 0) + state.drawPile.length + state.discardPile.length;
}
function createInitialGame(partial = {}) {
  const config = normalizeGameConfig(partial);
  const rng = createRng(config.seed);
  const events = [];
  const players = buildPlayerNames(config).map((name, seat) => ({
    seat,
    name,
    isHuman: seat === config.humanSeat,
    hand: [],
    saidUno: false
  }));
  let drawPile = shuffle(createDeck(), rng);
  const drawCard = () => {
    const card = drawPile.pop();
    if (!card) throw new Error("\u62BD\u724C\u5806\u5DF2\u8017\u5C3D\uFF08\u5F00\u5C40\u9636\u6BB5\u4E0D\u5E94\u53D1\u751F\uFF09");
    return card;
  };
  for (let round = 0; round < 7; round += 1) {
    for (const player of players) {
      player.hand.push(drawCard());
    }
  }
  for (const player of players) {
    events.push({ type: "DEAL", seat: player.seat, count: player.hand.length });
  }
  const nominalFirst = config.startingPlayer === "human" ? config.humanSeat : nextInt(rng, config.playerCount);
  const dealerSeat = prevSeat(nominalFirst, config.playerCount);
  const ignoredCards = [];
  let startCard = null;
  let guard = 0;
  while (!startCard) {
    guard += 1;
    if (guard > 216) throw new Error("\u8D77\u624B\u7FFB\u724C\u5F02\u5E38\uFF1A\u8D85\u8FC7\u91CD\u7FFB\u4E0A\u9650");
    const candidate = drawCard();
    if (candidate.kind === "wild4") {
      drawPile.push(candidate);
      drawPile = shuffle(drawPile, rng);
      events.push({ type: "PILE_RESHUFFLE", reason: "wild4-start" });
      continue;
    }
    if (config.startCardRule === "ignore-action" && (candidate.kind === "skip" || candidate.kind === "reverse" || candidate.kind === "draw2")) {
      ignoredCards.push(candidate);
      events.push({ type: "START_CARD_IGNORED", card: candidate });
      continue;
    }
    startCard = candidate;
  }
  if (ignoredCards.length > 0) {
    drawPile = [...ignoredCards, ...drawPile];
    events.push({ type: "PILE_RESHUFFLE", reason: "ignore-action" });
  }
  const discardPile = [startCard];
  events.push({ type: "START_CARD", card: startCard });
  let direction = 1;
  let currentSeat = nominalFirst;
  let currentColor = null;
  let pendingColorChoiceSeat = null;
  let phase = "await-play";
  switch (startCard.kind) {
    case "number": {
      currentColor = startCard.color;
      break;
    }
    case "wild": {
      phase = "choose-color";
      pendingColorChoiceSeat = nominalFirst;
      currentSeat = nominalFirst;
      break;
    }
    case "skip": {
      currentColor = startCard.color;
      events.push({ type: "SKIP", seat: nominalFirst });
      currentSeat = nextSeat(nominalFirst, config.playerCount, direction);
      break;
    }
    case "reverse": {
      currentColor = startCard.color;
      direction = -1;
      events.push({ type: "REVERSE", direction });
      currentSeat = prevSeat(nominalFirst, config.playerCount);
      break;
    }
    case "draw2": {
      currentColor = startCard.color;
      const drawn = [drawCard(), drawCard()];
      players[nominalFirst].hand.push(...drawn);
      events.push({ type: "DRAW", seat: nominalFirst, count: drawn.length, cards: drawn });
      currentSeat = nextSeat(nominalFirst, config.playerCount, direction);
      break;
    }
    case "wild4": {
      throw new Error("\u8D77\u624B\u724C\u4E0D\u5E94\u8BE5\u662F Wild+4");
    }
  }
  return {
    config,
    phase,
    players,
    drawPile,
    discardPile,
    currentColor,
    currentSeat,
    direction,
    dealerSeat,
    pendingColorChoiceSeat,
    drawnThisTurn: null,
    stack: null,
    wild4Info: null,
    pendingChallenge: null,
    unoWindow: null,
    turnCount: 0,
    actionCount: 0,
    winnerSeat: null,
    endReason: null,
    events,
    history: [...events],
    rng
  };
}
function getTopCard(state) {
  const top = state.discardPile[state.discardPile.length - 1];
  if (!top) throw new Error("\u5F03\u724C\u5806\u4E3A\u7A7A");
  return top;
}

// packages/game-core/src/legal.ts
function topCard(state) {
  return state.discardPile[state.discardPile.length - 1] ?? null;
}
function isColor(value) {
  return typeof value === "string" && ALL_COLORS.includes(value);
}
function isPlayable(state, card) {
  if (card.kind === "wild" || card.kind === "wild4") return true;
  const top = topCard(state);
  if (!top) return false;
  if (state.currentColor !== null && card.color === state.currentColor) return true;
  if (top.kind === "number" && card.kind === "number" && card.value === top.value) return true;
  if ((top.kind === "skip" || top.kind === "reverse" || top.kind === "draw2") && card.kind === top.kind) {
    return true;
  }
  return false;
}
function hasPlayableCard(state, seat) {
  const player = state.players[seat];
  if (!player) return false;
  return player.hand.some((card) => isPlayable(state, card));
}
function isWild4Legal(state, seat) {
  const player = state.players[seat];
  if (!player) return true;
  const currentColor = state.currentColor;
  if (!currentColor) return true;
  const hasMatchingColor = player.hand.some((card) => card.color === currentColor);
  if (hasMatchingColor) return false;
  if (state.config.wild4Legality === "new-version") {
    const hasWild = player.hand.some((card) => card.kind === "wild");
    if (hasWild) return false;
  }
  return true;
}
function isStackableCard(card) {
  return card.kind === "draw2" || card.kind === "wild4";
}
function playActionsFor(card, type) {
  if (card.kind === "wild" || card.kind === "wild4") {
    return ALL_COLORS.map(
      (color) => type === "PLAY_CARD" ? { type: "PLAY_CARD", cardId: card.id, colorChoice: color } : { type: "PLAY_DRAWN", cardId: card.id, colorChoice: color }
    );
  }
  return type === "PLAY_CARD" ? [{ type: "PLAY_CARD", cardId: card.id }] : [{ type: "PLAY_DRAWN", cardId: card.id }];
}
function stackActionsFor(card) {
  if (card.kind === "wild4") {
    return ALL_COLORS.map((color) => ({
      type: "STACK_PLAY",
      cardId: card.id,
      colorChoice: color
    }));
  }
  return [{ type: "STACK_PLAY", cardId: card.id }];
}
function stackResponseActions(state) {
  const stack = state.stack;
  if (!stack) return [];
  const player = state.players[stack.awaitingSeat];
  if (!player) return [];
  const actions = [];
  for (const card of player.hand) {
    if (isStackableCard(card)) actions.push(...stackActionsFor(card));
  }
  actions.push({ type: "STACK_DECLINE" });
  return actions;
}
function challengeActions(state) {
  const pending = state.pendingChallenge;
  if (!pending || pending.challengerSeat !== state.currentSeat) return [];
  return [{ type: "CHALLENGE_W4" }, { type: "DECLINE_CHALLENGE" }];
}
function awaitPlayActions(state) {
  const player = state.players[state.currentSeat];
  if (!player) return [];
  const actions = [];
  if (state.drawnThisTurn) {
    if (isPlayable(state, state.drawnThisTurn)) {
      actions.push(...playActionsFor(state.drawnThisTurn, "PLAY_DRAWN"));
    }
    actions.push({ type: "END_TURN" });
    return actions;
  }
  for (const card of player.hand) {
    if (isPlayable(state, card)) {
      actions.push(...playActionsFor(card, "PLAY_CARD"));
    }
  }
  actions.push({ type: "DRAW" });
  return actions;
}
function getLegalActions(state) {
  switch (state.phase) {
    case "choose-color":
      return ALL_COLORS.map((color) => ({ type: "CHOOSE_COLOR", color }));
    case "stack-response":
      return stackResponseActions(state);
    case "challenge-decide":
      return challengeActions(state);
    case "uno-window": {
      const win = state.unoWindow;
      if (!win) return [];
      const actions = [];
      if (win.canCall) actions.push({ type: "CALL_UNO" });
      for (const targetSeat of win.canCatch) actions.push({ type: "CATCH_UNO", targetSeat });
      if (win.pendingPhase === "stack-response") actions.push(...stackResponseActions(state));
      else if (win.pendingPhase === "challenge-decide") actions.push(...challengeActions(state));
      else actions.push(...awaitPlayActions(state));
      return actions;
    }
    case "await-play":
      return awaitPlayActions(state);
    default:
      return [];
  }
}

// packages/game-core/src/engine.ts
var AI_UNO_CALL_CHANCE = {
  casual: 0.8,
  easy: 0.95,
  realistic: 1,
  hardcore: 1
};
var AI_UNO_CATCH_CHANCE = {
  casual: 0.1,
  easy: 0.4,
  realistic: 0.8,
  hardcore: 1
};
function cloneState(state) {
  return structuredClone(state);
}
function requirePlayer(state, seat) {
  const player = state.players[seat];
  if (!player) throw new Error(`\u5EA7\u4F4D ${seat} \u4E0D\u5B58\u5728`);
  return player;
}
function replenishDrawPile(state, events) {
  if (state.drawPile.length > 0) return true;
  if (state.discardPile.length <= 1) return false;
  const top = state.discardPile[state.discardPile.length - 1];
  const recyclable = state.discardPile.slice(0, -1);
  state.drawPile = shuffle(recyclable, state.rng);
  state.discardPile = [top];
  events.push({ type: "PILE_RESHUFFLE", reason: "draw" });
  return state.drawPile.length > 0;
}
function prepareDraw(state, events, allowRoundEnd = true) {
  if (state.drawPile.length > 0) return true;
  if (!allowRoundEnd) return replenishDrawPile(state, events);
  if (state.config.deckExhaustion === "end-by-fewest") {
    endRoundByFewestCards(state, events);
    return false;
  }
  if (!replenishDrawPile(state, events)) {
    endRoundByFewestCards(state, events);
    return false;
  }
  return state.drawPile.length > 0;
}
function drawTo(state, seat, count, events, options = {}) {
  const drawn = [];
  for (let index = 0; index < count; index += 1) {
    if (!prepareDraw(state, events, options.allowRoundEnd !== false)) break;
    const card = state.drawPile.pop();
    requirePlayer(state, seat).hand.push(card);
    drawn.push(card);
  }
  if (drawn.length > 0) {
    events.push({ type: "DRAW", seat, count: drawn.length, cards: drawn });
    if (requirePlayer(state, seat).hand.length > 1) requirePlayer(state, seat).saidUno = false;
  }
  return drawn;
}
function endRound(state, winnerSeat, events) {
  state.phase = "round-end";
  state.winnerSeat = winnerSeat;
  state.endReason = "empty-hand";
  state.pendingColorChoiceSeat = null;
  state.drawnThisTurn = null;
  state.stack = null;
  state.wild4Info = null;
  state.pendingChallenge = null;
  state.unoWindow = null;
  events.push({ type: "PLAYER_OUT", seat: winnerSeat });
  events.push({ type: "ROUND_END", winnerSeat, reason: "empty-hand" });
}
function endRoundByFewestCards(state, events) {
  let minCount = Number.POSITIVE_INFINITY;
  for (const player of state.players) minCount = Math.min(minCount, player.hand.length);
  const fewest = state.players.filter((player) => player.hand.length === minCount);
  const winnerSeat = fewest.length === 1 ? fewest[0].seat : null;
  state.phase = "round-end";
  state.winnerSeat = winnerSeat;
  state.endReason = "deck-empty";
  state.pendingColorChoiceSeat = null;
  state.drawnThisTurn = null;
  state.stack = null;
  state.wild4Info = null;
  state.pendingChallenge = null;
  state.unoWindow = null;
  events.push({ type: "ROUND_END", winnerSeat, reason: "deck-empty" });
}
function advanceTurn(state, skipNext = false) {
  const playerCount = state.players.length;
  let next = nextSeat(state.currentSeat, playerCount, state.direction);
  if (skipNext) next = nextSeat(next, playerCount, state.direction);
  state.currentSeat = next;
  state.phase = "await-play";
  state.drawnThisTurn = null;
  state.pendingChallenge = null;
  state.unoWindow = null;
  state.turnCount += 1;
}
function isStackingEnabled(state) {
  return state.config.stacking !== "none";
}
function startStack(state, card, events) {
  const actor = state.currentSeat;
  const topColor = state.currentColor;
  if (!topColor) throw new Error("\u53E0\u724C\u94FE\u9700\u8981\u5DF2\u7ECF\u786E\u5B9A\u7684\u989C\u8272");
  const awaitingSeat = nextSeat(actor, state.players.length, state.direction);
  state.stack = {
    total: card.kind === "draw2" ? 2 : 4,
    chain: [card],
    lastPlayer: actor,
    topColor,
    awaitingSeat
  };
  state.phase = "stack-response";
  state.currentSeat = awaitingSeat;
  state.drawnThisTurn = null;
  events.push({ type: "STACK_PUSH", seat: actor, card, total: state.stack.total });
}
function resolveStackDraw(state, events) {
  const stack = state.stack;
  if (!stack) throw new Error("\u5F53\u524D\u6CA1\u6709\u53E0\u724C\u94FE");
  const drawerSeat = stack.awaitingSeat;
  const total = stack.total;
  state.stack = null;
  events.push({ type: "STACK_RESOLVE", seat: drawerSeat, total });
  drawTo(state, drawerSeat, total, events);
  state.wild4Info = null;
  if (state.phase === "round-end") return;
  state.currentSeat = nextSeat(drawerSeat, state.players.length, state.direction);
  state.phase = "await-play";
  state.drawnThisTurn = null;
  state.turnCount += 1;
}
function shouldOfferChallenge(state) {
  if (!state.config.challengeWild4) return false;
  const stack = state.stack;
  const info = state.wild4Info;
  if (!stack || !info || stack.chain.length !== 1) return false;
  if (stack.chain[0]?.kind !== "wild4") return false;
  return info.challengeable && info.seat === stack.lastPlayer;
}
function enterChallengeDecide(state) {
  const stack = state.stack;
  if (!stack) throw new Error("\u5F53\u524D\u6CA1\u6709\u53E0\u724C\u94FE");
  const challengerSeat = stack.awaitingSeat;
  const targetSeat = stack.lastPlayer;
  state.stack = null;
  state.pendingChallenge = { challengerSeat, targetSeat, total: 4 };
  state.phase = "challenge-decide";
  state.currentSeat = challengerSeat;
  state.drawnThisTurn = null;
}
function resolveChallengeSuccess(state, events) {
  const pending = state.pendingChallenge;
  if (!pending) throw new Error("\u5F53\u524D\u6CA1\u6709 +4 \u6311\u6218\u7A97\u53E3");
  const challenger = requirePlayer(state, pending.challengerSeat);
  const target = requirePlayer(state, pending.targetSeat);
  const hand = challenger.isHuman ? target.hand.map((card) => ({ ...card })) : void 0;
  events.push({
    type: "CHALLENGE_SUCCESS",
    challenger: pending.challengerSeat,
    target: pending.targetSeat,
    ...hand ? { hand } : {}
  });
  state.pendingChallenge = null;
  state.wild4Info = null;
  state.drawnThisTurn = null;
  drawTo(state, pending.targetSeat, 4, events);
  if (state.phase === "round-end") return;
  state.phase = "await-play";
  state.currentSeat = pending.challengerSeat;
  state.turnCount += 1;
}
function resolveChallengeFail(state, events) {
  const pending = state.pendingChallenge;
  if (!pending) throw new Error("\u5F53\u524D\u6CA1\u6709 +4 \u6311\u6218\u7A97\u53E3");
  const penalty = 6;
  events.push({
    type: "CHALLENGE_FAIL",
    challenger: pending.challengerSeat,
    target: pending.targetSeat,
    penalty
  });
  state.pendingChallenge = null;
  state.wild4Info = null;
  state.drawnThisTurn = null;
  drawTo(state, pending.challengerSeat, penalty, events);
  if (state.phase === "round-end") return;
  state.phase = "await-play";
  state.currentSeat = nextSeat(pending.challengerSeat, state.players.length, state.direction);
  state.turnCount += 1;
}
function resolveChallengeDecline(state, events) {
  const pending = state.pendingChallenge;
  if (!pending) throw new Error("\u5F53\u524D\u6CA1\u6709 +4 \u6311\u6218\u7A97\u53E3");
  state.pendingChallenge = null;
  state.wild4Info = null;
  state.drawnThisTurn = null;
  drawTo(state, pending.challengerSeat, pending.total, events);
  if (state.phase === "round-end") return;
  state.phase = "await-play";
  state.currentSeat = nextSeat(pending.challengerSeat, state.players.length, state.direction);
  state.turnCount += 1;
}
function openUnoWindow(state, seat, pendingPhase) {
  const player = requirePlayer(state, seat);
  state.unoWindow = {
    seat,
    canCatch: seat === state.config.humanSeat ? [] : [seat],
    canCall: player.isHuman && !state.config.autoCallUno,
    pendingPhase
  };
  state.phase = "uno-window";
}
function handleUnoAfterPlay(state, actor, pendingPhase, events) {
  const player = requirePlayer(state, actor);
  if (player.hand.length !== 1) return;
  player.saidUno = false;
  if (player.isHuman && !state.config.autoCallUno) {
    openUnoWindow(state, actor, pendingPhase);
    return;
  }
  const callChance = state.config.autoCallUno ? 1 : AI_UNO_CALL_CHANCE[state.config.aiDifficulty];
  if (callChance >= 1 || nextFloat(state.rng) < callChance) {
    player.saidUno = true;
    events.push({ type: "UNO_CALLED", seat: actor });
    return;
  }
  openUnoWindow(state, actor, pendingPhase);
}
function penalizeUno(state, seat, events) {
  const penalty = state.config.unoPenalty;
  events.push({ type: "UNO_CAUGHT", seat, penalty });
  drawTo(state, seat, penalty, events);
  requirePlayer(state, seat).saidUno = false;
}
function closeUnoWindow(state, events) {
  const win = state.unoWindow;
  if (!win) return;
  state.unoWindow = null;
  state.phase = win.pendingPhase;
  const target = requirePlayer(state, win.seat);
  if (target.saidUno) return;
  const catchChance = AI_UNO_CATCH_CHANCE[state.config.aiDifficulty];
  let catcherSeat = win.seat;
  for (let step = 1; step < state.players.length; step += 1) {
    catcherSeat = nextSeat(catcherSeat, state.players.length, state.direction);
    const catcher = requirePlayer(state, catcherSeat);
    if (catcher.isHuman) continue;
    if (catchChance >= 1 || nextFloat(state.rng) < catchChance) {
      penalizeUno(state, win.seat, events);
      return;
    }
  }
}
function playStackCard(state, card, colorChoice, events) {
  const stack = state.stack;
  if (!stack) throw new Error("\u5F53\u524D\u6CA1\u6709\u53E0\u724C\u94FE");
  const actor = state.currentSeat;
  if (actor !== stack.awaitingSeat) throw new Error("\u8FD8\u6CA1\u8F6E\u5230\u8BE5\u73A9\u5BB6\u54CD\u5E94\u53E0\u724C");
  const player = requirePlayer(state, actor);
  const isWild4Card = card.kind === "wild4";
  let chosenColor = null;
  if (isWild4Card) {
    if (!isColor(colorChoice)) throw new Error("Wild+4 \u53E0\u724C\u5FC5\u987B\u9009\u62E9\u4E00\u4E2A\u5408\u6CD5\u989C\u8272");
    chosenColor = colorChoice;
  }
  const previousColor = state.currentColor;
  const wild4WasLegal = isWild4Card ? isWild4Legal(state, actor) : true;
  const handIndex = player.hand.findIndex((item) => item.id === card.id);
  if (handIndex < 0) throw new Error("\u624B\u724C\u4E2D\u6CA1\u6709\u8FD9\u5F20\u724C");
  player.hand.splice(handIndex, 1);
  state.discardPile.push(card);
  events.push({ type: "PLAY", seat: actor, card });
  if (isWild4Card && chosenColor) {
    state.currentColor = chosenColor;
    events.push({ type: "COLOR_SET", seat: actor, color: chosenColor });
    state.wild4Info = {
      seat: actor,
      wasLegal: wild4WasLegal,
      previousColor,
      challengeable: false,
      turn: state.turnCount
    };
  } else if (card.color) {
    state.currentColor = card.color;
  }
  stack.total += card.kind === "draw2" ? 2 : 4;
  stack.chain.push(card);
  stack.lastPlayer = actor;
  if (!state.currentColor) throw new Error("\u53E0\u724C\u94FE\u989C\u8272\u5F02\u5E38");
  stack.topColor = state.currentColor;
  const next = nextSeat(actor, state.players.length, state.direction);
  stack.awaitingSeat = next;
  state.currentSeat = next;
  events.push({ type: "STACK_PUSH", seat: actor, card, total: stack.total });
  if (player.hand.length === 0) {
    const victimSeat = next;
    const total = stack.total;
    state.stack = null;
    events.push({ type: "STACK_RESOLVE", seat: victimSeat, total });
    drawTo(state, victimSeat, total, events, { allowRoundEnd: false });
    endRound(state, actor, events);
    return;
  }
  if (player.hand.length === 1) handleUnoAfterPlay(state, actor, "stack-response", events);
}
function playCard(state, card, colorChoice, events) {
  const actor = state.currentSeat;
  const player = requirePlayer(state, actor);
  const previousColor = state.currentColor;
  const wild4WasLegal = card.kind === "wild4" ? isWild4Legal(state, actor) : true;
  const handIndex = player.hand.findIndex((item) => item.id === card.id);
  if (handIndex < 0) throw new Error("\u624B\u724C\u4E2D\u6CA1\u6709\u8FD9\u5F20\u724C");
  player.hand.splice(handIndex, 1);
  state.discardPile.push(card);
  events.push({ type: "PLAY", seat: actor, card });
  if (card.kind === "wild" || card.kind === "wild4") {
    if (!isColor(colorChoice)) throw new Error("Wild \u724C\u5FC5\u987B\u9009\u62E9\u4E00\u4E2A\u5408\u6CD5\u989C\u8272");
    state.currentColor = colorChoice;
    events.push({ type: "COLOR_SET", seat: actor, color: colorChoice });
  } else if (card.color) {
    state.currentColor = card.color;
  }
  if (card.kind === "wild4") {
    state.wild4Info = {
      seat: actor,
      wasLegal: wild4WasLegal,
      previousColor,
      challengeable: true,
      turn: state.turnCount
    };
  }
  const victim = nextSeat(actor, state.players.length, state.direction);
  let skipNext = false;
  switch (card.kind) {
    case "number":
    case "wild": {
      break;
    }
    case "skip": {
      events.push({ type: "SKIP", seat: victim });
      skipNext = true;
      break;
    }
    case "reverse": {
      state.direction = state.direction === 1 ? -1 : 1;
      events.push({ type: "REVERSE", direction: state.direction });
      if (state.players.length === 2 && state.config.twoPlayerRules) {
        events.push({ type: "SKIP", seat: victim });
        skipNext = true;
      }
      break;
    }
    case "draw2": {
      if (isStackingEnabled(state)) {
        startStack(state, card, events);
      } else {
        drawTo(state, victim, 2, events);
        events.push({ type: "SKIP", seat: victim });
        skipNext = true;
      }
      break;
    }
    case "wild4": {
      if (isStackingEnabled(state)) {
        startStack(state, card, events);
      } else if (state.config.challengeWild4 && player.hand.length > 0) {
        state.pendingChallenge = {
          challengerSeat: victim,
          targetSeat: actor,
          total: 4
        };
        state.phase = "challenge-decide";
        state.currentSeat = victim;
        state.drawnThisTurn = null;
      } else {
        drawTo(state, victim, 4, events);
        events.push({ type: "SKIP", seat: victim });
        skipNext = true;
      }
      break;
    }
  }
  if (state.phase === "round-end") return;
  if (player.hand.length === 0) {
    if (state.stack) {
      const pending = state.stack;
      const victimSeat = pending.awaitingSeat;
      const total = pending.total;
      state.stack = null;
      events.push({ type: "STACK_RESOLVE", seat: victimSeat, total });
      drawTo(state, victimSeat, total, events, { allowRoundEnd: false });
    }
    endRound(state, actor, events);
    return;
  }
  if (state.phase === "stack-response") {
    handleUnoAfterPlay(state, actor, "stack-response", events);
    return;
  }
  if (state.phase === "challenge-decide") {
    handleUnoAfterPlay(state, actor, "challenge-decide", events);
    return;
  }
  advanceTurn(state, skipNext);
  handleUnoAfterPlay(state, actor, "await-play", events);
}
function applyAction(state, action) {
  const next = cloneState(state);
  const events = [];
  next.events = events;
  if (next.phase === "round-end") {
    throw new Error("\u5BF9\u5C40\u5DF2\u7ED3\u675F\uFF0C\u4E0D\u80FD\u518D\u6267\u884C\u52A8\u4F5C");
  }
  next.actionCount += 1;
  if (next.phase === "uno-window" && next.unoWindow && action.type !== "CALL_UNO" && action.type !== "CATCH_UNO") {
    closeUnoWindow(next, events);
    if (next.endReason !== null) {
      next.history.push(...events);
      return { state: next, events };
    }
  }
  switch (action.type) {
    case "CHOOSE_COLOR": {
      if (next.phase !== "choose-color" || next.pendingColorChoiceSeat !== next.currentSeat) {
        throw new Error("\u5F53\u524D\u4E0D\u9700\u8981\u9009\u62E9\u989C\u8272");
      }
      if (!isColor(action.color)) throw new Error("\u975E\u6CD5\u989C\u8272");
      next.currentColor = action.color;
      next.pendingColorChoiceSeat = null;
      next.phase = "await-play";
      events.push({ type: "COLOR_SET", seat: next.currentSeat, color: action.color });
      break;
    }
    case "DRAW": {
      if (next.phase !== "await-play") throw new Error("\u5F53\u524D\u9636\u6BB5\u4E0D\u80FD\u62BD\u724C");
      if (next.drawnThisTurn) throw new Error("\u672C\u56DE\u5408\u5DF2\u7ECF\u62BD\u8FC7\u724C\uFF0C\u8BF7\u6253\u51FA\u62BD\u5230\u7684\u724C\u6216\u7ED3\u675F\u56DE\u5408");
      const seat = next.currentSeat;
      const drawn = drawTo(next, seat, 1, events);
      if (drawn.length === 0) break;
      const card = drawn[0];
      if (isPlayable(next, card)) {
        next.drawnThisTurn = card;
        next.phase = "await-play";
      } else {
        advanceTurn(next);
      }
      break;
    }
    case "PLAY_CARD": {
      if (next.phase !== "await-play") throw new Error("\u5F53\u524D\u9636\u6BB5\u4E0D\u80FD\u51FA\u724C");
      if (next.drawnThisTurn) throw new Error("\u5DF2\u62BD\u724C\uFF1A\u53EA\u80FD\u6253\u51FA\u521A\u62BD\u5230\u7684\u724C\u6216\u7ED3\u675F\u56DE\u5408");
      const player = requirePlayer(next, next.currentSeat);
      const card = player.hand.find((item) => item.id === action.cardId);
      if (!card) throw new Error("\u624B\u724C\u4E2D\u6CA1\u6709\u8FD9\u5F20\u724C");
      if (!isPlayable(next, card)) throw new Error("\u8FD9\u5F20\u724C\u5F53\u524D\u4E0D\u53EF\u51FA");
      if ((card.kind === "wild" || card.kind === "wild4") && (!isColor(action.colorChoice) || !ALL_COLORS.includes(action.colorChoice))) {
        throw new Error("\u51FA\u4E07\u80FD\u724C\u5FC5\u987B\u9009\u62E9\u989C\u8272");
      }
      playCard(next, card, action.colorChoice, events);
      break;
    }
    case "PLAY_DRAWN": {
      if (next.phase !== "await-play" || !next.drawnThisTurn) {
        throw new Error("\u5F53\u524D\u6CA1\u6709\u53EF\u6253\u51FA\u7684\u62BD\u724C");
      }
      const card = next.drawnThisTurn;
      if (card.id !== action.cardId) throw new Error("\u53EA\u80FD\u6253\u51FA\u521A\u62BD\u5230\u7684\u90A3\u5F20\u724C");
      if (!isPlayable(next, card)) throw new Error("\u521A\u62BD\u5230\u7684\u724C\u5F53\u524D\u4E0D\u53EF\u51FA");
      if ((card.kind === "wild" || card.kind === "wild4") && (!isColor(action.colorChoice) || !ALL_COLORS.includes(action.colorChoice))) {
        throw new Error("\u51FA\u4E07\u80FD\u724C\u5FC5\u987B\u9009\u62E9\u989C\u8272");
      }
      next.drawnThisTurn = null;
      playCard(next, card, action.colorChoice, events);
      break;
    }
    case "END_TURN": {
      if (next.phase !== "await-play") throw new Error("\u5F53\u524D\u9636\u6BB5\u4E0D\u80FD\u7ED3\u675F\u56DE\u5408");
      if (!next.drawnThisTurn) throw new Error("\u672C\u56DE\u5408\u6CA1\u6709\u62BD\u724C\uFF0C\u4E0D\u80FD\u7ED3\u675F\u56DE\u5408");
      next.drawnThisTurn = null;
      advanceTurn(next);
      break;
    }
    case "STACK_PLAY": {
      if (next.phase !== "stack-response" || !next.stack) {
        throw new Error("\u5F53\u524D\u4E0D\u662F\u53E0\u724C\u54CD\u5E94\u9636\u6BB5");
      }
      const player = requirePlayer(next, next.currentSeat);
      const card = player.hand.find((item) => item.id === action.cardId);
      if (!card) throw new Error("\u624B\u724C\u4E2D\u6CA1\u6709\u8FD9\u5F20\u724C");
      if (card.kind !== "draw2" && card.kind !== "wild4") {
        throw new Error("\u53E0\u724C\u54CD\u5E94\u9636\u6BB5\u53EA\u80FD\u6253\u51FA +2 \u6216 +4");
      }
      playStackCard(next, card, action.colorChoice, events);
      break;
    }
    case "STACK_DECLINE": {
      if (next.phase !== "stack-response" || !next.stack) {
        throw new Error("\u5F53\u524D\u4E0D\u662F\u53E0\u724C\u54CD\u5E94\u9636\u6BB5");
      }
      if (shouldOfferChallenge(next)) {
        enterChallengeDecide(next);
      } else {
        resolveStackDraw(next, events);
      }
      break;
    }
    case "CHALLENGE_W4": {
      if (next.phase !== "challenge-decide" || !next.pendingChallenge) {
        throw new Error("\u5F53\u524D\u4E0D\u662F +4 \u6311\u6218\u7A97\u53E3");
      }
      if (next.currentSeat !== next.pendingChallenge.challengerSeat) {
        throw new Error("\u4E0D\u662F\u4F60\u7684\u6311\u6218\u56DE\u5408");
      }
      const info = next.wild4Info;
      if (!info || !info.challengeable || info.seat !== next.pendingChallenge.targetSeat) {
        throw new Error("\u5F53\u524D\u6CA1\u6709\u53EF\u6311\u6218\u7684 Wild+4");
      }
      if (info.wasLegal) {
        resolveChallengeFail(next, events);
      } else {
        resolveChallengeSuccess(next, events);
      }
      break;
    }
    case "DECLINE_CHALLENGE": {
      if (next.phase !== "challenge-decide" || !next.pendingChallenge) {
        throw new Error("\u5F53\u524D\u4E0D\u662F +4 \u6311\u6218\u7A97\u53E3");
      }
      if (next.currentSeat !== next.pendingChallenge.challengerSeat) {
        throw new Error("\u4E0D\u662F\u4F60\u7684\u6311\u6218\u56DE\u5408");
      }
      resolveChallengeDecline(next, events);
      break;
    }
    case "CALL_UNO": {
      const win = next.unoWindow;
      if (next.phase !== "uno-window" || !win) throw new Error("\u5F53\u524D\u4E0D\u662F UNO \u7A97\u53E3");
      if (!win.canCall) throw new Error("\u5F53\u524D\u4E0D\u80FD\u558A UNO");
      const player = requirePlayer(next, win.seat);
      if (player.saidUno) throw new Error("\u5DF2\u7ECF\u558A\u8FC7 UNO");
      player.saidUno = true;
      events.push({ type: "UNO_CALLED", seat: win.seat });
      next.unoWindow = null;
      next.phase = win.pendingPhase;
      break;
    }
    case "CATCH_UNO": {
      const win = next.unoWindow;
      if (next.phase !== "uno-window" || !win) throw new Error("\u5F53\u524D\u4E0D\u662F UNO \u7A97\u53E3");
      if (action.targetSeat !== win.seat) throw new Error("\u53EA\u80FD\u6293\u5F53\u524D\u5FD8\u558A UNO \u7684\u73A9\u5BB6");
      if (win.seat === next.config.humanSeat) throw new Error("\u4E0D\u80FD\u6293\u81EA\u5DF1");
      const target = requirePlayer(next, win.seat);
      if (target.saidUno) throw new Error("\u8BE5\u73A9\u5BB6\u5DF2\u7ECF\u558A\u8FC7 UNO");
      penalizeUno(next, win.seat, events);
      next.unoWindow = null;
      if (next.endReason === null) next.phase = win.pendingPhase;
      break;
    }
    default: {
      throw new Error(`\u672A\u77E5\u52A8\u4F5C\u7C7B\u578B: ${action.type}`);
    }
  }
  next.history.push(...events);
  return { state: next, events };
}
function isGameOver(state) {
  return state.phase === "round-end";
}
function isTerminal(state) {
  return isGameOver(state);
}

// packages/game-core/src/result.ts
function cardScore(card) {
  if (card.kind === "wild" || card.kind === "wild4") return 50;
  if (card.kind === "number") return card.value ?? 0;
  return 20;
}
function scoreHand(cards) {
  return cards.reduce((sum, card) => sum + cardScore(card), 0);
}
function getResult(state, options = {}) {
  if (state.phase !== "round-end") throw new Error("\u5BF9\u5C40\u5C1A\u672A\u7ED3\u675F\uFF0C\u65E0\u6CD5\u751F\u6210\u7ED3\u7B97\u6570\u636E");
  const players = state.players.map((player) => ({
    seat: player.seat,
    name: player.name,
    isHuman: player.isHuman,
    remaining: player.hand.map((card) => ({ ...card })),
    score: scoreHand(player.hand),
    saidUno: player.saidUno
  }));
  let draws = 0;
  let plays = 0;
  let stackPlays = 0;
  let unoCalls = 0;
  for (const event of state.history) {
    if (event.type === "DRAW") draws += event.count;
    else if (event.type === "PLAY") plays += 1;
    else if (event.type === "STACK_PUSH") stackPlays += 1;
    else if (event.type === "UNO_CALLED") unoCalls += 1;
  }
  return {
    winnerSeat: state.winnerSeat,
    isDraw: state.winnerSeat === null,
    reason: state.endReason ?? "empty-hand",
    players,
    turns: state.turnCount,
    actions: state.actionCount,
    draws,
    plays,
    stackPlays,
    unoCalls,
    durationMs: options.durationMs ?? 0
  };
}

// packages/game-core/src/public-view.ts
var DEFAULT_VIEW_SETTINGS = {
  autoCallUno: false,
  aiSpeed: "normal",
  sound: true,
  animation: true,
  showHint: true,
  aiChatter: true
};
function createLobbyView(config = {}, settings = {}) {
  return {
    mock: false,
    screen: "lobby",
    phase: "lobby",
    config: {
      playerCount: config.playerCount ?? 4,
      difficulty: config.difficulty ?? "realistic",
      aiMode: config.aiMode ?? "auto",
      challengeWild4: config.challengeWild4 ?? true
    },
    currentSeat: 0,
    direction: 1,
    currentColor: null,
    players: [],
    human: {
      seat: 0,
      hand: [],
      legalActions: [],
      drawnThisTurn: null,
      mustRespondStack: false,
      canCallUno: false,
      canCatch: [],
      pendingChallenge: null
    },
    table: {
      discardTop: null,
      discardTop3: [],
      drawPileCount: 0,
      stack: null,
      pendingColorChoice: false,
      winnerSeat: null
    },
    events: [],
    result: null,
    settings: { ...DEFAULT_VIEW_SETTINGS, ...settings },
    dev: {}
  };
}
function sanitizeEventsForSeat(events, seat) {
  return events.map((event) => {
    if (event.type === "DRAW") {
      if (event.seat === seat) return event;
      return { type: "DRAW", seat: event.seat, count: event.count, cards: [] };
    }
    if (event.type === "CHALLENGE_SUCCESS") {
      if (event.challenger === seat && event.hand) {
        return {
          type: "CHALLENGE_SUCCESS",
          challenger: event.challenger,
          target: event.target,
          hand: event.hand.map((card) => ({ ...card }))
        };
      }
      return { type: "CHALLENGE_SUCCESS", challenger: event.challenger, target: event.target };
    }
    return event;
  });
}
function labelFor(action, card, state) {
  switch (action.type) {
    case "PLAY_CARD":
    case "PLAY_DRAWN":
    case "STACK_PLAY": {
      const prefix = action.type === "STACK_PLAY" ? "\u53E0 " : action.type === "PLAY_DRAWN" ? "\u51FA " : "\u51FA ";
      if (!card) return `${prefix}\u4E00\u5F20\u724C`;
      if (action.colorChoice)
        return `${prefix}${cardLabel(card)} \xB7 ${COLOR_NAME[action.colorChoice]}`;
      return `${prefix}${cardLabel(card)}`;
    }
    case "DRAW":
      return "\u6478 1 \u5F20";
    case "END_TURN":
      return "\u7ED3\u675F\u56DE\u5408";
    case "CHOOSE_COLOR":
      return `${COLOR_NAME[action.color]}\u8272`;
    case "STACK_DECLINE":
      return `\u653E\u5F03\u53E0\u724C\uFF08\u6478 ${state.stack?.total ?? 0} \u5F20\uFF09`;
    case "CHALLENGE_W4":
      return "\u6311\u6218\uFF01\u67E5\u770B\u624B\u724C";
    case "DECLINE_CHALLENGE":
      return "\u6478 4 \u5F20";
    case "CALL_UNO":
      return "UNO!";
    case "CATCH_UNO":
      return "\u6293\u4ED6\uFF01";
    default:
      return "\u64CD\u4F5C";
  }
}
function hintFor(action, state) {
  switch (action.type) {
    case "PLAY_CARD":
    case "PLAY_DRAWN": {
      return "\u9AD8\u4EAE\u7684\u724C\u53EF\u4EE5\u6253\u51FA\uFF0C\u70B9\u51FB\u76F4\u63A5\u51FA\u724C";
    }
    case "STACK_PLAY":
      return `\u7EE7\u7EED\u53E0\u724C\uFF0C\u8BA9\u4E0B\u5BB6\u6478 ${(state.stack?.total ?? 0) + 2} \u5F20\u4EE5\u4E0A`;
    case "DRAW":
      return "\u6CA1\u6709\u5408\u9002\u7684\u724C\uFF1F\u6478\u4E00\u5F20";
    case "END_TURN":
      return "\u7ED3\u675F\u672C\u56DE\u5408";
    case "CHOOSE_COLOR":
      return "\u8BF7\u9009\u62E9\u4E07\u80FD\u724C\u7684\u989C\u8272";
    case "STACK_DECLINE":
      return `\u653E\u5F03\u53E0\u724C\uFF0C\u6478 ${state.stack?.total ?? 0} \u5F20`;
    case "CHALLENGE_W4":
      return "\u6000\u7591\u4E0A\u5BB6 +4 \u8FDD\u89C4\uFF1F\u6311\u6218\u5E76\u67E5\u770B\u4ED6\u7684\u624B\u724C";
    case "DECLINE_CHALLENGE":
      return "\u63A5\u53D7 +4\uFF0C\u6478 4 \u5F20\u5E76\u5931\u53BB\u56DE\u5408";
    case "CALL_UNO":
      return "\u53EA\u5269\u6700\u540E\u4E00\u5F20\uFF0C\u5FEB\u558A UNO";
    case "CATCH_UNO":
      return "\u53D1\u73B0\u6709\u4EBA\u5FD8\u4E86\u558A UNO\uFF0C\u6293\u4F4F\u4ED6";
    default:
      return "";
  }
}
function cardForAction(action, state) {
  if (action.type === "PLAY_CARD" || action.type === "STACK_PLAY") {
    return state.players[state.currentSeat]?.hand.find((card) => card.id === action.cardId) ?? null;
  }
  if (action.type === "PLAY_DRAWN") return state.drawnThisTurn;
  return null;
}
function idFor(action) {
  switch (action.type) {
    case "PLAY_CARD":
      return `play:${action.cardId}:${action.colorChoice ?? "-"}`;
    case "PLAY_DRAWN":
      return `play-drawn:${action.cardId}:${action.colorChoice ?? "-"}`;
    case "STACK_PLAY":
      return `stack:${action.cardId}:${action.colorChoice ?? "-"}`;
    case "CHOOSE_COLOR":
      return `choose-color:${action.color}`;
    case "CATCH_UNO":
      return `catch:${action.targetSeat}`;
    default:
      return action.type.toLowerCase();
  }
}
function toUiAction(action, state) {
  const card = cardForAction(action, state);
  const uiAction = {
    id: idFor(action),
    type: action.type,
    label: labelFor(action, card, state),
    disabled: false,
    hint: hintFor(action, state)
  };
  if ("cardId" in action) uiAction.cardId = action.cardId;
  if ("colorChoice" in action && action.colorChoice) uiAction.colorChoice = action.colorChoice;
  if ("color" in action) uiAction.color = action.color;
  if ("targetSeat" in action) uiAction.targetSeat = action.targetSeat;
  return uiAction;
}
function toEngineAction(uiAction) {
  switch (uiAction.type) {
    case "PLAY_CARD":
      if (!uiAction.cardId) throw new Error("PLAY_CARD \u7F3A\u5C11 cardId");
      return {
        type: "PLAY_CARD",
        cardId: uiAction.cardId,
        ...uiAction.colorChoice ? { colorChoice: uiAction.colorChoice } : {}
      };
    case "PLAY_DRAWN":
      if (!uiAction.cardId) throw new Error("PLAY_DRAWN \u7F3A\u5C11 cardId");
      return {
        type: "PLAY_DRAWN",
        cardId: uiAction.cardId,
        ...uiAction.colorChoice ? { colorChoice: uiAction.colorChoice } : {}
      };
    case "STACK_PLAY":
      if (!uiAction.cardId) throw new Error("STACK_PLAY \u7F3A\u5C11 cardId");
      return {
        type: "STACK_PLAY",
        cardId: uiAction.cardId,
        ...uiAction.colorChoice ? { colorChoice: uiAction.colorChoice } : {}
      };
    case "CHOOSE_COLOR":
      if (!uiAction.color) throw new Error("CHOOSE_COLOR \u7F3A\u5C11 color");
      return { type: "CHOOSE_COLOR", color: uiAction.color };
    case "CATCH_UNO":
      if (uiAction.targetSeat === void 0) throw new Error("CATCH_UNO \u7F3A\u5C11 targetSeat");
      return { type: "CATCH_UNO", targetSeat: uiAction.targetSeat };
    case "DRAW":
    case "END_TURN":
    case "STACK_DECLINE":
    case "CHALLENGE_W4":
    case "DECLINE_CHALLENGE":
    case "CALL_UNO":
      return { type: uiAction.type };
    default:
      throw new Error(`\u672A\u77E5 UI \u52A8\u4F5C\u7C7B\u578B\uFF1A${String(uiAction.type)}`);
  }
}
function getHumanLegalActions(state, seat) {
  if (state.phase === "round-end") return [];
  const legal = getLegalActions(state);
  if (state.phase === "uno-window") {
    const windowActions = legal.filter(
      (action) => action.type === "CALL_UNO" || action.type === "CATCH_UNO"
    );
    const pendingActions = state.currentSeat === seat ? legal.filter((action) => !windowActions.includes(action)) : [];
    return [...windowActions, ...pendingActions].map((action) => toUiAction(action, state));
  }
  if (state.currentSeat !== seat) return [];
  return legal.map((action) => toUiAction(action, state));
}
function lastPlayedBySeat(state) {
  const map = /* @__PURE__ */ new Map();
  for (const event of state.history) {
    if (event.type === "PLAY") map.set(event.seat, { ...event.card });
  }
  return map;
}
function toPublicResult(state, durationMs = 0) {
  const result = getResult(state, { durationMs });
  return {
    winnerSeat: result.winnerSeat,
    isDraw: result.isDraw,
    reason: result.reason,
    players: result.players.map((player) => ({
      seat: player.seat,
      name: player.name,
      isHuman: player.isHuman,
      remaining: player.remaining,
      score: player.score,
      saidUno: player.saidUno
    })),
    turns: result.turns,
    actions: result.actions,
    draws: result.draws,
    plays: result.plays,
    stackPlays: result.stackPlays,
    unoCalls: result.unoCalls,
    durationMs: result.durationMs
  };
}
function getGameView(state, seat, options = {}) {
  if (!state.players[seat])
    throw new RangeError(`\u5EA7\u4F4D ${seat} \u4E0D\u5B58\u5728\uFF08\u5171 ${state.players.length} \u4EBA\uFF09`);
  const human = state.players[seat];
  const lastPlayed = lastPlayedBySeat(state);
  const roundEnded = state.phase === "round-end";
  return {
    mock: false,
    screen: roundEnded ? "result" : "game",
    phase: state.phase,
    config: {
      playerCount: state.players.length,
      difficulty: state.config.aiDifficulty,
      aiMode: state.config.aiMode,
      challengeWild4: state.config.challengeWild4
    },
    currentSeat: state.currentSeat,
    direction: state.direction,
    currentColor: state.currentColor,
    players: state.players.map((player) => ({
      seat: player.seat,
      name: player.name,
      isHuman: player.isHuman,
      avatar: player.isHuman ? "\u{1F9D1}" : "\u{1F916}",
      handCount: player.hand.length,
      saidUno: player.saidUno,
      thinking: false,
      lastPlayed: lastPlayed.get(player.seat) ?? null,
      line: "",
      difficulty: player.isHuman ? null : state.config.aiDifficulty
    })),
    human: {
      seat,
      hand: human.hand.map((card) => ({ ...card })),
      legalActions: getHumanLegalActions(state, seat),
      drawnThisTurn: state.drawnThisTurn ? { ...state.drawnThisTurn } : null,
      mustRespondStack: state.phase === "stack-response" && state.currentSeat === seat,
      canCallUno: Boolean(
        state.unoWindow && state.unoWindow.seat === seat && state.unoWindow.canCall
      ),
      canCatch: state.unoWindow && state.unoWindow.seat !== seat ? [...state.unoWindow.canCatch] : [],
      pendingChallenge: state.pendingChallenge && state.pendingChallenge.challengerSeat === seat ? { opponentSeat: state.pendingChallenge.targetSeat } : null
    },
    table: {
      discardTop: state.discardPile.length > 0 ? { ...state.discardPile[state.discardPile.length - 1] } : null,
      discardTop3: [...state.discardPile].slice(-3).reverse().map((card) => ({ ...card })),
      drawPileCount: state.drawPile.length,
      stack: state.stack ? {
        total: state.stack.total,
        chain: state.stack.chain.map((card) => ({ ...card })),
        lastPlayer: state.stack.lastPlayer,
        topColor: state.stack.topColor,
        awaitingSeat: state.stack.awaitingSeat
      } : null,
      pendingColorChoice: state.phase === "choose-color",
      winnerSeat: state.winnerSeat
    },
    events: sanitizeEventsForSeat(state.events, seat),
    result: roundEnded ? toPublicResult(state, options.durationMs ?? 0) : null,
    settings: { ...DEFAULT_VIEW_SETTINGS, ...options.settings },
    dev: {}
  };
}

// packages/game-core/src/index.ts
var GAME_CORE_VERSION = "0.1.0";

// packages/ai/src/difficulty.ts
var UNO_CALL_PROBABILITY = {
  casual: 0.8,
  easy: 0.95,
  realistic: 1,
  hardcore: 1
};
var UNO_CATCH_PROBABILITY = {
  casual: 0.1,
  easy: 0.4,
  realistic: 0.8,
  hardcore: 1
};
var DIFFICULTY_ORDER = ["casual", "easy", "realistic", "hardcore"];
var DIFFICULTY_LABEL = {
  casual: "\u4F11\u95F2",
  easy: "\u7B80\u5355",
  realistic: "\u771F\u5B9E",
  hardcore: "\u9AA8\u7070\u7EA7"
};
var casual = {
  difficulty: "casual",
  label: DIFFICULTY_LABEL.casual,
  mistakeRate: 0.2,
  noise: 0.35,
  memoryLevel: "none",
  colorChoice: "most-in-hand",
  challenge: { mode: "random", randomChance: 0.1, threshold: 1, priorIllegal: 0.5 },
  bluffChance: 0,
  weights: {
    handReduction: 1,
    attack: 0.15,
    colorKeep: 0.2,
    followUp: 0,
    wildCost: 0.1,
    endgame: 0.2,
    threat: 0,
    stackGain: 0.25,
    drawCost: 0.5,
    bluffRisk: 0,
    nextPlayerWeakColor: 0.1,
    colorFit: 0.5,
    challengeSuccess: 0.2,
    challengeRisk: 0.2
  },
  description: "\u966A\u4F60\u73A9\uFF1A\u4F1A\u72AF\u9519\u3001\u4E0D\u8BB0\u724C\u3001\u51E0\u4E4E\u4E0D\u6311\u6218\u3001\u4ECE\u4E0D\u8BC8\u552C"
};
var easy = {
  difficulty: "easy",
  label: DIFFICULTY_LABEL.easy,
  mistakeRate: 0.1,
  noise: 0.15,
  memoryLevel: "colors",
  colorChoice: "weighted",
  challenge: { mode: "simple", randomChance: 0, threshold: 0.45, priorIllegal: 0.4 },
  bluffChance: 0.1,
  weights: {
    handReduction: 1,
    attack: 0.4,
    colorKeep: 0.45,
    followUp: 0.15,
    wildCost: 0.35,
    endgame: 0.5,
    threat: 0.25,
    stackGain: 0.5,
    drawCost: 0.9,
    bluffRisk: 0.4,
    nextPlayerWeakColor: 0.3,
    colorFit: 0.8,
    challengeSuccess: 0.6,
    challengeRisk: 0.5
  },
  description: "\u89C4\u5219\u6B63\u786E\u7684\u666E\u901A\u6C34\u5E73\uFF1A\u53EA\u8BB0\u5DF2\u51FA\u989C\u8272\u6570\u91CF\uFF0C\u5076\u5C14\u6311\u6218\u3001\u5076\u5C14\u8BC8\u552C"
};
var realistic = {
  difficulty: "realistic",
  label: DIFFICULTY_LABEL.realistic,
  mistakeRate: 0.03,
  noise: 0.05,
  memoryLevel: "full",
  colorChoice: "next-player",
  challenge: { mode: "estimate", randomChance: 0, threshold: 0.4, priorIllegal: 0.35 },
  bluffChance: 0.3,
  weights: {
    handReduction: 1,
    attack: 0.6,
    colorKeep: 0.7,
    followUp: 0.45,
    wildCost: 0.6,
    endgame: 0.9,
    threat: 0.5,
    stackGain: 0.8,
    drawCost: 1.1,
    bluffRisk: 0.9,
    nextPlayerWeakColor: 0.7,
    colorFit: 1,
    challengeSuccess: 1,
    challengeRisk: 0.8
  },
  description: "\u50CF\u666E\u901A\u8001\u73A9\u5BB6\uFF1A\u8BB0\u5168\u90E8\u5DF2\u51FA\u724C\u3001\u6309\u6982\u7387\u6311\u6218\u3001\u4F1A\u4E3B\u52A8\u8BC8\u552C"
};
var hardcore = {
  difficulty: "hardcore",
  label: DIFFICULTY_LABEL.hardcore,
  mistakeRate: 0,
  noise: 0,
  memoryLevel: "full-plus",
  colorChoice: "bayes",
  challenge: { mode: "ev", randomChance: 0, threshold: 0.32, priorIllegal: 0.35 },
  bluffChance: 0.5,
  weights: {
    handReduction: 1,
    attack: 0.8,
    colorKeep: 1,
    followUp: 1,
    wildCost: 0.8,
    endgame: 1.3,
    threat: 0.8,
    stackGain: 1,
    drawCost: 1.2,
    bluffRisk: 1.8,
    nextPlayerWeakColor: 1.2,
    colorFit: 1.3,
    challengeSuccess: 1.4,
    challengeRisk: 1
  },
  description: "\u8FD1\u4E4E\u6700\u4F18\uFF1A\u7CBE\u786E\u8BB0\u724C\u3001\u6309\u671F\u671B\u503C\u6311\u6218\u3001\u5173\u952E\u8282\u70B9\u8BC8\u552C\u3001\u96F6\u5931\u8BEF"
};
var DIFFICULTY_PROFILES = {
  casual,
  easy,
  realistic,
  hardcore
};
function getDifficultyProfile(difficulty) {
  const profile = DIFFICULTY_PROFILES[difficulty];
  if (!profile) throw new RangeError(`\u672A\u77E5 AI \u96BE\u5EA6\uFF1A${String(difficulty)}`);
  return profile;
}

// packages/ai/src/view.ts
function sanitizeHistory(events, seat) {
  return events.map((event) => {
    if (event.type === "DRAW") {
      if (event.seat === seat) return event;
      return { type: "DRAW", seat: event.seat, count: event.count, cards: [] };
    }
    if (event.type === "CHALLENGE_SUCCESS") {
      return {
        type: "CHALLENGE_SUCCESS",
        challenger: event.challenger,
        target: event.target
      };
    }
    return event;
  });
}
function colorBeforeLastWild4(events) {
  let playIndex = -1;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "PLAY" && event.card.kind === "wild4") {
      playIndex = index;
      break;
    }
  }
  if (playIndex < 0) return null;
  let color = null;
  for (let index = 0; index < playIndex; index += 1) {
    const event = events[index];
    if (event.type === "START_CARD") {
      if (event.card.color) color = event.card.color;
    } else if (event.type === "PLAY") {
      if (event.card.color) color = event.card.color;
    } else if (event.type === "COLOR_SET") {
      color = event.color;
    }
  }
  return color;
}
function nextPlayerSeat(view) {
  return nextSeat(view.seat, view.players.length, view.direction);
}
function getAiView(state, seat) {
  const player = state.players[seat];
  if (!player) throw new RangeError(`\u5EA7\u4F4D ${seat} \u4E0D\u5B58\u5728\uFF08\u5171 ${state.players.length} \u4EBA\uFF09`);
  const players = state.players.map((item) => ({
    seat: item.seat,
    name: item.name,
    isHuman: item.isHuman,
    handCount: item.hand.length,
    saidUno: item.saidUno
  }));
  const hand = player.hand.map((card) => ({ ...card }));
  const drawnThisTurn = state.currentSeat === seat && state.drawnThisTurn ? { ...state.drawnThisTurn } : null;
  return {
    seat,
    phase: state.phase,
    currentSeat: state.currentSeat,
    direction: state.direction,
    currentColor: state.currentColor,
    turnCount: state.turnCount,
    config: {
      playerCount: state.config.playerCount,
      humanSeat: state.config.humanSeat,
      deckExhaustion: state.config.deckExhaustion,
      stacking: state.config.stacking,
      challengeWild4: state.config.challengeWild4,
      twoPlayerRules: state.config.twoPlayerRules,
      unoPenalty: state.config.unoPenalty,
      wild4Legality: state.config.wild4Legality
    },
    hand,
    players,
    discardPile: state.discardPile.map((card) => ({ ...card })),
    topCard: state.discardPile.length > 0 ? { ...state.discardPile[state.discardPile.length - 1] } : null,
    drawPileCount: state.drawPile.length,
    drawnThisTurn,
    stack: state.stack ? {
      total: state.stack.total,
      chain: state.stack.chain.map((card) => ({ ...card })),
      lastPlayer: state.stack.lastPlayer,
      topColor: state.stack.topColor,
      awaitingSeat: state.stack.awaitingSeat
    } : null,
    pendingChallenge: state.pendingChallenge ? { ...state.pendingChallenge } : null,
    unoWindow: state.unoWindow ? {
      seat: state.unoWindow.seat,
      canCall: state.unoWindow.canCall,
      canCatch: [...state.unoWindow.canCatch]
    } : null,
    history: sanitizeHistory(state.history, seat)
  };
}

// packages/ai/src/memory.ts
var INITIAL = (() => {
  const deck = createDeck();
  const colors = { red: 0, yellow: 0, green: 0, blue: 0 };
  const kinds = {
    number: 0,
    skip: 0,
    reverse: 0,
    draw2: 0,
    wild: 0,
    wild4: 0
  };
  for (const card of deck) {
    if (card.color) colors[card.color] += 1;
    kinds[card.kind] += 1;
  }
  return { colors, kinds };
})();
var INITIAL_COLOR_COUNTS = INITIAL.colors;
var INITIAL_KIND_COUNTS = INITIAL.kinds;
function emptyColorRecord() {
  return { red: 0, yellow: 0, green: 0, blue: 0 };
}
function countSeen(cards) {
  const colors = emptyColorRecord();
  const kinds = {
    number: 0,
    skip: 0,
    reverse: 0,
    draw2: 0,
    wild: 0,
    wild4: 0
  };
  for (const card of cards) {
    if (card.color) colors[card.color] += 1;
    kinds[card.kind] += 1;
  }
  return { colors, kinds };
}
function buildPlayerMemories(view) {
  const players = view.players.map((item) => ({
    seat: item.seat,
    isHuman: item.isHuman,
    handCount: item.handCount,
    saidUno: item.saidUno,
    colorsPlayed: emptyColorRecord(),
    actionCardsPlayed: 0,
    wild4Played: 0,
    plays: 0,
    draws: 0,
    wild4BluffsCaught: 0,
    wild4LegalProven: 0
  }));
  const bySeat = /* @__PURE__ */ new Map();
  for (const player of players) bySeat.set(player.seat, player);
  for (const event of view.history) {
    applyPublicEvent(event, bySeat);
  }
  return players;
}
function applyPublicEvent(event, bySeat) {
  switch (event.type) {
    case "PLAY": {
      const player = bySeat.get(event.seat);
      if (!player) return;
      player.plays += 1;
      if (event.card.color) player.colorsPlayed[event.card.color] += 1;
      if (event.card.kind !== "number") player.actionCardsPlayed += 1;
      if (event.card.kind === "wild4") player.wild4Played += 1;
      return;
    }
    case "DRAW": {
      const player = bySeat.get(event.seat);
      if (player) player.draws += event.count;
      return;
    }
    case "CHALLENGE_SUCCESS": {
      const target = bySeat.get(event.target);
      if (target) target.wild4BluffsCaught += 1;
      return;
    }
    case "CHALLENGE_FAIL": {
      const target = bySeat.get(event.target);
      if (target) target.wild4LegalProven += 1;
      return;
    }
    default:
      return;
  }
}
function buildMemory(view) {
  const seen = countSeen([...view.discardPile, ...view.hand]);
  const remainingByColor = emptyColorRecord();
  for (const color of ["red", "yellow", "green", "blue"]) {
    remainingByColor[color] = Math.max(0, INITIAL.colors[color] - seen.colors[color]);
  }
  const otherHandCount = view.players.reduce(
    (sum, player) => player.seat === view.seat ? sum : sum + player.handCount,
    0
  );
  return {
    seat: view.seat,
    remainingByColor,
    wildsRemaining: Math.max(0, INITIAL.kinds.wild - seen.kinds.wild),
    wild4Remaining: Math.max(0, INITIAL.kinds.wild4 - seen.kinds.wild4),
    draw2Remaining: Math.max(0, INITIAL.kinds.draw2 - seen.kinds.draw2),
    skipRemaining: Math.max(0, INITIAL.kinds.skip - seen.kinds.skip),
    reverseRemaining: Math.max(0, INITIAL.kinds.reverse - seen.kinds.reverse),
    unknownCards: view.drawPileCount + otherHandCount,
    seenCards: view.discardPile.length + view.hand.length,
    players: buildPlayerMemories(view),
    challengeSuccesses: view.history.filter((event) => event.type === "CHALLENGE_SUCCESS").length,
    challengeFails: view.history.filter((event) => event.type === "CHALLENGE_FAIL").length,
    colorBeforeLastWild4: colorBeforeLastWild4(view.history)
  };
}
function probabilityAtLeastOne(successCards, unknownCards, draws) {
  if (draws <= 0 || successCards <= 0) return 0;
  if (unknownCards <= 0) return 0;
  if (successCards >= unknownCards) return 1;
  let pNone = 1;
  for (let index = 0; index < draws; index += 1) {
    const remainingUnknown = unknownCards - index;
    if (remainingUnknown <= 0) break;
    const remainingMiss = unknownCards - successCards - index;
    if (remainingMiss <= 0) return 1;
    pNone *= remainingMiss / remainingUnknown;
  }
  return 1 - pNone;
}
function estimatePlayerHasColor(memory, handCount, color, level) {
  if (handCount <= 0) return 0;
  if (level === "none") return 0.5;
  const remaining = memory.remainingByColor[color];
  const unknown = memory.unknownCards;
  if (unknown <= 0) return 0.5;
  if (level === "colors") {
    const ratio = Math.min(1, remaining / unknown);
    return clamp01(1 - (1 - ratio) ** handCount);
  }
  return clamp01(probabilityAtLeastOne(remaining, unknown, handCount));
}
function clamp01(value) {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

// packages/ai/src/features.ts
function isAttackCard(card) {
  if (!card) return false;
  return card.kind === "skip" || card.kind === "reverse" || card.kind === "draw2" || card.kind === "wild4";
}
function resultingColor(draft) {
  return draft.card?.color ?? draft.colorChoice;
}
function handWithout(hand, card) {
  if (!card) return [...hand];
  return hand.filter((item) => item.id !== card.id);
}
function countColor(cards, color) {
  if (!color) return 0;
  return cards.reduce((sum, card) => card.color === color ? sum + 1 : sum, 0);
}
var CHALLENGE_ESTIMATE_CALIBRATION = 0.68;
function estimateChallengeIllegalProbability(view, memory, profile) {
  const strategy = profile.challenge;
  if (profile.memoryLevel === "none") return clamp01(strategy.priorIllegal);
  const preColor = memory.colorBeforeLastWild4;
  const pending = view.pendingChallenge;
  if (!preColor || !pending) return clamp01(strategy.priorIllegal);
  const target = view.players.find((player) => player.seat === pending.targetSeat);
  const handCount = target?.handCount ?? 0;
  if (handCount <= 0) return 0;
  const remaining = memory.remainingByColor[preColor];
  const unknown = memory.unknownCards;
  if (unknown <= 0) return clamp01(strategy.priorIllegal);
  let probability;
  if (profile.memoryLevel === "colors") {
    const ratio = Math.min(1, remaining / unknown);
    probability = 1 - (1 - ratio) ** handCount;
  } else {
    probability = probabilityAtLeastOne(remaining, unknown, handCount);
  }
  probability *= CHALLENGE_ESTIMATE_CALIBRATION;
  if (profile.memoryLevel === "full-plus" && target) {
    const targetMemory = memory.players.find((player) => player.seat === target.seat);
    if (targetMemory) {
      probability += 0.12 * Math.min(2, targetMemory.wild4BluffsCaught);
      probability -= 0.1 * Math.min(2, targetMemory.wild4LegalProven);
    }
  }
  const estimated = Number.isFinite(probability) ? probability : strategy.priorIllegal;
  return clamp01(0.02 + 0.96 * clamp01(estimated));
}
function extractFeatures(draft, context) {
  const { view, memory, profile } = context;
  const isPlay = draft.kind === "play" || draft.kind === "play-drawn" || draft.kind === "stack-play";
  const handSize = view.hand.length;
  const handAfter = isPlay ? handSize - 1 : handSize;
  const handAfterCards = handWithout(view.hand, draft.card);
  const resultColor = resultingColor(draft);
  const nextSeat2 = nextPlayerSeat(view);
  const nextCount = view.players[nextSeat2]?.handCount ?? 0;
  const opponentCounts = view.players.filter((player) => player.seat !== view.seat).map((player) => player.handCount);
  const minOpponentCount = opponentCounts.length > 0 ? Math.min(...opponentCounts) : handSize;
  const attack = isPlay ? extractAttack(draft, view, nextCount) : 0;
  const features = {
    handReduction: isPlay ? 1 : 0,
    attack,
    colorKeep: isPlay ? extractColorKeep(draft, handAfterCards, resultColor) : 0,
    followUp: isPlay ? extractFollowUp(draft, handAfterCards, resultColor) : 0,
    wildCost: isPlay ? extractWildCost(draft, handSize) : 0,
    endgame: isPlay ? extractEndgame(draft, handAfter, nextCount) : 0,
    threat: isPlay && isAttackCard(draft.card) ? extractThreat(nextCount, minOpponentCount) : 0,
    stackGain: draft.kind === "stack-play" ? extractStackGain(draft, view, nextCount) : 0,
    drawCost: extractDrawCost(draft, view),
    bluffRisk: extractBluffRisk(draft, view, memory, profile),
    nextPlayerWeakColor: 0,
    colorFit: 0,
    challengeSuccess: 0,
    challengeRisk: 0
  };
  if ((isPlay || draft.kind === "choose-color") && resultColor) {
    features.colorFit = handAfter === 0 ? 1 : clamp01(countColor(handAfterCards, resultColor) / Math.max(1, handAfter));
    const pNextHasColor = estimatePlayerHasColor(
      memory,
      nextCount,
      resultColor,
      profile.memoryLevel
    );
    features.nextPlayerWeakColor = clamp01(1 - pNextHasColor);
  }
  if (draft.kind === "challenge") {
    const probability = estimateChallengeIllegalProbability(view, memory, profile);
    features.challengeSuccess = probability;
    features.challengeRisk = clamp01(1 - probability);
  }
  return features;
}
function extractAttack(draft, view, nextCount) {
  if (!draft.card) return 0;
  let attack;
  switch (draft.card.kind) {
    case "skip":
      attack = 0.5;
      break;
    case "reverse":
      attack = view.players.length === 2 ? 0.75 : 0.45;
      break;
    case "draw2":
      attack = 0.7;
      break;
    case "wild4":
      attack = 0.55;
      break;
    case "wild":
      attack = 0.2;
      break;
    default:
      attack = 0;
  }
  if (isAttackCard(draft.card)) {
    attack += clamp01((3 - nextCount) / 3) * 0.35;
  }
  if (draft.kind === "stack-play") attack = Math.max(attack, 0.35);
  return clamp01(attack);
}
function extractColorKeep(draft, handAfterCards, resultColor) {
  if (!draft.card || !resultColor) return 0;
  const matching = countColor(handAfterCards, resultColor);
  return clamp01(matching / Math.max(1, handAfterCards.length));
}
function extractFollowUp(draft, handAfterCards, resultColor) {
  const card = draft.card;
  if (!card) return 0;
  if (handAfterCards.length === 0) return 1;
  let playable = 0;
  for (const item of handAfterCards) {
    if (item.kind === "wild" || item.kind === "wild4") {
      playable += 1;
      continue;
    }
    if (resultColor && item.color === resultColor) {
      playable += 1;
      continue;
    }
    if (card.kind === "number" && item.kind === "number" && item.value === card.value) {
      playable += 1;
      continue;
    }
    if ((card.kind === "skip" || card.kind === "reverse" || card.kind === "draw2") && item.kind === card.kind) {
      playable += 1;
    }
  }
  return clamp01(playable / handAfterCards.length);
}
function extractWildCost(draft, handSize) {
  if (!draft.card) return 0;
  if (draft.card.kind !== "wild" && draft.card.kind !== "wild4") return 0;
  const cost = clamp01((handSize - 2) / 8);
  return clamp01(cost + (draft.card.kind === "wild4" ? 0.1 : 0));
}
function extractEndgame(draft, handAfter, nextCount) {
  let endgame;
  if (handAfter <= 0) endgame = 1;
  else if (handAfter === 1) endgame = 0.6;
  else if (handAfter === 2) endgame = 0.3;
  else endgame = 0;
  if (isAttackCard(draft.card)) {
    if (nextCount <= 1) endgame = Math.max(endgame, 0.9);
    else if (nextCount <= 2) endgame = Math.max(endgame, 0.6);
    if (handAfter <= 2) endgame = Math.max(endgame, 0.5);
  }
  return clamp01(endgame);
}
function extractThreat(nextCount, minOpponentCount) {
  const nextThreat = clamp01((3 - nextCount) / 3) * 0.7;
  const leaderThreat = clamp01((3 - minOpponentCount) / 3) * 0.3;
  return clamp01(nextThreat + leaderThreat);
}
function extractStackGain(draft, view, nextCount) {
  if (!draft.card) return 0;
  const power = draft.card.kind === "draw2" ? 2 : 4;
  const stackTotal = view.stack?.total ?? 0;
  let gain = 0.25 + (power + Math.min(stackTotal, 12) * 0.2) / 12;
  if (nextCount <= 2) gain -= 0.1;
  return clamp01(gain);
}
function extractDrawCost(draft, view) {
  if (draft.kind === "draw") return 1;
  if (draft.kind === "stack-decline") {
    return clamp01((view.stack?.total ?? 0) / 12);
  }
  if (draft.kind === "end-turn") return 0.15;
  return 0;
}
function extractBluffRisk(draft, view, memory, profile) {
  if (draft.kind !== "play" && draft.kind !== "play-drawn") return 0;
  if (!draft.card || draft.card.kind !== "wild4") return 0;
  const currentColor = view.currentColor;
  const rest = handWithout(view.hand, draft.card);
  const hasMatchingColor = currentColor ? rest.some((card) => card.color === currentColor) : false;
  const hasWild = rest.some((card) => card.kind === "wild");
  const illegal = hasMatchingColor || view.config.wild4Legality === "new-version" && hasWild;
  if (!illegal) return 0;
  const attempts = memory.challengeSuccesses + memory.challengeFails;
  const pChallenge = clamp01(0.35 + attempts * 0.04);
  return clamp01(pChallenge * (1 - profile.bluffChance * 0.6) * 0.9);
}

// packages/ai/src/scoring.ts
function weightedScore(candidate, profile) {
  const features = candidate.features;
  const weights = profile.weights;
  return weights.handReduction * features.handReduction + weights.attack * features.attack + weights.colorKeep * features.colorKeep + weights.followUp * features.followUp - weights.wildCost * features.wildCost + weights.endgame * features.endgame + weights.threat * features.threat + weights.stackGain * features.stackGain - weights.drawCost * features.drawCost - weights.bluffRisk * features.bluffRisk + weights.nextPlayerWeakColor * features.nextPlayerWeakColor + weights.colorFit * features.colorFit + weights.challengeSuccess * features.challengeSuccess - weights.challengeRisk * features.challengeRisk;
}
function normalizeScores(candidates) {
  if (candidates.length === 0) return;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    min = Math.min(min, candidate.rawScore);
    max = Math.max(max, candidate.rawScore);
  }
  const range = max - min;
  for (const candidate of candidates) {
    candidate.score = range > 1e-9 ? (candidate.rawScore - min) / range : 1;
  }
}

// packages/ai/src/candidates.ts
function findOwnCard(view, cardId) {
  const card = view.hand.find((item) => item.id === cardId);
  if (!card) throw new Error(`AI \u624B\u724C\u4E2D\u6CA1\u6709 ${cardId}\uFF08\u89C6\u56FE\u4E0E\u5F15\u64CE\u72B6\u6001\u4E0D\u4E00\u81F4\uFF09`);
  return card;
}
function toDraft(action, view) {
  switch (action.type) {
    case "PLAY_CARD":
      return {
        kind: "play",
        action,
        card: findOwnCard(view, action.cardId),
        colorChoice: action.colorChoice ?? null
      };
    case "PLAY_DRAWN": {
      const card = view.drawnThisTurn;
      if (!card) throw new Error("PLAY_DRAWN \u5019\u9009\u7F3A\u5C11\u62BD\u5230\u7684\u724C");
      return { kind: "play-drawn", action, card, colorChoice: action.colorChoice ?? null };
    }
    case "DRAW":
      return { kind: "draw", action, card: null, colorChoice: null };
    case "END_TURN":
      return { kind: "end-turn", action, card: null, colorChoice: null };
    case "CHOOSE_COLOR":
      return { kind: "choose-color", action, card: null, colorChoice: action.color };
    case "STACK_PLAY":
      return {
        kind: "stack-play",
        action,
        card: findOwnCard(view, action.cardId),
        colorChoice: action.colorChoice ?? null
      };
    case "STACK_DECLINE":
      return { kind: "stack-decline", action, card: null, colorChoice: null };
    case "CHALLENGE_W4":
      return { kind: "challenge", action, card: null, colorChoice: null };
    case "DECLINE_CHALLENGE":
      return { kind: "decline-challenge", action, card: null, colorChoice: null };
    case "CALL_UNO":
    case "CATCH_UNO":
      throw new Error("UNO \u7A97\u53E3\u52A8\u4F5C\u4E0D\u5E94\u751F\u6210 AI \u5019\u9009\uFF08\u5E94\u5728\u8FC7\u6EE4\u9636\u6BB5\u6392\u9664\uFF09");
  }
}
function candidateId(action) {
  switch (action.type) {
    case "PLAY_CARD":
    case "PLAY_DRAWN":
    case "STACK_PLAY":
      return `${action.type}:${action.cardId}:${action.colorChoice ?? "-"}`;
    case "CHOOSE_COLOR":
      return `CHOOSE_COLOR:${action.color}`;
    case "CATCH_UNO":
      return `CATCH_UNO:${action.targetSeat}`;
    default:
      return action.type;
  }
}
function colorNameOf(color) {
  return color ? COLOR_NAME[color] : "";
}
function makeNote(candidate, view) {
  const { card, colorChoice } = candidate;
  switch (candidate.kind) {
    case "play": {
      if (!card) return "\u51FA\u724C";
      if (card.kind === "wild" || card.kind === "wild4") {
        const kept = view.hand.filter((item) => item.color === colorChoice).length;
        return `\u51FA ${cardLabel(card)} \u2192 ${colorNameOf(colorChoice)}\uFF08\u624B\u4E2D ${kept} \u5F20${colorNameOf(colorChoice)}\uFF09`;
      }
      if (card.color) {
        const kept = view.hand.filter(
          (item) => item.id !== card.id && item.color === card.color
        ).length;
        return `\u51FA ${cardLabel(card)}\uFF08\u4FDD\u7559 ${kept} \u5F20${colorNameOf(card.color)}\uFF09`;
      }
      return `\u51FA ${cardLabel(card)}`;
    }
    case "play-drawn":
      return `\u51FA\u521A\u62BD\u5230\u7684 ${card ? cardLabel(card) : "\u724C"}`;
    case "draw":
      return "\u62BD 1 \u5F20";
    case "end-turn":
      return "\u7ED3\u675F\u56DE\u5408\uFF08\u4FDD\u7559\u62BD\u5230\u7684\u724C\uFF09";
    case "choose-color": {
      const count = view.hand.filter((item) => item.color === colorChoice).length;
      return `\u9009${colorNameOf(colorChoice)}\uFF08\u624B\u4E2D ${count} \u5F20\uFF09`;
    }
    case "stack-play": {
      const total = (view.stack?.total ?? 0) + (card?.kind === "draw2" ? 2 : 4);
      return `\u53E0 ${card ? cardLabel(card) : "\u724C"}\uFF08\u7D2F\u8BA1 ${total} \u5F20\uFF09`;
    }
    case "stack-decline":
      return `\u653E\u5F03\u53E0\u724C\uFF0C\u6478 ${view.stack?.total ?? 0} \u5F20`;
    case "challenge":
      return `\u6311\u6218 +4\uFF08\u4F30\u7B97\u5BF9\u65B9\u8FDD\u89C4\u6982\u7387 ${Math.round(candidate.features.challengeSuccess * 100)}%\uFF09`;
    case "decline-challenge":
      return `\u63A5\u53D7 +4\uFF0C\u6478 ${view.pendingChallenge?.total ?? 4} \u5F20`;
  }
}
function generateCandidates(context) {
  const legal = getLegalActions(context.state);
  if (legal.length === 0) {
    throw new Error(`\u5EA7\u4F4D ${context.seat} \u5F53\u524D\u6CA1\u6709\u5408\u6CD5\u52A8\u4F5C\uFF08\u5F15\u64CE\u72B6\u6001\u5F02\u5E38\uFF09`);
  }
  const featureContext = {
    view: context.view,
    memory: context.memory,
    profile: context.profile,
    seat: context.seat
  };
  const candidates = [];
  for (const action of legal) {
    if (action.type === "CALL_UNO" || action.type === "CATCH_UNO") continue;
    const draft = toDraft(action, context.view);
    const candidate = {
      id: candidateId(action),
      kind: draft.kind,
      action,
      card: draft.card,
      colorChoice: draft.colorChoice,
      features: extractFeatures(draft, featureContext),
      score: 0,
      rawScore: 0,
      note: ""
    };
    candidate.rawScore = weightedScore(candidate, context.profile);
    candidate.note = makeNote(candidate, context.view);
    candidates.push(candidate);
  }
  if (candidates.length === 0) {
    throw new Error(`\u5EA7\u4F4D ${context.seat} \u8FC7\u6EE4\u540E\u6CA1\u6709\u53EF\u7528\u7684 AI \u5019\u9009\uFF08\u5F15\u64CE\u72B6\u6001\u5F02\u5E38\uFF09`);
  }
  return candidates;
}

// packages/ai/src/decide.ts
function applyChallengeStrategy(challenge, decline, profile, options) {
  const strategy = profile.challenge;
  const probability = challenge.features.challengeSuccess;
  const challenged = strategy.mode === "random" ? nextFloat(options.rng) < strategy.randomChance : probability >= strategy.threshold;
  const best = Math.max(challenge.rawScore, decline.rawScore);
  const chosen = challenged ? challenge : decline;
  const other = challenged ? decline : challenge;
  chosen.rawScore = best + 1;
  other.rawScore = best;
  const percent = Math.round(probability * 100);
  challenge.note = `\u6311\u6218 +4\uFF08\u4F30\u7B97\u5BF9\u65B9\u8FDD\u89C4\u6982\u7387 ${percent}%\uFF09`;
  decline.note = `\u63A5\u53D7 +4\uFF0C\u6478 4 \u5F20\uFF08\u4F30\u7B97\u5BF9\u65B9\u8FDD\u89C4\u6982\u7387 ${percent}%\uFF0C\u9009\u62E9\u4E0D\u6311\u6218\uFF09`;
}
function decide(state, seat, options) {
  if (state.phase === "round-end") throw new Error("\u5BF9\u5C40\u5DF2\u7ED3\u675F\uFF0CAI \u4E0D\u518D\u51B3\u7B56");
  if (state.currentSeat !== seat) {
    throw new Error(`\u5EA7\u4F4D ${seat} \u4E0D\u662F\u5F53\u524D\u884C\u52A8\u8005\uFF08\u5F53\u524D\u5EA7\u4F4D ${state.currentSeat}\uFF09`);
  }
  const profile = getDifficultyProfile(options.difficulty);
  const view = getAiView(state, seat);
  const memory = options.memory ?? buildMemory(view);
  const candidates = generateCandidates({ state, seat, view, memory, profile });
  for (const candidate of candidates) {
    candidate.rawScore = weightedScore(candidate, profile);
    if (profile.noise > 0) {
      candidate.rawScore += profile.noise * (nextFloat(options.rng) * 2 - 1);
    }
  }
  const challenge = candidates.find((candidate) => candidate.kind === "challenge");
  const decline = candidates.find((candidate) => candidate.kind === "decline-challenge");
  const isChallengeWindow = Boolean(challenge && decline);
  if (challenge && decline) {
    applyChallengeStrategy(challenge, decline, profile, options);
  }
  candidates.sort(
    (left, right) => right.rawScore - left.rawScore || left.id.localeCompare(right.id)
  );
  let chosen = candidates[0];
  if (!isChallengeWindow && profile.mistakeRate > 0 && candidates.length > 1 && nextFloat(options.rng) < profile.mistakeRate) {
    const index = 1 + nextInt(options.rng, candidates.length - 1);
    chosen = candidates[index];
  }
  normalizeScores(candidates);
  return {
    seat,
    difficulty: options.difficulty,
    action: chosen.action,
    candidate: chosen,
    candidates,
    reason: chosen.note,
    source: "local"
  };
}

// packages/ai/src/selfplay.ts
var DEFAULT_MAX_ACTIONS = 5e3;
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function createSelfPlayGame(config) {
  if (config.difficulties.length !== config.playerCount) {
    throw new RangeError(
      `difficulties \u957F\u5EA6\uFF08${config.difficulties.length}\uFF09\u5FC5\u987B\u7B49\u4E8E playerCount\uFF08${config.playerCount}\uFF09`
    );
  }
  const partial = {
    playerCount: config.playerCount,
    seed: config.seed,
    names: Array.from({ length: config.playerCount }, (_, index) => `AI${index + 1}`),
    aiDifficulty: config.engineDifficulty ?? "realistic",
    autoCallUno: false
  };
  if (config.deckExhaustion) partial.deckExhaustion = config.deckExhaustion;
  if (config.challengeWild4 !== void 0) partial.challengeWild4 = config.challengeWild4;
  if (config.twoPlayerRules !== void 0) partial.twoPlayerRules = config.twoPlayerRules;
  const state = createInitialGame(partial);
  state.config.humanSeat = -1;
  for (const player of state.players) player.isHuman = false;
  return { state, aiRng: createRng(`selfplay-ai-${String(config.seed)}`) };
}
function sameAction(left, right) {
  if (left.type !== right.type) return false;
  switch (left.type) {
    case "PLAY_CARD":
    case "PLAY_DRAWN":
    case "STACK_PLAY": {
      const other = right;
      return left.cardId === other.cardId && (left.colorChoice ?? null) === (other.colorChoice ?? null);
    }
    case "CHOOSE_COLOR":
      return left.color === right.color;
    case "CATCH_UNO":
      return left.targetSeat === right.targetSeat;
    default:
      return true;
  }
}
function playSelfPlayGame(config) {
  const maxActions = config.maxActions ?? DEFAULT_MAX_ACTIONS;
  const session = createSelfPlayGame(config);
  let state = session.state;
  const aiRng = session.aiRng;
  const errors = [];
  let illegalActions = 0;
  let conservationOk = true;
  let executed = 0;
  while (!isGameOver(state)) {
    if (executed >= maxActions) {
      errors.push(`\u8FBE\u5230\u52A8\u4F5C\u4E0A\u9650 ${maxActions}\uFF0C\u5BF9\u5C40\u672A\u7ED3\u675F\uFF08\u53EF\u80FD\u6B7B\u5FAA\u73AF\uFF09`);
      break;
    }
    const legal = getLegalActions(state);
    if (legal.length === 0) {
      errors.push("\u5F53\u524D\u9636\u6BB5\u6CA1\u6709\u5408\u6CD5\u52A8\u4F5C\uFF08\u5F15\u64CE\u72B6\u6001\u5F02\u5E38\uFF09");
      break;
    }
    const seat = state.currentSeat;
    const difficulty = config.difficulties[seat];
    if (!difficulty) {
      errors.push(`\u5EA7\u4F4D ${seat} \u6CA1\u6709\u914D\u7F6E\u96BE\u5EA6`);
      break;
    }
    let action;
    try {
      action = decide(state, seat, { difficulty, rng: aiRng }).action;
    } catch (error) {
      errors.push(`AI \u51B3\u7B56\u5F02\u5E38\uFF08\u5EA7\u4F4D ${seat} / ${difficulty}\uFF09\uFF1A${errorMessage(error)}`);
      break;
    }
    if (!legal.some((item) => sameAction(item, action))) {
      illegalActions += 1;
      errors.push(`AI \u9009\u62E9\u4E86\u975E\u6CD5\u52A8\u4F5C\uFF08\u5EA7\u4F4D ${seat} / ${difficulty}\uFF09\uFF1A${JSON.stringify(action)}`);
      break;
    }
    try {
      const applied = applyAction(state, action);
      state = applied.state;
    } catch (error) {
      illegalActions += 1;
      errors.push(`applyAction \u62D2\u7EDD\u8BE5\u52A8\u4F5C\uFF08\u5EA7\u4F4D ${seat} / ${difficulty}\uFF09\uFF1A${errorMessage(error)}`);
      break;
    }
    executed += 1;
    const total = countCards(state);
    if (total !== 108) {
      conservationOk = false;
      errors.push(`\u724C\u6570\u5F02\u5E38\uFF1A${total}\uFF08\u5E94\u4E3A 108\uFF09`);
      break;
    }
  }
  const challenges = state.history.filter(
    (event) => event.type === "CHALLENGE_SUCCESS" || event.type === "CHALLENGE_FAIL"
  ).length;
  const remainingHandCounts = state.players.map((player) => player.hand.length);
  if (isGameOver(state)) {
    const result = getResult(state);
    return {
      seed: config.seed,
      playerCount: config.playerCount,
      difficulties: [...config.difficulties],
      winnerSeat: result.winnerSeat,
      isDraw: result.isDraw,
      reason: result.reason,
      turns: result.turns,
      actions: result.actions,
      draws: result.draws,
      plays: result.plays,
      stackPlays: result.stackPlays,
      unoCalls: result.unoCalls,
      challenges,
      illegalActions,
      errors,
      conservationOk,
      remainingHandCounts
    };
  }
  let draws = 0;
  let plays = 0;
  let stackPlays = 0;
  let unoCalls = 0;
  for (const event of state.history) {
    if (event.type === "DRAW") draws += event.count;
    else if (event.type === "PLAY") plays += 1;
    else if (event.type === "STACK_PUSH") stackPlays += 1;
    else if (event.type === "UNO_CALLED") unoCalls += 1;
  }
  return {
    seed: config.seed,
    playerCount: config.playerCount,
    difficulties: [...config.difficulties],
    winnerSeat: null,
    isDraw: false,
    reason: "empty-hand",
    turns: state.turnCount,
    actions: state.actionCount,
    draws,
    plays,
    stackPlays,
    unoCalls,
    challenges,
    illegalActions,
    errors,
    conservationOk,
    remainingHandCounts
  };
}
function runDifficultyLadder(options) {
  const games = Math.max(1, Math.floor(options.gamesPerPairing));
  const baseSeed = options.baseSeed ?? "m2-ladder";
  const pairings = [];
  for (let index = 0; index < DIFFICULTY_ORDER.length - 1; index += 1) {
    const weak = DIFFICULTY_ORDER[index];
    const strong = DIFFICULTY_ORDER[index + 1];
    let strongWins = 0;
    let weakWins = 0;
    let draws = 0;
    let illegalActions2 = 0;
    let errorCount2 = 0;
    let totalTurns = 0;
    let totalActions = 0;
    for (let gameIndex = 0; gameIndex < games; gameIndex += 1) {
      const swap = gameIndex % 2 === 1;
      const difficulties = swap ? [strong, weak] : [weak, strong];
      const result = playSelfPlayGame({
        playerCount: 2,
        seed: `${String(baseSeed)}-${weak}-vs-${strong}-${gameIndex}`,
        difficulties,
        engineDifficulty: options.engineDifficulty,
        maxActions: options.maxActions,
        deckExhaustion: options.deckExhaustion,
        challengeWild4: options.challengeWild4,
        twoPlayerRules: options.twoPlayerRules
      });
      if (result.winnerSeat === null) draws += 1;
      else if (result.difficulties[result.winnerSeat] === strong) strongWins += 1;
      else weakWins += 1;
      illegalActions2 += result.illegalActions;
      errorCount2 += result.errors.length;
      totalTurns += result.turns;
      totalActions += result.actions;
    }
    const decided = games - draws;
    pairings.push({
      weak,
      strong,
      games,
      strongWins,
      weakWins,
      draws,
      strongWinRate: decided > 0 ? strongWins / decided : 0,
      avgTurns: totalTurns / games,
      avgActions: totalActions / games,
      illegalActions: illegalActions2,
      errorCount: errorCount2,
      totalTurns,
      totalActions
    });
  }
  const illegalActions = pairings.reduce((sum, pairing) => sum + pairing.illegalActions, 0);
  const errorCount = pairings.reduce((sum, pairing) => sum + pairing.errorCount, 0);
  return {
    pairings,
    monotonic: pairings.every((pairing) => pairing.strongWinRate > 0.5),
    illegalActions,
    errorCount,
    games: pairings.reduce((sum, pairing) => sum + pairing.games, 0)
  };
}
function runMixedTable(options) {
  const games = Math.max(1, Math.floor(options.games));
  const baseSeed = options.baseSeed ?? "m2-mixed";
  const winCounts = { casual: 0, easy: 0, realistic: 0, hardcore: 0 };
  const positionSums = {
    casual: 0,
    easy: 0,
    realistic: 0,
    hardcore: 0
  };
  const positionCounts = {
    casual: 0,
    easy: 0,
    realistic: 0,
    hardcore: 0
  };
  let draws = 0;
  let illegalActions = 0;
  let errorCount = 0;
  let totalTurns = 0;
  for (let gameIndex = 0; gameIndex < games; gameIndex += 1) {
    const shift = gameIndex % DIFFICULTY_ORDER.length;
    const difficulties = DIFFICULTY_ORDER.map(
      (_, offset) => DIFFICULTY_ORDER[(offset + shift) % DIFFICULTY_ORDER.length]
    );
    const result = playSelfPlayGame({
      playerCount: difficulties.length,
      seed: `${String(baseSeed)}-${gameIndex}`,
      difficulties,
      engineDifficulty: options.engineDifficulty,
      maxActions: options.maxActions,
      deckExhaustion: options.deckExhaustion,
      challengeWild4: options.challengeWild4
    });
    illegalActions += result.illegalActions;
    errorCount += result.errors.length;
    totalTurns += result.turns;
    const remaining = result.remainingHandCounts;
    result.difficulties.forEach((difficulty, seat) => {
      const value = remaining[seat] ?? 99;
      const rank = 1 + remaining.filter((count) => count < value).length;
      positionSums[difficulty] += rank;
      positionCounts[difficulty] += 1;
    });
    if (result.winnerSeat === null) draws += 1;
    else winCounts[result.difficulties[result.winnerSeat]] += 1;
  }
  const averagePositions = {};
  for (const difficulty of DIFFICULTY_ORDER) {
    const count = positionCounts[difficulty];
    averagePositions[difficulty] = count > 0 ? positionSums[difficulty] / count : 0;
  }
  const rankingMonotonic = DIFFICULTY_ORDER.every(
    (difficulty, index) => index === 0 || averagePositions[difficulty] <= averagePositions[DIFFICULTY_ORDER[index - 1]]
  );
  return {
    games,
    draws,
    winCounts,
    averagePositions,
    avgTurns: totalTurns / games,
    illegalActions,
    errorCount,
    rankingMonotonic
  };
}

// packages/ai/src/index.ts
var AI_VERSION = "0.2.0";
export {
  AI_VERSION,
  ALL_COLORS,
  CHALLENGE_ESTIMATE_CALIBRATION,
  COLOR_CODE,
  COLOR_NAME,
  DEFAULT_GAME_CONFIG,
  DEFAULT_VIEW_SETTINGS,
  DIFFICULTY_LABEL,
  DIFFICULTY_ORDER,
  DIFFICULTY_PROFILES,
  GAME_CORE_VERSION,
  INITIAL_COLOR_COUNTS,
  INITIAL_KIND_COUNTS,
  UNO_CALL_PROBABILITY,
  UNO_CATCH_PROBABILITY,
  applyAction,
  buildMemory,
  buildPlayerNames,
  cardLabel,
  cardScore,
  clamp01,
  colorBeforeLastWild4,
  countCards,
  createDeck,
  createInitialGame,
  createLobbyView,
  createRng,
  createSeed,
  createSelfPlayGame,
  decide,
  estimateChallengeIllegalProbability,
  estimatePlayerHasColor,
  extractFeatures,
  generateCandidates,
  getAiView,
  getDifficultyProfile,
  getGameView,
  getHumanLegalActions,
  getLegalActions,
  getResult,
  getTopCard,
  hasPlayableCard,
  hashSeed,
  isColor,
  isGameOver,
  isPlayable,
  isStackableCard,
  isTerminal,
  isWild4Legal,
  nextFloat,
  nextInt,
  nextPlayerSeat,
  nextSeat,
  normalizeGameConfig,
  normalizeScores,
  playSelfPlayGame,
  prevSeat,
  probabilityAtLeastOne,
  runDifficultyLadder,
  runMixedTable,
  sameAction,
  sanitizeEventsForSeat,
  sanitizeHistory,
  scoreHand,
  shuffle,
  toEngineAction,
  toPublicResult,
  toUiAction,
  topCard,
  weightedScore
};
