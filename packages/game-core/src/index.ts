/**
 * UNO 规则引擎。
 *
 * 设计约束：
 * - 纯函数、无 UI / 网络 / localStorage 依赖；
 * - 随机性走可注入 seed，保证相同 seed + 相同动作序列可完全复现；
 * - 规则规格以 `docs/开发计划.md` 第 4 章为准。
 */

export * from './types.ts';
export * from './config.ts';
export * from './rng.ts';
export * from './deck.ts';
export * from './setup.ts';
export * from './legal.ts';
export * from './engine.ts';
export * from './result.ts';
export * from './public-view.ts';
