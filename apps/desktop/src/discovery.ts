/**
 * M10-04：局域网 UDP 房间发现。
 *
 * 主机每 2 秒广播开放房间码 + HTTP/WS 端口 + 应用版本；客户端监听并缓存，
 * 输入房间码后匹配到主机地址，再连接 `ws://<host>:<port>/ws`。
 *
 * 纯协议/缓存与网络服务放在同一模块，便于单测；不依赖 Electron。
 */
import { randomUUID } from 'node:crypto';
import { createSocket, type RemoteInfo, type Socket } from 'node:dgram';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

export const DISCOVERY_MAGIC = 'uno-discovery';
export const DISCOVERY_PROTOCOL = 1;
/** 固定 UDP 端口：主机广播与客户端监听共用（可被测试覆盖） */
export const DISCOVERY_PORT = 41234;
export const DISCOVERY_INTERVAL_MS = 2000;
/** 连续 3 次未收到广播即视为房间消失 */
export const DISCOVERY_TTL_MS = 7000;
export const ROOM_CODE_PATTERN = /^[A-Z2-9]{4,6}$/;

const MAX_PACKET_BYTES = 4096;
const MAX_ROOMS_PER_ANNOUNCEMENT = 32;
const MAX_CACHE_ENTRIES = 64;
const MAX_HOSTS = 10;
const APP_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export interface DiscoveryRoom {
  code: string;
  players: number;
}

export interface DiscoveryAnnouncement {
  magic: typeof DISCOVERY_MAGIC;
  protocol: number;
  instanceId: string;
  appVersion: string;
  hostName: string;
  port: number;
  rooms: DiscoveryRoom[];
}

export interface DiscoveredRoom {
  code: string;
  host: string;
  port: number;
  instanceId: string;
  hostName: string;
  appVersion: string;
  players: number;
  compatible: boolean;
  lastSeenAt: number;
}

export interface HostEndpoint {
  host: string;
  port: number;
}

export interface DiscoveryServiceOptions {
  /** 内嵌 HTTP/WS 服务端口 */
  port: number;
  instanceId: string;
  appVersion: string;
  hostName: string;
  /** 当前开放房间（每次广播时读取） */
  getRooms: () => DiscoveryRoom[];
  /** 覆盖 UDP 监听端口；测试可传 0 取随机端口 */
  discoveryPort?: number;
  /** 覆盖广播目标；测试可传 127.0.0.1 */
  broadcastAddresses?: () => string[];
  now?: () => number;
  onError?: (message: string) => void;
}

interface DiscoveryAnnouncementInput {
  instanceId: string;
  appVersion: string;
  hostName: string;
  port: number;
  rooms: DiscoveryRoom[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeLabel(value: string, maxLength: number): string {
  let cleaned = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) continue;
    cleaned += char;
  }
  return cleaned.trim().slice(0, maxLength);
}

function isPort(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 65535;
}

export function isValidRoomCode(value: unknown): value is string {
  return typeof value === 'string' && ROOM_CODE_PATTERN.test(value);
}

function normalizeRooms(value: unknown): DiscoveryRoom[] | null {
  if (!Array.isArray(value) || value.length > MAX_ROOMS_PER_ANNOUNCEMENT) return null;
  const rooms = new Map<string, DiscoveryRoom>();
  for (const item of value) {
    if (!isRecord(item)) return null;
    const code = typeof item.code === 'string' ? item.code.trim().toUpperCase() : '';
    if (!isValidRoomCode(code)) return null;
    if (!Number.isInteger(item.players)) return null;
    const players = item.players as number;
    if (players < 1 || players > MAX_HOSTS) return null;
    rooms.set(code, { code, players });
  }
  return [...rooms.values()];
}

