import { Router } from 'express';
import { config, isAiConfigured } from '../config.ts';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'uno-server',
    version: '0.1.0',
    uptimeSec: Math.round(process.uptime()),
    time: new Date().toISOString(),
  });
});

healthRouter.get('/config', (_req, res) => {
  res.json({
    aiEnabled: isAiConfigured,
    // 注意：这里只暴露模型名等非敏感信息，永远不返回 API Key
    model: isAiConfigured ? config.zhipu.model : null,
    fallbackModels: isAiConfigured ? config.zhipu.fallbackModels : [],
    hasWebUi: config.hasWebUi,
    // M4 阶段才会真正实现 AI 决策
    aiDecisionImplemented: false,
  });
});
