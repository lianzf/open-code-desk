import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { CircleStop, RefreshCw, TerminalSquare, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import '@xterm/xterm/css/xterm.css';

interface TerminalPanelProps {
  readonly workspaceId: string;
  readonly onClose: () => void;
}

type TerminalState = 'starting' | 'running' | 'exited' | 'failed';

function readableError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
  }
  return '无法启动集成终端。';
}

export function TerminalPanel({ workspaceId, onClose }: TerminalPanelProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string | undefined>(undefined);
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<TerminalState>('starting');
  const [shell, setShell] = useState('');
  const [cwd, setCwd] = useState('');
  const [exitCode, setExitCode] = useState<number>();
  const [errorMessage, setErrorMessage] = useState<string>();

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

    const removeDataListener = window.openCodeDesk.terminal.onData((event) => {
      if (event.sessionId === sessionIdRef.current) {
        terminal.write(event.data);
      }
    });
    const removeExitListener = window.openCodeDesk.terminal.onExit((event) => {
      if (event.sessionId === sessionIdRef.current) {
        sessionIdRef.current = undefined;
        setState('exited');
        setExitCode(event.exitCode);
        terminal.write(`\r\n\x1b[90m[进程已退出，退出码 ${event.exitCode}]\x1b[0m\r\n`);
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
        setShell(session.shell);
        setCwd(session.cwd);
        setState('running');
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setState('failed');
          setErrorMessage(readableError(error));
          terminal.write(`\r\n\x1b[31m${readableError(error)}\x1b[0m\r\n`);
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
    <section className="flex h-60 min-h-0 shrink-0 flex-col border-t border-zinc-800 bg-zinc-950">
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-zinc-800 px-3 text-[11px]">
        <TerminalSquare className="size-3.5 text-cyan-500" aria-hidden="true" />
        <span className="font-medium text-zinc-300">交互终端</span>
        <span className="text-zinc-600">用户控制</span>
        {cwd !== '' ? <span className="min-w-0 truncate text-zinc-600">{cwd}</span> : null}
        <span className="ml-auto text-zinc-600">
          {state === 'starting'
            ? '正在启动'
            : state === 'running'
              ? shell
              : state === 'failed'
                ? '启动失败'
                : `已退出${exitCode === undefined ? '' : ` (${exitCode})`}`}
        </span>
        {state === 'running' ? (
          <button
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-amber-300"
            onClick={() => void stop()}
            aria-label="终止终端进程"
            title="终止终端进程"
          >
            <CircleStop className="size-3.5" />
          </button>
        ) : (
          <button
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            onClick={() => setGeneration((value) => value + 1)}
            aria-label="重新启动终端"
            title="重新启动终端"
          >
            <RefreshCw className="size-3.5" />
          </button>
        )}
        <button
          className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          onClick={onClose}
          aria-label="关闭终端面板"
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
