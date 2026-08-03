import { ImagePlus, Paperclip, Plus, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { useAppSettingsStore } from '@/features/settings/app-settings.store';
import { translateContext } from './context-i18n';
import { useConversationContextStore } from './context.store';

const typeLabels = {
  file: 'typeFile',
  selection: 'typeSelection',
  directory: 'typeDirectory',
  git_diff: 'typeGitDiff',
  terminal: 'typeTerminal',
  diagnostic: 'typeDiagnostic',
  image: 'typeImage',
  text: 'typeText',
  summary: 'typeSummary',
} as const;

export function ContextTray() {
  const context = useConversationContextStore();
  const [addingText, setAddingText] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const locale = useAppSettingsStore((state) => state.settings.locale);
  const t = (
    key: Parameters<typeof translateContext>[1],
    values?: Record<string, string | number>,
  ) => translateContext(locale, key, values);
  const totalTokens = context.items.reduce((total, item) => total + item.tokenEstimate, 0);

  const addText = async () => {
    if (content.trim() === '') {
      return;
    }
    await context.save({
      type: 'text',
      title: title.trim() || t('supplement'),
      content,
      priority: 60,
    });
    setContent('');
    setAddingText(false);
  };

  return (
    <div
      className="mb-2 rounded-lg border border-zinc-800 bg-zinc-950/70"
      data-testid="context-tray"
    >
      <div className="flex h-8 items-center gap-2 px-2 text-[10px] text-zinc-500">
        <Paperclip className="size-3.5" />
        <span>{t('contextItems', { value: context.items.length })}</span>
        <span>{t('approximateTokens', { value: totalTokens })}</span>
        {context.loading ? <span className="text-cyan-600">{t('syncing')}</span> : null}
        <button
          className="ml-auto flex items-center gap-1 rounded px-1.5 py-1 hover:bg-zinc-800 hover:text-zinc-300"
          onClick={() => void context.pickImage()}
          disabled={context.conversationId === undefined || context.loading}
          data-testid="add-image-context"
        >
          <ImagePlus className="size-3" />
          {t('image')}
        </button>
        <button
          className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-zinc-800 hover:text-zinc-300"
          onClick={() => setAddingText((value) => !value)}
          disabled={context.conversationId === undefined}
          data-testid="add-text-context"
        >
          <Plus className="size-3" />
          {t('pasteText')}
        </button>
      </div>
      {context.items.length === 0 ? null : (
        <div className="flex max-h-20 flex-wrap gap-1 overflow-auto border-t border-zinc-900 p-2">
          {context.items.map((item) => (
            <span
              key={item.id}
              className="flex max-w-full items-center gap-1 rounded bg-zinc-900 px-2 py-1 text-[10px] text-zinc-400"
              title={`${t(typeLabels[item.type])} · ${item.tokenEstimate} tokens`}
            >
              <span className="max-w-48 truncate">
                {t(typeLabels[item.type])} · {item.title}
              </span>
              <button
                className="rounded text-zinc-600 hover:text-red-300"
                onClick={() => void context.remove(item.id)}
                aria-label={t('removeContext', { name: item.title })}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {addingText ? (
        <div
          className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={t('addTextContext')}
          data-testid="text-context-dialog"
        >
          <div className="w-[min(560px,94vw)] space-y-3 rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl">
            <div>
              <h3 className="text-sm font-medium text-zinc-100">{t('addTextContext')}</h3>
              <p className="mt-1 text-[10px] text-zinc-500">{t('addTextDescription')}</p>
            </div>
            <input
              className="h-8 w-full rounded border border-zinc-700 bg-black px-2 text-xs text-zinc-300 outline-none focus:border-cyan-500"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('supplement')}
              maxLength={300}
              aria-label={t('contextTitle')}
            />
            <textarea
              className="max-h-[50vh] min-h-32 w-full resize-y rounded border border-zinc-700 bg-black p-2 text-xs text-zinc-300 outline-none focus:border-cyan-500"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder={t('pastePlaceholder')}
              maxLength={500_000}
              data-testid="text-context-content"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setAddingText(false)}>
                {t('cancel')}
              </Button>
              <Button
                size="sm"
                onClick={() => void addText()}
                disabled={content.trim() === ''}
                data-testid="save-text-context"
              >
                {t('add')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      {context.errorMessage === undefined ? null : (
        <p className="border-t border-red-950 px-2 py-1 text-[10px] text-red-300">
          {context.errorMessage}
        </p>
      )}
    </div>
  );
}
