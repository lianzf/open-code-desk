import { createHash } from 'node:crypto';
import { extname } from 'node:path';

export const maximumFileBytes = 2_000_000;

const languageByExtension: Readonly<Record<string, string>> = {
  '.css': 'css',
  '.go': 'go',
  '.html': 'html',
  '.java': 'java',
  '.js': 'javascript',
  '.json': 'json',
  '.jsx': 'javascript',
  '.md': 'markdown',
  '.py': 'python',
  '.rs': 'rust',
  '.scss': 'scss',
  '.sh': 'shell',
  '.sql': 'sql',
  '.toml': 'toml',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
};

export function contentHash(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

export function fileLanguage(filePath: string): string {
  return languageByExtension[extname(filePath).toLocaleLowerCase('en-US')] ?? 'plaintext';
}

export function decodeText(content: Uint8Array): string {
  if (content.includes(0)) throw new Error('不支持打开二进制文件。');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    throw new Error('文件不是有效的 UTF-8 文本。');
  }
}

export function joinRelative(parent: string, child: string): string {
  return parent === '' ? child : `${parent}/${child}`;
}

export function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
