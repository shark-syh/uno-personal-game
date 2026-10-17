/**
 * 智谱决策 Prompt 与输出解析（M4，对应 `docs/开发计划.md` 6.6）。
 *
 * 服务端只接收前端裁剪过的**公开信息 + 自己手牌 + 候选动作**，
 * 不会收到其他玩家手牌/隐藏信息；系统提示词按难度切换风格/温度/台词要求。
 * 输出约定：只输出 JSON `{ action_id, reason, line }`。
 */
import type { Difficulty } from '@uno/game-core';
import type { ChatMessage } from '../zhipu.ts';

export interface LlmDifficultyProfile {
  label: string;
  /** 前端使用的 LLM 参与频率（0~1） */
  llmChance: number;
  temperature: number;
  maxTokens: number;
  /** 风格描述（写进 system prompt） */
  style: string;
}

/** 四档难度的 LLM 参数（对齐开发计划 6.6 参数建议表） */
export const LLM_DIFFICULTY: Record<Difficulty, LlmDifficultyProfile> = {
  casual: {
    label: '休闲',
    llmChance: 0.3,
    temperature: 0.9,
    maxTokens: 220,
    style: '憨憨话多、爱自夸、偶尔犯迷糊；台词轻松俏皮，可以有点笨拙的自信',
  },
  easy: {
    label: '简单',
    llmChance: 0.6,
    temperature: 0.7,
    maxTokens: 260,
    style: '话不多、水平一般但稳当；台词简短自然',
  },
  realistic: {
    label: '真实',
    llmChance: 1,
    temperature: 0.5,
    maxTokens: 360,
    style: '像普通老玩家：会算牌、会压人，说话自然、偶尔调侃',
  },
  hardcore: {
    label: '骨灰级',
    llmChance: 1,
    temperature: 0.3,
    maxTokens: 450,
    style: '话少但毒舌、心理战高手；只在对胜负重要时开口，台词短促有力',
  },
};

/** 前端发来的候选动作（展示信息，服务端只用于 Prompt 与校验） */
export interface LlmCandidate {
  id: string;
  kind: string;
  action: string;
  card: string | null;
  color: string | null;
  score: number;
  note: string;
}

export interface LlmSeatView {
  seat: number;
  name: string;
  handCount: number;
  saidUno: boolean;
  isHuman: boolean;
}

export interface LlmTable {
  topCard: string | null;
  currentColor: string | null;
  direction: 'clockwise' | 'counterclockwise';
  drawPileCount: number;
  discardTop3: string[];
  stack: { total: number; chain: string[]; awaitingSeat: number } | null;
  phase: string;
}

export interface LlmDecisionPayload {
  difficulty: Difficulty;
  seat: number;
  playerName: string;
  you: { hand: string[]; handCount: number };
  table: LlmTable;
  players: LlmSeatView[];
  candidates: LlmCandidate[];
  historySummary: string[];
}

export interface LlmDecision {
  actionId: string;
  reason: string;
  line: string;
}

const ACTION_KINDS = new Set([
  'PLAY_CARD',
  'PLAY_DRAWN',
  'DRAW',
  'END_TURN',
  'CHOOSE_COLOR',
  'STACK_PLAY',
  'STACK_DECLINE',
  'CHALLENGE_W4',
  'DECLINE_CHALLENGE',
  'CALL_UNO',
  'CATCH_UNO',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDifficulty(value: unknown): value is Difficulty {
  return value === 'casual' || value === 'easy' || value === 'realistic' || value === 'hardcore';
}

function readStringArray(value: unknown, maxItems: number, maxLength: number): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > maxItems) return null;
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length > maxLength) return null;
    result.push(item);
  }
  return result;
}

/**
 * 校验前端请求体（手写校验，不引入额外依赖）。
 * 对数组长度/字符串长度设上限，避免把异常大 payload 转发给 LLM。
 */
