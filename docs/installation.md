# 安装与首次启动

OpenCode Desk 的正式发布产物由对应平台的原生 CI runner 构建。最终用户不需要安装 Node.js、pnpm 或开发工具。

## 下载前验证

从同一个 GitHub Release 下载目标平台安装包和 `SHA256SUMS.txt`，先核对 SHA-256。发布附件还包含 `open-code-desk.cdx.json`、`dependency-audit.json`、`license-audit.json` 和 `secret-scan.json`，四份安全元数据也必须出现在校验清单中。正式 Windows/macOS 产物还必须通过平台签名验证；如果发布页明确标注为开发测试包，则不要把它用于生产环境或不可信项目。

Windows PowerShell：

```powershell
Get-FileHash -Algorithm SHA256 '.\OpenCode Desk Setup x.y.z.exe'
Get-AuthenticodeSignature '.\OpenCode Desk Setup x.y.z.exe' | Format-List Status,SignerCertificate
```

正式 Windows 安装包的签名状态必须为 `Valid`。

macOS：

```bash
shasum -a 256 'OpenCode Desk-x.y.z.dmg'
spctl --assess --verbose --type open 'OpenCode Desk-x.y.z.dmg'
```

## Windows

1. 运行 `OpenCode Desk Setup x.y.z.exe`。
2. 选择安装目录并完成安装。
3. 从开始菜单或桌面快捷方式启动 OpenCode Desk。
4. 首次启动后选择本地项目，再进入“模型设置”配置服务。

安装程序支持静默安装：

```powershell
& '.\OpenCode Desk Setup x.y.z.exe' /S
```

可以从 Windows“已安装的应用”卸载，也可以运行安装目录内的卸载程序。卸载应用前，如需保留会话、模型引用和最近项目，请保留应用用户数据目录；API Key 本身由操作系统安全凭据能力保护。

## macOS

1. 打开 DMG，将 OpenCode Desk 拖入 `Applications`；ZIP 主要用于自动更新分发。
2. 首次打开前可验证应用签名与 notarization ticket：

   ```bash
   codesign --verify --deep --strict --verbose=2 '/Applications/OpenCode Desk.app'
   spctl --assess --verbose --type exec '/Applications/OpenCode Desk.app'
   xcrun stapler validate '/Applications/OpenCode Desk.app'
   ```

3. 从 Applications 启动并选择本地项目。

正式发布不应要求用户绕过 Gatekeeper。若系统提示开发者无法验证，应停止安装并核对下载来源和发布签名。

## Linux

AppImage 不需要系统级安装：

```bash
chmod +x 'OpenCode Desk-x.y.z.AppImage'
./'OpenCode Desk-x.y.z.AppImage'
```

保存 API Key 需要可用的 Secret Service 或 KWallet。若桌面环境只提供不安全的 `basic_text` 后端，应用会拒绝保存密钥，而不是降级为明文存储。

## 首次使用检查

1. 主界面正常出现且没有白屏。
2. 选择一个本地项目后文件树可展开，文本文件可打开。
3. 在模型设置中保存 Provider，并执行连接测试。
4. 创建会话并发送一条消息，确认流式响应可停止。
5. 关闭应用后检查没有残留的 OpenCode Desk 进程，再次启动确认最近项目和会话可恢复。

完整操作闭环见[使用指南](user-guide.md)，模型字段说明见[模型配置指南](model-configuration.md)。正式发布验收人员必须另按[干净设备独立验收清单](clean-device-acceptance.md)逐项操作、留证并签字；自动化通过不能替代该记录。
