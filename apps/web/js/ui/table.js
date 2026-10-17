import { renderPlayers } from "./players.js";
import { renderHand } from "./hand.js";
import { renderHud } from "./hud.js";

export function renderTable(view, context) {
  renderHud(view, context);
  renderPlayers(view);
  renderHand(view, context);
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