/** 生成待广播的公告（房间码去重、字段清洗） */
export function createAnnouncement(input: DiscoveryAnnouncementInput): DiscoveryAnnouncement {
  const rooms = new Map<string, DiscoveryRoom>();
  for (const room of input.rooms) {
    const code = room.code.trim().toUpperCase();
    if (!isValidRoomCode(code)) continue;
    rooms.set(code, { code, players: Math.min(MAX_HOSTS, Math.max(1, Math.trunc(room.players))) });
  }
  return {
    magic: DISCOVERY_MAGIC,
    protocol: DISCOVERY_PROTOCOL,
    instanceId: sanitizeLabel(input.instanceId, 64),
    appVersion: sanitizeLabel(input.appVersion, 32),
    hostName: sanitizeLabel(input.hostName, 64) || 'UNO',
    port: input.port,
    rooms: [...rooms.values()].slice(0, MAX_ROOMS_PER_ANNOUNCEMENT),
  };
}

export function encodeAnnouncement(input: DiscoveryAnnouncementInput): string {
  return JSON.stringify(createAnnouncement(input));
}

/** 严格解析 UDP 报文；任何字段异常都当作无效包丢弃 */
export function parseAnnouncement(raw: string | Buffer): DiscoveryAnnouncement | null {
  const text = typeof raw === 'string' ? raw : raw.toString('utf8');
  if (text.length === 0 || Buffer.byteLength(text, 'utf8') > MAX_PACKET_BYTES) return null;

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  if (data.magic !== DISCOVERY_MAGIC) return null;
  if (data.protocol !== DISCOVERY_PROTOCOL) return null;

  const instanceId =
    typeof data.instanceId === 'string' ? sanitizeLabel(data.instanceId, 64) : '';
  if (!/^[A-Za-z0-9-]{8,64}$/.test(instanceId)) return null;

  const appVersion =
    typeof data.appVersion === 'string' ? sanitizeLabel(data.appVersion, 32) : '';
  if (!APP_VERSION_PATTERN.test(appVersion)) return null;

  const hostName = typeof data.hostName === 'string' ? sanitizeLabel(data.hostName, 64) : '';
  if (!hostName) return null;
  if (!isPort(data.port)) return null;

  const rooms = normalizeRooms(data.rooms);
  if (!rooms) return null;

  return {
    magic: DISCOVERY_MAGIC,
    protocol: DISCOVERY_PROTOCOL,
    instanceId,
    appVersion,
    hostName,
    port: data.port,
    rooms,
  };
}

function parseIpv4(value: string): [number, number, number, number] | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const numbers: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const number = Number(part);
    if (number < 0 || number > 255) return null;
    numbers.push(number);
  }
  return [numbers[0]!, numbers[1]!, numbers[2]!, numbers[3]!];
}

export function isIpv4(value: string): boolean {
  return parseIpv4(value) !== null;
}

