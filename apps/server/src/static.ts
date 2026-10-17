import express, { type Express } from 'express';
import { config } from './config.ts';

const PLACEHOLDER_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>UNO 单机版 · 本地服务</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0; min-height: 100vh; display: grid; place-items: center;
        background: radial-gradient(circle at 50% 30%, #14532d, #0b1f14 70%);
        color: #eceff4; font-family: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
      }
      .card {
        max-width: 560px; padding: 40px; border-radius: 16px;
        background: rgba(0, 0, 0, 0.35); border: 1px solid rgba(255, 255, 255, 0.12);
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
      }
      h1 { margin: 0 0 8px; font-size: 28px; }
      p { line-height: 1.7; color: #c7d2cb; margin: 8px 0; }
      a { color: #ffd166; }
      code { background: rgba(255, 255, 255, 0.1); padding: 2px 6px; border-radius: 6px; }
      .tag {
        display: inline-block; margin-bottom: 16px; padding: 4px 10px; border-radius: 999px;
        background: rgba(255, 209, 102, 0.15); color: #ffd166; font-size: 12px;
        letter-spacing: 0.08em;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <span class="tag">M0 · 工程骨架已启动</span>
      <h1>UNO 单机版 · 本地服务</h1>
      <p>服务已运行，但还没有找到前端页面 <code>apps/web/index.html</code>（由外部 Codex 产出中）。</p>
      <p>可以访问：<a href="/api/health">/api/health</a> · <a href="/api/config">/api/config</a></p>
      <p>前端产出后重启服务，本页会被真实 UI 替换。</p>
    </main>
  </body>
</html>`;

/**
 * 挂载前端静态资源。
 * - 找到 apps/web/index.html：直接托管真实 UI；
 * - 还没有 UI：给一个占位页 + 健康检查链接，方便 M0 阶段验证服务。
 */
export function mountStatic(app: Express): void {
  if (config.hasWebUi) {
    app.use(express.static(config.webDir, { extensions: ['html'] }));
    return;
  }

  app.get('/', (_req, res) => {
    res.type('html').send(PLACEHOLDER_HTML);
  });
}
