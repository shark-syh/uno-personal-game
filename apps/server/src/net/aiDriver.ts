/**
 * M8-04 服务端 AI 驱动 + M8-06 断线顶替。
 *
 * 触发时机：开局 / 真人动作 / 再来一局 / 对局中有人断线之后（由 wsServer 调用）。
 * 每步：当前行动座位若是 AI（isHuman=false）或已断线的真人，则用与单机相同的
 * 本地启发式 decide 选一个动作，经 RoomManager.applySystemAction → applyAction 裁决，
 * 每步广播一次按座位脱敏的视图（动画由客户端事件队列逐步播放）。
 *
 * 设计约束：
 * - AI 与真人走同一条规则路径（applyAction），服务端不另写规则；
 * - 智谱在线决策本里程碑未接入（单机仍由浏览器走 /api/ai/decide 代理）；
 *   联机 AI 固定使用本地启发式（离线可用、也是单机智谱失败时的兜底）；
 * - 步数上限兜底：理论不会触达，防御性避免死循环拖垮服务。
 */
import { decide } from '@uno/ai';
import { isGameOver } from '@uno/game-core';
import type { Room, RoomManager } from './rooms.ts';

/** 连续 AI 动作的防御上限（全员断线自动打完整局也远低于此；防死循环拖垮服务） */
const MAX_AI_STEPS = 2048;

/** 座位是否应由服务端代打：AI 座位，或已断线的真人座位（M8-06 顶替规则） */
function isServerDriven(room: Room, seat: number): boolean {
  const statePlayer = room.state?.players[seat];
  if (!statePlayer) return false;
  if (!statePlayer.isHuman) return true;
  const roomPlayer = room.players[seat];
  return roomPlayer ? !roomPlayer.connected : false;
}

/**
 * 推进 AI 回合直到轮到「在线真人」或对局结束。
 * @param broadcast 每步动作应用后调用一次（广播各座位视图）
 */
export function runAiTurns(room: Room, rooms: RoomManager, broadcast: () => void): void {
  let steps = 0;
  while (room.state && room.status === 'playing' && !isGameOver(room.state)) {
    const state = room.state;
    const seat = state.currentSeat;
    if (!isServerDriven(room, seat)) return;
    if (!room.aiRng) return; // 理论不会发生（开局即建），防御
    if (steps >= MAX_AI_STEPS) {
      console.error(`[uno-ai] 房间 ${room.code} AI 步数超过 ${MAX_AI_STEPS}，强制中断（防死循环）`);
      return;
    }
    let action;
    try {
      action = decide(state, seat, {
        difficulty: state.config.aiDifficulty,
        rng: room.aiRng,
      }).action;
    } catch (error) {
      console.error(`[uno-ai] 房间 ${room.code} 座位 ${seat} 决策失败：`, error);
      return;
    }
    try {
      rooms.applySystemAction(room, action);
    } catch (error) {
      console.error(`[uno-ai] 房间 ${room.code} 座位 ${seat} 动作被引擎拒绝：`, error);
      return;
    }
    steps += 1;
    broadcast();
  }
}