function ipv4ToNumber(value: string): number | null {
  const parts = parseIpv4(value);
  if (!parts) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function numberToIpv4(value: number): string {
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
}

/** 由 IP + 子网掩码计算定向广播地址（如 192.168.1.23/24 → 192.168.1.255） */
export function broadcastAddressFor(address: string, netmask: string): string | null {
  const ip = ipv4ToNumber(address);
  const mask = ipv4ToNumber(netmask);
  if (ip === null || mask === null) return null;
  return numberToIpv4((ip | (~mask >>> 0)) >>> 0);
}

/** 所有非回环 IPv4 接口的定向广播地址 + 受限广播兜底 */
export function getBroadcastAddresses(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): string[] {
  const addresses = new Set<string>();
  for (const list of Object.values(interfaces)) {
    for (const item of list ?? []) {
      if (item.family !== 'IPv4' || item.internal) continue;
      const broadcast = broadcastAddressFor(item.address, item.netmask);
      if (broadcast) addresses.add(broadcast);
    }
  }
  addresses.add('255.255.255.255');
  return [...addresses];
}

const HOST_PATTERN = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;

/** 解析手动主机地址（host:port）；拒绝带协议头、路径或非法端口 */
export function parseEndpoint(raw: string): HostEndpoint | null {
  const value = raw.trim();
  const separator = value.lastIndexOf(':');
  if (separator <= 0) return null;
  const host = value.slice(0, separator);
  const portText = value.slice(separator + 1);
  if (!/^\d{1,5}$/.test(portText)) return null;
  if (!HOST_PATTERN.test(host)) return null;
  const port = Number(portText);
  if (!isPort(port)) return null;
  return { host: host.toLowerCase(), port };
}

/** 主版本一致才允许联机（协议版本已由 parseAnnouncement 单独校验） */
export function isCompatibleAppVersion(remote: string, local: string): boolean {
  const remoteMajor = remote.split('.')[0];
  const localMajor = local.split('.')[0];
  return Boolean(remoteMajor) && remoteMajor === localMajor;
}

interface CachedAnnouncement {
  announcement: DiscoveryAnnouncement;
  host: string;
  lastSeenAt: number;
}

export class DiscoveryCache {
  private readonly entries = new Map<string, CachedAnnouncement>();

  constructor(private readonly ttlMs = DISCOVERY_TTL_MS) {}

  record(announcement: DiscoveryAnnouncement, host: string, now = Date.now()): void {
    if (!isIpv4(host) || announcement.rooms.length === 0) return;
    this.entries.set(announcement.instanceId, {
      announcement: { ...announcement, rooms: announcement.rooms.map((room) => ({ ...room })) },
      host,
      lastSeenAt: now,
    });
    this.prune(now);
    while (this.entries.size > MAX_CACHE_ENTRIES) {
      let oldestKey: string | null = null;
      let oldestAt = Number.POSITIVE_INFINITY;
      for (const [key, entry] of this.entries) {
        if (entry.lastSeenAt < oldestAt) {
          oldestAt = entry.lastSeenAt;
          oldestKey = key;
        }
      }
      if (!oldestKey) break;
      this.entries.delete(oldestKey);
    }
  }

  list(now = Date.now()): CachedAnnouncement[] {
    this.prune(now);
    return [...this.entries.values()].sort(
      (left, right) =>
        right.lastSeenAt - left.lastSeenAt ||
        left.announcement.instanceId.localeCompare(right.announcement.instanceId),
    );
  }

  find(code: string, now = Date.now()): CachedAnnouncement[] {
    const normalized = code.trim().toUpperCase();
    if (!isValidRoomCode(normalized)) return [];
    return this.list(now).filter((entry) =>
      entry.announcement.rooms.some((room) => room.code === normalized),
    );
  }

  prune(now = Date.now()): void {
    for (const [key, entry] of this.entries) {
      if (now - entry.lastSeenAt > this.ttlMs) this.entries.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

export class DiscoveryService {
  private readonly cache = new DiscoveryCache();
  private readonly now: () => number;
  private socket: Socket | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listening = false;
  private boundPortValue: number | null = null;
  private reportedSocketError = false;

  constructor(private readonly options: DiscoveryServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  get enabled(): boolean {
    return this.listening;
  }

  get boundPort(): number | null {
    return this.boundPortValue;
  }

  async start(): Promise<boolean> {
    if (this.socket) return this.listening;

    const socket = createSocket({ type: 'udp4', reuseAddr: true });
    this.socket = socket;
    socket.on('message', (message, remote) => this.handleMessage(message, remote));

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          socket.off('listening', onListening);
          reject(error);
        };
        const onListening = (): void => {
          socket.off('error', onError);
          resolve();
        };
        socket.once('error', onError);
        socket.once('listening', onListening);
        socket.bind({
          port: this.options.discoveryPort ?? DISCOVERY_PORT,
          address: '0.0.0.0',
          exclusive: false,
        });
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.options.onError?.(`UDP 发现启动失败（${detail}），可手动输入主机地址`);
      this.socket = null;
      try {
        socket.close();
      } catch {
        /* 未监听时关闭可能抛错，忽略 */
      }
      return false;
    }

    socket.on('error', (error) => {
      if (this.reportedSocketError) return;
      this.reportedSocketError = true;
      this.options.onError?.(`UDP 发现连接异常：${error.message}`);
    });
    try {
      socket.setBroadcast(true);
    } catch {
      /* 某些系统不允许设置广播，发送时会失败并静默 */
    }

    const address = socket.address();
    this.boundPortValue = typeof address === 'object' ? address.port : null;
    this.listening = true;
    this.announce();
    this.timer = setInterval(() => this.announce(), DISCOVERY_INTERVAL_MS);
    this.timer.unref?.();
    return true;
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.listening = false;
    this.boundPortValue = null;
    const socket = this.socket;
    this.socket = null;
    this.cache.clear();
    if (!socket) return;
    await new Promise<void>((resolve) => {
      try {
        socket.close(() => resolve());
      } catch {
        resolve();
      }
    });
  }

  listRooms(localVersion = this.options.appVersion, now = this.now()): DiscoveredRoom[] {
    const rooms: DiscoveredRoom[] = [];
    for (const entry of this.cache.list(now)) {
      for (const room of entry.announcement.rooms) {
        rooms.push({
          code: room.code,
          host: entry.host,
          port: entry.announcement.port,
          instanceId: entry.announcement.instanceId,
          hostName: entry.announcement.hostName,
          appVersion: entry.announcement.appVersion,
          players: room.players,
          compatible: isCompatibleAppVersion(entry.announcement.appVersion, localVersion),
          lastSeenAt: entry.lastSeenAt,
        });
      }
    }
    return rooms.sort(
      (left, right) =>
        left.code.localeCompare(right.code) ||
        Number(right.compatible) - Number(left.compatible) ||
        left.host.localeCompare(right.host),
    );
  }

  findRoom(
    code: string,
    localVersion = this.options.appVersion,
    now = this.now(),
  ): DiscoveredRoom[] {
    const normalized = code.trim().toUpperCase();
    if (!isValidRoomCode(normalized)) return [];
    return this.cache.find(normalized, now).flatMap((entry) => {
      const room = entry.announcement.rooms.find((item) => item.code === normalized);
      if (!room) return [];
      return [
        {
          code: normalized,
          host: entry.host,
          port: entry.announcement.port,
          instanceId: entry.announcement.instanceId,
          hostName: entry.announcement.hostName,
          appVersion: entry.announcement.appVersion,
          players: room.players,
          compatible: isCompatibleAppVersion(entry.announcement.appVersion, localVersion),
          lastSeenAt: entry.lastSeenAt,
        },
      ];
    });
  }

  private announce(): void {
    const socket = this.socket;
    if (!socket || !this.listening) return;
    let rooms: DiscoveryRoom[];
    try {
      rooms = this.options.getRooms();
    } catch {
      return;
    }
    if (rooms.length === 0) return;

    let packet: Buffer;
    try {
      packet = Buffer.from(
        encodeAnnouncement({
          instanceId: this.options.instanceId,
          appVersion: this.options.appVersion,
          hostName: this.options.hostName,
          port: this.options.port,
          rooms,
        }),
        'utf8',
      );
    } catch {
      return;
    }

    const addresses = this.options.broadcastAddresses?.() ?? getBroadcastAddresses();
    const discoveryPort = this.boundPortValue ?? DISCOVERY_PORT;
    for (const address of addresses) {
      socket.send(packet, discoveryPort, address, () => {
        /* 单个网卡/防火墙失败不影响其他地址 */
      });
    }
  }

  private handleMessage(message: Buffer, remote: RemoteInfo): void {
    if (!this.listening) return;
    const announcement = parseAnnouncement(message);
    if (!announcement) return;
    if (announcement.instanceId === this.options.instanceId) return;
    if (!isIpv4(remote.address)) return;
    this.cache.record(announcement, remote.address, this.now());
  }
}

export function createDiscoveryService(options: DiscoveryServiceOptions): DiscoveryService {
  return new DiscoveryService(options);
}

/** 测试/主进程用：稳定的实例 ID */
export function createInstanceId(): string {
  return randomUUID();
}
