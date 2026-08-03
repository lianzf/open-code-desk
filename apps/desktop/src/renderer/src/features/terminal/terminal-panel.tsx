import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { CircleStop, Paperclip, RefreshCw, TerminalSquare, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useConversationContextStore } from '@/features/context/context.store';
import { localizeMainProcessError } from '@/features/settings/main-process-error-i18n';
import { translateTerminal, useTerminalTranslation } from './terminal-i18n';
import '@xterm/xterm/css/xterm.css';

interface TerminalPanelProps {
  readonly workspaceId: string;
  readonly onClose: () => void;
}

type TerminalState = 'starting' | 'running' | 'exited' | 'failed';

function readableError(error: unknown, locale: 'zh-CN' | 'en-US', fallback: string): string {
  return error instanceof Error
    ? localizeMainProcessError(locale, error.message, undefined, fallback)
    : fallback;
}

const ansiSequence = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');

function cleanTerminalOutput(output: string): string {
  return output.replaceAll(ansiSequence, '').replaceAll('\r', '').trim();
}

export function TerminalPanel({ workspaceId, onClose }: TerminalPanelProps) {
  const { locale, t } = useTerminalTranslation();
  const localeRef = useRef(locale);
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string | undefined>(undefined);
  const contextSourceRef = useRef<string | undefined>(undefined);
  const outputRef = useRef('');
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<TerminalState>('starting');
  const [shell, setShell] = useState('');
  const [cwd, setCwd] = useState('');
  const [exitCode, setExitCode] = useState<number>();
  const [errorMessage, setErrorMessage] = useState<string>();
  const [outputSize, setOutputSize] = useState(0);
  const contextConversationId = useConversationContextStore((state) => state.conversationId);
  const saveContext = useConversationContextStore((state) => state.save);

  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return;
    }

    let disposed = false;
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'Cascadia Code, Consolas, monospace',
      fontSize: 12,
      scrollback: 5_000,
      theme: {
        background: '#09090b',
        foreground: '#d4d4d8',
        cursor: '#22d3ee',
        selectionBackground: '#164e63',
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    fit.fit();
    terminal.focus();
    setState('starting');
    setExitCode(undefined);
    setErrorMessage(undefined);
    outputRef.current = '';
    setOutputSize(0);

    const removeDataListener = window.openCodeDesk.terminal.onData((event) => {
      if (event.sessionId === sessionIdRef.current) {
        outputRef.current = `${outputRef.current}${event.data}`.slice(-200_000);
        setOutputSize(outputRef.current.length);
        terminal.write(event.data);
      }
    });
    const removeExitListener = window.openCodeDesk.terminal.onExit((event) => {
      if (event.sessionId === sessionIdRef.current) {
        sessionIdRef.current = undefined;
        setState('exited');
        setExitCode(event.exitCode);
        terminal.write(
          `\r\n\x1b[90m${translateTerminal(localeRef.current, 'processExitedMessage', { code: event.exitCode })}\x1b[0m\r\n`,
        );
      }
    });
    const inputDisposable = terminal.onData((data) => {
      const sessionId = sessionIdRef.current;
      if (sessionId !== undefined) {
        void window.openCodeDesk.terminal.write({ sessionId, data });
      }
    });
    const resizeObserver = new ResizeObserver(() => {
      fit.fit();
      const sessionId = sessionIdRef.current;
      if (sessionId !== undefined) {
        void window.openCodeDesk.terminal.resize({
          sessionId,
          cols: terminal.cols,
          rows: terminal.rows,
        });
      }
    });
    resizeObserver.observe(host);

    void window.openCodeDesk.terminal
      .create({
        workspaceId,
        cols: terminal.cols,
        rows: terminal.rows,
      })
      .then(async (session) => {
        if (disposed) {
          await window.openCodeDesk.terminal.close({ sessionId: session.sessionId });
          return;
        }
        sessionIdRef.current = session.sessionId;
        contextSourceRef.current = session.sessionId;
        setShell(session.shell);
        setCwd(session.cwd);
        setState('running');
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setState('failed');
          const message = readableError(
            error,
            localeRef.current,
            translateTerminal(localeRef.current, 'startFailedGeneric'),
          );
          setErrorMessage(message);
          terminal.write(`\r\n\x1b[31m${message}\x1b[0m\r\n`);
        }
      });

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      inputDisposable.dispose();
      removeDataListener();
      removeExitListener();
      const sessionId = sessionIdRef.current;
      sessionIdRef.current = undefined;
      if (sessionId !== undefined) {
        void window.openCodeDesk.terminal.close({ sessionId });
      }
      terminal.dispose();
    };
  }, [generation, workspaceId]);

  const stop = async () => {
    const sessionId = sessionIdRef.current;
    if (sessionId === undefined) {
      return;
    }
    await window.openCodeDesk.terminal.close({ sessionId });
    sessionIdRef.current = undefined;
    setState('exited');
  };

  return (
    <section className="flex h-full min-h-0 flex-col border-t border-zinc-800 bg-zinc-950">
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-zinc-800 px-3 text-[11px]">
        <TerminalSquare className="size-3.5 text-cyan-500" aria-hidden="true" />
        <span className="font-medium text-zinc-300">{t('interactiveTerminal')}</span>
        <span className="text-zinc-600">{t('userControlled')}</span>
        {cwd !== '' ? <span className="min-w-0 truncate text-zinc-600">{cwd}</span> : null}
        <span className="ml-auto text-zinc-600">
          {state === 'starting'
            ? t('starting')
            : state === 'running'
              ? shell
              : state === 'failed'
                ? t('startFailed')
                : t('exited', { code: exitCode === undefined ? '' : ` (${exitCode})` })}
        </span>
        <button
          className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-cyan-300 disabled:opacity-40"
          onClick={() => {
            const content = cleanTerminalOutput(outputRef.current);
            if (content !== '') {
              void saveContext({
                type: 'terminal',
                title: t('terminalContextTitle', { cwd: cwd || t('workspace') }),
                content,
                priority: 75,
                ...(contextSourceRef.current === undefined
                  ? {}
                  : { sourceKey: `terminal:${contextSourceRef.current}` }),
              });
            }
          }}
          disabled={contextConversationId === undefined || outputSize === 0}
          aria-label={t('addOutputContext')}
          title={t('addOutputContextTitle')}
          data-testid="add-terminal-context"
        >
          <Paperclip className="size-3.5" />
        </button>
        {state === 'running' ? (
          <button
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-amber-300"
            onClick={() => void stop()}
            aria-label={t('stopTerminal')}
            title={t('stopTerminal')}
          >
            <CircleStop className="size-3.5" />
          </button>
        ) : (
          <button
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            onClick={() => setGeneration((value) => value + 1)}
            aria-label={t('restartTerminal')}
            title={t('restartTerminal')}
          >
            <RefreshCw className="size-3.5" />
          </button>
        )}
        <button
          className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          onClick={onClose}
          aria-label={t('closeTerminal')}
        >
          <X className="size-3.5" />
        </button>
      </header>
      {errorMessage === undefined ? null : (
        <p className="shrink-0 border-b border-red-950 bg-red-950/40 px-3 py-1 text-[11px] text-red-300">
          {errorMessage}
        </p>
      )}
      <div ref={hostRef} className="min-h-0 flex-1 px-1 py-1" data-testid="terminal-host" />
    </section>
  );
}
