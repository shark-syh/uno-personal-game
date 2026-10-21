/**
 * M10-01 Electron 桌面壳。
 *
 * 关键顺序：先加载 environment.ts（写入 UNO_WEB_DIR / UNO_ENV_FILE），
 * 再导入 server/config.ts；否则 config 会按打包后的 __dirname 解析出错误路径。
 */
import './environment.ts';

import { mkdirSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  safeStorage,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import { DESKTOP_PATHS } from './environment.ts';
import {
  IPC_CLEAR_AI_KEY,
  IPC_DISCOVERY_FIND,
  IPC_DISCOVERY_LIST,
  IPC_GET_AI_KEY_STATUS,
  IPC_GET_SERVER_INFO,
  IPC_SAVE_AI_KEY,
  type DesktopAiKeyResult,
  type DesktopAiKeyStatus,
  type DesktopDiscoveredRoom,
  type DesktopDiscoveryFindResult,
  type DesktopDiscoveryReason,
  type DesktopDiscoverySnapshot,
  type DesktopServerInfo,
} from './ipc.ts';
import { createDiscoveryService, createInstanceId, isValidRoomCode, type DiscoveredRoom, type DiscoveryService } from './discovery.ts';
import { createSecretStore, type SecretStore } from './secretStore.ts';
import { getAiKeyStatus, setDesktopApiKey } from '../../server/src/ai-key.ts';
import { createUnoServer, type UnoServer } from '../../server/src/server.ts';
import { getLanAddresses } from '../../server/src/net/lan.ts';

app.setAppUserModelId('com.uno.local');

function findCliValue(name: string): string | null {
  const prefix = `${name}=`;
  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = process.argv[index]!;
    if (arg === name) return process.argv[index + 1] ?? null;
    if (arg.startsWith(prefix)) return arg.slice(prefix.length) || null;
  }
  return null;
}

/**
 * 支持独立用户数据目录（M10-06 双实例 E2E 必需）：
 * 单实例锁按 userData 生效，两个实例必须使用不同 --user-data-dir。
 */
const userDataOverride =
  process.env.UNO_USER_DATA_DIR?.trim() ||
  findCliValue('--user-data-dir') ||
  findCliValue('--uno-user-data-dir');
if (userDataOverride) {
  const userDataDir = path.resolve(userDataOverride);
  mkdirSync(userDataDir, { recursive: true });
  app.setPath('userData', userDataDir);
  app.setPath('sessionData', userDataDir);
}

let mainWindow: BrowserWindow | null = null;
let unoServer: UnoServer | null = null;
let serverInfo: DesktopServerInfo | null = null;
let secretStore: SecretStore | null = null;
let discovery: DiscoveryService | null = null;
let shutdownStarted = false;
let shutdownComplete = false;

/** safeStorage 必须在 app ready 之后使用；密钥文件放在独立 userData 下 */
function getSecretStore(): SecretStore {
  if (!secretStore) {
    secretStore = createSecretStore(path.join(app.getPath('userData'), 'zhipu-secret.bin'), {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (plain) => safeStorage.encryptString(plain),
      decrypt: (cipher) => safeStorage.decryptString(cipher),
    });
  }
  return secretStore;
}

function buildAiKeyStatus(): DesktopAiKeyStatus {
  return { ...getAiKeyStatus(), encryptionAvailable: getSecretStore().isAvailable() };
}

function keyResult(ok: boolean, message?: string): DesktopAiKeyResult {
  return { ok, status: buildAiKeyStatus(), ...(message ? { message } : {}) };
}

function toDesktopRoom(room: DiscoveredRoom, now = Date.now()): DesktopDiscoveredRoom {
  return {
    code: room.code,
    host: room.host,
    port: room.port,
    hostName: room.hostName,
    appVersion: room.appVersion,
    players: room.players,
    compatible: room.compatible,
    local: false,
    ageMs: Math.max(0, now - room.lastSeenAt),
  };
}

/** 本机内嵌服务上的开放房间（同一台电脑开房/多窗口加入时优先走本地） */
function localDiscoveredRooms(): DesktopDiscoveredRoom[] {
  const info = serverInfo;
  if (!info) return [];
  return (unoServer?.rooms.getOpenRooms() ?? []).map((room) => ({
    code: room.code,
    host: '127.0.0.1',
    port: info.port,
    hostName: '本机',
    appVersion: info.version,
    players: room.players,
    compatible: true,
    local: true,
    ageMs: 0,
  }));
}

