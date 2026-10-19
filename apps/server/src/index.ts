import { createUnoServer } from './server.ts';
import { config, isAiConfigured } from './config.ts';

const { server } = createUnoServer();

server.listen(config.port, () => {
  const url = `http://localhost:${config.port}`;
  console.log(`[uno-server] 已启动: ${url}`);
  console.log(`[uno-server] 联机 WebSocket: ws://localhost:${config.port}/ws（M8 局域网联机）`);
  console.log(
    `[uno-server] 前端页面: ${
      config.hasWebUi ? 'apps/web/index.html（已找到）' : '未找到，显示占位页'
    }`,
  );
  console.log(
    `[uno-server] 智谱 AI: ${
      isAiConfigured
        ? `已配置 Key（默认模型 ${config.zhipu.model}）`
        : '未配置（.env 中设置 ZHIPU_API_KEY，缺失时自动用本地 AI）'
    }`,
  );
});

function shutdown(signal: string): void {
  console.log(`[uno-server] 收到 ${signal}，正在关闭...`);
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
