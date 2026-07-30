import { ImagePlus, Paperclip, Plus, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { useConversationContextStore } from './context.store';

const typeLabels = {
  file: '文件',
  selection: '选中代码',
  directory: '目录',
  git_diff: 'Git Diff',
  terminal: '终端',
  diagnostic: '报错',
  image: '图片',
  text: '文本',
  summary: '摘要',
} as const;

export function ContextTray() {
  const context = useConversationContextStore();
  const [addingText, setAddingText] = useState(false);
  const [title, setTitle] = useState('补充说明');
  const [content, setContent] = useState('');
  const totalTokens = context.items.reduce((total, item) => total + item.tokenEstimate, 0);

  const addText = async () => {
    if (content.trim() === '') {
      return;
    }
    await context.save({
      type: 'text',
      title: title.trim() || '补充说明',
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
        <span>上下文 {context.items.length} 项</span>
        <span>约 {totalTokens} tokens</span>
        {context.loading ? <span className="text-cyan-600">同步中…</span> : null}
        <button
          className="ml-auto flex items-center gap-1 rounded px-1.5 py-1 hover:bg-zinc-800 hover:text-zinc-300"
          onClick={() => void context.pickImage()}
          disabled={context.conversationId === undefined || context.loading}
          data-testid="add-image-context"
        >
          <ImagePlus className="size-3" />
          图片
        </button>
        <button
          className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-zinc-800 hover:text-zinc-300"
          onClick={() => setAddingText((value) => !value)}
          disabled={context.conversationId === undefined}
          data-testid="add-text-context"
        >
          <Plus className="size-3" />
          粘贴文本
        </button>
      </div>
      {context.items.length === 0 ? null : (
        <div className="flex max-h-20 flex-wrap gap-1 overflow-auto border-t border-zinc-900 p-2">
          {context.items.map((item) => (
            <span
              key={item.id}
              className="flex max-w-full items-center gap-1 rounded bg-zinc-900 px-2 py-1 text-[10px] text-zinc-400"
              title={`${typeLabels[item.type]} · ${item.tokenEstimate} tokens`}
            >
              <span className="max-w-48 truncate">
                {typeLabels[item.type]} · {item.title}
              </span>
              <button
                className="rounded text-zinc-600 hover:text-red-300"
                onClick={() => void context.remove(item.id)}
                aria-label={`移除上下文 ${item.title}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {addingText ? (
        <div className="space-y-2 border-t border-zinc-900 p-2">
          <input
            className="h-7 w-full rounded border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-300 outline-none"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={300}
            aria-label="上下文标题"
          />
          <textarea
            className="max-h-32 min-h-16 w-full resize-y rounded border border-zinc-800 bg-zinc-900 p-2 text-xs text-zinc-300 outline-none"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="粘贴补充代码、报错或说明"
            maxLength={500_000}
            data-testid="text-context-content"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAddingText(false)}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={() => void addText()}
              disabled={content.trim() === ''}
              data-testid="save-text-context"
            >
              添加
            </Button>
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
