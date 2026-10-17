const colors = { red: "红", yellow: "黄", green: "绿", blue: "蓝" };
const avatars = ["🧑", "🤖", "🧓", "🧑‍🎨", "🧑‍🚀", "🧙", "🦸", "🧑‍🍳", "🧑‍🔬", "🧑‍🌾"];
const names = ["你", "老王", "小林", "阿杰", "小美", "大壮", "安娜", "小北", "阿诚", "小雨"];
const difficulty = [null, "casual", "easy", "realistic", "hardcore", "casual", "easy", "realistic", "hardcore", "easy"];

export function card(faceCode, index = 0) {
  const map = { R: "red", Y: "yellow", G: "green", B: "blue" };
  const prefix = faceCode[0];
  const valueText = faceCode.slice(1);
  const kind = faceCode === "WC" ? "wild" : faceCode === "W4" ? "wild4" : valueText === "R" ? "reverse" : valueText === "S" ? "skip" : valueText === "A2" ? "draw2" : "number";
  return { id: `${faceCode}#${index}`, kind, color: prefix === "W" ? null : map[prefix], value: kind === "number" ? Number(valueText) : null, faceCode };
}

function action(id, type, label, extra = {}) { return { id, type, label, disabled: false, ...extra }; }
function basePlayers(count, { thinking = false, oneUno = false } = {}) {
  return Array.from({ length: count }, (_, seat) => ({ seat, name: names[seat], isHuman: seat === 0, avatar: avatars[seat], handCount: seat === 0 ? 5 : 3 + (seat % 5), saidUno: oneUno && seat === 2, thinking: thinking && seat === 1, lastPlayed: seat === 1 ? card("B3", 0) : null, line: seat === 1 ? (thinking ? "让我想想…" : "这张不错") : seat === 2 ? "轮到谁了？" : "", difficulty: seat === 0 ? null : difficulty[seat] }));
}
function humanHand() { return [card("R7", 0), card("GS", 0), card("B0", 0), card("WC", 0), card("YA2", 0)]; }
function colorActions(type, cardId) { return Object.keys(colors).map((color) => action(`${type}:${cardId}:${color}`, type, type === "CHOOSE_COLOR" ? `${colors[color]}色` : `出 ${cardId.split("#")[0]} · ${colors[color]}`, { cardId, ...(type === "CHOOSE_COLOR" ? { color } : { colorChoice: color }) })); }
function common({ name = "normal-play", count = 4, phase = "await-play", players = basePlayers(count), hand = humanHand(), legalActions = [], currentColor = "red", stack = null, events = [], pendingColorChoice = false, pendingChallenge = null, canCallUno = false, canCatch = [], drawnThisTurn = null, discardTop = card("R3"), discardTop3 = [discardTop, card("B3"), card("Y5")] } = {}) {
  return { mock: true, screen: name === "lobby" ? "lobby" : name === "result" ? "result" : "game", phase, config: { playerCount: count, difficulty: "realistic", aiMode: "auto", challengeWild4: true }, currentSeat: players.find((player) => player.thinking)?.seat ?? 0, direction: 1, currentColor, players: players.map((player) => player.isHuman ? { ...player, handCount: hand.length } : player), human: { seat: 0, hand, legalActions, drawnThisTurn, mustRespondStack: phase === "stack-response", canCallUno, canCatch, pendingChallenge }, table: { discardTop, discardTop3, drawPileCount: 41, stack, pendingColorChoice, winnerSeat: null }, events, result: null, settings: { autoCallUno: false, aiSpeed: "normal", sound: true, animation: true, showHint: true, aiChatter: true }, dev: { mockName: name } };
}

function normal(name = "normal-play", count = 4) {
  const hand = humanHand();
  const legal = [action("play:R7#0", "PLAY_CARD", "出 红7", { cardId: "R7#0", hint: "红色数字牌可以出" }), ...colorActions("PLAY_CARD", "WC#0"), action("draw", "DRAW", "摸牌", { hint: "摸到能打出的牌为止" })];
  return common({ name, count, hand, legalActions: legal, events: [{ type: "PLAY", seat: 1, card: card("B3") }, { type: "DRAW", seat: 0, count: 2 }, { type: "COLOR_SET", seat: 1, color: "red" }] });
}

