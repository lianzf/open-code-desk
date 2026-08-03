export function jdtLsConfigurationName(
  platform: NodeJS.Platform,
  architecture: NodeJS.Architecture,
): string {
  if (platform === 'win32' && architecture === 'x64') return 'config_win';
  if (platform === 'darwin' && architecture === 'arm64') return 'config_mac_arm';
  if (platform === 'darwin' && architecture === 'x64') return 'config_mac';
  if (platform === 'linux' && architecture === 'arm64') return 'config_linux_arm';
  if (platform === 'linux' && architecture === 'x64') return 'config_linux';
  throw new Error(`Java debugging is not supported on ${platform}-${architecture}.`);
}
