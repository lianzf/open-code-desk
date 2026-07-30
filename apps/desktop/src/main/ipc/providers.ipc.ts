import { ipcMain } from 'electron';
import {
  connectionTestResultSchema,
  deleteProviderRequestSchema,
  deleteProviderResponseSchema,
  modelInfoListSchema,
  providerChannels,
  providerConfigListSchema,
  providerConfigSchema,
  providerDescriptorListSchema,
  providerIdRequestSchema,
  saveProviderRequestSchema,
} from '@open-code-desk/ipc-contracts';

import type { ProviderService } from '../providers/provider.service';
import { assertTrustedIpcEvent, type TrustedRendererOptions } from './assert-trusted-event';

export function registerProvidersIpc(
  options: TrustedRendererOptions,
  service: ProviderService,
): void {
  ipcMain.handle(providerChannels.listKinds, (event) => {
    assertTrustedIpcEvent(event, options);
    return providerDescriptorListSchema.parse(service.listKinds());
  });

  ipcMain.handle(providerChannels.list, (event) => {
    assertTrustedIpcEvent(event, options);
    return providerConfigListSchema.parse(service.list());
  });

  ipcMain.handle(providerChannels.save, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = saveProviderRequestSchema.parse(untrustedInput);
    return providerConfigSchema.parse(await service.save(input));
  });

  ipcMain.handle(providerChannels.delete, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = deleteProviderRequestSchema.parse(untrustedInput);
    await service.delete(input.providerId);
    return deleteProviderResponseSchema.parse({ deleted: true });
  });

  ipcMain.handle(providerChannels.testConnection, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = providerIdRequestSchema.parse(untrustedInput);
    return connectionTestResultSchema.parse(await service.testConnection(input.providerId));
  });

  ipcMain.handle(providerChannels.listModels, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = providerIdRequestSchema.parse(untrustedInput);
    return modelInfoListSchema.parse(await service.listModels(input.providerId));
  });
}

export function unregisterProvidersIpc(): void {
  Object.values(providerChannels).forEach((channel) => ipcMain.removeHandler(channel));
}
