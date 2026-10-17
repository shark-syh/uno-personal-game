import { Router } from 'express';
import { config } from '../config.ts';

export interface HealthRouterDeps {
  /** 智谱是否已配置（测试可注入） */
  aiConfigured: boolean;
  aiModel: string | null;
  aiFallbackModels: string[];
}

/** 健康检查与前端配置（不泄漏 Key；测试可注入 AI 状态） */
export function createHealthRouter(deps: HealthRouterDeps): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'uno-server',
      version: '0.1.0',
      uptimeSec: Math.round(process.uptime()),
      time: new Date().toISOString(),
    });
  });

  router.get('/config', (_req, res) => {
    res.json({
      aiEnabled: deps.aiConfigured,
      // 注意：这里只暴露模型名等非敏感信息，永远不返回 API Key
      model: deps.aiConfigured ? deps.aiModel : null,
      fallbackModels: deps.aiConfigured ? deps.aiFallbackModels : [],
      hasWebUi: config.hasWebUi,
      // M4：智谱混合决策已实现（前端会先尝试智谱，失败自动降级本地 AI）
      aiDecisionImplemented: true,
      aiTimeoutMs: config.zhipu.timeoutMs,
    });
  });

  return router;
}
