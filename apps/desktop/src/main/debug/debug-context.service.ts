import { createHash, randomUUID } from 'node:crypto';

import type {
  DebugContextSection,
  DebugContextSectionKey,
  DebugContextSnapshot,
  DebugSession,
} from '@open-code-desk/domain';
import type {
  AttachDebugContextRequest,
  AttachDebugContextResponse,
  PreviewDebugContextRequest,
} from '@open-code-desk/ipc-contracts';

import type { AuditLogService } from '../audit/audit-log.service';
import type { FileChangeService } from '../changes/file-change.service';
import type { ConversationRepository } from '../conversations/conversation.repository';
import type { ContextItemService } from '../context/context-item.service';
import type { WorkspaceFileService } from '../filesystem/workspace-file.service';
import type { GitService } from '../git/git.service';
import { isSensitiveName, redactSensitiveText } from '../security/sensitive-text';
import type { DebugSessionRepository } from './debug-session.repository';
import type { DebugSessionService } from './debug-session.service';
import {
  composeDebugContext,
  createDebugContextSection as section,
  formatDebugConfiguration,
  formatDebugStack,
  formatDependencyGroup,
} from './debug-context-formatters';

type DebugRuntime = Pick<
  DebugSessionService,
  'threads' | 'stackTrace' | 'scopes' | 'variables' | 'evaluate' | 'listWatches'
>;
type PausedDebugSession = DebugSession & { readonly pause: NonNullable<DebugSession['pause']> };

interface CachedSnapshot {
  readonly snapshot: DebugContextSnapshot;
  readonly expiresAtMs: number;
}

