# 第三方调试适配器

## vscode-js-debug 1.117.0

- 上游项目：<https://github.com/microsoft/vscode-js-debug>
- 上游版本：`v1.117.0`
- 应用入口：`js-debug-1.117.0/src/dapDebugServer.js`
- 入口文件 SHA-256：`50EBF42EBA65B673677866B2FCC1BC82C4D6AAFE2BDB67A2EA76A3A7A89D1902`
- 许可证：MIT，完整文本见 `js-debug-1.117.0/LICENSE`

该目录保存上游发布的独立 DAP Server 运行产物，由 `electron-builder.yml` 作为只读资源复制到
安装包的 `resources/js-debug`。它不是 OpenCode Desk 的业务源码，因此不参与本仓库的 Prettier
和 ESLint 改写。

升级时必须从上游正式 Release 获取构建产物，记录新版本和入口文件 SHA-256，保留上游许可证，
然后运行 Node 调试集成测试、Electron 调试 E2E 以及 Windows/macOS/Linux 打包矩阵。
