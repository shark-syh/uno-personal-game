/**
 * 大厅巨型 UNO 牌（2026-11-07）。
 * 每次打开大厅随机：一张卡面（54 张唯一牌面之一）+ 一张卡背交叠，
 * 随机决定哪张压在上面，并给两张牌各自的倾角/位移一点人手写牌的偏差。
 * 只改装饰层，不触碰 window.UnoApp 契约与大厅文案轮换。
 */
// cards/manifest.json 的 54 个唯一卡面（避免额外网络请求；新增牌面时同步此表）
const FACES = "B0 B1 B2 B3 B4 B5 B6 B7 B8 B9 BA2 BR BS G0 G1 G2 G3 G4 G5 G6 G7 G8 G9 GA2 GR GS R0 R1 R2 R3 R4 R5 R6 R7 R8 R9 RA2 RR RS Y0 Y1 Y2 Y3 Y4 Y5 Y6 Y7 Y8 Y9 YA2 YR YS WC W4".split(" ");

const deck = document.querySelector(".lobby-deck");

if (deck) {
  const face = deck.querySelector(".lobby-deck__card--face");
  const rand = (min, max) => (min + Math.random() * (max - min)).toFixed(1);

  // 上下层随机：「一张卡面在上 / 一张卡背在上」两种构图各半
  deck.dataset.top = Math.random() < 0.5 ? "face" : "back";
  deck.style.setProperty("--deck-face-x", `${rand(-28, -16)}px`);
  deck.style.setProperty("--deck-face-y", `${rand(-22, -8)}px`);
  deck.style.setProperty("--deck-face-rot", `${rand(-12, -6)}deg`);
  deck.style.setProperty("--deck-back-x", `${rand(26, 42)}px`);
  deck.style.setProperty("--deck-back-y", `${rand(14, 30)}px`);
  deck.style.setProperty("--deck-back-rot", `${rand(6, 12)}deg`);

  const code = FACES[Math.floor(Math.random() * FACES.length)];
  const url = `cards/${code}.png`;
  // 先解码再挂到可见元素：启动动画退场时卡面一定已经就位（也供 boot.js 等待）
  const preload = new Image();
  const commit = () => {
    face.src = url;
    face.dataset.code = code;
    face.dataset.ready = "1";
    deck.dataset.ready = "1";
  };
  preload.onload = commit;
  preload.onerror = commit;
  preload.src = url;
}