export function validateDecisionPayload(
  body: unknown,
): { ok: true; payload: LlmDecisionPayload } | { ok: false; message: string } {
  if (!isRecord(body)) return { ok: false, message: '请求体必须是 JSON 对象' };
  if (!isDifficulty(body.difficulty)) return { ok: false, message: 'difficulty 非法' };
  if (
    typeof body.seat !== 'number' ||
    !Number.isInteger(body.seat) ||
    body.seat < 0 ||
    body.seat > 9
  ) {
    return { ok: false, message: 'seat 非法' };
  }
  if (
    typeof body.playerName !== 'string' ||
    body.playerName.length === 0 ||
    body.playerName.length > 24
  ) {
    return { ok: false, message: 'playerName 非法' };
  }
  if (!isRecord(body.you)) return { ok: false, message: 'you 非法' };
  const hand = readStringArray(body.you.hand, 30, 16);
  if (!hand) return { ok: false, message: 'you.hand 非法' };
  if (typeof body.you.handCount !== 'number' || body.you.handCount !== hand.length) {
    return { ok: false, message: 'you.handCount 与 hand 不一致' };
  }
  if (!isRecord(body.table)) return { ok: false, message: 'table 非法' };
  const table = body.table;
  if (table.topCard !== null && (typeof table.topCard !== 'string' || table.topCard.length > 16)) {
    return { ok: false, message: 'table.topCard 非法' };
  }
  if (
    typeof table.drawPileCount !== 'number' ||
    table.drawPileCount < 0 ||
    table.drawPileCount > 108
  ) {
    return { ok: false, message: 'table.drawPileCount 非法' };
  }
  if (table.currentColor !== null && typeof table.currentColor !== 'string') {
    return { ok: false, message: 'table.currentColor 非法' };
  }
  if (table.direction !== 'clockwise' && table.direction !== 'counterclockwise') {
    return { ok: false, message: 'table.direction 非法' };
  }
  if (typeof table.phase !== 'string' || table.phase.length > 24) {
    return { ok: false, message: 'table.phase 非法' };
  }
  const discardTop3 = readStringArray(table.discardTop3, 3, 16);
  if (!discardTop3) return { ok: false, message: 'table.discardTop3 非法' };

  let stack: LlmTable['stack'] = null;
  if (table.stack !== null && table.stack !== undefined) {
    if (!isRecord(table.stack)) return { ok: false, message: 'table.stack 非法' };
    const chain = readStringArray(table.stack.chain, 30, 16);
    if (!chain) return { ok: false, message: 'table.stack.chain 非法' };
    if (
      typeof table.stack.total !== 'number' ||
      table.stack.total <= 0 ||
      table.stack.total > 108
    ) {
      return { ok: false, message: 'table.stack.total 非法' };
    }
    if (typeof table.stack.awaitingSeat !== 'number') {
      return { ok: false, message: 'table.stack.awaitingSeat 非法' };
    }
    stack = { total: table.stack.total, chain, awaitingSeat: table.stack.awaitingSeat };
  }

  if (!Array.isArray(body.players) || body.players.length < 2 || body.players.length > 10) {
    return { ok: false, message: 'players 非法' };
  }
  const players: LlmSeatView[] = [];
  for (const raw of body.players) {
    if (!isRecord(raw)) return { ok: false, message: 'players 项非法' };
    if (typeof raw.seat !== 'number' || typeof raw.name !== 'string' || raw.name.length > 24) {
      return { ok: false, message: 'players 项非法' };
    }
    if (typeof raw.handCount !== 'number' || raw.handCount < 0 || raw.handCount > 30) {
      return { ok: false, message: 'players.handCount 非法' };
    }
    players.push({
      seat: raw.seat,
      name: raw.name,
      handCount: raw.handCount,
      saidUno: raw.saidUno === true,
      isHuman: raw.isHuman === true,
    });
  }

  if (
    !Array.isArray(body.candidates) ||
    body.candidates.length < 1 ||
    body.candidates.length > 40
  ) {
    return { ok: false, message: 'candidates 非法' };
  }
  const candidates: LlmCandidate[] = [];
  for (const raw of body.candidates) {
    if (!isRecord(raw)) return { ok: false, message: 'candidates 项非法' };
    if (typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > 80) {
      return { ok: false, message: 'candidate.id 非法' };
    }
    if (typeof raw.action !== 'string' || !ACTION_KINDS.has(raw.action)) {
      return { ok: false, message: `candidate.action 非法：${String(raw.action)}` };
    }
    candidates.push({
      id: raw.id,
      kind: typeof raw.kind === 'string' && raw.kind.length <= 24 ? raw.kind : 'unknown',
      action: raw.action,
      card: typeof raw.card === 'string' && raw.card.length <= 16 ? raw.card : null,
      color: typeof raw.color === 'string' && raw.color.length <= 12 ? raw.color : null,
      score: typeof raw.score === 'number' && Number.isFinite(raw.score) ? raw.score : 0,
      note: typeof raw.note === 'string' ? raw.note.slice(0, 120) : '',
    });
  }

  const historySummary = readStringArray(body.historySummary ?? [], 12, 40);
  const payload: LlmDecisionPayload = {
    difficulty: body.difficulty,
    seat: body.seat,
    playerName: body.playerName,
    you: { hand, handCount: hand.length },
    table: {
      topCard: typeof table.topCard === 'string' ? table.topCard : null,
      currentColor: typeof table.currentColor === 'string' ? table.currentColor : null,
      direction: table.direction,
      drawPileCount: table.drawPileCount,
      discardTop3,
      stack,
      phase: table.phase,
    },
    players,
    candidates,
    historySummary: historySummary ?? [],
  };
  if (JSON.stringify(payload).length > 24_000) {
    return { ok: false, message: '请求体过大' };
  }
  return { ok: true, payload };
}

