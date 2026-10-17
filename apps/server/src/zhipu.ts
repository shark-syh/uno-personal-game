/**
 * 智谱 Chat Completions 客户端（M4）。
 *
 * 设计要点（见 `开发计划.md` 6.8 / 事故坑位）：
 * - Key 只在服务端；本模块**不记录/不返回 Key**，日志只记录模型名/状态码/耗时；
 * - `glm-4.7-flash` 是思考型模型：默认 `thinking:{type:'disabled'}`，若模型返回 400 自动去掉该参数重试；
 * - 限流/过载（429 / 1302 / 1305）重试 1 次，随后按备用模型链切换；
 * - 总预算 = timeoutMs（默认取 AI_DECISION_TIMEOUT_MS，3.5s）；超时立即失败，由前端降级本地 AI；
 * - 失败返回结构化 code，前端据此提示"已降级本地 AI"。
 */
import { config } from './config.ts';

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** 覆盖默认模型（一般不用） */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** 总预算（毫秒）；默认取配置 */
  timeoutMs?: number;
  /** 是否要求 JSON 输出（默认 true） */
  jsonMode?: boolean;
}

export type AiErrorCode =
  | 'AI_NOT_CONFIGURED'
  | 'TIMEOUT'
  | 'RATE_LIMIT'
  | 'AUTH_FAILED'
  | 'MODEL_UNAVAILABLE'
  | 'BAD_REQUEST'
  | 'NETWORK_ERROR'
  | 'EMPTY_RESPONSE'
  | 'UNKNOWN';

export interface ChatSuccess {
  ok: true;
  content: string;
  model: string;
  latencyMs: number;
  attempts: number;
}

export interface ChatFailure {
  ok: false;
  code: AiErrorCode;
  message: string;
  status?: number;
  latencyMs: number;
  attempts: number;
}

export type ChatResult = ChatSuccess | ChatFailure;

export interface ZhipuClientOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  fallbackModels?: string[];
  timeoutMs?: number;
  /** 测试注入；默认全局 fetch */
  fetchImpl?: typeof fetch;
  /** 测试注入；默认 setTimeout */
  sleep?: (ms: number) => Promise<void>;
}

export interface ZhipuClient {
  isConfigured: boolean;
  model: string;
  fallbackModels: string[];
  chat(request: ChatRequest): Promise<ChatResult>;
}

interface RawAttempt {
  ok: boolean;
  status: number;
  content: string;
  errorCode: string;
  errorMessage: string;
  aborted: boolean;
  networkError: boolean;
  latencyMs: number;
}

const RATE_LIMIT_CODES = new Set(['429', '1302', '1305', '1113']);

