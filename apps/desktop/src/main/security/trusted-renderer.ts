import { normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function normalizedPath(path: string): string {
  const resolvedPath = normalize(resolve(path));
  return process.platform === 'win32' ? resolvedPath.toLocaleLowerCase('en-US') : resolvedPath;
}

export function isTrustedRendererUrl(
  senderUrl: string,
  rendererHtmlPath: string,
  devServerUrl?: string,
): boolean {
  try {
    const parsedSenderUrl = new URL(senderUrl);

    if (devServerUrl !== undefined) {
      return parsedSenderUrl.origin === new URL(devServerUrl).origin;
    }

    if (parsedSenderUrl.protocol !== 'file:') {
      return false;
    }

    return normalizedPath(fileURLToPath(parsedSenderUrl)) === normalizedPath(rendererHtmlPath);
  } catch {
    return false;
  }
}
