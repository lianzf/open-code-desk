/// <reference types="vite/client" />

import type { DesktopApi } from '@open-code-desk/ipc-contracts';

declare global {
  interface Window {
    readonly openCodeDesk: DesktopApi;
  }
}

export {};