/** 构建系统提示词（按难度风格） */
export function buildSystemPrompt(payload: LlmDecisionPayload): string {
  const profile = LLM_DIFFICULTY[payload.difficulty];
  return [
    `你是本地 UNO 单机版中的 AI 对手「${payload.playerName}」，难度档位：${profile.label}。`,
    '规则摘要：',
    '- 108 张标准 UNO，2~10 人；本作采用宽松叠法：+2 与 +4 可任意互相叠加，接不上的人摸累计张数并失去回合。',
    '- 单局定胜负，先出完手牌者胜；其余按官方规则（UNO 喊牌、+4 挑战、方向/跳过/+2 等）。',
    '- 你只能使用给你的公开信息和自己的手牌，禁止假设能看到其他玩家手牌。',
    `你的风格：${profile.style}。`,
    '任务：从候选动作列表中选择一个最优动作，并给出：',
    '1) action_id（必须是候选列表中的 id，逐字一致）',
    '2) reason（中文一句话，≤40 字，仅用于说明你的思考）',
    '3) line（对玩家说的一句中文台词，≤20 字，可为空字符串）',
    '输出要求：只输出 JSON，不要 Markdown、不要代码块、不要额外文字：',
    '{"action_id":"...","reason":"...","line":"..."}',
  ].join('\n');
}

/** 构建用户消息（JSON 快照，仅公开信息 + 自己手牌） */
export function buildUserPrompt(payload: LlmDecisionPayload): string {
  return JSON.stringify(
    {
      you: { seat: payload.seat, name: payload.playerName, hand: payload.you.hand },
      table: payload.table,
      players: payload.players,
      candidates: payload.candidates,
      historySummary: payload.historySummary,
    },
    null,
    0,
  );
}

/** 构建完整 messages */
export function buildDecisionMessages(payload: LlmDecisionPayload): ChatMessage[] {
  return [
    { role: 'system', content: buildSystemPrompt(payload) },
    { role: 'user', content: buildUserPrompt(payload) },
  ];
}

/** 从模型输出中提取 JSON（容忍代码块/前后杂文字） */
export function extractJsonObject(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidateText = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(candidateText);
  } catch {
    const start = candidateText.indexOf('{');
    const end = candidateText.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidateText.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** 解析并校验模型输出（action_id/reason/line） */
export function parseDecisionOutput(
  content: string,
  candidateIds: ReadonlySet<string>,
):
  | { ok: true; decision: LlmDecision }
  | { ok: false; code: 'AI_INVALID_OUTPUT' | 'AI_INVALID_ACTION'; message: string } {
  const parsed = extractJsonObject(content);
  if (!isRecord(parsed)) {
    return { ok: false, code: 'AI_INVALID_OUTPUT', message: '模型输出不是合法 JSON 对象' };
  }
  const actionId = typeof parsed.action_id === 'string' ? parsed.action_id.trim() : '';
  if (actionId.length === 0) {
    return { ok: false, code: 'AI_INVALID_OUTPUT', message: '模型输出缺少 action_id' };
  }
  if (!candidateIds.has(actionId)) {
    return {
      ok: false,
      code: 'AI_INVALID_ACTION',
      message: `模型选择了候选之外的 action_id：${actionId}`,
    };
  }
  const reason = typeof parsed.reason === 'string' ? parsed.reason.trim().slice(0, 60) : '';
  const line = typeof parsed.line === 'string' ? parsed.line.trim().slice(0, 30) : '';
  return { ok: true, decision: { actionId, reason, line } };
}
