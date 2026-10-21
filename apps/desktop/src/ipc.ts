export const IPC_GET_SERVER_INFO = 'uno:get-server-info';
export const IPC_GET_AI_KEY_STATUS = 'uno:ai-key-status';
export const IPC_SAVE_AI_KEY = 'uno:ai-key-save';
export const IPC_CLEAR_AI_KEY = 'uno:ai-key-clear';
export const IPC_DISCOVERY_LIST = 'uno:discovery-list';
export const IPC_DISCOVERY_FIND = 'uno:discovery-find';

export interface DesktopServerInfo {
  port: number;
  localUrl: string;
  lanUrls: string[];
  version: string;
  isPackaged: boolean;
}

export type AiKeySource = 'desktop' | 'env' | 'none';

/** 只暴露状态，永远不回传 Key 明文 */
export interface DesktopAiKeyStatus {
  configured: boolean;
  source: AiKeySource;
  model: string;
  /** 系统是否支持 safeStorage（Windows DPAPI） */
  encryptionAvailable: boolean;
}

export interface DesktopAiKeyResult {
  ok: boolean;
  status: DesktopAiKeyStatus;
  /** ok=false 时的玩家可读提示；绝不包含 Key */
  message?: string;
}

/** M10-04：UDP 发现到的房间（本地房间 local=true，host 为回环地址） */
export interface DesktopDiscoveredRoom {
  code: string;
  host: string;
  port: number;
  hostName: string;
  appVersion: string;
  players: number;
  compatible: boolean;
  local: boolean;
  /** 距离上次收到广播的毫秒数 */
  ageMs: number;
}

export interface DesktopDiscoverySnapshot {
  /** UDP 监听是否可用（false 时仍可手动输入主机地址） */
  enabled: boolean;
  rooms: DesktopDiscoveredRoom[];
}

export type DesktopDiscoveryReason =
  | 'bad-code'
  | 'not-found'
  | 'version-mismatch'
  | 'disabled';

export interface DesktopDiscoveryFindResult extends DesktopDiscoverySnapshot {
  matches: DesktopDiscoveredRoom[];
  reason?: DesktopDiscoveryReason;
}
