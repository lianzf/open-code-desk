import type { DebugBreakpoint } from '@open-code-desk/domain';

import type { DapClient } from './dap-client';
import { asArray, asRecord, booleanValue, numberValue, stringValue } from './dap-values';

export async function setDapSpecialBreakpoints(
  client: DapClient,
  kind: 'function' | 'data',
  breakpoints: ReadonlyArray<DebugBreakpoint>,
  supported: boolean,
): Promise<ReadonlyArray<DebugBreakpoint>> {
  if (!supported) {
    return breakpoints.map((breakpoint) =>
      breakpoint.enabled
        ? {
            ...breakpoint,
            status: 'unverified',
            message: `当前调试适配器不支持${kind === 'function' ? '函数' : '数据'}断点。`,
          }
        : { ...breakpoint, status: 'disabled' },
    );
  }
  const enabled = breakpoints.filter((breakpoint) => breakpoint.enabled);
  const body = asRecord(
    await client.request<unknown>(
      kind === 'function' ? 'setFunctionBreakpoints' : 'setDataBreakpoints',
      {
        breakpoints: enabled.map((breakpoint) =>
          kind === 'function'
            ? {
                name: breakpoint.functionName,
                ...(breakpoint.condition === undefined ? {} : { condition: breakpoint.condition }),
                ...(breakpoint.hitCondition === undefined
                  ? {}
                  : { hitCondition: breakpoint.hitCondition }),
              }
            : {
                dataId: breakpoint.dataId,
                accessType: breakpoint.dataAccessType ?? 'write',
                ...(breakpoint.condition === undefined ? {} : { condition: breakpoint.condition }),
                ...(breakpoint.hitCondition === undefined
                  ? {}
                  : { hitCondition: breakpoint.hitCondition }),
              },
        ),
      },
    ),
  );
  const results = asArray(body.breakpoints);
  let enabledIndex = 0;
  return breakpoints.map((breakpoint) => {
    if (!breakpoint.enabled) return { ...breakpoint, status: 'disabled' };
    const result = asRecord(results[enabledIndex++]);
    const adapterBreakpointId = numberValue(result, 'id');
    const message = stringValue(result, 'message');
    return {
      ...breakpoint,
      status: booleanValue(result, 'verified') === true ? 'verified' : 'unverified',
      ...(adapterBreakpointId === undefined ? {} : { adapterBreakpointId }),
      ...(message === undefined ? {} : { message }),
    };
  });
}
