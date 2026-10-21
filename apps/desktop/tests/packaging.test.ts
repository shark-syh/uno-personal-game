import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const DESKTOP_DIR = path.resolve('apps/desktop');
const yml = readFileSync(path.join(DESKTOP_DIR, 'electron-builder.yml'), 'utf8');
const installerScript = readFileSync(path.join(DESKTOP_DIR, 'build', 'installer.nsi'), 'utf8');

describe('electron-builder 打包配置', () => {
  it('只打包构建产物，不携带源码或密钥', () => {
    expect(yml).toContain('appId: com.uno.local');
    expect(yml).toContain('dist/**/*');
    expect(yml).not.toContain('.env');
    expect(yml).not.toContain('- node_modules');
  });

  it('前端以 extraResources 复制到 resources/web', () => {
    expect(yml).toMatch(/extraResources:[\s\S]*from: \.\.\/web[\s\S]*to: web/);
  });

  it('NSIS 产物命名为 UNO-Setup-<版本>.exe，且为当前用户安装', () => {
    expect(yml).toContain('UNO-Setup-${version}.${ext}');
    expect(yml).toContain('script: installer.nsi');
    expect(yml).toContain('oneClick: true');
    expect(yml).toContain('perMachine: false');
  });

  it('自建 NSIS 脚本在安装时生成卸载器，避免执行中间安装器', () => {
    expect(installerScript).toContain('WriteUninstaller');
    expect(installerScript).not.toContain('UNINSTALLER_OUT_FILE');
    expect(installerScript).not.toContain('PowerShell');
  });

  it('图标资源存在', () => {
    expect(statSync(path.join(DESKTOP_DIR, 'build', 'icon.ico')).size).toBeGreaterThan(0);
    expect(statSync(path.join(DESKTOP_DIR, 'build', 'icon.png')).size).toBeGreaterThan(0);
  });
});
