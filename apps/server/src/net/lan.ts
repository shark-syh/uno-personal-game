/**
 * 局域网地址工具（M8 联机配套）：枚举本机非回环 IPv4，生成可分享的访问地址。
 * 用于服务启动日志与 /api/health，让房主能直接把「http://192.168.x.x:3000」告诉好友。
 */
import { networkInterfaces } from 'node:os';

export function getLanAddresses(port: number): string[] {
  const urls: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family !== 'IPv4' || item.internal) continue;
      urls.push(`http://${item.address}:${port}`);
    }
  }
  return urls;
}
