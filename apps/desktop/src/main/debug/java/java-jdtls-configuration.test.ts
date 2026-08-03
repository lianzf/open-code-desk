import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { jdtLsConfigurationName } from './java-jdtls-configuration';

describe('JDT LS platform configuration', () => {
  it.each([
    ['win32', 'x64', 'config_win'],
    ['darwin', 'x64', 'config_mac'],
    ['darwin', 'arm64', 'config_mac_arm'],
    ['linux', 'x64', 'config_linux'],
    ['linux', 'arm64', 'config_linux_arm'],
  ] as const)('maps %s-%s to %s', (platform, architecture, expected) => {
    expect(jdtLsConfigurationName(platform, architecture)).toBe(expected);
  });

  it('rejects unsupported platforms', () => {
    expect(() => jdtLsConfigurationName('aix', 'x64')).toThrow(
      'Java debugging is not supported on aix-x64.',
    );
    expect(() => jdtLsConfigurationName('win32', 'arm64')).toThrow(
      'Java debugging is not supported on win32-arm64.',
    );
  });

  it('ships JDT LS configurations with architecture-matched native launchers', () => {
    expect(configuration('config_mac')).toContain('cocoa.macosx.x86_64');
    expect(configuration('config_mac_arm')).toContain('cocoa.macosx.aarch64');
    expect(configuration('config_linux')).toContain('gtk.linux.x86_64');
    expect(configuration('config_linux_arm')).toContain('gtk.linux.aarch64');
  });
});

function configuration(name: string): string {
  return readFileSync(
    resolve('apps', 'desktop', 'vendor', 'jdtls-1.60.0', name, 'config.ini'),
    'utf8',
  );
}
