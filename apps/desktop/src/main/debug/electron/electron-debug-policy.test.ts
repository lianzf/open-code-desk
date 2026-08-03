import { describe, expect, it } from 'vitest';

import { assessElectronDebugRisk } from './electron-debug-policy';

describe('Electron debug risk policy', () => {
  it('marks the exact loopback Chromium endpoint as medium risk', () => {
    expect(assessElectronDebugRisk(9222)).toEqual({
      level: 'medium',
      reasons: [
        'Electron renderer debugging opens a loopback Chromium DevTools endpoint at 127.0.0.1:9222 while the approved session is running.',
      ],
    });
  });
});
