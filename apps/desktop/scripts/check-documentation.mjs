import { execFileSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const requiredDocuments = [
  'README.md',
  'docs/architecture.md',
  'docs/clean-device-acceptance.md',
  'docs/installation.md',
  'docs/model-configuration.md',
  'docs/privacy.md',
  'docs/provider-development.md',
  'docs/roadmap.md',
  'docs/security.md',
  'docs/tool-development.md',
  'docs/troubleshooting.md',
  'docs/user-guide.md',
];
const requiredAcceptanceHeadings = [
  '## 验收角色与环境',
  '## 候选版本记录',
  '## 平台安装与生命周期',
  '## 核心 AI 编程闭环（22 步）',
  '## IDE 调试与 AI 修复闭环',
  '## Provider 真实服务矩阵',
  '## 安全、持久化与故障检查',
  '## 结果与签字',
];
const requiredAcceptanceProviders = [
  'OpenAI',
  'Anthropic Claude',
  'Google Gemini',
  'DeepSeek',
  'OpenRouter',
  '通义千问',
  '智谱 GLM',
  'Moonshot/Kimi',
  'Ollama',
  'OpenAI Compatible',
];
const requiredReadmeHeadings = [
  '## 当前能力',
  '## 技术栈',
  '## 开发环境',
  '## 本地运行',
  '## 质量检查',
  '## 构建安装包',
  '## 配置模型',
  '## 安全设计',
  '## 常见问题',
  '## 文档',
  '## 当前限制',
  '## 许可证',
];

for (const path of requiredDocuments) await access(path);
const readme = await readFile('README.md', 'utf8');
for (const heading of requiredReadmeHeadings) {
  if (!readme.includes(heading)) throw new Error(`README is missing required heading: ${heading}`);
}
const acceptance = await readFile('docs/clean-device-acceptance.md', 'utf8');
for (const heading of requiredAcceptanceHeadings) {
  if (!acceptance.includes(heading)) {
    throw new Error(`Clean-device acceptance guide is missing required heading: ${heading}`);
  }
}
for (const provider of requiredAcceptanceProviders) {
  if (!acceptance.includes(`| ${provider}`)) {
    throw new Error(`Clean-device acceptance guide is missing Provider: ${provider}`);
  }
}

const markdownFiles = listMarkdownFiles().filter(
  (path) => !path.replaceAll('\\', '/').startsWith('apps/desktop/vendor/'),
);
const missingLinks = [];
let localLinksChecked = 0;
for (const file of markdownFiles) {
  const text = await readFile(file, 'utf8');
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
    let target = match[1].trim();
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
    if (/^(?:https?:|mailto:|#)/u.test(target)) continue;
    target = decodeURIComponent(target.split('#')[0]);
    if (target === '') continue;
    localLinksChecked += 1;
    const resolvedTarget = resolve(dirname(file), target);
    if (!(await exists(resolvedTarget))) missingLinks.push({ file, target });
  }
}

if (missingLinks.length > 0) {
  throw new Error(
    `Documentation has broken local links:\n${JSON.stringify(missingLinks, null, 2)}`,
  );
}
console.info(
  JSON.stringify({
    status: 'ok',
    requiredDocuments: requiredDocuments.length,
    markdownFiles: markdownFiles.length,
    localLinksChecked,
  }),
);

function listMarkdownFiles() {
  return execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*.md'],
    { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  )
    .split('\0')
    .filter((path) => path.length > 0)
    .sort((left, right) => left.localeCompare(right, 'en-US'));
}

async function exists(path) {
  return access(path).then(
    () => true,
    () => false,
  );
}
