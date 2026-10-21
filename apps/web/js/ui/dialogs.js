import { getSettings, saveSettings } from "../state/settings.js";
import { getStats } from "../state/stats.js";
import { createAiClient } from "../ai/aiClient.js";

let lastFocus = null;
let dialogSource = null;
const colorNames = { red: "红色", yellow: "黄色", green: "绿色", blue: "蓝色" };

function button(label, onClick, className = "btn", action = null) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = className;
  item.textContent = label;
  item.setAttribute("aria-label", label);
  if (action) { item.dataset.actionId = action.id; item.disabled = Boolean(action.disabled); }
  item.addEventListener("click", onClick);
  return item;
}

function show(title, body, actions, source = "user") {
  const root = document.querySelector("#dialog-root");
  if (!root.classList.contains("is-open")) lastFocus = document.activeElement;
  const card = document.createElement("div");
  card.className = "dialog-card";
  card.tabIndex = -1;
  const close = button("×", closeDialog, "btn btn-ghost dialog-close");
  close.setAttribute("aria-label", "关闭弹窗");
  const heading = document.createElement("h2");
  heading.id = "dialog-title";
  heading.textContent = title;
  const footer = document.createElement("div");
  footer.className = "dialog-actions";
  footer.append(...actions);
  card.append(close, heading, body, footer);
  root.replaceChildren(card);
  root.classList.add("is-open");
  root.setAttribute("aria-label", title);
  dialogSource = source;
  document.querySelector("#app").inert = true;
  document.querySelector("#dev-toolbar").inert = true;
  card.focus();
  return card;
}

export function closeDialog() {
  const root = document.querySelector("#dialog-root");
  if (!root.classList.contains("is-open")) return;
  root.classList.remove("is-open");
  root.replaceChildren();
  document.querySelector("#app").inert = false;
  document.querySelector("#dev-toolbar").inert = false;
  dialogSource = null;
  const returnTarget = lastFocus?.isConnected && lastFocus !== document.body
    ? lastFocus
    : document.querySelector('.screen.is-active button:not(:disabled), .screen.is-active input');
  returnTarget?.focus();
  lastFocus = null;
}

/**
 * 只关闭由 render 自动打开的弹窗（选色 / +4 挑战）。
 * 玩家主动打开的设置、战绩、退出确认等弹窗不应被状态重绘强行关掉；
 * 屏幕切换时由 render 调用 closeDialog() 统一关闭。
 */
export function closeAutoDialog() {
  if (dialogSource === "auto") closeDialog();
}

function paragraph(text) { const node = document.createElement("p"); node.textContent = text; return node; }

