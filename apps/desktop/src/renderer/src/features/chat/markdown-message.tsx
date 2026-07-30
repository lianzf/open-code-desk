import * as monaco from 'monaco-editor';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useEffect, useState } from 'react';

function HighlightedCode({ code, language }: { readonly code: string; readonly language: string }) {
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void monaco.editor.colorize(code, language, {}).then((html) => {
      if (active) {
        setHighlightedHtml(html);
      }
    });
    return () => {
      active = false;
    };
  }, [code, language]);

  const className =
    'block overflow-x-auto rounded-lg border border-zinc-700 bg-zinc-950 p-3 font-mono text-xs text-zinc-200';
  if (highlightedHtml === null) {
    return <code className={className}>{code}</code>;
  }
  return (
    <code
      className={className}
      // Monaco escapes source text before producing its theme-controlled spans.
      dangerouslySetInnerHTML={{ __html: highlightedHtml }}
    />
  );
}

export function MarkdownMessage({ content }: { readonly content: string }) {
  return (
    <div className="chat-markdown text-sm leading-6 text-zinc-300">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ children, ...props }) {
            return (
              <a
                {...props}
                target="_blank"
                rel="noreferrer"
                className="text-cyan-400 underline decoration-cyan-800 underline-offset-2"
              >
                {children}
              </a>
            );
          },
          code({ children, className, ...props }) {
            const block = className?.startsWith('language-') === true;
            if (block) {
              return (
                <HighlightedCode
                  code={String(children).replace(/\n$/, '')}
                  language={className?.slice('language-'.length) ?? 'plaintext'}
                />
              );
            }
            return (
              <code
                {...props}
                className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[0.9em] text-cyan-200"
              >
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
