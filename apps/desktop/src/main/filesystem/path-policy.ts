import { isAbsolute, relative, resolve, sep, win32 } from 'node:path';

const sensitiveFileNames = new Set(['id_dsa', 'id_ecdsa', 'id_ed25519', 'id_rsa', 'known_hosts']);

const sensitiveDirectoryNames = new Set(['.aws', '.azure', '.gnupg', '.ssh', 'browser data']);

export const ignoredDirectoryNames = new Set([
  '.git',
  '.next',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'playwright-report',
  'release',
  'test-results',
]);

function comparablePath(path: string): string {
  const resolved = resolve(path);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

export function isPathInside(rootPath: string, candidatePath: string): boolean {
  const root = comparablePath(rootPath);
  const candidate = comparablePath(candidatePath);
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === '' ||
    (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot))
  );
}

export function normalizeRelativePath(input: string): string {
  if (input.includes('\0')) {
    throw new Error('路径包含无效字符。');
  }

  if (isAbsolute(input) || win32.isAbsolute(input)) {
    throw new Error('只允许工作区内的相对路径。');
  }

  if (input === '') {
    return '';
  }

  const normalizedSeparators = input.replaceAll('\\', '/');
  const segments = normalizedSeparators.split('/');

  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error('路径包含不允许的跳转或空路径段。');
  }

  return segments.join('/');
}

export function toPlatformPath(rootPath: string, relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath);
  const candidate = normalized === '' ? rootPath : resolve(rootPath, ...normalized.split('/'));

  if (!isPathInside(rootPath, candidate)) {
    throw new Error('路径超出工作区边界。');
  }

  return candidate;
}

export function isSensitiveRelativePath(relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath).toLocaleLowerCase('en-US');

  if (normalized === '') {
    return false;
  }

  const segments = normalized.split('/');
  return segments.some((segment) => {
    if (sensitiveDirectoryNames.has(segment) || sensitiveFileNames.has(segment)) {
      return true;
    }

    return (
      segment === '.env' ||
      segment.startsWith('.env.') ||
      segment.endsWith('.p12') ||
      segment.endsWith('.pfx')
    );
  });
}

export function isIgnoredDirectoryName(name: string): boolean {
  return ignoredDirectoryNames.has(name.toLocaleLowerCase('en-US'));
}