function discoverySnapshot(): DesktopDiscoverySnapshot {
  const remote = (discovery?.listRooms() ?? []).map((room) => toDesktopRoom(room));
  return { enabled: discovery?.enabled ?? false, rooms: [...localDiscoveredRooms(), ...remote] };
}

function findDiscoveredRoom(code: unknown): DesktopDiscoveryFindResult {
  const snapshot = discoverySnapshot();
  if (typeof code !== 'string') {
    return { ...snapshot, matches: [], reason: 'bad-code' };
  }
  const normalized = code.trim().toUpperCase();
  if (!isValidRoomCode(normalized)) {
    return { ...snapshot, matches: [], reason: 'bad-code' };
  }

  const local = snapshot.rooms.filter((room) => room.local && room.code === normalized);
  if (local.length > 0) {
    return { ...snapshot, matches: local };
  }

  const matches = (discovery?.findRoom(normalized) ?? []).map((room) => toDesktopRoom(room));
  let reason: DesktopDiscoveryReason | undefined;
  if (matches.length === 0) {
    reason = snapshot.enabled ? 'not-found' : 'disabled';
  } else if (matches.every((room) => !room.compatible)) {
    reason = 'version-mismatch';
  }
  return { ...snapshot, matches, ...(reason ? { reason } : {}) };
}

function registerDiscoveryIpc(): void {
  ipcMain.handle(IPC_DISCOVERY_LIST, (event): DesktopDiscoverySnapshot => {
    if (!isTrustedSender(event)) return { enabled: false, rooms: [] };
    return discoverySnapshot();
  });
  ipcMain.handle(IPC_DISCOVERY_FIND, (event, code: unknown): DesktopDiscoveryFindResult => {
    if (!isTrustedSender(event)) {
      return { enabled: false, rooms: [], matches: [], reason: 'disabled' };
    }
    return findDiscoveredRoom(code);
  });
}

async function startDiscovery(info: DesktopServerInfo): Promise<void> {
  const service = createDiscoveryService({
    port: info.port,
    instanceId: createInstanceId(),
    appVersion: info.version,
    hostName: hostname() || 'UNO',
    getRooms: () => unoServer?.rooms.getOpenRooms() ?? [],
    onError: (message) => console.error(`[uno-desktop] ${message}`),
  });
  discovery = service;
  const enabled = await service.start();
  if (enabled) {
    console.log(`[uno-desktop] UDP 房间发现已启动（UDP 端口 ${service.boundPort}）`);
  } else {
    console.error('[uno-desktop] UDP 房间发现不可用：仍可手动输入主机地址加入');
  }
}

/** 只接受内置服务页面的 IPC（防止意外导航后的其他源调用密钥接口） */
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  if (!serverInfo) return false;
  const senderUrl = event.senderFrame?.url;
  if (!senderUrl) return false;
  try {
    return new URL(senderUrl).origin === new URL(serverInfo.localUrl).origin;
  } catch {
    return false;
  }
}

/** 启动时读取已保存的 Key；文件损坏/未配置时按未配置处理 */
function loadStoredApiKey(): void {
  const store = getSecretStore();
  if (!store.isAvailable()) return;
  const key = store.read();
  if (key) setDesktopApiKey(key);
}

