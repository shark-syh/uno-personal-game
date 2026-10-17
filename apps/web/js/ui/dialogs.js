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
  if (kind === "uno" || kind === "catch") {
    show(kind === "uno" ? "UNO!" : "抓 UNO", paragraph(kind === "uno" ? "只剩最后一张！" : "有人忘了喊 UNO。"), [button(payload.label, () => submit(payload), kind === "uno" ? "btn btn-primary btn-large uno-button" : "btn btn-primary", payload)], source);
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
    const field = (label, key, select = false) => {
      const row = document.createElement("label");
      row.className = "setting-row";
      const text = document.createElement("span");
      text.textContent = label;
      const input = document.createElement(select ? "select" : "input");
      input.name = key;
      input.setAttribute("aria-label", label);
      if (select) {
        [["slow", "慢"], ["normal", "正常"], ["fast", "快"]].forEach(([value, name]) => { const option = document.createElement("option"); option.value = value; option.textContent = name; input.append(option); });
        input.value = settings[key];
      } else { input.type = "checkbox"; input.checked = settings[key]; }
      input.dataset.setting = key;
      row.append(text, input);
      body.append(row);
    };
    field("音效", "sound"); field("动画", "animation"); field("AI 速度", "aiSpeed", true); field("自动喊 UNO", "autoCallUno");
    const testResult = document.createElement("p");
    testResult.className = "setting-test-result";
    testResult.setAttribute("aria-live", "polite");
    body.append(testResult);
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
      body.querySelectorAll("[data-setting]").forEach((input) => { next[input.dataset.setting] = input.tagName === "SELECT" ? input.value : input.checked; });
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
