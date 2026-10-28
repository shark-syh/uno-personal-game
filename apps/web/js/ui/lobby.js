const difficultyOptions = [["casual", "休闲"], ["easy", "简单"], ["realistic", "真实"], ["hardcore", "骨灰级"]];
const modeOptions = [["zhipu", "智谱"], ["local", "本地"], ["auto", "自动"]];

// 大厅左栏文案（契约 §2.3，2026-10-28 用户指令改为 4 组轮换）：
//   HERO_SETS——巨字三行（中间行描边 em）+ 对应的中文意译 lead；
//   INDEX_SETS——01/02/03 index 三连（中文意译）。
// 每次「进入」大厅（页面加载，模块顶层执行一次）按 uno:lobbyIndex 计数轮换一组，
// 巨字与 lead 永远同组配对；组数任意增减只需改这两张表（长度不一致时按各自长度取模）。
const HERO_SETS = [
  { lines: ["PLAY", "WITH", "INTENT."], lead: "把牌桌变成一块可读的控制面：当前回合、对手压力、牌堆状态和你的可执行动作同时进入视野。" },
  { lines: ["READ", "THE", "TABLE."], lead: "每一条信息都摆在桌面上：当前颜色、方向、牌堆余量，还有谁在思考——不用猜，一眼读完。" },
  { lines: ["WATCH.", "PRESS.", "PLAY."], lead: "先看清桌面，再掂量对手的压力，最后把该出的那张牌打出去——三步之外没有多余动作。" },
  { lines: ["DEAL.", "THINK.", "WIN."], lead: "发牌之后只剩三件事：看清局面、做出决断、赢下这一局——剩下的交给那 108 张牌。" },
];
const INDEX_SETS = [
  ["看清牌面", "读懂对手", "打出这一手"],
  ["摊开整桌", "掂量对手", "落子见真章"],
  ["读取局面", "估算压力", "做出决断"],
  ["盯住牌堆", "算清威胁", "抢先出手"],
];
const INDEX_KEY = "uno:lobbyIndex";

function rotateLobbyCopy() {
  let step = 0;
  try {
    const prev = Number.parseInt(localStorage.getItem(INDEX_KEY) ?? "-1", 10);
    step = (Number.isFinite(prev) ? prev + 1 : 0) % HERO_SETS.length;
    localStorage.setItem(INDEX_KEY, String(step));
  } catch {
    step = 0;
  }
  const hero = HERO_SETS[step];
  [...document.querySelectorAll(".lobby-display span, .lobby-display em")].forEach((node, index) => {
    if (hero.lines[index]) node.textContent = hero.lines[index];
  });
  const lead = document.querySelector("#lobby-lead");
  if (lead) lead.textContent = hero.lead;
  const set = INDEX_SETS[step % INDEX_SETS.length];
  [...document.querySelectorAll(".lobby-index .index-item small")].forEach((node, index) => {
    if (set[index]) node.textContent = set[index];
  });
}

rotateLobbyCopy();

// +4 挑战开关：开始游戏前勾选，随 START_GAME 的 config 一起交给引擎（字段与 GameConfig.challengeWild4 对齐）。
// 模块内保留本次会话的最后选择，回到大厅时不会重置。
let challengeWild4 = true;
let challengeInitialized = false;

function choices(root, options, value, onChange) {
  root.replaceChildren(...options.map(([key, label]) => {
    const button = document.createElement("button");
    button.type = "button"; button.textContent = label; button.dataset.value = key; button.setAttribute("aria-label", label); button.setAttribute("aria-pressed", String(key === value));
    button.addEventListener("click", () => { root.querySelectorAll("button").forEach((item) => item.setAttribute("aria-pressed", String(item === button))); onChange(key); });
    return button;
  }));
}

export function renderLobby(view, { onAction, openDialog }) {
  const countRoot = document.querySelector("#player-count-options");
  const difficultyRoot = document.querySelector("#difficulty-options");
  const modeRoot = document.querySelector("#ai-mode-options");
  const challengeInput = document.querySelector("#challenge-wild4");
  const state = { playerCount: view.config?.playerCount || 4, difficulty: view.config?.difficulty || "realistic", aiMode: view.config?.aiMode || "auto" };
  if (!challengeInitialized) { challengeWild4 = view.config?.challengeWild4 ?? true; challengeInitialized = true; }
  choices(countRoot, Array.from({ length: 9 }, (_, i) => [String(i + 2), String(i + 2)]), String(state.playerCount), (value) => { state.playerCount = Number(value); });
  choices(difficultyRoot, difficultyOptions, state.difficulty, (value) => { state.difficulty = value; });
  choices(modeRoot, modeOptions, state.aiMode, (value) => { state.aiMode = value; });
  if (challengeInput) { challengeInput.checked = challengeWild4; challengeInput.onchange = () => { challengeWild4 = challengeInput.checked; }; }
  const form = document.querySelector("#lobby-form");
  form.onsubmit = (event) => { event.preventDefault(); onAction({ type: "START_GAME", config: { playerName: "你", playerCount: state.playerCount, difficulty: state.difficulty, aiMode: state.aiMode, challengeWild4 } }); };
}