function registerSecretIpc(): void {
  // 状态本身不含 Key，任何来源读取都不会泄露敏感信息
  ipcMain.handle(IPC_GET_AI_KEY_STATUS, () => buildAiKeyStatus());

  ipcMain.handle(IPC_SAVE_AI_KEY, (event, rawKey: unknown): DesktopAiKeyResult => {
    if (!isTrustedSender(event)) return keyResult(false, '不受信任的调用来源');
    if (typeof rawKey !== 'string') return keyResult(false, '请输入有效的 API Key');
    const key = rawKey.trim();
    if (key.length === 0) return keyResult(false, '请输入有效的 API Key');
    if (key.length > 512) return keyResult(false, 'API Key 长度异常，请检查后重试');
    const store = getSecretStore();
    if (!store.isAvailable()) {
      return keyResult(false, '当前系统安全存储不可用，无法保存 Key（仍可使用 .env 配置）');
    }
    try {
      store.save(key);
      setDesktopApiKey(key);
      console.log('[uno-desktop] 智谱 Key 已保存（safeStorage），立即生效');
      return keyResult(true);
    } catch {
      return keyResult(false, '保存 Key 失败，请重试');
    }
  });

  ipcMain.handle(IPC_CLEAR_AI_KEY, (event): DesktopAiKeyResult => {
    if (!isTrustedSender(event)) return keyResult(false, '不受信任的调用来源');
    getSecretStore().clear();
    setDesktopApiKey(null);
    console.log('[uno-desktop] 智谱 Key 已清除，回退到 .env / 本地 AI');
    return keyResult(true);
  });
}

function listenOnRandomPort(server: UnoServer['server']): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      const address = server.address();
      if (address && typeof address === 'object') resolve(address.port);
      else reject(new Error('服务已监听，但无法读取端口'));
    };
    server.once('error', onError);
    server.once('listening', onListening);
    // 监听 0.0.0.0：本机用 127.0.0.1 打开，局域网设备通过 UDP 发现拿到的 IP 访问
    server.listen(0, '0.0.0.0');
  });
}

async function startUnoServer(): Promise<DesktopServerInfo> {
  const uno = createUnoServer();
  const port = await listenOnRandomPort(uno.server);
  unoServer = uno;
  const info: DesktopServerInfo = {
    port,
    localUrl: `http://127.0.0.1:${port}`,
    lanUrls: getLanAddresses(port),
    version: app.getVersion(),
    isPackaged: app.isPackaged,
  };
  serverInfo = info;

  console.log(`[uno-desktop] 本地服务已启动: ${info.localUrl}`);
  console.log(`[uno-desktop] 前端资源: ${DESKTOP_PATHS.webDir}`);
  for (const lanUrl of info.lanUrls) console.log(`[uno-desktop] 局域网地址: ${lanUrl}`);
  return info;
}

function createMainWindow(localUrl: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b1f14',
    title: 'UNO',
    webPreferences: {
      preload: DESKTOP_PATHS.preloadFile,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  window.removeMenu();
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  // 桌面版只允许停留在内置服务页面；外链交给系统浏览器
  const localOrigin = new URL(localUrl).origin;
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== localOrigin) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  void window.loadURL(localUrl);
  return window;
}

async function stopUnoServer(): Promise<void> {
  const currentDiscovery = discovery;
  discovery = null;
  if (currentDiscovery) await currentDiscovery.stop();

  const current = unoServer;
  unoServer = null;
  serverInfo = null;
  if (!current) return;

  for (const client of current.wss.clients) client.terminate();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 3000);
    current.wss.close(() => {
      current.server.close(() => {
        clearTimeout(timer);
        resolve();
      });
      // 关闭 keep-alive 与升级连接，确保窗口关闭后端口立即可复用
      current.server.closeAllConnections?.();
    });
  });
}

async function bootstrap(): Promise<void> {
  Menu.setApplicationMenu(null);
  ipcMain.handle(IPC_GET_SERVER_INFO, () => serverInfo);
  registerSecretIpc();
  registerDiscoveryIpc();
  // 先注入已保存的 Key，再启动内嵌服务，保证首局就能用上
  loadStoredApiKey();

  try {
    const info = await startUnoServer();
    await startDiscovery(info);
    mainWindow = createMainWindow(info.localUrl);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[uno-desktop] 启动失败: ${detail}`);
    dialog.showErrorBox('UNO 启动失败', `本地服务无法启动：${detail}`);
    app.quit();
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(bootstrap).catch((error: unknown) => {
    console.error('[uno-desktop] 初始化失败', error);
    dialog.showErrorBox('UNO 启动失败', String(error));
    app.quit();
  });

  app.on('activate', () => {
    if (!mainWindow && serverInfo) mainWindow = createMainWindow(serverInfo.localUrl);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', (event) => {
    if (shutdownComplete) return;
    event.preventDefault();
    if (shutdownStarted) return;
    shutdownStarted = true;
    void stopUnoServer().finally(() => {
      shutdownComplete = true;
      app.quit();
    });
  });
}
