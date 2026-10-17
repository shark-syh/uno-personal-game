import { Router } from 'express';

/**
 * 智谱 AI 代理接口（M4 阶段实现）。
 * 现在返回 501，方便前端提前对接时明确"后端存在但还没实现"。
 */
export const aiRouter = Router();

aiRouter.post('/ai/decide', (_req, res) => {
  res.status(501).json({
    error: 'AI_DECISION_NOT_IMPLEMENTED',
    message: 'AI 决策将在 M4 阶段接入智谱；当前请使用本地策略 AI（M2）。',
  });
});
