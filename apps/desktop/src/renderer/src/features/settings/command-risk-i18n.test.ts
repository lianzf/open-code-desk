import { describe, expect, it } from 'vitest';

import { localizeRiskReason } from './command-risk-i18n';

describe('localizeRiskReason', () => {
  it('translates canonical command risk reasons to Chinese', () => {
    expect(
      localizeRiskReason(
        'zh-CN',
        'No known high-risk pattern was detected; explicit approval is still required.',
      ),
    ).toBe('未检测到已知高风险模式；仍需明确批准。');
    expect(localizeRiskReason('zh-CN', 'sudo is a privileged or system-control executable.')).toBe(
      'sudo 是特权或系统控制可执行程序。',
    );
  });

  it('preserves task names while translating nested reasons to Chinese', () => {
    expect(localizeRiskReason('zh-CN', '测试任务: This executable may access the network.')).toBe(
      '测试任务：该可执行程序可能访问网络。',
    );
    expect(
      localizeRiskReason(
        'zh-CN',
        '启动前任务：测试任务: Package manager commands may execute project lifecycle scripts.',
      ),
    ).toBe('启动前任务：测试任务：包管理器命令可能执行项目生命周期脚本。');
  });

  it('translates persisted Chinese hook prefixes to English', () => {
    expect(
      localizeRiskReason('en-US', '启动后任务：lint: This executable may access the network.'),
    ).toBe('Post-run task: lint: This executable may access the network.');
  });

  it('translates remote and container attach risk details to Chinese', () => {
    expect(
      localizeRiskReason(
        'zh-CN',
        'The debugger will connect to the container target through local port forwarding at 127.0.0.1:9229.',
      ),
    ).toBe('调试器将通过本机端口转发连接容器目标 127.0.0.1:9229。');
    expect(
      localizeRiskReason(
        'zh-CN',
        'The debugger will connect to a remote Node.js target over the network at debug.example:9230.',
      ),
    ).toBe('调试器将通过网络连接远程 Node.js 目标 debug.example:9230。');
    expect(
      localizeRiskReason(
        'zh-CN',
        'The debugger will connect to a remote Python target over the network at python.example:5678.',
      ),
    ).toBe('调试器将通过网络连接远程 Python 目标 python.example:5678。');
    expect(
      localizeRiskReason(
        'zh-CN',
        'Remote debug ports can grant control of the program; connect only to a trusted target and network.',
      ),
    ).toBe('远程调试端口可能授予程序控制能力；请仅连接可信目标和网络。');
    expect(
      localizeRiskReason(
        'zh-CN',
        'Attach debugging does not start or automatically terminate the target process.',
      ),
    ).toBe('附加调试不会启动或自动终止目标进程。');
  });

  it('preserves unknown project-provided reasons', () => {
    expect(localizeRiskReason('zh-CN', 'Adapter supplied detail.')).toBe(
      'Adapter supplied detail.',
    );
    expect(localizeRiskReason('en-US', 'Adapter supplied detail.')).toBe(
      'Adapter supplied detail.',
    );
  });
});
