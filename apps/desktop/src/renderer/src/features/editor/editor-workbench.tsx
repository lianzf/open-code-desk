import Editor from '@monaco-editor/react';
import { FileCode2, LoaderCircle, Paperclip, Save, TextSelect, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { useConversationContextStore } from '@/features/context/context.store';
import { cn } from '@/lib/utils';
import { useEditorStore } from './editor.store';
import './monaco-environment';

export function EditorWorkbench() {
  const { activePath, closeFile, loading, saveActive, saving, setActive, tabs, updateContent } =
    useEditorStore();
  const activeTab = tabs.find((tab) => tab.relativePath === activePath);
  const contextConversationId = useConversationContextStore((state) => state.conversationId);
  const saveContext = useConversationContextStore((state) => state.save);
  const [selectedCode, setSelectedCode] = useState<{
    readonly path: string;
    readonly content: string;
    readonly title: string;
    readonly sourceKey: string;
  }>();

  if (loading && activeTab === undefined) {
    return (
      <div className="grid h-full place-items-center text-sm text-zinc-500">
        <LoaderCircle className="mb-2 size-5 animate-spin" aria-hidden="true" />
        正在读取文件…
      </div>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-[#0b0b0d]" data-testid="editor-workbench">
      <div className="flex h-9 shrink-0 items-center overflow-x-auto border-b border-zinc-800 bg-zinc-950">
        {tabs.map((tab) => {
          const dirty = tab.content !== tab.savedContent;
          return (
            <div
              key={tab.relativePath}
              className={cn(
                'group flex h-full min-w-32 max-w-56 items-center border-r border-zinc-800 px-2 text-xs',
                tab.relativePath === activePath ? 'bg-[#0b0b0d] text-zinc-100' : 'text-zinc-500',
              )}
            >
              <button
                className="flex min-w-0 flex-1 items-center gap-1.5"
                onClick={() => setActive(tab.relativePath)}
                title={tab.relativePath}
              >
                <FileCode2 className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{tab.name}</span>
                {dirty ? (
                  <span
                    className="size-1.5 shrink-0 rounded-full bg-cyan-400"
                    aria-label="未保存"
                  />
                ) : null}
              </button>
              <button
                className="ml-1 rounded p-0.5 opacity-0 hover:bg-zinc-700 group-hover:opacity-100 focus:opacity-100"
                onClick={() => closeFile(tab.relativePath)}
                aria-label={`关闭 ${tab.name}`}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </div>
          );
        })}
        <div className="ml-auto pr-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={activeTab === undefined || contextConversationId === undefined}
            onClick={() => {
              if (activeTab !== undefined) {
                void saveContext({
                  type: 'file',
                  title: activeTab.relativePath,
                  content: activeTab.content,
                  priority: 90,
                  sourceKey: `file:${activeTab.relativePath}`,
                });
              }
            }}
            title="将当前文件加入 AI 上下文"
            data-testid="add-current-file-context"
          >
            <Paperclip className="size-3.5" />
            当前文件
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={
              activeTab === undefined ||
              contextConversationId === undefined ||
              selectedCode?.path !== activeTab.relativePath
            }
            onClick={() => {
              if (selectedCode !== undefined) {
                void saveContext({
                  type: 'selection',
                  title: selectedCode.title,
                  content: selectedCode.content,
                  priority: 100,
                  sourceKey: selectedCode.sourceKey,
                });
              }
            }}
            title="将选中代码加入 AI 上下文"
            data-testid="add-selection-context"
          >
            <TextSelect className="size-3.5" />
            选中代码
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={
              activeTab === undefined || activeTab.content === activeTab.savedContent || saving
            }
            onClick={() => void saveActive()}
            data-testid="save-file"
          >
            {saving ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            保存
          </Button>
        </div>
      </div>

      {activeTab === undefined ? (
        <div className="grid flex-1 place-items-center">
          <div className="max-w-sm text-center">
            <FileCode2 className="mx-auto size-9 text-zinc-700" aria-hidden="true" />
            <p className="mt-4 text-sm text-zinc-400">从左侧文件树打开代码文件</p>
            <p className="mt-1 text-xs text-zinc-600">
              文件内容仅在需要时读取，不会一次加载整个项目。
            </p>
          </div>
        </div>
      ) : (
        <Editor
          key={activeTab.relativePath}
          path={activeTab.relativePath}
          language={activeTab.language}
          value={activeTab.content}
          theme="vs-dark"
          onChange={(value) => updateContent(value ?? '')}
          onMount={(editor, monaco) => {
            setSelectedCode(undefined);
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
              void saveActive();
            });
            editor.onDidChangeCursorSelection(({ selection }) => {
              const content = editor.getModel()?.getValueInRange(selection) ?? '';
              if (content === '') {
                setSelectedCode(undefined);
                return;
              }
              setSelectedCode({
                path: activeTab.relativePath,
                content,
                title: `${activeTab.relativePath}:${selection.startLineNumber}-${selection.endLineNumber}`,
                sourceKey: `selection:${activeTab.relativePath}:${selection.startLineNumber}:${selection.startColumn}:${selection.endLineNumber}:${selection.endColumn}`,
              });
            });
          }}
          options={{
            automaticLayout: true,
            fontFamily: 'Cascadia Code, JetBrains Mono, Consolas, monospace',
            fontSize: 13,
            minimap: { enabled: true },
            padding: { top: 12 },
            scrollBeyondLastLine: false,
            smoothScrolling: true,
          }}
        />
      )}
    </section>
  );
}
