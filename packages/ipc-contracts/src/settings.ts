import { z } from 'zod';

const providerIdSchema = z.string().uuid();
const modelIdSchema = z.string().trim().min(1).max(500);
const shortcutSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(
    /^(?:(?:Ctrl|Cmd|Alt|Shift)\+)*(?:[A-Z0-9]|Comma|Period|Slash|Backquote|F(?:[1-9]|1[0-2]))$/,
    'Shortcut must use modifiers followed by one supported key.',
  );

function shortcutIdentity(shortcut: string): string {
  const tokens = shortcut.split('+');
  const key = tokens.pop() ?? '';
  return `${tokens.sort().join('+')}+${key}`.toLocaleLowerCase('en-US');
}

export const settingsChannels = {
  get: 'settings:get',
  update: 'settings:update',
} as const;

export const appThemeSchema = z.enum(['system', 'dark', 'light']);
export const appLocaleSchema = z.enum(['zh-CN', 'en-US']);
export const shortcutSettingsSchema = z
  .object({
    openApplicationSettings: shortcutSchema,
    openProviderSettings: shortcutSchema,
    toggleTerminal: shortcutSchema,
    toggleGit: shortcutSchema,
  })
  .strict()
  .superRefine((shortcuts, context) => {
    const assigned = new Map<string, string>();
    for (const [action, shortcut] of Object.entries(shortcuts)) {
      const modifiers = shortcut.split('+').slice(0, -1);
      if (new Set(modifiers).size !== modifiers.length) {
        context.addIssue({
          code: 'custom',
          message: 'Shortcut contains a duplicate modifier.',
          path: [action],
        });
      }
      if (modifiers.includes('Ctrl') && modifiers.includes('Cmd')) {
        context.addIssue({
          code: 'custom',
          message: 'Ctrl and Cmd cannot be combined in a cross-platform shortcut.',
          path: [action],
        });
      }
      const normalized = shortcutIdentity(shortcut);
      const duplicateAction = assigned.get(normalized);
      if (duplicateAction !== undefined) {
        context.addIssue({
          code: 'custom',
          message: `Shortcut conflicts with ${duplicateAction}.`,
          path: [action],
        });
      } else {
        assigned.set(normalized, action);
      }
    }
  });

export const defaultShortcutSettings = {
  openApplicationSettings: 'Ctrl+Comma',
  openProviderSettings: 'Ctrl+Shift+Comma',
  toggleTerminal: 'Ctrl+Backquote',
  toggleGit: 'Ctrl+Shift+G',
} as const;

export const appSettingsSchema = z
  .object({
    selectedProviderId: providerIdSchema.optional(),
    selectedModels: z.record(providerIdSchema, modelIdSchema).default({}),
    theme: appThemeSchema.default('system'),
    locale: appLocaleSchema.default('zh-CN'),
    shortcuts: shortcutSettingsSchema.default(defaultShortcutSettings),
    autoCheckUpdates: z.boolean().default(true),
    crashReporting: z.boolean().default(true),
  })
  .strict();

export const updateAppSettingsRequestSchema = z
  .object({
    selectedProviderId: providerIdSchema.optional(),
    selectedModels: z.record(providerIdSchema, modelIdSchema).optional(),
    theme: appThemeSchema.optional(),
    locale: appLocaleSchema.optional(),
    shortcuts: shortcutSettingsSchema.optional(),
    autoCheckUpdates: z.boolean().optional(),
    crashReporting: z.boolean().optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, 'At least one setting must be provided.');

export type AppSettings = z.infer<typeof appSettingsSchema>;
export type UpdateAppSettingsRequest = z.infer<typeof updateAppSettingsRequestSchema>;
