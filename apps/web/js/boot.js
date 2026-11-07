/**
 * 启动动画（boot）：手写复刻 UNO。
 *
 * 经典脚本（非 module）：在 </body> 前同步执行，首帧绘制之前就把四条笔画置为
 * 「尚未书写」，杜绝第一次启动时先闪出完整 UNO 字形再被 JS 清空的加载跳变。
 *
 * 设计要点
 * - 静态 DOM 在 index.html 内（CSS 一到位就能首帧绘制），本脚本只负责「书写」与「退场」；
 * - 每条笔画用 stroke-dashoffset 逐笔写出，笔尖光点沿 getPointAtLength 跟随，进度条同步；
 * - 写完 → 墨迹定格 + 光带扫过 → 整层虚化溶解，大厅两栏错峰升起，一次连续运动进入应用；
 * - 降级：reduced-motion / 设置关闭动画 / ?test=1 / ?mock=1 / ?dev=1 / 每次会话只播一次；
 *   ?boot=1 强制重播（方便预览），?boot=0 强制跳过。点击或按任意键可立即跳过。
 * - 不触碰 window.UnoApp 契约、DOM 锚点、引擎与网络层。
 */
(function () {
  "use strict";

  const root = document.documentElement;
  const overlay = document.getElementById("boot-screen");
  const appRoot = document.getElementById("app");
  if (!overlay) return;

  // 不依赖 ESM 模块图：直接读同一份 uno:settings，避免首次冷启动时模块加载时序差异
  function readSettings() {
    const fallback = { animation: true, animationSpeed: "normal" };
    try { return { ...fallback, ...JSON.parse(localStorage.getItem("uno:settings") || "{}") }; }
    catch { return fallback; }
  }

  const params = new URLSearchParams(window.location.search);
  const settings = readSettings();
  const force = params.get("boot") === "1";
  const noBoot = params.get("boot") === "0";
  // 自动化验收与开发模式不播启动动画，避免遮罩拦截点击或改变首屏等待时间
  const isTestOrDev =
    params.get("test") === "1" ||
    params.get("mock") === "1" ||
    params.get("dev") === "1" ||
    params.get("mode") === "mock";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let played = false;
  try { played = sessionStorage.getItem("uno:bootPlayed") === "1"; } catch { /* 隐私模式按未播处理 */ }

  const shouldSkip =
    !force &&
    (noBoot || reduceMotion || settings.animation === false || isTestOrDev || played);

  // ★ 首帧修复：无论播放还是跳过，都先把墨迹藏好（CSS 里另有同源预设，双保险）。
  //   跳过时直接移除遮罩，自然也不会有残留字形。
  const allStrokes = [...overlay.querySelectorAll(".boot-ink .boot-stroke")];
  for (const path of allStrokes) {
    const len = path.getTotalLength() || 2400;
    path.style.strokeDasharray = `${len} ${len}`;
    path.style.strokeDashoffset = String(len);
  }

  if (shouldSkip) {
    overlay.remove();
    return;
  }

  const speed = settings.animationSpeed === "fast" ? 0.62 : 1;
  const pen = overlay.querySelector(".boot-pen");
  const meter = overlay.querySelector(".boot-meter i");
  const status = overlay.querySelector(".boot-status");
  const statusText = overlay.querySelector("#boot-status-text");

  try { sessionStorage.setItem("uno:bootPlayed", "1"); } catch { /* 忽略 */ }
  if (appRoot) appRoot.inert = true;

  // 每笔的起止略有重叠，像一口气写完而不是三段机械拼接
  const timeline = [
    { at: 120, dur: 600 },   // U
    { at: 660, dur: 640 },   // N
    { at: 1240, dur: 700 },  // O
    { at: 1860, dur: 420 },  // 手写下划线
  ].map((item, index) => {
    const el = allStrokes[index];
    return {
      el,
      at: item.at * speed,
      dur: item.dur * speed,
      len: el ? el.getTotalLength() : 0,
    };
  }).filter((item) => item.el && item.len > 0);
  const total = 2280 * speed;

  const stages = [
    { at: 0, label: "正在铺开牌桌" },
    { at: 820 * speed, label: "洗牌中" },
    { at: 1660 * speed, label: "准备就绪" },
  ];
  let stageIndex = -1;
  let swapTimer = 0;
  function setStage(index) {
    if (index === stageIndex || !stages[index]) return;
    stageIndex = index;
    if (!status || !statusText) return;
    status.classList.add("is-swapping");
    window.clearTimeout(swapTimer);
    swapTimer = window.setTimeout(() => {
      statusText.textContent = stages[index].label;
      status.classList.remove("is-swapping");
    }, 180);
  }

  let rafId = 0;
  let exiting = false;
  let startedAt = 0;

  const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

  function frame(now) {
    const t = now - startedAt;
    let active = null;

    for (const item of timeline) {
      const raw = Math.max(0, Math.min(1, (t - item.at) / item.dur));
      const eased = ease(raw);
      item.el.style.strokeDashoffset = String(item.len * (1 - eased));
      if (raw > 0 && raw < 1) active = { item, eased };
    }

    if (pen && active) {
      const point = active.item.el.getPointAtLength(active.item.len * active.eased);
      pen.setAttribute("transform", `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)})`);
      pen.style.opacity = "1";
    } else if (pen) {
      pen.style.opacity = "0";
    }

    if (meter) meter.style.transform = `scaleX(${Math.min(1, t / total).toFixed(4)})`;
    for (let i = stages.length - 1; i >= 0; i -= 1) {
      if (t >= stages[i].at) { setStage(i); break; }
    }

    if (t < total) {
      rafId = requestAnimationFrame(frame);
    } else {
      if (pen) pen.style.opacity = "0";
      overlay.classList.add("is-settling");
      setStage(stages.length - 1);
      window.setTimeout(() => void exit(), 660);
    }
  }

  /** 等大厅真正渲染完（含随机卡面解码）再揭示，避免退场时露出空壳；最多等 2.2s */
  function waitForApp() {
    return new Promise((resolve) => {
      const ready = () => {
        const lobby = document.getElementById("lobby-screen");
        const counts = document.getElementById("player-count-options");
        const face = document.querySelector(".lobby-deck__card--face");
        return !!lobby?.classList.contains("is-active") &&
          (counts?.children.length ?? 0) > 0 &&
          // 卡面图由 lobbyDeck.js 预加载后挂上；没有牌组或已完成都不阻塞
          (!face || face.dataset.ready === "1");
      };
      if (ready()) { resolve(); return; }
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      const deadline = window.setTimeout(finish, 2200);
      const poll = () => {
        if (done) return;
        if (ready()) { window.clearTimeout(deadline); finish(); }
        else requestAnimationFrame(poll);
      };
      requestAnimationFrame(poll);
    });
  }

  async function exit() {
    if (exiting) return;
    exiting = true;
    window.cancelAnimationFrame(rafId);
    await waitForApp();

    root.classList.add("boot-reveal");
    overlay.classList.add("is-leaving");

    window.setTimeout(() => {
      overlay.remove();
      if (appRoot) appRoot.inert = false;
      window.dispatchEvent(new CustomEvent("uno:boot-complete"));
    }, 680);
    // 等错峰入场动画（最长 270 + 660ms）跑完再摘类，避免末帧回弹
    window.setTimeout(() => root.classList.remove("boot-reveal"), 1020);
  }

  /** 点击 / 按键：补齐笔画后直接进入退场 */
  function skip() {
    if (exiting) return;
    for (const item of timeline) item.el.style.strokeDashoffset = "0";
    if (meter) meter.style.transform = "scaleX(1)";
    if (pen) pen.style.opacity = "0";
    void exit();
  }

  overlay.addEventListener("pointerdown", skip);
  window.addEventListener("keydown", skip, { once: true });
  // 兜底：自动化脚本用 element.click() 触发的合成点击也能立即结束启动层
  document.addEventListener("click", skip, { capture: true, once: true });

  startedAt = performance.now();
  rafId = requestAnimationFrame(frame);
})();
