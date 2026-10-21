import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CLEAR_AI_KEY,
  IPC_DISCOVERY_FIND,
  IPC_DISCOVERY_LIST,
  IPC_GET_AI_KEY_STATUS,
  IPC_GET_SERVER_INFO,
  IPC_SAVE_AI_KEY,
  type DesktopAiKeyResult,
  type DesktopAiKeyStatus,
  type DesktopDiscoveryFindResult,
  type DesktopDiscoverySnapshot,
  type DesktopServerInfo,
} from './ipc.ts';

/**
 * 渲染进程唯一的桌面能力入口。保持窄接口：不暴露 Node / fs / shell。
 * M10-03：智谱 Key 只提供「状态 / 保存 / 清除」，不回传明文。
 */
const desktopApi = {
  isDesktop: true as const,
  getServerInfo: (): Promise<DesktopServerInfo | null> =>
    ipcRenderer.invoke(IPC_GET_SERVER_INFO) as Promise<DesktopServerInfo | null>,
  aiKey: {
    getStatus: (): Promise<DesktopAiKeyStatus> =>
      ipcRenderer.invoke(IPC_GET_AI_KEY_STATUS) as Promise<DesktopAiKeyStatus>,
    save: (key: string): Promise<DesktopAiKeyResult> =>
      ipcRenderer.invoke(IPC_SAVE_AI_KEY, key) as Promise<DesktopAiKeyResult>,
    clear: (): Promise<DesktopAiKeyResult> =>
      ipcRenderer.invoke(IPC_CLEAR_AI_KEY) as Promise<DesktopAiKeyResult>,
  },
  // M10-04：只读发现结果，不暴露 UDP/fs；匹配到的地址由渲染进程用于连接 WS
  discovery: {
    listRooms: (): Promise<DesktopDiscoverySnapshot> =>
      ipcRenderer.invoke(IPC_DISCOVERY_LIST) as Promise<DesktopDiscoverySnapshot>,
    findRoom: (code: string): Promise<DesktopDiscoveryFindResult> =>
      ipcRenderer.invoke(IPC_DISCOVERY_FIND, code) as Promise<DesktopDiscoveryFindResult>,
  },
};

contextBridge.exposeInMainWorld('unoDesktop', desktopApi);
