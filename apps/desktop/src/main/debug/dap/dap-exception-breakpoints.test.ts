import { describe, expect, it } from 'vitest';

import { createNodeExceptionBreakpointArguments } from '../node/node-debug-launch';
import { matchesPythonExceptionType } from '../python/python-exception-policy';
import { createPythonExceptionBreakpointArguments } from '../python/python-debug-launch';

describe('DAP exception breakpoint arguments', () => {
  it('uses conditional Node.js filters for named and ignored exception types', () => {
    expect(
      createNodeExceptionBreakpointArguments({
        exceptionPauseMode: 'uncaught',
        exceptionBreakTypes: ['TypeError', 'TypeError', 'RangeError'],
        exceptionIgnoreTypes: ['AbortError'],
      }),
    ).toEqual({
      filters: [],
      filterOptions: [
        { filterId: 'uncaught', condition: 'error.name != "AbortError"' },
        {
          filterId: 'all',
          condition:
            '(error.name == "TypeError" || error.name == "RangeError") && (error.name != "AbortError")',
        },
      ],
    });
  });

  it('escapes Node.js exception names as string literals instead of executable expressions', () => {
    const exceptionName = 'TypeError" || globalThis.pwned || "';
    const argumentsValue = createNodeExceptionBreakpointArguments({
      exceptionPauseMode: 'none',
      exceptionBreakTypes: [exceptionName],
      exceptionIgnoreTypes: [],
    });
    expect(argumentsValue).toEqual({
      filters: [],
      filterOptions: [
        {
          filterId: 'all',
          condition: `(error.name == ${JSON.stringify(exceptionName)})`,
        },
      ],
    });
  });

  it('uses Python DAP exception options for positive rules and filters ignores in-session', () => {
    expect(
      createPythonExceptionBreakpointArguments({
        exceptionPauseMode: 'all',
        exceptionBreakTypes: ['ValueError'],
        exceptionIgnoreTypes: ['CancelledError'],
      }),
    ).toEqual({
      filters: [],
      exceptionOptions: [
        {
          path: [{ names: ['Python Exceptions'] }, { names: ['BaseException'] }],
          breakMode: 'always',
        },
      ],
    });
    expect(
      matchesPythonExceptionType(
        {
          exceptionId: 'package.errors.CancelledError: cancelled',
          typeName: 'package.errors.CancelledError',
        },
        ['CancelledError'],
      ),
    ).toBe(true);
    expect(
      matchesPythonExceptionType({ exceptionId: 'ValueError: invalid value' }, ['TypeError']),
    ).toBe(false);
  });

  it('keeps simple adapter filters when no named exception rules are configured', () => {
    const policy = {
      exceptionPauseMode: 'uncaught' as const,
      exceptionBreakTypes: [],
      exceptionIgnoreTypes: [],
    };
    expect(createNodeExceptionBreakpointArguments(policy)).toEqual({ filters: ['uncaught'] });
    expect(createPythonExceptionBreakpointArguments(policy)).toEqual({ filters: ['uncaught'] });
  });
});