export const mockNames = ["lobby", "normal-play", "ai-thinking", "stack-response", "wild-color-picker", "challenge-decide", "uno-window", "catch-uno", "result", "ten-players", "two-players"];

export function createMockView(name = "lobby", playerCount = 4) {
  if (name === "lobby") return common({ name, count: 4, phase: "lobby" });
  if (name === "normal-play") return normal(name, playerCount);
  if (name === "two-players") return normal(name, 2);
  if (name === "ai-thinking") { const hand = humanHand(); const view = common({ name, phase: "await-play", players: basePlayers(4, { thinking: true }), hand, drawnThisTurn: hand[2], legalActions: [], events: [{ type: "PLAY", seat: 1, card: card("B3") }] }); view.direction = -1; return view; }
  if (name === "stack-response") return common({ name, phase: "stack-response", currentColor: "green", hand: [card("W4", 1), card("GA2", 1), card("R7"), card("B0"), card("YA2")], discardTop: card("W4"), discardTop3: [card("W4"), card("GA2"), card("RA2")], stack: { total: 8, chain: [card("RA2"), card("GA2"), card("W4")], lastPlayer: 1, topColor: "green" }, legalActions: [...colorActions("STACK_PLAY", "W4#1"), action("stack:GA2#1", "STACK_PLAY", "叠 +2", { cardId: "GA2#1" }), action("stack-decline", "STACK_DECLINE", "摸 8 张")], events: [{ type: "STACK_PUSH", seat: 1, card: card("W4"), total: 8 }] });
  if (name === "wild-color-picker") {
    const playedWild = card("WC");
    return common({ name, phase: "choose-color", pendingColorChoice: true, hand: [card("R7"), card("B3", 1)], discardTop: playedWild, discardTop3: [playedWild, card("R3"), card("B3")], legalActions: colorActions("CHOOSE_COLOR", "WC#0"), events: [{ type: "PLAY", seat: 0, card: playedWild }] });
  }
  if (name === "challenge-decide") return common({ name, phase: "challenge-decide", discardTop: card("W4"), pendingChallenge: { opponentSeat: 1 }, legalActions: [action("decline-challenge", "DECLINE_CHALLENGE", "摸 4 张"), action("challenge", "CHALLENGE_W4", "挑战！查看手牌")], events: [{ type: "PLAY", seat: 1, card: card("W4") }] });
  if (name === "uno-window") return common({ name, phase: "uno-window", hand: [card("R7")], players: basePlayers(4), canCallUno: true, legalActions: [action("uno", "CALL_UNO", "UNO!")] });
  if (name === "catch-uno") { const players = basePlayers(4); players[1].handCount = 1; return common({ name, phase: "uno-window", players, canCatch: [1], legalActions: [action("catch:1", "CATCH_UNO", "抓他！", { targetSeat: 1 })], events: [{ type: "PLAY", seat: 1, card: card("B3") }] }); }
  if (name === "result") {
    const players = basePlayers(4).map((p, i) => ({ seat: p.seat, name: p.name, remaining: i === 0 ? [] : [card(["R1", "G2", "B3", "Y4"][i]), card(["R2", "G3", "B4", "Y5"][i])], score: i === 0 ? 0 : 42 + i * 13 }));
    return { ...common({ name, phase: "round-end", hand: [] }), result: { winnerSeat: 0, winnerScore: players.slice(1).reduce((sum, player) => sum + player.score, 0), players, turns: 23, durationMs: 184000 } };
  }
  if (name === "ten-players") return common({ name, count: 10, players: basePlayers(10, { thinking: true }), legalActions: [] });
  return normal("normal-play", 4);
}

export function mockAction(view, actionValue) { console.log("[UNO mock action]", actionValue); return view; }
