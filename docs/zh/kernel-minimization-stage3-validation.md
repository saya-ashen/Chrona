# 内核最小保留：阶段 3 开发检查记录

日期：2026-11-08。状态：开发检查通过；未部署，未删除既有用户数据。

## 已实现

- 删除 `content` 系统接口、`content-local` 能力、`history.file` 和共享 `chat/` 引用；不留兼容读取。
- Web 上传、消息归属校验及下载均使用私有内容区；QQ 从自己的消息记录证明归属后读取。下载不受最近 100 条消息展示窗口限制。
- 应用页面图片由页面所属应用显式声明读取工具，按登记时的 moduleId/contractHash 路由；不猜工具名，不退回内核读取。读取有界且限定栅格图片类型及签名。
- Agent 输入按准入回执绑定真实发起应用；Web 图片文件名保留可信 MIME 对应扩展名，避免模型输入遗漏。未增加文件选择器或宣称新增非图片模型输入能力。
- 构建参考文件直接在授权 cwd 内有界读取，不再复制到共享附件目录。
- 运行输出由 `workspace-local.capture-file` 绑定 Run 与实际接收应用，循 origin 关联交付，不接受伪造接收方或任意跨应用 ref。
- coding 提供 owner 可见的 `read-result`；校验成果名称、哈希、大小、结构及实际发布记录。发行契约生成器保留这个产品工具。
- 未改变真实停止后、释放目录前捕获不可变执行快照的保证。

## 检查与修复

| 检查 | 结果 / 证据（均在 `.tmp/kernel-minimization/`） |
| --- | --- |
| 全量 typecheck | 通过：`stage3-typecheck-final.log` |
| 默认 lint ratchet | 通过，仅保留原有 doctor complexity 警告：`stage3-lint.log` |
| 全量 Bun 测试 | 全量扫描其余文件通过；唯一旧 history 工具清单断言更新后定向 1/1 通过：`stage3-test-bun.log`、`stage3-history-fixed.log` |
| 全量 API 测试 | 其余文件通过；Neovim 实际宿主发现发行生成器遗漏新工具，修复后两项均通过：`stage3-test-api.log`、`stage3-neovim-builder-fixed.log` |
| 浏览器 | 30 项结果（29 张截图），桌面/平板/移动端通过，无 JS/控制台/HTTP 错误和外部请求：`stage3-browser-recheck/results.json` |
| 定向边界 | 应用归属、跨 workspace、symlink/FIFO/路径逃逸、大小、私有上传及下载、旧消息附件、成果不可变性；见 `stage3-reviewed-fixes.log` 及上述重查日志 |

审查发现并修复两处真实缺陷：无扩展名上传导致图片 MIME 丢失，以及旧附件被消息展示窗口截断。浏览器发现用户气泡内下载链接颜色不可见，已修复并复查。全量与定向检查只用临时数据库、假模型和离线 SDK；不调用真实模型、QQ 或外部账号。

## 范围边界

用户选择本轮只修改 Chrona。外部 `agent-workbench.nvim` 仍使用已删除的 `content.read`，其旧成果读取明确不兼容；API 测试证明旧调用失败，并直接经新 `coding.read-result` 验证同一成果。不能将此记录描述为旧客户端完整成果 UI 验收。

旧附件和会话的备份、校验、删除演练与阶段 5 同一清单处理；本阶段未执行既有用户数据删除。用户已将范围限定为本地开发及本地部署，不需要 chino 副本。后续本地部署仍需确认在用数据的处理方式，不以本记录代替数据删除授权。
