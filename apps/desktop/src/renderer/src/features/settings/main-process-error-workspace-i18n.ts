type MatchTranslator = (match: RegExpMatchArray) => string;

export const workspaceExactEnglish = new Map<string, string>([
  ['当前环境不支持选择图片。', 'Image selection is unavailable in the current environment.'],
  [
    '图片必须是大小不超过 5 MB 的普通文件。',
    'The image must be a regular file no larger than 5 MB.',
  ],
  ['图片大小不能超过 5 MB。', 'The image cannot exceed 5 MB.'],
  [
    '图片内容不是受支持的 PNG、JPEG、GIF 或 WebP 格式。',
    'The image is not a supported PNG, JPEG, GIF, or WebP file.',
  ],
  ['路径包含无效字符。', 'The path contains invalid characters.'],
  ['只允许工作区内的相对路径。', 'Only relative paths inside the workspace are allowed.'],
  ['路径包含不允许的跳转或空路径段。', 'The path contains a forbidden traversal or empty segment.'],
  ['路径超出工作区边界。', 'The path is outside the workspace.'],
  ['不支持打开二进制文件。', 'Binary files cannot be opened.'],
  ['文件不是有效的 UTF-8 文本。', 'The file is not valid UTF-8 text.'],
  ['该目录受敏感路径策略保护。', 'The directory is protected by the sensitive-path policy.'],
  ['请求路径不是目录。', 'The requested path is not a directory.'],
  ['请求路径不是普通文件。', 'The requested path is not a regular file.'],
  ['文件超过 2 MB，无法在编辑器中打开。', 'Files larger than 2 MB cannot be opened in the editor.'],
  [
    '只能保存工作区内已有的普通文本文件。',
    'Only existing regular text files inside the workspace can be saved.',
  ],
  ['文件父目录超出工作区边界。', 'The file parent directory is outside the workspace.'],
  [
    '文件已在磁盘上发生变化，请重新加载后再保存。',
    'The file changed on disk. Reload it before saving.',
  ],
  ['保存内容超过 2 MB 限制。', 'The content to save exceeds the 2 MB limit.'],
  ['新文件内容超过 2 MB 限制。', 'The new file content exceeds the 2 MB limit.'],
  ['源路径和目标路径不能相同。', 'The source and destination paths cannot be the same.'],
  ['不允许移动符号链接。', 'Symbolic links cannot be moved.'],
  ['不能把目录移动到其自身内部。', 'A directory cannot be moved inside itself.'],
  ['目标路径已存在，请选择其他名称。', 'The destination path already exists. Choose another name.'],
  ['不允许通过文件树删除符号链接。', 'Symbolic links cannot be deleted through the file tree.'],
  ['只能删除普通文件或空目录。', 'Only regular files or empty directories can be deleted.'],
  ['必须指定文件路径。', 'A file path is required.'],
  ['该文件受敏感路径策略保护。', 'The file is protected by the sensitive-path policy.'],
  ['目标父目录超出工作区边界。', 'The destination parent directory is outside the workspace.'],
  ['解析后的路径超出工作区边界。', 'The resolved path is outside the workspace.'],
  ['当前工作区不是 Git 仓库。', 'The current workspace is not a Git repository.'],
  [
    '安全策略禁止读取该敏感文件的 Git Diff。',
    'The security policy blocks reading the Git diff for this sensitive file.',
  ],
  [
    '工作区真实路径已发生变化，已阻止继续执行 Git 命令。',
    'The workspace real path changed, so the Git command was blocked.',
  ],
  [
    'Git 仓库根目录不等于当前工作区，已阻止读取工作区外的仓库内容。',
    'The Git repository root does not match the workspace, so content outside the workspace was blocked.',
  ],
  ['不支持读取二进制文件。', 'Binary files cannot be read.'],
  [
    '外部目录路径无效或已超出授权边界。',
    'The external directory path is invalid or outside the authorized boundary.',
  ],
  ['必须指定外部文件路径。', 'An external file path is required.'],
  [
    '外部文件无效或已超出授权边界。',
    'The external file is invalid or outside the authorized boundary.',
  ],
  ['外部文件超过 2 MB 读取限制。', 'The external file exceeds the 2 MB read limit.'],
  [
    '该外部文件受敏感路径策略保护。',
    'The external file is protected by the sensitive-path policy.',
  ],
  [
    '外部目录授权不存在或不属于当前工作区。',
    'The external-directory authorization does not exist or belongs to another workspace.',
  ],
  [
    '外部目录授权已失效或不再安全。',
    'The external-directory authorization expired or is no longer safe.',
  ],
  [
    '该外部路径受敏感路径策略保护。',
    'The external path is protected by the sensitive-path policy.',
  ],
  ['该路径已被工作区权限规则禁止访问。', 'Workspace permission rules deny access to this path.'],
  ['不能禁止整个工作区根目录。', 'The entire workspace root cannot be denied.'],
  ['外部目录选择器不可用。', 'The external-directory picker is unavailable.'],
  ['只能授权目录。', 'Only directories can be authorized.'],
  [
    '该目录已位于当前工作区内，无需额外授权。',
    'The directory is already inside the workspace and needs no additional authorization.',
  ],
  [
    '敏感凭据目录或系统目录不能被授权。',
    'Sensitive credential or system directories cannot be authorized.',
  ],
  [
    '该任务执行请求已不再等待批准。',
    'The task execution request is no longer waiting for approval.',
  ],
  ['找不到当前工作区的项目任务。', 'No project task was found in the current workspace.'],
  [
    '项目任务引用了当前工作区中不存在的依赖。',
    'The project task references a dependency that does not exist in the current workspace.',
  ],
  [
    '系统安全凭据服务不可用。请启用 Secret Service 或 KWallet 后重试。',
    'The system credential service is unavailable. Enable Secret Service or KWallet and retry.',
  ],
  [
    '操作系统安全凭据服务当前不可用，密钥未保存。请解锁系统凭据库后重试。',
    'The operating-system credential service is unavailable, so the key was not saved. Unlock the system credential store and retry.',
  ],
  ['找不到该最近工作区记录。', 'The recent workspace entry was not found.'],
  ['工作区路径不是目录。', 'The workspace path is not a directory.'],
  ['所选路径不是目录。', 'The selected path is not a directory.'],
]);

export const workspaceEnglishRules: ReadonlyArray<readonly [RegExp, MatchTranslator]> = [
  [/^无法读取 Git 状态：(.+)$/s, (match) => `Could not read Git status: ${value(match, 1)}`],
  [/^无法读取 Git Diff：(.+)$/s, (match) => `Could not read the Git diff: ${value(match, 1)}`],
  [/^无法启动 Git：(.+)$/s, (match) => `Could not start Git: ${value(match, 1)}`],
];

function value(match: RegExpMatchArray, index: number): string {
  return match[index] ?? '';
}
