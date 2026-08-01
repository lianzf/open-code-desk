import { BrainCircuit, LoaderCircle } from 'lucide-react';
import type { DebugContextSectionKey } from '@open-code-desk/ipc-contracts';

import { Button } from '@/components/ui/button';
import { useChatStore } from '@/features/chat/chat.store';
import { useConversationContextStore } from '@/features/context/context.store';
import { useProviderStore } from '@/features/providers/provider.store';
import { DebugContextDialog } from './debug-context-dialog';
import { useDebugStore } from './debug.store';

export function DebugAiAction({ paused }: { readonly paused: boolean }) {
  const debug = useDebugStore();
  const chat = useChatStore();
  const refreshContext = useConversationContextStore((context) => context.refresh);
  const selectedProviderId = useProviderStore((provider) => provider.selectedProviderId);
  const canAskAi =
    paused &&
    chat.activeConversationId !== undefined &&
    chat.activeRequestId === undefined &&
    selectedProviderId !== undefined;

  const confirm = async (selectedSections: ReadonlyArray<DebugContextSectionKey>) => {
    const conversationId = chat.activeConversationId;
    if (conversationId === undefined) return;
    const result = await debug.attachContext(conversationId, selectedSections);
    if (result === undefined) return;
    await refreshContext();
    await chat.send(result.prompt);
  };

  return (
    <>
      {paused ? (
        <Button
          size="sm"
          variant="outline"
          className="h-7 border-cyan-900 text-[10px] text-cyan-300"
          disabled={!canAskAi || debug.contextLoading}
          title={
            selectedProviderId === undefined
              ? '请先配置并选择模型'
              : chat.activeConversationId === undefined
                ? '请先创建会话'
                : '先预览并选择要发送给 AI 的调试上下文'
          }
          onClick={() => {
            const conversationId = chat.activeConversationId;
            if (conversationId !== undefined) void debug.previewContext(conversationId);
          }}
          data-testid="debug-ask-ai"
        >
          {debug.contextLoading ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <BrainCircuit className="size-3.5" />
          )}
          交给 AI 分析
        </Button>
      ) : null}
      {debug.contextPreview === undefined ? null : (
        <DebugContextDialog
          key={debug.contextPreview.id}
          snapshot={debug.contextPreview}
          loading={debug.contextLoading}
          onClose={debug.clearContextPreview}
          onConfirm={confirm}
        />
      )}
    </>
  );
}
