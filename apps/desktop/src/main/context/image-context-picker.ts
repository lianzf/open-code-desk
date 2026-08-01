import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';

import { dialog } from 'electron';
import type { ChatImageContentPart } from '@open-code-desk/provider-core';

const maximumImageBytes = 5 * 1024 * 1024;

export interface PickedContextImage {
  readonly title: string;
  readonly content: string;
  readonly sourceKey: string;
}

export interface ContextImagePicker {
  pick(): Promise<PickedContextImage | null>;
}

function detectMediaType(buffer: Buffer): ChatImageContentPart['mediaType'] | undefined {
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return 'image/png';
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  const signature = buffer.subarray(0, 6).toString('ascii');
  if (signature === 'GIF87a' || signature === 'GIF89a') {
    return 'image/gif';
  }
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return undefined;
}

export class ElectronContextImagePicker implements ContextImagePicker {
  public async pick(): Promise<PickedContextImage | null> {
    const result = await dialog.showOpenDialog({
      title: '选择图片上下文',
      properties: ['openFile'],
      filters: [
        {
          name: '图片',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
        },
      ],
    });
    const filePath = result.filePaths[0];
    if (result.canceled || filePath === undefined) {
      return null;
    }

    const metadata = await stat(filePath);
    if (!metadata.isFile() || metadata.size === 0 || metadata.size > maximumImageBytes) {
      throw new Error('图片必须是大小不超过 5 MB 的普通文件。');
    }
    const buffer = await readFile(filePath);
    if (buffer.byteLength > maximumImageBytes) {
      throw new Error('图片大小不能超过 5 MB。');
    }
    const mediaType = detectMediaType(buffer);
    if (mediaType === undefined) {
      throw new Error('图片内容不是受支持的 PNG、JPEG、GIF 或 WebP 格式。');
    }
    const digest = createHash('sha256').update(buffer).digest('hex');
    return {
      title: basename(filePath),
      content: `data:${mediaType};base64,${buffer.toString('base64')}`,
      sourceKey: `image:sha256:${digest}`,
    };
  }
}
