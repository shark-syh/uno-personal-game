import express, { type Express } from 'express';
import { config } from './config.ts';
import { createHealthRouter } from './routes/health.ts';
import { createAiRouter } from './routes/ai.ts';
import { mountStatic } from './static.ts';
import { zhipuClient, type ZhipuClient } from './zhipu.ts';

export interface CreateAppOptions {
  /** 测试注入：替换智谱客户端（默认读取 .env 的单例） */
  aiClient?: ZhipuClient;
  /** 实际监听端口提供者（桌面版随机端口；默认使用 config.port） */
  getPort?: () => number;
}

/**
 * 创建本地服务（不监听端口，方便测试用 ephemeral port）。
 * 职责：静态托管前端 + 提供 /api 接口；不承担游戏逻辑（引擎在前端运行）。
 */
export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  const aiClient = options.aiClient ?? zhipuClient;

  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  app.use(
    '/api',
    createHealthRouter({
      // 函数形式：桌面版保存/清除 Key 后 /api/config 立即反映，不需要重启服务
      aiConfigured: () => aiClient.isConfigured,
      aiModel: aiClient.model ?? config.zhipu.model,
      aiFallbackModels: aiClient.fallbackModels ?? config.zhipu.fallbackModels,
      getPort: options.getPort,
    }),
  );
  app.use('/api', createAiRouter({ client: aiClient }));
  mountStatic(app);

  // 未匹配的路径统一返回 404 JSON（避免前端拿到 HTML 后解析失败）
  app.use((req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', path: req.path });
  });

  return app;
}
