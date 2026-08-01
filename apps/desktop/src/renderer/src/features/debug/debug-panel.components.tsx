import type { DebugVariable } from '@open-code-desk/ipc-contracts';
import { ChevronRight } from 'lucide-react';

export function DebugSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="border-b border-zinc-900 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function VariableList({
  variables,
  values,
  expand,
  depth,
}: {
  readonly variables: ReadonlyArray<DebugVariable>;
  readonly values: Readonly<Record<number, ReadonlyArray<DebugVariable>>>;
  readonly expand: (reference: number) => Promise<void>;
  readonly depth: number;
}) {
  return variables.map((variable, index) => (
    <div key={`${variable.name}-${index}`}>
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-1 py-0.5 pr-2 text-left font-mono text-[10px] hover:bg-zinc-900"
        style={{ paddingLeft: `${12 + depth * 12}px` }}
        disabled={variable.variablesReference === 0}
        onClick={() => void expand(variable.variablesReference)}
      >
        {variable.variablesReference > 0 ? (
          <ChevronRight className="size-3 shrink-0" />
        ) : (
          <span className="w-3" />
        )}
        <span className="truncate text-cyan-300">{variable.name}</span>
        <span className="truncate text-zinc-500">= {variable.value}</span>
      </button>
      {depth < 8 && values[variable.variablesReference] !== undefined ? (
        <VariableList
          variables={values[variable.variablesReference] ?? []}
          values={values}
          expand={expand}
          depth={depth + 1}
        />
      ) : null}
    </div>
  ));
}
