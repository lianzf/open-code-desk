import {
  appSettingsSchema,
  type AppSettings,
  type UpdateAppSettingsRequest,
} from '@open-code-desk/ipc-contracts';

import type { ProviderConfigRepository } from '../providers/provider-config.repository';
import type { AppSettingsRepository } from './app-settings.repository';

const providerSelectionKey = 'provider-selection';

export class AppSettingsService {
  public constructor(
    private readonly repository: AppSettingsRepository,
    private readonly providers: ProviderConfigRepository,
  ) {}

  public get(): AppSettings {
    const stored = appSettingsSchema.safeParse(this.repository.get(providerSelectionKey));
    return this.normalize(
      stored.success ? stored.data : appSettingsSchema.parse({ selectedModels: {} }),
    );
  }

  public update(input: UpdateAppSettingsRequest): AppSettings {
    const current = this.get();
    const normalized = this.normalize({
      selectedModels: input.selectedModels ?? current.selectedModels,
      shortcuts: input.shortcuts ?? current.shortcuts,
      theme: input.theme ?? current.theme,
      locale: input.locale ?? current.locale,
      autoCheckUpdates: input.autoCheckUpdates ?? current.autoCheckUpdates,
      crashReporting: input.crashReporting ?? current.crashReporting,
      ...(input.selectedProviderId === undefined && current.selectedProviderId === undefined
        ? {}
        : { selectedProviderId: input.selectedProviderId ?? current.selectedProviderId }),
    });
    this.repository.set(providerSelectionKey, normalized);
    return normalized;
  }

  private normalize(input: AppSettings): AppSettings {
    const providerIds = new Set(this.providers.list().map((provider) => provider.id));
    const selectedModels = Object.fromEntries(
      Object.entries(input.selectedModels).filter(([providerId]) => providerIds.has(providerId)),
    );
    const selectedProviderId =
      input.selectedProviderId !== undefined && providerIds.has(input.selectedProviderId)
        ? input.selectedProviderId
        : undefined;
    return {
      ...(selectedProviderId === undefined ? {} : { selectedProviderId }),
      selectedModels,
      theme: input.theme,
      locale: input.locale,
      shortcuts: input.shortcuts,
      autoCheckUpdates: input.autoCheckUpdates,
      crashReporting: input.crashReporting,
    };
  }
}
