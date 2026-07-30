import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

import { ProviderServiceError } from './provider-error';

const forbiddenHeaderNames = new Set([
  'connection',
  'content-length',
  'host',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const sensitiveHeaderPattern = /(?:authorization|api[-_]?key|token|secret|cookie|credential)/i;
const blockedNetworkAddresses = new BlockList();

blockedNetworkAddresses.addSubnet('0.0.0.0', 8, 'ipv4');
blockedNetworkAddresses.addSubnet('10.0.0.0', 8, 'ipv4');
blockedNetworkAddresses.addSubnet('100.64.0.0', 10, 'ipv4');
blockedNetworkAddresses.addSubnet('127.0.0.0', 8, 'ipv4');
blockedNetworkAddresses.addSubnet('169.254.0.0', 16, 'ipv4');
blockedNetworkAddresses.addSubnet('172.16.0.0', 12, 'ipv4');
blockedNetworkAddresses.addSubnet('192.0.0.0', 24, 'ipv4');
blockedNetworkAddresses.addSubnet('192.168.0.0', 16, 'ipv4');
blockedNetworkAddresses.addSubnet('198.18.0.0', 15, 'ipv4');
blockedNetworkAddresses.addSubnet('224.0.0.0', 4, 'ipv4');
blockedNetworkAddresses.addSubnet('::', 128, 'ipv6');
blockedNetworkAddresses.addSubnet('::1', 128, 'ipv6');
blockedNetworkAddresses.addSubnet('fc00::', 7, 'ipv6');
blockedNetworkAddresses.addSubnet('fe80::', 10, 'ipv6');
blockedNetworkAddresses.addSubnet('ff00::', 8, 'ipv6');

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) {
    return true;
  }
  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    return normalized.startsWith('127.');
  }
  return ipVersion === 6 && normalized === '::1';
}

export function validateProviderBaseUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ProviderServiceError(
      'VALIDATION_ERROR',
      'Base URL 不是有效地址。请输入包含协议和主机名的完整 URL。',
      false,
    );
  }

  if (url.username !== '' || url.password !== '') {
    throw new ProviderServiceError(
      'VALIDATION_ERROR',
      'Base URL 不能包含用户名或密码，请使用 API Key 或安全请求头。',
      false,
    );
  }
  if (url.search !== '' || url.hash !== '') {
    throw new ProviderServiceError('VALIDATION_ERROR', 'Base URL 不能包含查询参数或片段。', false);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ProviderServiceError(
      'VALIDATION_ERROR',
      'Base URL 只允许 HTTPS；本机开发服务可使用 HTTP。',
      false,
    );
  }
  if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname)) {
    throw new ProviderServiceError(
      'VALIDATION_ERROR',
      '非本机模型服务必须使用 HTTPS，避免凭据和代码通过明文网络传输。',
      false,
    );
  }

  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

export function validateCustomHeader(name: string, value: string): void {
  if (forbiddenHeaderNames.has(name.toLowerCase())) {
    throw new ProviderServiceError(
      'VALIDATION_ERROR',
      `请求头 ${name} 由网络栈管理，不能自定义。`,
      false,
    );
  }
  if (/[\r\n]/.test(value)) {
    throw new ProviderServiceError('VALIDATION_ERROR', `请求头 ${name} 包含非法换行符。`, false);
  }
}

export function isSensitiveHeaderName(name: string): boolean {
  return sensitiveHeaderPattern.test(name);
}

function isBlockedAddress(address: string, family: 4 | 6): boolean {
  return blockedNetworkAddresses.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

export async function assertSafeProviderEndpoint(input: string): Promise<void> {
  const url = new URL(input);
  const normalizedHostname = url.hostname.replace(/^\[|\]$/g, '');
  const directFamily = isIP(normalizedHostname);
  let addresses: ReadonlyArray<{ readonly address: string; readonly family: 4 | 6 }>;
  if (directFamily === 4 || directFamily === 6) {
    addresses = [{ address: normalizedHostname, family: directFamily }];
  } else {
    try {
      const resolvedAddresses = await lookup(normalizedHostname, {
        all: true,
        verbatim: true,
      });
      addresses = resolvedAddresses.map(({ address, family }) => {
        if (family !== 4 && family !== 6) {
          throw new Error('Unsupported address family');
        }
        return { address, family };
      });
    } catch {
      throw new ProviderServiceError(
        'PROVIDER_UNAVAILABLE',
        '无法解析模型服务地址。请检查 Base URL、DNS 和网络连接。',
        true,
      );
    }
  }

  if (url.protocol === 'http:') {
    if (!addresses.every(({ address }) => isLoopbackHostname(address))) {
      throw new ProviderServiceError(
        'VALIDATION_ERROR',
        'HTTP 模型服务解析到了非本机地址，已阻止发送凭据和代码。',
        false,
      );
    }
    return;
  }

  if (addresses.some(({ address, family }) => isBlockedAddress(address, family))) {
    throw new ProviderServiceError(
      'VALIDATION_ERROR',
      '模型服务地址解析到了本机、私网或保留地址。远程自定义服务必须使用公网 HTTPS 地址。',
      false,
    );
  }
}
