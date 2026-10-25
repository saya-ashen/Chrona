# v2-12 规格：Provider 的浏览器

状态：已实现（2026-10-25）。依赖 [v2-11](platform-v2-11-provider-module.md)。

## 1. 背景

Provider 写和改模块，但看不到页面：构建运行只能跑测试（只断言文字和结构），改样式等于盲改。截图是 Provider 写代码时自己用的手段，所以它是 Provider 的能力（agent 工具集的一部分），不是模块，也不是 `provider.*` 路由方法；构建运行里本来也调不到路由工具。

## 2. 能力

- **`browser_screenshot({ url, width?, height? })`**：Chrona 随发布带的 Pi 扩展（`external-plugins/pi-steward-agent/browser-tools.ts`）。只截本机页面（`http://127.0.0.1` / `localhost`）；无头浏览器先让页面脚本运行（虚拟时间 8 秒）再截图；结果作为图片交给模型（Pi 工具结果的 `ImageContent`），同时存到工作目录 `screenshots/`，模型不看图时也能引用路径。默认视口 1440×900。
- **`node_modules/chrona/preview.ts <模块目录> [fixtures.json]`**：构建目录里的预览脚本。用测试内核（`chrona/testing`）启动模块，把它的 HTTP（`chrona.serve`）转发到 `http://127.0.0.1:<随机端口>/`。路由调用按 fixtures.json（`{ "<module>.<tool>": 输出 }`）回答，没有的返回 null，与作者测试相同，不产生任何真实效果。web 模块的数据接口不在模块内验证密钥，所以预览直接显示页面而不是登录页。
- 构建提示：提供页面的模块在后台启动预览；有 `browser_screenshot` 时在 1440×900、1024×768、390×844 下检查页面再提交。

## 3. 浏览器从哪里来

每次启动 Provider 时按顺序找，找到才加载扩展、把工具加入 `--tools`、通过 `CHRONA_BROWSER` 传入路径：

1. `CHRONA_STEWARD_BROWSER` 指定的可执行文件；
2. PATH 中的 `chromium`、`chromium-browser`、`google-chrome-stable`、`google-chrome`；
3. Chrona 之前获取的浏览器（`<dataDir>/providers/browser/`）。

都没有时在后台获取一次，本次运行没有浏览器工具，之后的运行有：

- 有 Nix：`nix build <CHRONA_NIXPKGS 或 nixpkgs>#chromium --out-link <dataDir>/providers/browser/nix`（与模块依赖相同的 nixpkgs 固定方式，out-link 即 GC root）；
- 没有 Nix（仅 linux-x64）：下载 Chrome for Testing 的 `chrome-headless-shell`，版本与 SHA-256 写在代码里（`HEADLESS_SHELL`，当前 155.0.8059.39；官方不发布校验值，升级时两者一起改），校验不符即放弃；用 `unzip`，没有则用 `python3 -m zipfile` 解压。

获取失败记一条 `steward.browser` 警告日志，到 Chrona 重启前不再重试（避免每次运行重复下载 120 MB）。缺系统库等导致浏览器起不来时，工具调用会报错，Provider 能看到原因。

## 4. 沙箱

bubblewrap 下浏览器与 Pi 在同一沙箱内：只读根目录让 PATH 和 `/nix/store` 中的浏览器可见；下载到数据目录（被屏蔽）的浏览器，其目录以只读方式重新挂入。网络命名空间不隔离，所以能访问 `127.0.0.1` 上的预览。实测（NixOS、Chrome 无头模式）不需要 `--no-sandbox` 或额外设备挂载。

## 5. 未做

- 首页健康信息不显示浏览器状态，只有日志。
- 截图只限视口，不支持整页长图和交互（点击、输入）。
- 对话运行里用 `m_modules_checkout` 取出的模块没有预览脚本；预览只在构建会话中提供（[v2-13](platform-v2-13-modules-tools.md)）。
