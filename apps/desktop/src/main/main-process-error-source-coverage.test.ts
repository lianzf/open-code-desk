import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { localizeMainProcessError } from '../renderer/src/features/settings/main-process-error-i18n';

interface SourceDiagnostic {
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

describe('main-process error source coverage', () => {
  it('provides Chinese text for every application-owned English diagnostic literal', () => {
    const untranslated = collectApplicationDiagnostics('en').filter(({ message }) => {
      const translated = localizeMainProcessError('zh-CN', message, undefined, '操作失败。');
      return translated === message;
    });

    expect(untranslated).toEqual([]);
  });

  it('provides English text for every application-owned Chinese diagnostic literal', () => {
    const fallback = '__untranslated_main_process_error__';
    const untranslated = collectApplicationDiagnostics('zh').filter(({ message }) => {
      const translated = localizeMainProcessError('en-US', message, undefined, fallback);
      return translated === fallback || /\p{Script=Han}/u.test(translated);
    });

    expect(untranslated).toEqual([]);
  });
});

function collectApplicationDiagnostics(language: 'en' | 'zh'): SourceDiagnostic[] {
  const root = process.cwd();
  const diagnostics: SourceDiagnostic[] = [];
  for (const sourceRoot of ['apps/desktop/src/main', 'packages']) {
    visitDirectory(join(root, sourceRoot));
  }
  return diagnostics;

  function visitDirectory(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visitDirectory(path);
      } else if (isProductionTypeScript(entry.name)) {
        inspectFile(path);
      }
    }
  }

  function inspectFile(path: string): void {
    const sourceText = readFileSync(path, 'utf8');
    const sourceFile = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true);
    visit(sourceFile);

    function visit(node: ts.Node): void {
      if (ts.isThrowStatement(node) && node.expression !== undefined) {
        const diagnostic = diagnosticFromThrow(node.expression, sourceFile, language);
        if (diagnostic !== undefined) {
          const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          diagnostics.push({
            file: relative(root, path).replaceAll('\\', '/'),
            line: position.line + 1,
            message: diagnostic,
          });
        }
      }
      ts.forEachChild(node, visit);
    }
  }
}

function diagnosticFromThrow(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  language: 'en' | 'zh',
): string | undefined {
  if (
    !ts.isNewExpression(expression) ||
    !expression.expression.getText(sourceFile).endsWith('Error')
  ) {
    return undefined;
  }
  const argument = expression.arguments?.at(-1);
  if (argument === undefined) return undefined;
  const message = literalText(argument);
  if (message === undefined) return undefined;
  const containsHan = /\p{Script=Han}/u.test(message);
  if (language === 'zh') return containsHan ? message : undefined;
  if (containsHan || !/[A-Za-z]/.test(message) || /^[A-Z][A-Z0-9_]*$/.test(message))
    return undefined;
  return message;
}

function literalText(node: ts.Expression): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (!ts.isTemplateExpression(node)) return undefined;
  let result = node.head.text;
  for (const span of node.templateSpans) {
    const expression = span.expression.getText();
    const sample = /detail|optional|formatLogTail/i.test(expression) ? '' : '1';
    result += sample + span.literal.text;
  }
  return result;
}

function isProductionTypeScript(name: string): boolean {
  return extname(name) === '.ts' && !/\.(?:test|spec|acceptance)\.ts$/.test(name);
}
