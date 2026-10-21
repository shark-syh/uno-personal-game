import { createSocket } from 'node:dgram';
import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  DISCOVERY_MAGIC,
  DISCOVERY_PROTOCOL,
  DISCOVERY_TTL_MS,
  DiscoveryCache,
  broadcastAddressFor,
  createDiscoveryService,
  encodeAnnouncement,
  getBroadcastAddresses,
  isCompatibleAppVersion,
  parseAnnouncement,
  parseEndpoint,
} from '../src/discovery.ts';

const BASE_ANNOUNCEMENT = {
  instanceId: 'host-aaaa',
  appVersion: '1.3.0',
  hostName: '客厅电脑',
  port: 51234,
  rooms: [
    { code: 'ABC234', players: 2 },
    { code: 'XYZ789', players: 4 },
  ],
};

function jsonWith(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    magic: DISCOVERY_MAGIC,
    protocol: DISCOVERY_PROTOCOL,
    ...BASE_ANNOUNCEMENT,
    ...overrides,
  });
}

describe('M10-04 UDP 发现协议', () => {
  it('编码/解析往返：房间码转大写并去重，控制字符被清洗', () => {
    const raw = encodeAnnouncement({
      ...BASE_ANNOUNCEMENT,
      hostName: ' 客厅\n电脑 ',
      rooms: [
        { code: 'abc234', players: 2 },
        { code: 'ABC234', players: 3 },
        { code: 'BAD1', players: 2 },
        { code: 'XYZ789', players: 99 },
      ],
    });
    const parsed = parseAnnouncement(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.hostName).toBe('客厅电脑');
    expect(parsed?.rooms).toEqual([
      { code: 'ABC234', players: 3 },
      { code: 'XYZ789', players: 10 },
    ]);
  });

  it('拒绝非法报文：协议、端口、版本、房间码、超长/非 JSON', () => {
    expect(parseAnnouncement('not json')).toBeNull();
    expect(parseAnnouncement(jsonWith({ magic: 'other' }))).toBeNull();
    expect(parseAnnouncement(jsonWith({ protocol: 2 }))).toBeNull();
    expect(parseAnnouncement(jsonWith({ instanceId: 'short' }))).toBeNull();
    expect(parseAnnouncement(jsonWith({ appVersion: 'v1.3' }))).toBeNull();
    expect(parseAnnouncement(jsonWith({ hostName: '   ' }))).toBeNull();
    expect(parseAnnouncement(jsonWith({ port: 0 }))).toBeNull();
    expect(parseAnnouncement(jsonWith({ port: 70000 }))).toBeNull();
    expect(parseAnnouncement(jsonWith({ rooms: [{ code: 'ABC1', players: 2 }] }))).toBeNull();
    expect(parseAnnouncement(jsonWith({ rooms: [{ code: 'ABC234', players: 0 }] }))).toBeNull();
    expect(parseAnnouncement('x'.repeat(5000))).toBeNull();
  });

  it('版本兼容按主版本号判断', () => {
    expect(isCompatibleAppVersion('1.3.0', '1.9.9')).toBe(true);
    expect(isCompatibleAppVersion('2.0.0', '1.3.0')).toBe(false);
    expect(isCompatibleAppVersion('', '1.3.0')).toBe(false);
  });

  it('手动地址只接受 host:port', () => {
    expect(parseEndpoint('192.168.1.5:51234')).toEqual({ host: '192.168.1.5', port: 51234 });
    expect(parseEndpoint(' My-PC.local:3000 ')).toEqual({ host: 'my-pc.local', port: 3000 });
    expect(parseEndpoint('localhost:3000')).toEqual({ host: 'localhost', port: 3000 });
    for (const invalid of [
      'http://192.168.1.5:3000',
      '192.168.1.5',
      ':3000',
      '192.168.1.5:0',
      '192.168.1.5:70000',
      'a b:3000',
      '192.168.1.5:abc',
    ]) {
      expect(parseEndpoint(invalid), invalid).toBeNull();
    }
  });

  it('由 IP/掩码计算定向广播地址，并跳过回环接口', () => {
    expect(broadcastAddressFor('192.168.1.23', '255.255.255.0')).toBe('192.168.1.255');
    expect(broadcastAddressFor('10.0.5.7', '255.255.0.0')).toBe('10.0.255.255');
    expect(broadcastAddressFor('172.16.3.9', '255.255.255.252')).toBe('172.16.3.11');
    expect(broadcastAddressFor('bad', '255.255.255.0')).toBeNull();

    const interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = {
      eth0: [
        {
          address: '192.168.1.10',
          netmask: '255.255.255.0',
          family: 'IPv4',
          mac: '00:00:00:00:00:00',
          internal: false,
          cidr: '192.168.1.10/24',
        },
      ],
      loopback: [
        {
          address: '127.0.0.1',
          netmask: '255.0.0.0',
          family: 'IPv4',
          mac: '00:00:00:00:00:00',
          internal: true,
          cidr: '127.0.0.1/8',
        },
      ],
    };
    expect(getBroadcastAddresses(interfaces)).toEqual(['192.168.1.255', '255.255.255.255']);
  });

  it('缓存按 TTL 过期、按房间码匹配多个主机，并忽略无效来源地址', () => {
    const cache = new DiscoveryCache(7000);
    const first = parseAnnouncement(jsonWith({}));
    const second = parseAnnouncement(
      jsonWith({ instanceId: 'host-bbbb', hostName: '书房电脑', rooms: [{ code: 'ABC234', players: 1 }] }),
    );
    if (!first || !second) throw new Error('测试报文应有效');

    cache.record(first, '192.168.1.9', 1000);
    cache.record(second, 'not-an-ip', 1100);
    expect(cache.find('ABC234', 1200)).toHaveLength(1);

    cache.record(second, '192.168.1.10', 1500);
    expect(cache.list(1600)).toHaveLength(2);
    expect(cache.find('abc234', 1600).map((entry) => entry.host)).toEqual([
      '192.168.1.10',
      '192.168.1.9',
    ]);

    cache.record(first, '192.168.1.9', 2000);
    expect(cache.find('XYZ789', 2500)).toHaveLength(1);
    expect(cache.find('ABC234', 2000 + DISCOVERY_TTL_MS + 1)).toEqual([]);
  });

  it('通过 UDP 收包后可按房间码匹配，并忽略自身广播/过期条目', async () => {
    let clock = 10_000;
    const service = createDiscoveryService({
      port: 51234,
      instanceId: 'self-host',
      appVersion: '1.3.0',
      hostName: 'self',
      getRooms: () => [],
      discoveryPort: 0,
      broadcastAddresses: () => [],
      now: () => clock,
    });
    const sender = createSocket('udp4');
    try {
      expect(await service.start()).toBe(true);
      const port = service.boundPort;
      expect(port).not.toBeNull();
      if (port === null) throw new Error('UDP 服务未返回端口');

      const send = (packet: string): Promise<void> =>
        new Promise((resolve, reject) => {
          sender.send(packet, port, '127.0.0.1', (error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      const waitFor = async (predicate: () => boolean): Promise<boolean> => {
        const deadline = Date.now() + 2000;
        while (Date.now() < deadline) {
          if (predicate()) return true;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        return false;
      };

      await send(
        jsonWith({ instanceId: 'peer-host', hostName: '客厅电脑', appVersion: '1.3.9' }),
      );
      expect(await waitFor(() => service.findRoom('ABC234', '1.3.0').length === 1)).toBe(true);
      const [match] = service.findRoom('ABC234', '1.3.0');
      expect(match).toMatchObject({
        host: '127.0.0.1',
        port: 51234,
        hostName: '客厅电脑',
        players: 2,
        compatible: true,
      });

      await send(jsonWith({ instanceId: 'self-host', rooms: [{ code: 'SELF22', players: 2 }] }));
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(service.findRoom('SELF22', '1.3.0')).toEqual([]);

      clock += DISCOVERY_TTL_MS + 1;
      expect(service.findRoom('ABC234', '1.3.0')).toEqual([]);
    } finally {
      sender.close();
      await service.stop();
    }
  });
});
