/**
 * 智谱混合 AI 的前端客户端（M4）。
 *
 * - 只调用本地服务 `/api/ai/decide` 与 `/api/ai/test`（不直接连智谱，Key 不进程前端）；
 * - 所有失败都返回结构化 code，由 engineMode 自动降级本地 AI，绝不阻塞对局；
 * - 默认 6.5s 客户端超时（服务端自身 3.5s 预算，留出网络/渲染余量）。
 */

const ERROR_MESSAGES = {
  AI_NOT_CONFIGURED: '未配置智谱 Key，已使用本地 AI',
  TIMEOUT: '智谱响应超时，已自动降级本地 AI',
  RATE_LIMIT: '智谱免费模型繁忙，已自动降级本地 AI',
  AUTH_FAILED: '智谱 Key 无效，已自动降级本地 AI',
  MODEL_UNAVAILABLE: '智谱模型不可用，已自动降级本地 AI',
  NETWORK_ERROR: '无法连接本地服务，已使用本地 AI',
  EMPTY_RESPONSE: '智谱返回空内容，已使用本地 AI',
  AI_INVALID_ACTION: '智谱选择了无效动作，已使用本地 AI',
  AI_INVALID_OUTPUT: '智谱输出格式异常，已使用本地 AI',
  INVALID_REQUEST: 'AI 请求参数异常，已使用本地 AI',
  UNKNOWN: '智谱暂时不可用，已使用本地 AI',
};

/** 错误码 → 玩家可读文案 */
export function aiErrorMessage(code) {
  return ERROR_MESSAGES[code] || ERROR_MESSAGES.UNKNOWN;
}

export function createAiClient(options = {}) {
  const timeoutMs = options.timeoutMs ?? 9000;
  const fetchImpl = options.fetchImpl ?? ((...args) => window.fetch(...args));

  async function postJson(url, body) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      let data = {};
      try {
        data = await response.json();
      } catch {
        data = {};
      }
      return { ok: response.ok && data.ok === true, status: response.status, data };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        data: { code: error?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR' },
      };
    } finally {
      window.clearTimeout(timer);
    }
  }

  return {
    /** 请求一次智谱决策；ok=false 时由调用方降级本地 AI */
    async decide(payload) {
      const startedAt = performance.now();
      const result = await postJson('/api/ai/decide', payload);
      const latencyMs = Math.round(performance.now() - startedAt);
      if (!result.ok) {
        const code = result.data.code || (result.status ? `HTTP_${result.status}` : 'UNKNOWN');
        return { ok: false, code, message: aiErrorMessage(code), latencyMs };
      }
      const data = result.data;
      return {
        ok: true,
        actionId: data.actionId,
        reason: data.reason || '',
        line: data.line || '',
        model: data.model || '',
        latencyMs,
      };
    },

    /** 设置页"测试智谱连接" */
    async testConnection() {
      const result = await postJson('/api/ai/test');
      if (!result.ok) {
        const code = result.data.code || (result.status ? `HTTP_${result.status}` : 'UNKNOWN');
        return { ok: false, code, message: aiErrorMessage(code) };
      }
      return {
        ok: true,
        model: result.data.model || '',
        latencyMs: result.data.latencyMs ?? 0,
        reply: result.data.reply || '',
      };
    },
  };
}

/** 读取服务端 AI 配置（是否配置 Key / 模型名 / 超时） */
export async function getServerAiConfig() {
  try {
    const response = await fetch('/api/config', { headers: { Accept: 'application/json' } });
    if (!response.ok) return { aiEnabled: false, error: true };
    return await response.json();
  } catch {
    return { aiEnabled: false, error: true };
  }
}