export function openDialog(kind, payload = {}, onAction = () => {}, source = "user") {
  const submit = (action) => { if (!action || action.disabled) return; closeDialog(); onAction(action); };
  if (kind === "color") {
    const body = document.createElement("div");
    const choices = document.createElement("div");
    choices.className = "choice-grid color-choices";
    ["red", "yellow", "green", "blue"].forEach((color, index) => {
      const action = payload.actions?.find((candidate) => (candidate.type === "CHOOSE_COLOR" ? candidate.color : candidate.colorChoice) === color);
      const item = button(`${index + 1} · ${colorNames[color]}`, () => submit(action), `btn btn-color-${color}`, action);
      item.disabled = !action || Boolean(action.disabled);
      item.dataset.color = color;
      choices.append(item);
    });
    body.append(choices);
    const card = show("选择颜色", body, [button("取消", closeDialog, "btn btn-ghost")], source);
    card.addEventListener("keydown", (event) => { if (/^[1-4]$/.test(event.key)) { event.preventDefault(); choices.children[Number(event.key) - 1].click(); } });
    return;
  }
  if (kind === "challenge") {
    const actions = (payload.actions || []).filter((item) => ["DECLINE_CHALLENGE", "CHALLENGE_W4"].includes(item.type));
    show("+4 挑战", paragraph("上家出了 +4。接受摸牌，或挑战并查看手牌。"), actions.map((action) => button(action.label, () => submit(action), action.type === "CHALLENGE_W4" ? "btn btn-primary" : "btn", action)), source);
    return;
  }
  // BUG-02：CALL_UNO 已改为单击直接喊（不弹确认框），这里只保留「抓 UNO」确认弹窗。
  if (kind === "catch") {
    show("抓 UNO", paragraph("有人忘了喊 UNO。"), [button(payload.label, () => submit(payload), "btn btn-primary", payload)], source);
    return;
  }
  if (kind === "confirm-quit") {
    show("确认退出", paragraph("退出对局并返回大厅？"), [button("继续对局", closeDialog, "btn btn-ghost"), button("退出对局", () => submit({ type: "BACK_TO_LOBBY" }), "btn btn-danger")], source);
    return;
  }
  if (kind === "stats") {
    const stats = getStats();
    show("本地战绩", paragraph(`对局 ${stats.games} · 获胜 ${stats.wins}`), [button("知道了", closeDialog, "btn btn-primary")], source);
    return;
  }
  if (kind === "settings") {
    const settings = getSettings();
    const body = document.createElement("div");
    body.className = "settings-list";
    // M5-06：规则项接入设置页（默认值与引擎 DEFAULT_GAME_CONFIG 一致，仅对新开对局生效）
    const field = (label, key, options = null) => {
      const row = document.createElement("label");
      row.className = "setting-row";
      const text = document.createElement("span");
      text.textContent = label;
      const input = document.createElement(options ? "select" : "input");
      input.name = key;
      input.setAttribute("aria-label", label);
      if (options) {
        options.forEach(([value, name]) => { const option = document.createElement("option"); option.value = String(value); option.textContent = name; input.append(option); });
        input.value = String(settings[key]);
        if (key === "unoPenalty" || key === "soundVolume") input.dataset.numeric = "true";
      } else { input.type = "checkbox"; input.checked = Boolean(settings[key]); }
      input.dataset.setting = key;
      row.append(text, input);
      body.append(row);
    };
    field("音效", "sound");
    field("音效音量", "soundVolume", [[0.35, "低"], [0.7, "中"], [1, "高"]]);
    field("动画", "animation");
    field("动画速度", "animationSpeed", [["normal", "正常"], ["fast", "快速"]]);
    field("AI 速度", "aiSpeed", [["slow", "慢"], ["normal", "正常"], ["fast", "快"]]);
    field("自动喊 UNO", "autoCallUno");
    // M10-03：桌面版自填智谱 Key（浏览器模式不显示；Key 只经 IPC 交给主进程加密保存）
    const desktopAiKey = window.unoDesktop?.aiKey;
    if (desktopAiKey) {
      const keyHeading = document.createElement("h3");
      keyHeading.className = "settings-heading";
      keyHeading.textContent = "智谱 API Key（桌面版）";
      const keyRow = document.createElement("label");
      keyRow.className = "setting-row is-text";
      const keyLabel = document.createElement("span");
      keyLabel.textContent = "API Key";
      const keyInput = document.createElement("input");
      keyInput.type = "password";
      keyInput.name = "zhipuApiKey";
      keyInput.autocomplete = "off";
      keyInput.spellcheck = false;
      keyInput.placeholder = "粘贴智谱 API Key";
      keyInput.setAttribute("aria-label", "智谱 API Key");
      keyInput.dataset.aiKeyInput = "true";
      keyRow.append(keyLabel, keyInput);
      const keyStatus = document.createElement("p");
      keyStatus.className = "settings-note";
      keyStatus.setAttribute("aria-live", "polite");
      keyStatus.dataset.aiKeyStatus = "true";
      keyStatus.textContent = "正在读取 Key 状态…";
      const keyActions = document.createElement("div");
      keyActions.className = "setting-actions";

      const describe = (status, extra = "") => {
        if (!status) return extra || "无法读取 Key 状态。";
        let text;
        if (status.configured && status.source === "desktop") {
          text = `已保存自填 Key（重启后仍保留），当前模型 ${status.model}。`;
        } else if (status.configured && status.source === "env") {
          text = `正在使用 .env 中的 Key，当前模型 ${status.model}；保存自填 Key 后将优先使用自填 Key。`;
        } else if (status.configured) {
          text = `已配置 Key，当前模型 ${status.model}。`;
        } else {
          text = "未配置 Key：AI 对手会使用本地启发式，在线智谱不可用。";
        }
        if (!status.encryptionAvailable) text += " 系统安全存储不可用，无法保存自填 Key。";
        return extra ? `${extra} ${text}` : text;
      };
      const applyStatus = (status, extra = "") => {
        keyStatus.textContent = describe(status, extra);
        clearKey.disabled = !status || status.source !== "desktop";
        keyInput.disabled = Boolean(status && !status.encryptionAvailable);
      };
      const refresh = async (extra = "") => {
        try { applyStatus(await desktopAiKey.getStatus(), extra); }
        catch { keyStatus.textContent = "无法读取 Key 状态，请重试。"; }
      };

      const saveKey = button("保存 Key", async () => {
        const value = keyInput.value.trim();
        if (!value) { keyStatus.textContent = "请先粘贴 API Key。"; keyInput.focus(); return; }
        saveKey.disabled = true;
        keyStatus.textContent = "正在保存…";
        try {
          const result = await desktopAiKey.save(value);
          if (result?.ok) { keyInput.value = ""; applyStatus(result.status, "已保存，新开对局生效。"); }
          else keyStatus.textContent = result?.message || "保存 Key 失败，请重试。";
        } catch { keyStatus.textContent = "保存 Key 失败，请重试。"; }
        finally { saveKey.disabled = false; }
      }, "btn btn-ghost");
      const clearKey = button("清除 Key", async () => {
        clearKey.disabled = true;
        keyStatus.textContent = "正在清除…";
        try {
          const result = await desktopAiKey.clear();
          if (result?.ok) applyStatus(result.status, "已清除，回退到 .env / 本地 AI。");
          else keyStatus.textContent = result?.message || "清除 Key 失败，请重试。";
        } catch { keyStatus.textContent = "清除 Key 失败，请重试。"; }
      }, "btn btn-ghost");
      clearKey.disabled = true;
      keyActions.append(saveKey, clearKey);
      body.append(keyHeading, keyRow, keyStatus, keyActions, paragraph("Key 仅保存在本机并由系统加密（Windows DPAPI），不会写入安装包或日志；留空则自动使用本地 AI。"));
      void refresh();
    }
    const rulesHeading = document.createElement("h3");
    rulesHeading.className = "settings-heading";
    rulesHeading.textContent = "规则（对之后新开的对局生效）";
    body.append(rulesHeading);
    field("2 人特殊规则（Reverse 等同 Skip / 连动）", "twoPlayerRules");
    field("UNO 罚牌张数", "unoPenalty", [[1, "1 张"], [2, "2 张（官方）"], [3, "3 张"]]);
    field("牌堆耗尽", "deckExhaustion", [["reshuffle", "洗回弃牌堆（官方）"], ["end-by-fewest", "耗尽即结束（手牌最少者胜）"]]);
    field("起始动作牌", "startCardRule", [["classic", "照常生效（官方）"], ["ignore-action", "忽略动作牌，继续翻牌"]]);
    const rulesNote = paragraph("规则设置只影响之后新开的对局；默认值为官方口径，可随时改回。");
    rulesNote.className = "settings-note";
    const testResult = document.createElement("p");
    testResult.className = "setting-test-result";
    testResult.setAttribute("aria-live", "polite");
    body.append(rulesNote, testResult);
    const testButton = button("测试智谱连接", async () => {
      testButton.disabled = true;
      testResult.textContent = "正在测试智谱连接…（首次约 2~3 秒）";
      const client = createAiClient({ timeoutMs: 12000 });
      const result = await client.testConnection();
      testButton.disabled = false;
      testResult.textContent = result.ok
        ? `智谱连接正常：${result.model || "未知模型"}（${result.latencyMs} ms）`
        : result.message;
    }, "btn btn-ghost");
    show("设置", body, [testButton, button("保存", () => {
      const next = { ...settings };
      body.querySelectorAll("[data-setting]").forEach((input) => { next[input.dataset.setting] = input.tagName === "SELECT" ? (input.dataset.numeric === "true" ? Number(input.value) : input.value) : input.checked; });
      try { saveSettings(next); closeDialog(); window.dispatchEvent(new Event("uno:settings-changed")); }
      catch { body.append(paragraph("无法保存设置，请检查浏览器是否允许本地存储。")); }
    }, "btn btn-primary"), button("取消", closeDialog, "btn btn-ghost")], source);
  }
}

export function installDialogKeyboard() {
  document.addEventListener("keydown", (event) => {
    const root = document.querySelector("#dialog-root");
    if (!root.classList.contains("is-open")) return;
    if (event.key === "Escape") { event.preventDefault(); closeDialog(); }
    if (event.key === "Tab") {
      const focusables = [...root.querySelectorAll("button, input, select")].filter((item) => !item.disabled);
      if (!focusables.length) return;
      const current = focusables.indexOf(document.activeElement);
      const next = event.shiftKey ? (current <= 0 ? focusables.length - 1 : current - 1) : (current + 1) % focusables.length;
      event.preventDefault(); focusables[next].focus();
    }
  });
}
