import { describe, expect, it } from 'vitest';

import { localizeMainProcessError, stripMainProcessErrorEnvelope } from './main-process-error-i18n';

describe('main-process error localization', () => {
  it('removes the Electron remote-method envelope in both locales', () => {
    const wrapped = "Error invoking remote method 'debug:threads': Error: 调试适配器连接已关闭。";

    expect(stripMainProcessErrorEnvelope(wrapped)).toBe('调试适配器连接已关闭。');
    expect(localizeMainProcessError('zh-CN', wrapped, undefined, '调试操作失败。')).toBe(
      '调试适配器连接已关闭。',
    );
    expect(localizeMainProcessError('en-US', wrapped, undefined, 'Debug operation failed.')).toBe(
      'The debug adapter connection closed.',
    );
  });

  it('translates parameterized and nested DAP failures without dropping details', () => {
    expect(
      localizeMainProcessError(
        'en-US',
        '调试请求 variables 超时。',
        undefined,
        'Debug operation failed.',
      ),
    ).toBe('Debug request variables timed out.');
    expect(
      localizeMainProcessError(
        'en-US',
        '调试启动失败：连接调试适配器超时。',
        'DEBUG_START_FAILED',
        'Debug operation failed.',
      ),
    ).toBe('Debugging failed to start: Timed out while connecting to the debug adapter.');
    expect(
      localizeMainProcessError(
        'en-US',
        '端口 5173 已被 node (PID 42) 占用，请更换端口或确认后终止占用进程。',
        'RUN_PORT_CONFLICT',
        'Run operation failed.',
      ),
    ).toBe(
      'Port 5173 is in use by node (PID 42). Change the port or confirm before terminating the process.',
    );
  });

  it('uses stable error codes when a localized dynamic message is unavailable', () => {
    expect(
      localizeMainProcessError(
        'en-US',
        '适配器返回了尚未归类的本地诊断。',
        'DEBUG_INTERRUPTED',
        'Debug operation failed.',
      ),
    ).toBe('The app closed before the debug session finished. Start the debug session again.');
  });

  it('translates validation, debug-context, and reverse-request diagnostics', () => {
    const translate = (message: string) =>
      localizeMainProcessError('en-US', message, undefined, 'Operation failed.');

    expect(translate('调试上下文预览已过期，请重新收集。')).toBe(
      'The debug context preview expired. Collect it again.',
    );
    expect(translate('任务“build”仍依赖该任务，请先移除依赖。')).toBe(
      'Task “build” still depends on this task. Remove the dependency first.',
    );
    expect(translate('Python 调试适配器资源不可用，请重新安装 OpenCode Desk。')).toBe(
      'The Python debug adapter is unavailable. Reinstall OpenCode Desk.',
    );
    expect(translate('Python 调试器发起了不受支持的反向请求 runInTerminal。')).toBe(
      'Debugger reverse request runInTerminal is not supported.',
    );
  });

  it('preserves third-party English diagnostics and safely falls back for unknown Chinese text', () => {
    expect(
      localizeMainProcessError(
        'en-US',
        'ECONNREFUSED 127.0.0.1:4711',
        undefined,
        'Debug operation failed.',
      ),
    ).toBe('ECONNREFUSED 127.0.0.1:4711');
    expect(
      localizeMainProcessError(
        'en-US',
        '尚未归类的中文错误。',
        undefined,
        'Debug operation failed.',
      ),
    ).toBe('Debug operation failed.');
  });

  it('translates known command-service diagnostics to Chinese without hiding unknown output', () => {
    expect(
      localizeMainProcessError(
        'zh-CN',
        'The command exceeded its 15000 ms timeout.',
        'COMMAND_FAILED',
        '命令操作失败。',
      ),
    ).toBe('命令超过 15000 毫秒超时限制。');
    expect(
      localizeMainProcessError(
        'zh-CN',
        'spawn custom-tool ENOENT',
        'COMMAND_FAILED',
        '命令操作失败。',
      ),
    ).toBe('spawn custom-tool ENOENT');
  });

  it('translates browser debug validation and startup diagnostics to Chinese', () => {
    const translate = (message: string) =>
      localizeMainProcessError('zh-CN', message, undefined, '调试操作失败。');

    expect(
      translate('Chrome or Microsoft Edge was not found. Install a supported Chromium browser.'),
    ).toBe('未找到 Chrome 或 Microsoft Edge，请安装受支持的 Chromium 浏览器。');
    expect(translate('Browser debugging does not support project type python.')).toBe(
      '浏览器调试不支持 python 项目类型。',
    );
    expect(
      translate(
        'The browser development server did not listen on 127.0.0.1:5173 within 30000 ms. Last output: [REDACTED]',
      ),
    ).toBe('浏览器开发服务器未能在 30000 毫秒内监听 127.0.0.1:5173。 最后输出：[REDACTED]');
  });

  it('translates Java debug validation and launch diagnostics to Chinese', () => {
    const translate = (message: string) =>
      localizeMainProcessError('zh-CN', message, undefined, '调试操作失败。');

    expect(
      translate(
        'Java debugging requires JDK 21 or newer for JDT LS. Set JDTLS_JAVA_HOME or JAVA_HOME to a JDK 21+ installation.',
      ),
    ).toContain('JDK 21');
    expect(translate('Java workspace build failed with status 2.')).toBe(
      'Java 工作区编译失败，状态码为 2。',
    );
    expect(translate('Java debugger does not support project type python.')).toBe(
      'Java 调试器不支持 python 项目类型。',
    );
  });
});
