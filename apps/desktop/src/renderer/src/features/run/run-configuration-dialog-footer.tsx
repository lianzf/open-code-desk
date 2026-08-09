import type { RunConfiguration } from '@open-code-desk/ipc-contracts';
import { Copy, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ConfigurationDraft } from './run-configuration-draft';
import { isDebugAttachDraftValid, isRunPortDraftValid } from './run-configuration-draft';
import { useRunTranslation } from './run-i18n';
import { useRunStore } from './run.store';

interface RunConfigurationDialogFooterProps {
  readonly draft: ConfigurationDraft;
  readonly editing: RunConfiguration | undefined;
  readonly onSave: () => Promise<void>;
}

export function RunConfigurationDialogFooter({
  draft,
  editing,
  onSave,
}: RunConfigurationDialogFooterProps) {
  const { t } = useRunTranslation();
  const loading = useRunStore((state) => state.loading);
  const close = useRunStore((state) => state.closeConfigurationDialog);
  const deleteConfiguration = useRunStore((state) => state.deleteConfiguration);
  const duplicateConfiguration = useRunStore((state) => state.duplicateConfiguration);

  return (
    <footer className="flex h-14 shrink-0 items-center gap-2 border-t border-zinc-800 px-5">
      {editing === undefined ? null : (
        <>
          <Button
            type="button"
            variant="outline"
            className="text-red-300 hover:text-red-200"
            disabled={loading}
            onClick={() => {
              if (window.confirm(t('deleteConfigurationConfirm', { name: editing.name }))) {
                void deleteConfiguration(editing.id);
              }
            }}
            data-testid="delete-run-configuration"
          >
            <Trash2 className="size-4" aria-hidden="true" />
            {t('delete')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => void duplicateConfiguration(editing.id)}
            data-testid="duplicate-run-configuration"
          >
            <Copy className="size-4" aria-hidden="true" />
            {t('copy')}
          </Button>
        </>
      )}
      <Button type="button" variant="outline" className="ml-auto" onClick={close}>
        {t('cancel')}
      </Button>
      <Button
        type="button"
        disabled={
          loading ||
          draft.name.trim() === '' ||
          draft.executable.trim() === '' ||
          !isDebugAttachDraftValid(draft) ||
          !isRunPortDraftValid(draft)
        }
        onClick={() => void onSave()}
        data-testid="save-run-configuration"
      >
        {loading ? t('saving') : t('save')}
      </Button>
    </footer>
  );
}
