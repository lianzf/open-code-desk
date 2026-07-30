import { dialog } from 'electron';

export interface DirectoryPicker {
  pickDirectory(): Promise<string | null>;
}

export class ElectronDirectoryPicker implements DirectoryPicker {
  public async pickDirectory(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      title: '打开本地代码项目',
      properties: ['openDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0] ?? null;
  }
}
