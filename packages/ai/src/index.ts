/**
 * UNO 本地启发式 AI（M2 阶段实现）。
 *
 * 定位：
 * - 四档难度（休闲 / 简单 / 真实 / 骨灰级）的纯本地策略；
 * - 离线可玩，同时作为智谱 LLM 失败/超时时的兜底决策器；
 * - 只能使用公开信息 + 自己的手牌（由引擎 getPublicView 强制隔离）。
 */
export const AI_VERSION = '0.1.0';

export const AI_TODO = {
  m2: '候选动作生成 + 启发式评分 + 记牌器 + 四档难度参数 + 自对弈基准',
} as const;
