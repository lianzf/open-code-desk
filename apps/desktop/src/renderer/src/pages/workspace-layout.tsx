import {
  bottomPanelHeightStorageKey,
  chatWidthStorageKey,
  clampBottomPanelHeight,
  clampChatWidth,
  clampSidebarWidth,
  sidebarWidthStorageKey,
} from './workspace-layout-state';

interface ResizerProps {
  readonly label: string;
  readonly value: number;
  setValue(value: number): void;
}

export function SidebarResizer({ label, value, setValue }: ResizerProps) {
  return (
    <div
      className="absolute inset-y-0 right-0 z-20 w-1.5 translate-x-1/2 cursor-col-resize touch-none hover:bg-cyan-500/60"
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={180}
      aria-valuemax={Math.round(window.innerWidth * 0.4)}
      aria-valuenow={value}
      tabIndex={0}
      data-testid="sidebar-resizer"
      onDoubleClick={() => {
        setValue(256);
        window.localStorage.setItem(sidebarWidthStorageKey, '256');
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const next = clampSidebarWidth(value + (event.key === 'ArrowRight' ? 16 : -16));
        setValue(next);
        window.localStorage.setItem(sidebarWidthStorageKey, String(next));
      }}
      onPointerDown={(event) => {
        const target = event.currentTarget;
        const startX = event.clientX;
        const startWidth = value;
        target.setPointerCapture(event.pointerId);
        const move = (moveEvent: PointerEvent) => {
          setValue(clampSidebarWidth(startWidth + moveEvent.clientX - startX));
        };
        const finish = (finishEvent: PointerEvent) => {
          target.removeEventListener('pointermove', move);
          target.removeEventListener('pointerup', finish);
          target.removeEventListener('pointercancel', finish);
          window.localStorage.setItem(
            sidebarWidthStorageKey,
            String(clampSidebarWidth(startWidth + finishEvent.clientX - startX)),
          );
        };
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', finish);
        target.addEventListener('pointercancel', finish);
      }}
    />
  );
}

export function ChatPanelResizer({ label, value, setValue }: ResizerProps) {
  return (
    <div
      className="absolute inset-y-0 left-0 z-20 w-1.5 -translate-x-1/2 cursor-col-resize touch-none hover:bg-cyan-500/60"
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={300}
      aria-valuemax={Math.round(window.innerWidth * 0.55)}
      aria-valuenow={value}
      tabIndex={0}
      data-testid="chat-panel-resizer"
      onDoubleClick={() => {
        setValue(400);
        window.localStorage.setItem(chatWidthStorageKey, '400');
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const next = clampChatWidth(value + (event.key === 'ArrowLeft' ? 16 : -16));
        setValue(next);
        window.localStorage.setItem(chatWidthStorageKey, String(next));
      }}
      onPointerDown={(event) => {
        const target = event.currentTarget;
        const startX = event.clientX;
        const startWidth = value;
        target.setPointerCapture(event.pointerId);
        const move = (moveEvent: PointerEvent) => {
          setValue(clampChatWidth(startWidth + startX - moveEvent.clientX));
        };
        const finish = (finishEvent: PointerEvent) => {
          target.removeEventListener('pointermove', move);
          target.removeEventListener('pointerup', finish);
          target.removeEventListener('pointercancel', finish);
          window.localStorage.setItem(
            chatWidthStorageKey,
            String(clampChatWidth(startWidth + startX - finishEvent.clientX)),
          );
        };
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', finish);
        target.addEventListener('pointercancel', finish);
      }}
    />
  );
}

export function BottomPanelResizer({ label, value, setValue }: ResizerProps) {
  return (
    <div
      className="absolute inset-x-0 top-0 z-20 h-1.5 -translate-y-1/2 cursor-row-resize touch-none hover:bg-cyan-500/60"
      role="separator"
      aria-label={label}
      aria-orientation="horizontal"
      aria-valuemin={160}
      aria-valuemax={Math.round(window.innerHeight * 0.75)}
      aria-valuenow={value}
      tabIndex={0}
      data-testid="bottom-panel-resizer"
      onDoubleClick={() => {
        setValue(288);
        window.localStorage.setItem(bottomPanelHeightStorageKey, '288');
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        const next = clampBottomPanelHeight(value + (event.key === 'ArrowUp' ? 16 : -16));
        setValue(next);
        window.localStorage.setItem(bottomPanelHeightStorageKey, String(next));
      }}
      onPointerDown={(event) => {
        const target = event.currentTarget;
        const startY = event.clientY;
        const startHeight = value;
        target.setPointerCapture(event.pointerId);
        const move = (moveEvent: PointerEvent) => {
          setValue(clampBottomPanelHeight(startHeight + startY - moveEvent.clientY));
        };
        const finish = (finishEvent: PointerEvent) => {
          target.removeEventListener('pointermove', move);
          target.removeEventListener('pointerup', finish);
          target.removeEventListener('pointercancel', finish);
          const next = clampBottomPanelHeight(startHeight + startY - finishEvent.clientY);
          setValue(next);
          window.localStorage.setItem(bottomPanelHeightStorageKey, String(next));
          if (target.hasPointerCapture(finishEvent.pointerId)) {
            target.releasePointerCapture(finishEvent.pointerId);
          }
        };
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', finish);
        target.addEventListener('pointercancel', finish);
      }}
    />
  );
}
