import type { DebugAdapterCapabilities } from '@open-code-desk/domain';

import { asRecord, booleanValue } from '../dap/dap-values';

export function mapExternalDapCapabilities(value: unknown): DebugAdapterCapabilities {
  const body = asRecord(value);
  return {
    pause: true,
    restart: booleanValue(body, 'supportsRestartRequest') ?? false,
    stepBack: booleanValue(body, 'supportsStepBack') ?? false,
    setVariable: booleanValue(body, 'supportsSetVariable') ?? false,
    conditionalBreakpoints: booleanValue(body, 'supportsConditionalBreakpoints') ?? false,
    hitConditionalBreakpoints: booleanValue(body, 'supportsHitConditionalBreakpoints') ?? false,
    logPoints: booleanValue(body, 'supportsLogPoints') ?? false,
    functionBreakpoints: booleanValue(body, 'supportsFunctionBreakpoints') ?? false,
    dataBreakpoints: booleanValue(body, 'supportsDataBreakpoints') ?? false,
    exceptionInfo: booleanValue(body, 'supportsExceptionInfoRequest') ?? false,
  };
}
