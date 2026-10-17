import { getSettings } from "../state/settings.js";

/**
 * M6-02：音效（Web Audio 合成，零外部音频资源、无第三方依赖）。
 *
 * - 默认音效关闭（DEFAULT_GAME_CONFIG/设置默认 sound:false？—— 见 `state/settings.js`：
 *   本作默认 sound:true，可在设置页关闭并调节音量）；
 * - 浏览器 autoplay 限制：首次用户交互（pointerdown/keydown）时创建并 resume AudioContext，
 *   之后的事件音效才真正可听；
 * - 音量取 `uno:settings.soundVolume`（0~1，设置页 低/中/高）；
 * - 调试/自动化可读 `documentElement.dataset.audio`（AudioContext.state）与
 *   `data-sfx-count`（已触发的音效次数）。
 */

let context = null;
let unlocked = false;

function audioContext() {
  if (context) return context;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    return null;
  }
  updateAudioState();
  return context;
}

function updateAudioState() {
  if (context) document.documentElement.dataset.audio = context.state;
}

function volume() {
  const settings = getSettings();
  if (settings.sound === false) return 0;
  const value = Number(settings.soundVolume);
  if (!Number.isFinite(value)) return 0.7;
  return Math.min(1, Math.max(0, value));
}

/** 在首次用户交互时解锁音频（autoplay 限制） */
export function installAudioUnlock() {
  if (installAudioUnlock.installed) return;
  installAudioUnlock.installed = true;
  const handler = () => {
    unlocked = true;
    const ctx = audioContext();
    if (!ctx) return;
    updateAudioState();
    if (ctx.state === "suspended") {
      ctx.resume().then(updateAudioState).catch(() => {});
    }
    document.removeEventListener("pointerdown", handler);
    document.removeEventListener("keydown", handler);
  };
  document.addEventListener("pointerdown", handler, { passive: true });
  document.addEventListener("keydown", handler);
}

function tone(freq, duration, { type = "sine", gain = 0.6, slideTo = null, delay = 0 } = {}) {
  const ctx = audioContext();
  const vol = volume();
  if (!ctx || vol <= 0) return;
  const t0 = ctx.currentTime + Math.max(0, delay);
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(20, freq), t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + duration);
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.2 * gain * vol), t0 + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(env).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.03);
}

function noise(duration = 0.2, { gain = 0.35, delay = 0 } = {}) {
  const ctx = audioContext();
  const vol = volume();
  if (!ctx || vol <= 0) return;
  const frames = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < frames; index += 1) data[index] = (Math.random() * 2 - 1) * (1 - index / frames);
  const source = ctx.createBufferSource();
  const env = ctx.createGain();
  env.gain.value = gain * vol;
  source.buffer = buffer;
  source.connect(env).connect(ctx.destination);
  source.start(ctx.currentTime + Math.max(0, delay));
}

const RECIPES = {
  deal() {
    tone(520, 0.05, { type: "triangle", gain: 0.4 });
    tone(660, 0.05, { type: "triangle", gain: 0.35, delay: 0.08 });
  },
  play() {
    tone(320, 0.08, { type: "triangle", gain: 0.7, slideTo: 170 });
    noise(0.06, { gain: 0.18 });
  },
  draw() {
    tone(430, 0.06, { type: "sine", gain: 0.5, slideTo: 300 });
    noise(0.07, { gain: 0.14 });
  },
  skip() {
    tone(150, 0.12, { type: "square", gain: 0.5, slideTo: 120 });
  },
  reverse() {
    tone(290, 0.17, { type: "triangle", gain: 0.6, slideTo: 540 });
  },
  color() {
    tone(660, 0.12, { type: "sine", gain: 0.5 });
    tone(880, 0.1, { type: "sine", gain: 0.35, delay: 0.07 });
  },
  stack() {
    tone(360, 0.08, { type: "square", gain: 0.45, slideTo: 440 });
    tone(440, 0.08, { type: "square", gain: 0.4, delay: 0.07 });
  },
  challenge() {
    tone(440, 0.15, { type: "triangle", gain: 0.55, slideTo: 700 });
    tone(880, 0.12, { type: "sine", gain: 0.3, delay: 0.1 });
  },
  fail() {
    tone(230, 0.2, { type: "sawtooth", gain: 0.4, slideTo: 110 });
  },
  uno() {
    tone(523, 0.1, { type: "square", gain: 0.45 });
    tone(659, 0.14, { type: "square", gain: 0.4, delay: 0.1 });
  },
  caught() {
    tone(200, 0.16, { type: "sawtooth", gain: 0.45, slideTo: 160 });
    tone(150, 0.14, { type: "square", gain: 0.35, delay: 0.14 });
  },
  out() {
    tone(392, 0.09, { type: "triangle", gain: 0.5 });
    tone(523, 0.09, { type: "triangle", gain: 0.45, delay: 0.09 });
    tone(659, 0.12, { type: "triangle", gain: 0.4, delay: 0.18 });
  },
  win() {
    [523, 659, 784, 1046].forEach((freq, index) => {
      tone(freq, 0.16, { type: "triangle", gain: 0.5, delay: index * 0.11 });
    });
  },
  lose() {
    [392, 330, 262].forEach((freq, index) => {
      tone(freq, 0.18, { type: "sine", gain: 0.45, delay: index * 0.13 });
    });
  },
  drawGame() {
    tone(330, 0.18, { type: "sine", gain: 0.4 });
    tone(330, 0.18, { type: "sine", gain: 0.4, delay: 0.2 });
  },
  shuffle() {
    noise(0.24, { gain: 0.4 });
  },
};

/** 播放一个合成音效；返回是否真正尝试了播放（受设置开关与音量影响） */
export function playSfx(name) {
  const recipe = RECIPES[name];
  if (!recipe) return false;
  if (volume() <= 0) return false;
  const ctx = audioContext();
  if (!ctx) return false;
  try {
    recipe();
  } catch {
    return false;
  }
  const count = Number(document.documentElement.dataset.sfxCount || "0") + 1;
  document.documentElement.dataset.sfxCount = String(count);
  updateAudioState();
  return true;
}

/** 事件 → 音效映射（由事件队列逐条调用） */
export function playSfxForEvent(event) {
  if (!event || !event.type) return false;
  switch (event.type) {
    case "DEAL":
      return playSfx("deal");
    case "PLAY":
      return playSfx("play");
    case "DRAW":
    case "PENALTY":
      return Number(event.count) > 0 ? playSfx("draw") : false;
    case "SKIP":
      return playSfx("skip");
    case "REVERSE":
      return playSfx("reverse");
    case "COLOR_SET":
    case "START_CARD":
      return playSfx("color");
    case "STACK_PUSH":
      return playSfx("stack");
    case "STACK_RESOLVE":
      return playSfx("draw");
    case "CHALLENGE_SUCCESS":
      return playSfx("challenge");
    case "CHALLENGE_FAIL":
      return playSfx("fail");
    case "UNO_CALLED":
      return playSfx("uno");
    case "UNO_CAUGHT":
      return playSfx("caught");
    case "PLAYER_OUT":
      return playSfx("out");
    case "ROUND_END":
      if (event.winnerSeat === null || event.winnerSeat === undefined) return playSfx("drawGame");
      return playSfx(Number(event.winnerSeat) === 0 ? "win" : "lose");
    case "PILE_RESHUFFLE":
      return playSfx("shuffle");
    default:
      return false;
  }
}
