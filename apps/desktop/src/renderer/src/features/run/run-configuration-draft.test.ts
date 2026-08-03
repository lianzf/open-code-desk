import { describe, expect, it } from 'vitest';

import {
  blankRunConfigurationDraft,
  isDebugAttachDraftValid,
  isRunPortDraftValid,
  toSaveRunConfigurationRequest,
} from './run-configuration-draft';

describe('remote debug configuration draft', () => {
  it('serializes an explicit container attach target', () => {
    const request = toSaveRunConfigurationRequest(
      {
        ...blankRunConfigurationDraft(),
        name: 'Container Node',
        type: 'node',
        executable: 'node',
        debugAttachEnabled: true,
        debugAttachEnvironment: 'container',
        debugAttachHost: '127.0.0.1',
        debugAttachPort: '9230',
        debugAttachRemoteRoot: '/workspace/app',
      },
      '00000000-0000-4000-8000-000000000001',
      undefined,
    );
    expect(request.debugAttach).toEqual({
      adapter: 'pwa-node',
      environment: 'container',
      host: '127.0.0.1',
      port: 9230,
      remoteRoot: '/workspace/app',
    });
  });

  it('rejects invalid attach endpoints before save', () => {
    const base = {
      ...blankRunConfigurationDraft(),
      debugAttachEnabled: true,
    } as const;
    expect(isDebugAttachDraftValid({ ...base, debugAttachHost: '' })).toBe(false);
    expect(isDebugAttachDraftValid({ ...base, debugAttachHost: 'https://server' })).toBe(false);
    expect(isDebugAttachDraftValid({ ...base, debugAttachPort: '0' })).toBe(false);
    expect(isDebugAttachDraftValid({ ...base, debugAttachPort: 'not-a-port' })).toBe(false);
    expect(isDebugAttachDraftValid({ ...base, debugAttachRemoteRoot: 'relative/path' })).toBe(
      false,
    );
    expect(isDebugAttachDraftValid(base)).toBe(true);
  });

  it('requires a valid renderer debug port for Electron configurations', () => {
    const electron = { ...blankRunConfigurationDraft(), type: 'electron' as const };
    expect(isRunPortDraftValid(electron)).toBe(false);
    expect(isRunPortDraftValid({ ...electron, port: '0' })).toBe(false);
    expect(isRunPortDraftValid({ ...electron, port: '9222' })).toBe(true);
    expect(isRunPortDraftValid(blankRunConfigurationDraft())).toBe(true);
  });
});
