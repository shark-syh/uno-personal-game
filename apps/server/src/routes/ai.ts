import { Router } from 'express';
import {
  buildDecisionMessages,
  LLM_DIFFICULTY,
  parseDecisionOutput,
  validateDecisionPayload,
} from '../prompts/ai-decide.ts';
import type { ChatFailure, ChatResult, ZhipuClient } from '../zhipu.ts';

export interface AiRouterDeps {
  client: ZhipuClient;
}

function failureStatus(code: ChatFailure['code']): number {
  switch (code) {
    case 'AI_NOT_CONFIGURED':
      return 503;
    case 'TIMEOUT':
      return 504;
    case 'RATE_LIMIT':
      return 429;
    default:
      return 502;
  }
}

function failureBody(result: ChatFailure): {
  ok: false;
  error: string;
  code: ChatFailure['code'];
  message: string;
  latencyMs: number;
  attempts: number;
} {
  return {
    ok: false,
    error: result.code,
    code: result.code,
    message: result.message,
    latencyMs: result.latencyMs,
    attempts: result.attempts,
  };
}

/**
 * 智谱代理路由（M4）：
 * - POST /api/ai/decide：接收「公开信息 + 自己手牌 + 候选动作」→ Prompt → 智谱 → 校验 action_id；
 * - POST /api/ai/test：设置页"测试智谱连接"按钮用；
 * 失败返回结构化 code，前端据此降级本地 AI（绝不阻塞对局）。
 */
export function createAiRouter(deps: AiRouterDeps): Router {
  const router = Router();

  router.post('/ai/decide', async (req, res) => {
    const validated = validateDecisionPayload(req.body);
    if (!validated.ok) {
      res.status(400).json({
        ok: false,
        error: 'INVALID_REQUEST',
        code: 'INVALID_REQUEST',
        message: validated.message,
      });
      return;
    }
    if (!deps.client.isConfigured) {
      res.status(503).json({
        ok: false,
        error: 'AI_NOT_CONFIGURED',
        code: 'AI_NOT_CONFIGURED',
        message: '未配置 ZHIPU_API_KEY，已使用本地 AI',
      });
      return;
    }

    const payload = validated.payload;
    const profile = LLM_DIFFICULTY[payload.difficulty];
    let result: ChatResult;
    try {
      result = await deps.client.chat({
        messages: buildDecisionMessages(payload),
        temperature: profile.temperature,
        maxTokens: profile.maxTokens,
      });
    } catch (error) {
      console.error('[ai] 决策调用异常', error instanceof Error ? error.message : error);
      res.status(502).json({
        ok: false,
        error: 'UNKNOWN',
        code: 'UNKNOWN',
        message: '智谱决策异常，已使用本地 AI',
      });
      return;
    }

    if (!result.ok) {
      res.status(failureStatus(result.code)).json(failureBody(result));
      return;
    }

    const candidateIds = new Set(payload.candidates.map((candidate) => candidate.id));
    const parsed = parseDecisionOutput(result.content, candidateIds);
    if (!parsed.ok) {
      res.status(502).json({
        ok: false,
        error: parsed.code,
        code: parsed.code,
        message: parsed.message,
        model: result.model,
        latencyMs: result.latencyMs,
      });
      return;
    }

    res.json({
      ok: true,
      actionId: parsed.decision.actionId,
      reason: parsed.decision.reason,
      line: parsed.decision.line,
      model: result.model,
      latencyMs: result.latencyMs,
      attempts: result.attempts,
    });
  });

  router.post('/ai/test', async (_req, res) => {
    if (!deps.client.isConfigured) {
      res.status(503).json({
        ok: false,
        error: 'AI_NOT_CONFIGURED',
        code: 'AI_NOT_CONFIGURED',
        message: '未配置 ZHIPU_API_KEY',
      });
      return;
    }
    const result = await deps.client.chat({
      messages: [
        {
          role: 'system',
          content: '你是一个 JSON 输出测试助手，只输出 JSON，不要输出 Markdown 或额外文字。',
        },
        { role: 'user', content: '只输出 JSON：{"ok":true}' },
      ],
      temperature: 0,
      maxTokens: 64,
      // 诊断接口给足预算：主模型偶发拥塞时仍能切到备用模型，避免误报失败
      timeoutMs: 12000,
    });
    if (!result.ok) {
      res.status(failureStatus(result.code)).json(failureBody(result));
      return;
    }
    res.json({
      ok: true,
      model: result.model,
      latencyMs: result.latencyMs,
      reply: result.content.slice(0, 120),
    });
  });

  return router;
}
