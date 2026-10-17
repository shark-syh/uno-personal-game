const difficultyOptions = [["casual", "休闲"], ["easy", "简单"], ["realistic", "真实"], ["hardcore", "骨灰级"]];
const modeOptions = [["zhipu", "智谱"], ["local", "本地"], ["auto", "自动"]];

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