const snapshotTtlMs = 10 * 60 * 1_000;
const maximumSnapshots = 50;
const modelPrompt =
  '请分析我刚刚明确附加的调试上下文，定位根因，并按需读取相关工作区文件。请先说明判断依据；如需修复，只能通过文件变更工具生成待审核 FileChange 和 Diff，不要直接写入文件，不要自动重新启动调试，也不要执行未获批准的命令。';

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export class DebugContextService {
  readonly #cache = new Map<string, CachedSnapshot>();

  public constructor(
    private readonly sessions: Pick<DebugSessionRepository, 'findById'>,
    private readonly runtime: DebugRuntime,
    private readonly conversations: Pick<ConversationRepository, 'findById'>,
    private readonly contextItems: Pick<ContextItemService, 'save'>,
    private readonly files: Pick<WorkspaceFileService, 'readFile'>,
    private readonly git: Pick<GitService, 'status' | 'diff'>,
    private readonly changes: Pick<FileChangeService, 'listForConversation'>,
    private readonly audit?: AuditLogService,
  ) {}

  public async preview(input: PreviewDebugContextRequest): Promise<DebugContextSnapshot> {
    this.pruneCache();
    const session = this.requirePausedSession(input.sessionId);
    const conversation = this.conversations.findById(input.conversationId);
    if (conversation === null) throw new Error('找不到要接收调试上下文的会话。');
    if (conversation.workspaceId !== session.workspaceId) {
      throw new Error('调试上下文只能发送到同一工作区的会话。');
    }

    const sections = await this.collectSections(session, input.conversationId);
    const createdAt = new Date();
    const pauseFingerprint = safePauseFingerprint(session);
    const digest = sha256({
      sessionId: session.id,
      conversationId: input.conversationId,
      pauseFingerprint,
      sections,
    });
    const snapshot: DebugContextSnapshot = {
      id: randomUUID(),
      sessionId: session.id,
      workspaceId: session.workspaceId,
      conversationId: input.conversationId,
      pauseFingerprint,
      digest,
      sections,
      totalTokenEstimate: sections.reduce((total, section) => total + section.tokenEstimate, 0),
      totalRedactionCount: sections.reduce((total, section) => total + section.redactionCount, 0),
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + snapshotTtlMs).toISOString(),
    };
    this.#cache.set(snapshot.id, { snapshot, expiresAtMs: createdAt.getTime() + snapshotTtlMs });
    this.pruneCache();
    return snapshot;
  }

  public attach(input: AttachDebugContextRequest): AttachDebugContextResponse {
    this.pruneCache();
    const cached = this.#cache.get(input.snapshotId);
    if (cached === undefined) throw new Error('调试上下文预览已过期，请重新收集。');
    const snapshot = cached.snapshot;
    if (snapshot.digest !== input.expectedDigest)
      throw new Error('调试上下文预览已变化，请重新审核。');
    if (snapshot.conversationId !== input.conversationId) {
      throw new Error('调试上下文预览与当前会话不匹配。');
    }
    const session = this.requirePausedSession(snapshot.sessionId);
    if (safePauseFingerprint(session) !== snapshot.pauseFingerprint) {
      throw new Error('程序暂停位置已变化，请重新收集调试上下文。');
    }
    const selected = new Set<DebugContextSectionKey>(input.selectedSections);
    const sections = snapshot.sections.filter((section) => selected.has(section.key));
    if (sections.length !== selected.size) throw new Error('所选调试上下文包含无效分区。');

    const contextItem = this.contextItems.save({
      conversationId: input.conversationId,
      type: 'diagnostic',
      title: `调试快照 · ${new Date(snapshot.createdAt).toLocaleString('zh-CN')}`,
      content: composeDebugContext(sections),
      priority: 95,
      sourceKey: `debug:${snapshot.sessionId}`,
    });
    this.#cache.delete(snapshot.id);
    this.audit?.record({
      workspaceId: snapshot.workspaceId,
      conversationId: snapshot.conversationId,
      actor: 'user',
      category: 'security',
      action: 'debug.context.attach',
      outcome: 'succeeded',
      summary: '用户审核并附加了已脱敏的调试上下文。',
      metadata: {
        sessionId: snapshot.sessionId,
        sectionCount: sections.length,
        redactionCount: sections.reduce((total, section) => total + section.redactionCount, 0),
      },
    });
    return {
      snapshotId: snapshot.id,
      contextItem: { ...contextItem, type: 'diagnostic' },
      prompt: modelPrompt,
    };
  }

  private async collectSections(
    session: PausedDebugSession,
    conversationId: string,
  ): Promise<ReadonlyArray<DebugContextSection>> {
    const pause = session.pause;
    const stack = await this.runtime.stackTrace(session.id, pause.threadId).catch(() => []);
    const frameId = pause.frameId ?? stack[0]?.id;
    const sections: Array<DebugContextSection | null> = [
      section(
        'location',
        '暂停位置',
        [
          `原因：${pause.reason}`,
          ...(pause.description === undefined ? [] : [`说明：${pause.description}`]),
          `线程：${pause.threadId}`,
          `位置：${pause.relativePath ?? '未知'}:${pause.line ?? '未知'}:${pause.column ?? 1}`,
        ].join('\n'),
      ),
      await this.sourceSection(session.workspaceId, pause.relativePath, pause.line),
      pause.exception === undefined
        ? null
        : section(
            'exception',
            '异常',
            [
              `异常：${pause.exception.typeName ?? pause.exception.exceptionId}`,
              ...(pause.exception.message === undefined
                ? []
                : [`消息：${pause.exception.message}`]),
              ...(pause.exception.description === undefined
                ? []
                : [`说明：${pause.exception.description}`]),
              ...(pause.exception.stackTrace === undefined
                ? []
                : [`调用栈：\n${pause.exception.stackTrace}`]),
            ].join('\n'),
          ),
      stack.length === 0 ? null : section('stack', '调用栈', formatDebugStack(stack)),
      await this.variablesSection(session.id, frameId),
      await this.watchesSection(session.id, session.workspaceId, frameId),
      session.outputTail.trim() === ''
        ? null
        : section('console', '调试控制台与程序输出', session.outputTail, 16_000),
      section('configuration', '运行配置', formatDebugConfiguration(session.command)),
      await this.gitSection(session.workspaceId),
      this.changesSection(conversationId),
      await this.dependenciesSection(session.workspaceId),
    ];
    return sections.filter((value): value is DebugContextSection => value !== null);
  }

  private async sourceSection(workspaceId: string, relativePath?: string, line?: number) {
    if (relativePath === undefined || line === undefined) return null;
    try {
      const file = await this.files.readFile(workspaceId, relativePath);
      const lines = file.content.split(/\r?\n/u);
      const start = Math.max(line - 16, 0);
      const end = Math.min(line + 15, lines.length);
      const excerpt = lines
        .slice(start, end)
        .map((value, index) => `${String(start + index + 1).padStart(5, ' ')} ${value}`)
        .join('\n');
      return section('source', `暂停位置源码 · ${relativePath}`, excerpt, 12_000);
    } catch {
      return null;
    }
  }

  private async variablesSection(sessionId: string, frameId?: number) {
    if (frameId === undefined) return null;
    try {
      const scopes = await this.runtime.scopes(sessionId, frameId);
      let forcedRedactions = 0;
      const blocks: string[] = [];
      for (const scope of scopes.filter((value) => !value.expensive).slice(0, 12)) {
        const variables = await this.runtime.variables(sessionId, scope.variablesReference);
        blocks.push(`## ${scope.name}`);
        for (const variable of variables.slice(0, 100)) {
          const sensitive = isSensitiveName(variable.name);
          if (sensitive) forcedRedactions += 1;
          blocks.push(
            `${variable.name}: ${sensitive ? '[REDACTED]' : variable.value}${variable.type === undefined ? '' : ` (${variable.type})`}`,
          );
        }
      }
      if (blocks.length === 0) return null;
      return section('variables', '局部变量与作用域', blocks.join('\n'), 20_000, forcedRedactions);
    } catch {
      return null;
    }
  }

  private async watchesSection(sessionId: string, workspaceId: string, frameId?: number) {
    const watches = this.runtime.listWatches({ workspaceId });
    if (watches.length === 0) return null;
    let forcedRedactions = 0;
    const values = await Promise.all(
      watches.slice(0, 50).map(async (watch) => {
        const sensitive = isSensitiveName(watch.expression);
        if (sensitive) forcedRedactions += 1;
        try {
          const result = await this.runtime.evaluate({
            sessionId,
            expression: watch.expression,
            context: 'watch',
            ...(frameId === undefined ? {} : { frameId }),
          });
          return `${watch.expression}: ${sensitive ? '[REDACTED]' : result.result}`;
        } catch (error) {
          return `${watch.expression}: 求值失败（${safeError(error)}）`;
        }
      }),
    );
    return section('watches', '监视表达式', values.join('\n'), 12_000, forcedRedactions);
  }

  private async gitSection(workspaceId: string) {
    try {
      const status = await this.git.status(workspaceId);
      if (!status.isRepository || status.clean) return null;
      const [unstaged, staged] = await Promise.all([
        this.git.diff({ workspaceId, staged: false, maxCharacters: 12_000 }),
        this.git.diff({ workspaceId, staged: true, maxCharacters: 12_000 }),
      ]);
      const content = [
        unstaged.content === '' ? '' : `## 未暂存\n${unstaged.content}`,
        staged.content === '' ? '' : `## 已暂存\n${staged.content}`,
      ]
        .filter(Boolean)
        .join('\n\n');
      return content === '' ? null : section('git_diff', 'Git Diff', content, 24_000);
    } catch {
      return null;
    }
  }

  private changesSection(conversationId: string) {
    const aggregates = this.changes.listForConversation(conversationId).slice(0, 5);
    if (aggregates.length === 0) return null;
    const content = aggregates
      .map(({ changeSet, changes }) =>
        [
          `${changeSet.title} · ${changeSet.status} · ${changeSet.updatedAt}`,
          ...changes.map(
            (change) =>
              `- ${change.operation} ${change.filePath}${change.destinationPath === undefined ? '' : ` → ${change.destinationPath}`} (${change.status})`,
          ),
        ].join('\n'),
      )
      .join('\n\n');
    return section('recent_changes', '最近文件变更', content, 8_000);
  }

  private async dependenciesSection(workspaceId: string) {
    try {
      const file = await this.files.readFile(workspaceId, 'package.json');
      const value: unknown = JSON.parse(file.content);
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
      const record = value as Record<string, unknown>;
      const groups = ['dependencies', 'devDependencies', 'peerDependencies'] as const;
      const lines = groups.flatMap((group) => formatDependencyGroup(group, record[group]));
      return lines.length === 0
        ? null
        : section('dependencies', '项目依赖', lines.join('\n'), 12_000);
    } catch {
      return null;
    }
  }

  private requirePausedSession(sessionId: string) {
    const session = this.sessions.findById(sessionId);
    if (session === null) throw new Error('找不到调试会话。');
    if (session.status !== 'paused' || session.pause === undefined) {
      throw new Error('只有程序暂停时才能收集调试上下文。');
    }
    return session as typeof session & { readonly pause: NonNullable<typeof session.pause> };
  }

  private pruneCache(): void {
    const now = Date.now();
    for (const [id, value] of this.#cache) if (value.expiresAtMs <= now) this.#cache.delete(id);
    while (this.#cache.size > maximumSnapshots) {
      const oldest = this.#cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.#cache.delete(oldest);
    }
  }
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : '未知错误';
}

function safePauseFingerprint(session: PausedDebugSession): string {
  return sha256(redactSensitiveText(JSON.stringify(session.pause)));
}
