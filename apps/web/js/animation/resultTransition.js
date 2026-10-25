/**
 * M6：结算飞牌转场（契约 §8.3）。
 *
 * 数据流：render() 在「切屏前」调用 captureTableCardRect() 缓存 #discard-pile 顶牌 rect
 * （screen 切成 display:none 后就取不到了——这是 §8.3 的主要坑位）；结算 render 完成后
 * playResultTransition() 用缓存 rect → #result-win-card rect 克隆飞行 520ms。
 *
 * 降级链：源 rect 无效 → 不飞；目标槽缺失/平局 → 不飞；reduced-motion/动画关闭 → 静态淡入。
 * 转场期间 #result-screen[data-transition="running"]，再来一局/回大厅的重复点击被忽略。
 */
import { renderCard } from "../ui/hand.js";

const FLY_MS = 520;

let lastTableCardRect = null;
let transitionRunning = false;

function motionOff() {
  return (
    document.documentElement.dataset.animation === "false" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function rectOf(node) {
  if (!node) return null;
  const rect = node.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return rect;
}

/** render() 切屏前调用：缓存牌桌弃牌堆顶牌的位置（game → result 转场的飞行源） */
export function captureTableCardRect() {
  const rect = rectOf(document.querySelector("#discard-pile .card") || document.querySelector("#discard-pile"));
  if (rect) lastTableCardRect = rect;
  return lastTableCardRect;
}

/** 转场是否进行中（结算页按钮在 running 期间忽略重复点击） */
export function isResultTransitionRunning() {
  return transitionRunning;
}

/**
 * 结算 render 后调用：获胜牌从牌桌位置飞入结算槽。
 * winCard 为 view.table.discardTop（empty-hand 语义下的最后一张打出牌）；无牌/无槽不飞。
 */
export function playResultTransition(winCard) {
  const screen = document.querySelector("#result-screen");
  const slot = document.querySelector("#result-win-card");
  if (!screen || !slot || slot.hidden) return;
  const from = lastTableCardRect;
  const to = rectOf(slot);
  if (!winCard || !from || !to) return;
  if (motionOff()) return; // 静态降级：槽内静态显示获胜牌，无飞行

  const clone = renderCard(winCard);
  clone.classList.add("result-fly-card");
  clone.style.left = `${from.left}px`;
  clone.style.top = `${from.top}px`;
  clone.style.width = `${from.width}px`;
  clone.style.height = `${from.height}px`;
  document.body.append(clone);

  slot.classList.add("is-occupied"); // 目标槽占位隐藏，避免布局跳动
  screen.dataset.transition = "running";
  transitionRunning = true;

  const dx = to.left - from.left;
  const dy = to.top - from.top;
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  const animation = clone.animate(
    [
      { transform: "translate(0, 0) scale(1)", opacity: 1 },
      { transform: `translate(${dx * 0.75}px, ${dy * 0.75}px) scale(${0.75 + 0.25 * sx}, ${0.75 + 0.25 * sy})`, opacity: 1, offset: 0.75 },
      { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 1 },
    ],
    { duration: FLY_MS, easing: "cubic-bezier(.2,.72,.25,1)", fill: "both" },
  );
  const finish = () => {
    clone.remove();
    slot.classList.remove("is-occupied");
    delete screen.dataset.transition;
    transitionRunning = false;
  };
  animation.onfinish = finish;
  animation.oncancel = finish;
  // 兜底：极端情况下动画事件不触发也不永久锁死
  window.setTimeout(() => {
    if (transitionRunning) finish();
  }, FLY_MS + 400);
}
