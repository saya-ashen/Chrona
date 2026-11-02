# v2-29 规格：内容引用与工具结果收敛

状态：已实现（2026-11-01），未部署。

## 1. 背景

Pi 工具桥将工具结果截断到 30,000 字符，大文件不适合经工具结果内联传输。
图片生成曾被迫拆成 6 KB 分块读取；线上已观察到 `m_modules_reference` / `m_modules_list` 输出被截断 30 次。
本次用内容引用传递文件，缩小默认索引，并让截断提示给出下一步。

## 2. 内容引用

- 格式：`<module>/<path>`，例如 `images/generated/result.png`。
- 引用指向应用的内容目录，不暴露内核或应用的私有数据目录。
- `chat/<file>` 指向会话附件；路径解析检查目录包含关系，不能越界。
- 应用返回引用而不是把大文件编码进普通工具结果。

## 3. 系统工具 `content.read`

- 调用：`content.read({ ref })`；模块与所有者可调用。
- 调用模块必须在 manifest `uses` 中声明 `content.read`，随版本展示并审批。
- 单文件上限 10 MiB；不存在、越界或超限时失败。
- 返回 `{ ref, name, mime, bytes, sha256, base64 }`，其中 `sha256` 校验文件内容。
- 标记为 `unrecorded`，不把大段 base64 留在工具调用记录中。
- 此工具用于明确需要读取字节的调用方，不用分块拼接绕过大小限制。

## 4. 回复附件

- `chrona_reply` 的 `files` 接受 `content/<module>/<path>`。
- 内核读取引用并存为会话附件，再沿现有回复路径交给入口。
- 单文件上限 20 MiB；保留原有工作目录文件附件方式。
- Provider 无需先把文件 base64 读进上下文再写回磁盘。

## 5. 索引与截断提示

- `m_modules_reference` 不传 `target` 时，仅返回 `{ target, source, description }` 索引。
- 需要精确契约时指定 `target`，不再默认返回全部契约正文。
- Provider 的 `modules.list` 每个应用只返回最新 5 个版本，并附 `versionCount` 总数。
- 非 Provider 调用方仍得到完整版本列表；输出契约中的 `versionCount` 为可选整数。
- 工具桥仍保留 30,000 字符截断，但提示现在注明结果总长度及如何缩小查询。
- 内容引用不改变模块间仅经路由调用交互的边界，也不增加外部发送路径。
