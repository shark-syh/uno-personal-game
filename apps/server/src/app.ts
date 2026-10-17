import express, { type Express } from 'express';
import { healthRouter } from './routes/health.ts';
import { aiRouter } from './routes/ai.ts';
import { mountStatic } from './static.ts';

/**
 * 创建本地服务（不监听端口，方便测试用 ephemeral port）。
 * 职责：静态托管前端 + 提供 /api 接口；不承担游戏逻辑（引擎在前端运行）。
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  app.use('/api', healthRouter);
  app.use('/api', aiRouter);
  mountStatic(app);

  // 未匹配的路径统一返回 404 JSON（避免前端拿到 HTML 后解析失败）
  app.use((req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', path: req.path });
  });

  return app;
}
