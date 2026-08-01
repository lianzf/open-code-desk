import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { runConfigurationInputClassName, type EnvironmentDraft } from './run-configuration-draft';

export function RunEnvironmentEditor({
  variables,
  onChange,
}: {
  readonly variables: ReadonlyArray<EnvironmentDraft>;
  readonly onChange: (variables: ReadonlyArray<EnvironmentDraft>) => void;
}) {
  const update = (index: number, patch: Partial<EnvironmentDraft>) => {
    onChange(
      variables.map((variable, variableIndex) =>
        variableIndex === index ? { ...variable, ...patch } : variable,
      ),
    );
  };

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
      <div className="mb-3 flex items-center">
        <div>
          <h3 className="text-xs font-semibold text-zinc-200">环境变量</h3>
          <p className="mt-0.5 text-[11px] text-zinc-600">
            已配置的敏感值保持空白即可保留原安全存储值
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={() =>
            onChange([...variables, { name: '', value: '', sensitive: false, configured: false }])
          }
        >
          <Plus className="size-3.5" aria-hidden="true" />
          添加
        </Button>
      </div>
      <div className="space-y-2">
        {variables.map((variable, index) => (
          <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-center">
            <input
              className={runConfigurationInputClassName}
              value={variable.name}
              onChange={(event) =>
                update(index, {
                  name: event.target.value,
                  ...(event.target.value === variable.name ? {} : { configured: false }),
                })
              }
              placeholder="变量名"
              aria-label={`环境变量 ${index + 1} 名称`}
            />
            <input
              className={runConfigurationInputClassName}
              type={variable.sensitive ? 'password' : 'text'}
              value={variable.value}
              onChange={(event) => update(index, { value: event.target.value })}
              placeholder={
                variable.sensitive && variable.configured ? '已安全配置（留空保留）' : '值'
              }
              aria-label={`环境变量 ${index + 1} 值`}
              autoComplete="off"
            />
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <input
                type="checkbox"
                checked={variable.sensitive}
                onChange={(event) =>
                  update(index, {
                    sensitive: event.target.checked,
                    ...(event.target.checked === variable.sensitive ? {} : { configured: false }),
                    ...(event.target.checked ? { value: '' } : {}),
                  })
                }
              />
              敏感
            </label>
            <button
              type="button"
              className="rounded p-2 text-zinc-600 hover:bg-zinc-800 hover:text-red-300"
              onClick={() => onChange(variables.filter((_, itemIndex) => itemIndex !== index))}
              aria-label={`删除环境变量 ${index + 1}`}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
