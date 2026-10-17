import { describe, expect, it } from 'vitest';
import {
  buildDecisionMessages,
  buildSystemPrompt,
  parseDecisionOutput,
  validateDecisionPayload,
} from '../src/prompts/ai-decide.ts';

function validPayload(): Record<string, unknown> {
  return {
    difficulty: 'realistic',
    seat: 1,
    playerName: '老王',
    you: { hand: ['R7', 'W4'], handCount: 2 },
    table: {
      topCard: 'B3',
      currentColor: 'blue',
      direction: 'clockwise',
      drawPileCount: 40,
      discardTop3: ['B3', 'G5'],
      stack: { total: 4, chain: ['B+2'], awaitingSeat: 1 },
      phase: 'stack-response',
    },
    players: [
      { seat: 0, name: '你', handCount: 3, saidUno: false, isHuman: true },
      { seat: 1, name: '老王', handCount: 2, saidUno: false, isHuman: false },
    ],
    candidates: [
      {
        id: 'stack:W4#0:blue',
        kind: 'stack-play',
        action: 'STACK_PLAY',
        card: 'W4',
        color: 'blue',
        score: 1.2,
        note: '叠 +4',
      },
      {
        id: 'STACK_DECLINE',
        kind: 'stack-decline',
        action: 'STACK_DECLINE',
        card: null,
        color: null,
        score: 0,
        note: '摸 4 张',
      },
    ],
    historySummary: ['STACK_PUSH', 'DRAW'],
  };
}

describe('M4 决策请求校验', () => {
  it('合法请求通过并规范化', () => {
    const result = validateDecisionPayload(validPayload());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.difficulty).toBe('realistic');
      expect(result.payload.candidates).toHaveLength(2);
      expect(result.payload.players).toHaveLength(2);
    }
  });

  it('非法 difficulty / 候选动作 / 长度超限被拒绝', () => {
    const badDifficulty = { ...validPayload(), difficulty: 'nightmare' };
    expect(validateDecisionPayload(badDifficulty).ok).toBe(false);

    const badAction = validPayload();
    (badAction.candidates as Array<Record<string, unknown>>)[0]!.action = 'HACK';
    expect(validateDecisionPayload(badAction).ok).toBe(false);

    const tooManyCandidates = validPayload();
    tooManyCandidates.candidates = Array.from({ length: 41 }, (_, index) => ({
      id: `PLAY_CARD:${index}`,
      kind: 'play',
      action: 'PLAY_CARD',
      card: 'R7',
      color: null,
      score: 1,
      note: '',
    }));
    expect(validateDecisionPayload(tooManyCandidates).ok).toBe(false);

    const mismatch = validPayload();
    (mismatch.you as Record<string, unknown>).handCount = 5;
    expect(validateDecisionPayload(mismatch).ok).toBe(false);
  });

  it('拒绝非对象 / 空候选', () => {
    expect(validateDecisionPayload(null).ok).toBe(false);
    expect(validateDecisionPayload('hello').ok).toBe(false);
    const empty = { ...validPayload(), candidates: [] };
    expect(validateDecisionPayload(empty).ok).toBe(false);
  });
});

describe('M4 Prompt 构建', () => {
  it('系统提示词包含难度风格、规则约束与 JSON 输出要求', () => {
    const validated = validateDecisionPayload(validPayload());
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const system = buildSystemPrompt(validated.payload);
    expect(system).toContain('老王');
    expect(system).toContain('真实');
    expect(system).toContain('宽松叠法');
    expect(system).toContain('禁止假设能看到其他玩家手牌');
    expect(system).toContain('action_id');
  });

  it('user 消息只包含公开信息 + 自己手牌 + 候选，不含隐藏字段', () => {
    const validated = validateDecisionPayload(validPayload());
    if (!validated.ok) throw new Error('payload invalid');
    const messages = buildDecisionMessages(validated.payload);
    expect(messages).toHaveLength(2);
    const user = messages[1]!.content;
    expect(user).toContain('"hand":["R7","W4"]');
    expect(user).toContain('"candidates"');
    expect(user).not.toContain('wild4Info');
    expect(user).not.toContain('wasLegal');
    expect(user).not.toContain('apiKey');
  });
});

describe('M4 模型输出解析', () => {
  const candidateIds = new Set(['stack:W4#0:blue', 'STACK_DECLINE']);

  it('解析标准 JSON', () => {
    const parsed = parseDecisionOutput(
      '{"action_id":"stack:W4#0:blue","reason":"叠 +4 逼下家","line":"这把你摸定了"}',
      candidateIds,
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.decision.actionId).toBe('stack:W4#0:blue');
      expect(parsed.decision.line).toBe('这把你摸定了');
    }
  });

  it('容忍 Markdown 代码块 / 前后杂文字', () => {
    const fenced = parseDecisionOutput(
      '思考如下：\n```json\n{"action_id":"STACK_DECLINE","reason":"没有叠牌","line":""}\n```\n',
      candidateIds,
    );
    expect(fenced.ok).toBe(true);
    const noisy = parseDecisionOutput(
      '我认为... {"action_id":"STACK_DECLINE","reason":"摸牌","line":"ok"} 完毕',
      candidateIds,
    );
    expect(noisy.ok).toBe(true);
  });

  it('非法 JSON / 候选外动作返回结构化错误', () => {
    const invalid = parseDecisionOutput('not json', candidateIds);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.code).toBe('AI_INVALID_OUTPUT');

    const outside = parseDecisionOutput('{"action_id":"play:R9#0"}', candidateIds);
    expect(outside.ok).toBe(false);
    if (!outside.ok) expect(outside.code).toBe('AI_INVALID_ACTION');
  });
});
