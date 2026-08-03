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

## debugpy 1.8.21

- 上游项目：<https://github.com/microsoft/debugpy>
- PyPI 发布：<https://pypi.org/project/debugpy/1.8.21/>
- 上游版本：`1.8.21`
- 分发文件：`debugpy-1.8.21-py2.py3-none-any.whl`
- Wheel SHA-256：`b1e37d333663c8851516a47364ef473da127f9caebe4417e6df6f5825a7e9a92`
- 应用入口：`debugpy-1.8.21/debugpy/adapter/__main__.py`
- 许可证：MIT，完整文本见 `debugpy-1.8.21/LICENSE`

应用随安装包分发固定版本的 debugpy，让用户选择自己的 Python 解释器即可调试，无需向项目
虚拟环境安装依赖。该资源由 `electron-builder.yml` 复制到 `resources/debugpy`。升级时必须校验
PyPI 官方文件摘要，保留许可证，并在 Windows、macOS、Linux 上运行真实断点、变量、单步、
异常与进程清理测试。

## Eclipse JDT Language Server 1.60.0

- 上游项目：<https://github.com/eclipse-jdtls/eclipse.jdt.ls>
- Eclipse milestone 分发：`jdt-language-server-1.60.0-202606262232.tar.gz`
- 分发包 SHA-256：`e94c303d8198f977930803582738771fd18c52c5492878410bf222b1aa81ef1d`
- 应用入口：`jdtls-1.60.0/plugins/org.eclipse.equinox.launcher_1.7.200.v20260619-2039.jar`
- 入口 SHA-256：`89007de5f1c1b600af7d6985665061b515f8678738a02c57098f0b3eece6e02e`
- 许可证：EPL-2.0，完整文本和源码获取说明见该目录

JDT LS 通过 stdio 运行，每个调试会话使用独立临时数据目录。应用不会修改系统 JDK、PATH、
注册表或用户项目依赖；用户需要提供 JDK 21 或更高版本作为语言服务器运行时。

## Microsoft Java Debug Server 0.53.2

- 上游项目：<https://github.com/microsoft/java-debug>
- 官方 VS Code 扩展版本：`vscjava.vscode-java-debug 0.59.0`
- Marketplace VSIX SHA-256：`e5973fcd763a984ea4d6e57644ccf8f5fe6caa80c0e589f29403f00c9ace3920`
- 应用入口：`java-debug-0.59.0/com.microsoft.java.debug.plugin-0.53.2.jar`
- 入口 SHA-256：`4a85f60e1d838476f43c95cde318aa81ade7b39cb9cfbc73b8c5a01197e020e6`
- 许可证：Java Debug Server 为 EPL-1.0；Marketplace 扩展的 MIT 许可证和双方第三方声明均保留

插件由 JDT LS 的 `initializationOptions.bundles` 加载，再通过本机回环端口提供 DAP。应用不从
项目目录或网络动态加载任意 Java 调试插件。
