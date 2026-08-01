import Editor, { type OnMount } from '@monaco-editor/react';
import { FileCode2, LoaderCircle, Paperclip, Save, TextSelect, X } from 'lucide-react';
import type { editor as MonacoEditor } from 'monaco-editor';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useConversationContextStore } from '@/features/context/context.store';
import { useDebugStore } from '@/features/debug/debug.store';
import { useResolvedTheme } from '@/features/settings/use-resolved-theme';
import { cn } from '@/lib/utils';
import { useEditorStore } from './editor.store';
import './monaco-environment';

export function EditorWorkbench() {
  const resolvedTheme = useResolvedTheme();
  const {
    activePath,
    closeFile,
    loading,
    navigationTarget,
    saveActive,
    saving,
    setActive,
    tabs,
    updateContent,
  } = useEditorStore();
  const activeTab = tabs.find((tab) => tab.relativePath === activePath);
  const activeRelativePath = activeTab?.relativePath;
  const contextConversationId = useConversationContextStore((state) => state.conversationId);
  const saveContext = useConversationContextStore((state) => state.save);
  const breakpoints = useDebugStore((state) => state.breakpoints);
  const debugSessions = useDebugStore((state) => state.sessions);
  const selectedDebugSessionId = useDebugStore((state) => state.selectedSessionId);
  const selectedFrameId = useDebugStore((state) => state.selectedFrameId);
  const stackFrames = useDebugStore((state) => state.stackFrames);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const decorationsRef = useRef<MonacoEditor.IEditorDecorationsCollection | null>(null);
  const [editorMountVersion, setEditorMountVersion] = useState(0);
  const [selectedCode, setSelectedCode] = useState<{
    readonly path: string;
    readonly content: string;
    readonly title: string;
    readonly sourceKey: string;
  }>();
  const selectedDebugSession = debugSessions.find(
    (session) => session.id === selectedDebugSessionId,
  );
  const selectedFrame = stackFrames.find((frame) => frame.id === selectedFrameId);
  const currentLocation =
    selectedFrame?.relativePath === undefined
      ? selectedDebugSession?.pause
      : {
          relativePath: selectedFrame.relativePath,
          line: selectedFrame.line,
          column: selectedFrame.column,
        };
  const currentRelativePath = currentLocation?.relativePath;
  const currentLine = currentLocation?.line;

  useEffect(() => {
    const editor = editorRef.current;
    if (editor === null || activeRelativePath === undefined) return;
    const activeBreakpoints = breakpoints.filter(
      (breakpoint) => breakpoint.relativePath === activeRelativePath,
    );
    const decorations: MonacoEditor.IModelDeltaDecoration[] = activeBreakpoints.map(
      (breakpoint) => ({
        range: {
          startLineNumber: breakpoint.line,
          startColumn: 1,
          endLineNumber: breakpoint.line,
          endColumn: 1,
        },
        options: {
          glyphMarginClassName: `debug-breakpoint debug-breakpoint-${breakpoint.status}`,
          glyphMarginHoverMessage: {
            value: breakpointTooltip(breakpoint.status, breakpoint.message),
          },
        },
      }),
    );

    if (currentRelativePath === activeRelativePath && currentLine !== undefined) {
      decorations.push({
        range: {
          startLineNumber: currentLine,
          startColumn: 1,
          endLineNumber: currentLine,
          endColumn: 1,
        },
        options: {
          isWholeLine: true,
          className: 'debug-current-line',
          linesDecorationsClassName: 'debug-current-line-number',
          glyphMarginClassName: 'debug-current-line-glyph',
          glyphMarginHoverMessage: { value: '当前暂停位置' },
        },
      });
      editor.revealLineInCenter(currentLine);
    }

    decorationsRef.current?.clear();
    decorationsRef.current = editor.createDecorationsCollection(decorations);
    editor.render(true);
  }, [activeRelativePath, breakpoints, currentLine, currentRelativePath, editorMountVersion]);

  useEffect(() => {
    const editor = editorRef.current;
    if (
      editor === null ||
      navigationTarget === undefined ||
      navigationTarget.relativePath !== activeTab?.relativePath
    ) {
      return;
    }
    editor.setPosition({
      lineNumber: navigationTarget.line,
      column: navigationTarget.column,
    });
    editor.revealPositionInCenterIfOutsideViewport({
      lineNumber: navigationTarget.line,
      column: navigationTarget.column,
    });
  }, [activeTab?.relativePath, editorMountVersion, navigationTarget]);

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
          theme={resolvedTheme === 'dark' ? 'vs-dark' : 'light'}
          onChange={(value) => updateContent(value ?? '')}
          onMount={(editor, monaco) => {
            editorRef.current = editor;
            setEditorMountVersion((version) => version + 1);
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
            editor.onMouseDown((event) => {
              if (
                event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
                event.target.position === null
              ) {
                return;
              }
              event.event.preventDefault();
              void useDebugStore
                .getState()
                .toggleBreakpoint(activeTab.relativePath, event.target.position.lineNumber);
            });
            editor.addAction({
              id: 'open-code-desk.debug.toggle-breakpoint',
              label: '切换断点',
              keybindings: [monaco.KeyCode.F9],
              contextMenuGroupId: 'debug',
              contextMenuOrder: 1,
              run: (mountedEditor) => {
                const line = mountedEditor.getPosition()?.lineNumber;
                if (line !== undefined) {
                  void useDebugStore.getState().toggleBreakpoint(activeTab.relativePath, line);
                }
              },
            });
            editor.addAction({
              id: 'open-code-desk.debug.remove-file-breakpoints',
              label: '删除当前文件全部断点',
              contextMenuGroupId: 'debug',
              contextMenuOrder: 3,
              run: () => useDebugStore.getState().deleteBreakpointsForFile(activeTab.relativePath),
            });
            editor.addAction({
              id: 'open-code-desk.debug.run-to-cursor',
              label: '运行到光标',
              keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.F10],
              contextMenuGroupId: 'debug',
              contextMenuOrder: 2,
              run: (mountedEditor) => {
                const position = mountedEditor.getPosition();
                const state = useDebugStore.getState();
                const session = state.sessions.find(
                  (candidate) => candidate.id === state.selectedSessionId,
                );
                if (position !== null && session?.status === 'paused') {
                  void state.runToCursor(
                    activeTab.relativePath,
                    position.lineNumber,
                    position.column,
                  );
                }
              },
            });
          }}
          options={{
            automaticLayout: true,
            fontFamily: 'Cascadia Code, JetBrains Mono, Consolas, monospace',
            fontSize: 13,
            glyphMargin: true,
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

function breakpointTooltip(status: string, message: string | undefined): string {
  const label =
    {
      pending: '等待调试器验证',
      verified: '已由调试器验证',
      unverified: '调试器未验证',
      disabled: '已禁用',
      error: '断点错误',
    }[status] ?? status;
  return message === undefined ? `断点：${label}` : `断点：${label}\n\n${message}`;
}
