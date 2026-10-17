/**
 * 候选动作生成（M2）：从引擎 `getLegalActions` 映射为带特征/评分/理由的候选。
 *
 * 说明：
 * - AI 只从合法动作里选（不修改引擎契约、不产生非法动作）；
 * - `CALL_UNO` / `CATCH_UNO` 是"人类窗口动作"，AI 的喊/抓由引擎 M1-6 自动按难度概率结算，
 *   因此候选生成时会过滤掉窗口动作（引擎注释也要求 M2 自行过滤）；
 * - 万能牌的颜色选项：引擎已经把 Wild/Wild4 展开成 4 个动作，这里保留为 4 个候选。
 */
import { COLOR_NAME, cardLabel, getLegalActions } from '@uno/game-core';
import type { Card, Color, EngineAction, GameState } from '@uno/game-core';
import type { AiMemory, AiView, Candidate, DifficultyProfile } from './types.ts';
import { extractFeatures } from './features.ts';
import type { CandidateDraft, FeatureContext } from './features.ts';
import { weightedScore } from './scoring.ts';

/** 候选生成上下文 */
export interface GenerateCandidatesContext {
  state: GameState;
  seat: number;
  view: AiView;
  memory: AiMemory;
  profile: DifficultyProfile;
}

/** 在 AI 自己的手牌里找一张牌 */
function findOwnCard(view: AiView, cardId: string): Card {
  const card = view.hand.find((item) => item.id === cardId);
  if (!card) throw new Error(`AI 手牌中没有 ${cardId}（视图与引擎状态不一致）`);
  return card;
}

/** 引擎动作 → 候选草稿 */
function toDraft(action: EngineAction, view: AiView): CandidateDraft {
  switch (action.type) {
    case 'PLAY_CARD':
      return {
        kind: 'play',
        action,
        card: findOwnCard(view, action.cardId),
        colorChoice: action.colorChoice ?? null,
      };
    case 'PLAY_DRAWN': {
      const card = view.drawnThisTurn;
      if (!card) throw new Error('PLAY_DRAWN 候选缺少抽到的牌');
      return { kind: 'play-drawn', action, card, colorChoice: action.colorChoice ?? null };
    }
    case 'DRAW':
      return { kind: 'draw', action, card: null, colorChoice: null };
    case 'END_TURN':
      return { kind: 'end-turn', action, card: null, colorChoice: null };
    case 'CHOOSE_COLOR':
      return { kind: 'choose-color', action, card: null, colorChoice: action.color };
    case 'STACK_PLAY':
      return {
        kind: 'stack-play',
        action,
        card: findOwnCard(view, action.cardId),
        colorChoice: action.colorChoice ?? null,
      };
    case 'STACK_DECLINE':
      return { kind: 'stack-decline', action, card: null, colorChoice: null };
    case 'CHALLENGE_W4':
      return { kind: 'challenge', action, card: null, colorChoice: null };
    case 'DECLINE_CHALLENGE':
      return { kind: 'decline-challenge', action, card: null, colorChoice: null };
    case 'CALL_UNO':
    case 'CATCH_UNO':
      throw new Error('UNO 窗口动作不应生成 AI 候选（应在过滤阶段排除）');
  }
}

/** 候选唯一 id */
function candidateId(action: EngineAction): string {
  switch (action.type) {
    case 'PLAY_CARD':
    case 'PLAY_DRAWN':
    case 'STACK_PLAY':
      return `${action.type}:${action.cardId}:${action.colorChoice ?? '-'}`;
    case 'CHOOSE_COLOR':
      return `CHOOSE_COLOR:${action.color}`;
    case 'CATCH_UNO':
      return `CATCH_UNO:${action.targetSeat}`;
    default:
      return action.type;
  }
}

function colorNameOf(color: Color | null): string {
  return color ? COLOR_NAME[color] : '';
}

/** 生成中文一句话理由（供日志 / 后续 M4 LLM 参考） */
function makeNote(candidate: Candidate, view: AiView): string {
  const { card, colorChoice } = candidate;
  switch (candidate.kind) {
    case 'play': {
      if (!card) return '出牌';
      if (card.kind === 'wild' || card.kind === 'wild4') {
        const kept = view.hand.filter((item) => item.color === colorChoice).length;
        return `出 ${cardLabel(card)} → ${colorNameOf(colorChoice)}（手中 ${kept} 张${colorNameOf(colorChoice)}）`;
      }
      if (card.color) {
        const kept = view.hand.filter(
          (item) => item.id !== card.id && item.color === card.color,
        ).length;
        return `出 ${cardLabel(card)}（保留 ${kept} 张${colorNameOf(card.color)}）`;
      }
      return `出 ${cardLabel(card)}`;
    }
    case 'play-drawn':
      return `出刚抽到的 ${card ? cardLabel(card) : '牌'}`;
    case 'draw':
      return '抽 1 张';
    case 'end-turn':
      return '结束回合（保留抽到的牌）';
    case 'choose-color': {
      const count = view.hand.filter((item) => item.color === colorChoice).length;
      return `选${colorNameOf(colorChoice)}（手中 ${count} 张）`;
    }
    case 'stack-play': {
      const total = (view.stack?.total ?? 0) + (card?.kind === 'draw2' ? 2 : 4);
      return `叠 ${card ? cardLabel(card) : '牌'}（累计 ${total} 张）`;
    }
    case 'stack-decline':
      return `放弃叠牌，摸 ${view.stack?.total ?? 0} 张`;
    case 'challenge':
      return `挑战 +4（估算对方违规概率 ${Math.round(candidate.features.challengeSuccess * 100)}%）`;
    case 'decline-challenge':
      return `接受 +4，摸 ${view.pendingChallenge?.total ?? 4} 张`;
  }
}

/** 生成某座位当前局面的全部候选（含特征/评分/理由） */
export function generateCandidates(context: GenerateCandidatesContext): Candidate[] {
  const legal = getLegalActions(context.state);
  if (legal.length === 0) {
    throw new Error(`座位 ${context.seat} 当前没有合法动作（引擎状态异常）`);
  }

  const featureContext: FeatureContext = {
    view: context.view,
    memory: context.memory,
    profile: context.profile,
    seat: context.seat,
  };

  const candidates: Candidate[] = [];
  for (const action of legal) {
    // AI 的 UNO 喊/抓由引擎自动结算；窗口动作不属于 AI 决策范围
    if (action.type === 'CALL_UNO' || action.type === 'CATCH_UNO') continue;

    const draft = toDraft(action, context.view);
    const candidate: Candidate = {
      id: candidateId(action),
      kind: draft.kind,
      action,
      card: draft.card,
      colorChoice: draft.colorChoice,
      features: extractFeatures(draft, featureContext),
      score: 0,
      rawScore: 0,
      note: '',
    };
    candidate.rawScore = weightedScore(candidate, context.profile);
    candidate.note = makeNote(candidate, context.view);
    candidates.push(candidate);
  }

  if (candidates.length === 0) {
    throw new Error(`座位 ${context.seat} 过滤后没有可用的 AI 候选（引擎状态异常）`);
  }
  return candidates;
}