function sleepDefault(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyFailure(attempt: RawAttempt): { code: AiErrorCode; message: string } {
  if (attempt.aborted) return { code: 'TIMEOUT', message: '智谱请求超时' };
  if (attempt.networkError) return { code: 'NETWORK_ERROR', message: '无法连接智谱服务' };
  if (attempt.status === 401 || attempt.status === 403) {
    return { code: 'AUTH_FAILED', message: '智谱 Key 无效或未激活' };
  }
  if (attempt.status === 429 || RATE_LIMIT_CODES.has(attempt.errorCode)) {
    return { code: 'RATE_LIMIT', message: '智谱免费模型繁忙（限流/过载）' };
  }
  if (attempt.status === 404) {
    return { code: 'MODEL_UNAVAILABLE', message: '智谱模型不可用' };
  }
  if (attempt.status === 400) {
    return { code: 'BAD_REQUEST', message: '智谱请求参数不被支持' };
  }
  if (attempt.status === 200 && !attempt.content) {
    return { code: 'EMPTY_RESPONSE', message: '智谱返回空内容' };
  }
  return {
    code: 'UNKNOWN',
    message: attempt.errorMessage || `智谱请求失败（HTTP ${attempt.status}）`,
  };
}

/** 创建智谱客户端（默认读 `.env` 配置；测试可注入 fake fetch） */
export function createZhipuClient(options: ZhipuClientOptions = {}): ZhipuClient {
  const apiKey = options.apiKey ?? config.zhipu.apiKey;
  const baseUrl = (options.baseUrl ?? config.zhipu.baseUrl).replace(/\/+$/, '');
  const primaryModel = options.model ?? config.zhipu.model;
  const fallbackModels = options.fallbackModels ?? config.zhipu.fallbackModels;
  const defaultTimeoutMs = options.timeoutMs ?? config.zhipu.timeoutMs;
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const sleep = options.sleep ?? sleepDefault;
  const models = [primaryModel, ...fallbackModels.filter((model) => model !== primaryModel)];

  async function requestOnce(
    model: string,
    request: ChatRequest,
    timeoutMs: number,
    withThinkingParam: boolean,
  ): Promise<RawAttempt> {
    const startedAt = Date.now();
    const payload: Record<string, unknown> = {
      model,
      messages: request.messages,
      temperature: request.temperature ?? 0.5,
      max_tokens: Math.max(request.maxTokens ?? 350, 32),
      stream: false,
    };
    if (request.jsonMode !== false) payload.response_format = { type: 'json_object' };
    if (withThinkingParam) payload.thinking = { type: 'disabled' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(50, timeoutMs));
    let status = 0;
    let body = '';
    let aborted = false;
    let networkError = false;
    try {
      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      status = response.status;
      body = await response.text();
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      aborted = name === 'AbortError' || controller.signal.aborted;
      networkError = !aborted;
    } finally {
      clearTimeout(timer);
    }

    const latencyMs = Date.now() - startedAt;
    let content = '';
    let errorCode = '';
    let errorMessage = '';
    try {
      const data = JSON.parse(body) as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { code?: string | number; message?: string };
      };
      content = data.choices?.[0]?.message?.content?.trim() ?? '';
      errorCode = data.error?.code === undefined ? '' : String(data.error.code);
      errorMessage = data.error?.message ?? '';
    } catch {
      // 非 JSON 响应：保留为空，由 classifyFailure 归类
    }

    // 仅记录模型/状态/耗时（绝不记录 Key 或完整响应体）
    console.log(
      `[zhipu] ${model} HTTP ${status}${errorCode ? ` code=${errorCode}` : ''} ${latencyMs}ms` +
        `${content ? ` content=${content.length}字` : ''}${aborted ? ' (aborted)' : ''}`,
    );

    return {
      ok: status === 200 && content.length > 0,
      status,
      content,
      errorCode,
      errorMessage,
      aborted,
      networkError,
      latencyMs,
    };
  }

  return {
    isConfigured: apiKey.length > 0,
    model: primaryModel,
    fallbackModels,
    async chat(request: ChatRequest): Promise<ChatResult> {
      const startedAt = Date.now();
      if (apiKey.length === 0) {
        return {
          ok: false,
          code: 'AI_NOT_CONFIGURED',
          message: '未配置 ZHIPU_API_KEY',
          latencyMs: Date.now() - startedAt,
          attempts: 0,
        };
      }

      const budgetMs = Math.max(500, request.timeoutMs ?? defaultTimeoutMs);
      const deadline = startedAt + budgetMs;
      let attempts = 0;
      let lastFailure: ChatFailure | null = null;
      let thinkingParam = true;

      for (const model of models) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const remaining = deadline - Date.now();
          if (remaining < 250) {
            return (
              lastFailure ?? {
                ok: false,
                code: 'TIMEOUT',
                message: '智谱决策预算耗尽',
                latencyMs: Date.now() - startedAt,
                attempts,
              }
            );
          }

          attempts += 1;
          let raw = await requestOnce(model, request, remaining, thinkingParam);

          // 部分模型不支持 thinking 参数：去掉后重试一次
          if (raw.status === 400 && thinkingParam) {
            thinkingParam = false;
            attempts += 1;
            raw = await requestOnce(model, request, Math.max(250, deadline - Date.now()), false);
          }

          if (raw.ok) {
            return {
              ok: true,
              content: raw.content,
              model,
              latencyMs: Date.now() - startedAt,
              attempts,
            };
          }

          const failure = classifyFailure(raw);
          lastFailure = {
            ok: false,
            code: failure.code,
            message: failure.message,
            status: raw.status,
            latencyMs: Date.now() - startedAt,
            attempts,
          };
          // 鉴权/参数错误：换模型也无意义，直接失败
          if (failure.code === 'AUTH_FAILED' || failure.code === 'BAD_REQUEST') return lastFailure;
          // 限流/超时/网络：短暂等待后重试一次（若预算允许），否则换备用模型
          if (
            failure.code === 'RATE_LIMIT' ||
            failure.code === 'TIMEOUT' ||
            failure.code === 'NETWORK_ERROR'
          ) {
            const waitMs = Math.min(600, Math.max(0, deadline - Date.now() - 300));
            if (waitMs > 0) await sleep(waitMs);
            continue;
          }
          break; // 该模型不可用（404/空响应等）→ 换下一个
        }
      }

      return (
        lastFailure ?? {
          ok: false,
          code: 'UNKNOWN',
          message: '智谱没有可用模型',
          latencyMs: Date.now() - startedAt,
          attempts,
        }
      );
    },
  };
}

/** 默认单例（读 .env 配置） */
export const zhipuClient = createZhipuClient();
