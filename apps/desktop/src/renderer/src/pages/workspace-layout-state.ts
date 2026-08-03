import { useState } from 'react';

export const bottomPanelHeightStorageKey = 'open-code-desk:layout:bottom-panel-height';
export const sidebarWidthStorageKey = 'open-code-desk:layout:sidebar-width';
export const chatWidthStorageKey = 'open-code-desk:layout:chat-width';

export function clampBottomPanelHeight(height: number): number {
  return Math.min(Math.max(height, 160), Math.max(160, Math.round(window.innerHeight * 0.75)));
}

export function clampSidebarWidth(width: number): number {
  return Math.min(Math.max(width, 180), Math.max(180, Math.round(window.innerWidth * 0.4)));
}

export function clampChatWidth(width: number): number {
  return Math.min(Math.max(width, 300), Math.max(300, Math.round(window.innerWidth * 0.55)));
}

function storedSize(key: string, fallback: number, clamp: (value: number) => number): number {
  const stored = Number(window.localStorage.getItem(key));
  return clamp(Number.isFinite(stored) && stored > 0 ? stored : fallback);
}

export function useWorkspaceLayout() {
  const [bottomPanelHeight, setBottomPanelHeight] = useState(() =>
    storedSize(bottomPanelHeightStorageKey, 288, clampBottomPanelHeight),
  );
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    storedSize(sidebarWidthStorageKey, 256, clampSidebarWidth),
  );
  const [chatWidth, setChatWidth] = useState(() =>
    storedSize(chatWidthStorageKey, 400, clampChatWidth),
  );
  return {
    bottomPanelHeight,
    setBottomPanelHeight,
    sidebarWidth,
    setSidebarWidth,
    chatWidth,
    setChatWidth,
  };
}
