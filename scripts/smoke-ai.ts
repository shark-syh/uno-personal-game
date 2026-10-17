/**
 * 智谱连通性冒烟测试（M4 的前置验证）。
 *
 * 用法（必须在项目根目录运行）：
 *   npm run smoke:ai
 *
 * 说明：
 * 1. glm-4.7-flash 是思考型模型，默认会消耗 reasoning tokens；这里关闭 thinking
 *    （thinking: disabled）并要求 JSON 输出，模拟 M4 的决策调用方式。
 * 2. 免费模型高峰期可能返回 429/1305（访问量过大）：脚本会自动重试一次，
 *    随后按 ZHIPU_FALLBACK_MODELS 依次尝试备用模型。
 * 3. 若模型不支持 thinking 参数（400），自动回退为不带 thinking 的请求。
 */
import { config, isAiConfigured } from '../apps/server/src/config.ts';

interface ChatResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string; reasoning_content?: string };
  }>;
  error?: { code?: string; message?: string };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function requestOnce(
  model: string,
  disableThinking: boolean,
): Promise<{ status: number; body: string }> {
  const url = `${config.zhipu.baseUrl}/chat/completions`;
  const payload: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: '你是一个 JSON 输出测试助手，只输出 JSON，不要输出任何其他文字。' },
      { role: 'user', content: '只输出 JSON：{"ok":true,"model":"你的模型名"}' },
    ],
    temperature: 0,
    max_tokens: 512,
    response_format: { type: 'json_object' },
    stream: false,
  };
  if (disableThinking) payload.thinking = { type: 'disabled' };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.zhipu.apiKey}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(Math.max(config.zhipu.timeoutMs, 20000)),
  });
  return { status: res.status, body: await res.text() };
}

interface AttemptResult {
  model: string;
  status: number;
  elapsedMs: number;
  usedThinkingParam: boolean;
  content: string;
  reasoning: string;
  finishReason: string;
  errorCode: string;
  rawBody: string;
}

async function tryModel(model: string): Promise<AttemptResult> {
  const started = Date.now();
  let usedThinkingParam = true;
  let result = await requestOnce(model, true);

  if (result.status === 400) {
    usedThinkingParam = false;
    result = await requestOnce(model, false);
  }

  const elapsedMs = Date.now() - started;
  let content = '';
  let reasoning = '';
  let finishReason = '';
  let errorCode = '';

  try {
    const data = JSON.parse(result.body) as ChatResponse;
    content = data.choices?.[0]?.message?.content?.trim() ?? '';
    reasoning = data.choices?.[0]?.message?.reasoning_content?.trim() ?? '';
    finishReason = data.choices?.[0]?.finish_reason ?? '';
    errorCode = data.error?.code ?? '';
  } catch {
    // 保留原始 body 供排查
  }

  return {
    model,
    status: result.status,
    elapsedMs,
    usedThinkingParam,
    content,
    reasoning,
    finishReason,
    errorCode,
    rawBody: result.body,
  };
}

async function main(): Promise<void> {
  if (!isAiConfigured) {
    console.error('[smoke-ai] 未配置 ZHIPU_API_KEY。');
    console.error('[smoke-ai] 请在项目根目录的 .env 中填写 Key，并确认命令是在项目目录运行。');
    process.exitCode = 1;
    return;
  }

  const models = [config.zhipu.model, ...config.zhipu.fallbackModels];
  console.log(`[smoke-ai] 模型尝试顺序: ${models.join(' → ')}`);

  const failures: AttemptResult[] = [];

  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      console.log(`\n[smoke-ai] 尝试 model=${model}（第 ${attempt} 次）…`);
      const result = await tryModel(model);
      const tag = `HTTP ${result.status} · ${result.elapsedMs}ms · thinking=${
        result.usedThinkingParam ? 'disabled' : '未使用'
      }`;
      console.log(`[smoke-ai] ${tag} · finish_reason=${result.finishReason || '-'}`);

      if (result.status === 200 && result.content) {
        console.log(`[smoke-ai] 模型输出: ${result.content}`);
        try {
          const parsed = JSON.parse(result.content) as { ok?: boolean; model?: string };
          console.log(`[smoke-ai] JSON 解析成功: ${JSON.stringify(parsed)}`);
        } catch {
          console.warn('[smoke-ai] 模型有正文但不是合法 JSON，M4 需要做输出解析修复。');
        }
        console.log(`\n[smoke-ai] 通过 ✔ 智谱接口可用（可用模型：${model}），M4 可以按计划接入。`);
        return;
      }

      if (result.status === 200 && !result.content) {
        console.warn('[smoke-ai] HTTP 200 但正文为空（推理消耗了 token 或模型未按要求输出）。');
        if (result.reasoning) console.warn(`[smoke-ai] 推理内容长度 ${result.reasoning.length} 字符。`);
        break; // 换下一个模型
      }

      if (result.status === 401 || result.status === 403) {
        console.error('[smoke-ai] 鉴权失败：请检查 .env 中的 ZHIPU_API_KEY 是否正确、是否已激活。');
        console.error(`[smoke-ai] 响应: ${result.rawBody.slice(0, 300)}`);
        process.exitCode = 1;
        return;
      }

      const overloaded = result.status === 429 || result.errorCode === '1305';
      if (overloaded) {
        console.warn(
          `[smoke-ai] 免费模型繁忙（${result.errorCode || result.status}）：该模型当前访问量过大。`,
        );
        failures.push(result);
        if (attempt === 1) {
          console.warn('[smoke-ai] 等待 2 秒后重试一次…');
          await sleep(2000);
          continue;
        }
        break; // 换下一个模型
      }

      if (result.status === 404) {
        console.warn(`[smoke-ai] 模型名不可用（404）：${model}，换下一个备用模型。`);
        failures.push(result);
        break;
      }

      console.error(`[smoke-ai] 请求失败（HTTP ${result.status}）：${result.rawBody.slice(0, 300)}`);
      failures.push(result);
      break;
    }
  }

  console.error('\n[smoke-ai] 所有候选模型均未成功。');
  console.error('[smoke-ai] 说明：网络与 Key 可能正常，只是免费模型高峰期繁忙（1305），稍后重试即可。');
  console.error('[smoke-ai] 本项目 M4 设计为：失败自动降级本地 AI，不影响游戏；可选换成低峰时段或付费模型。');
  for (const failure of failures) {
    console.error(
      `  - ${failure.model}: HTTP ${failure.status} ${failure.errorCode ? 'code=' + failure.errorCode : ''}`,
    );
  }
  process.exitCode = 1;
}

void main();
