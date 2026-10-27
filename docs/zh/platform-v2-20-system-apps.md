# v2-20 规格：系统应用

状态：已实现（2026-10-27），未部署；用户已确认范围。依赖 [v2-18](platform-v2-18-activity.md)、[v2-19](platform-v2-19-reflection.md)。

## 1. 背景

系统模块（chat、approvals、modules、settings、schedules、provider、secrets、activity、reflection）是内核代码的一部分，启动时在进程内注册，不在模块表里。网页的“应用”只读模块表，所以它们从不出现；v2-19 的反思做了什么、怎么判断的，网页上看不到。

系统模块不该有版本、构建或停用（构建永远改不到信任根），但应该能被看见。

## 2. 内核

- `SystemModule` 增加 `description`（给用户看的一句话）和可选 `sessions`（它工作时使用的会话来源；reflection 为 `reflect`）。
- 新工具 `modules.system({ module? })`，只读，仅网页和 MCP 可调用：
  - 不带 module：全部系统模块的名称、说明、会话来源、工具（名称、说明、谁能调用）；
  - 带 module：另附最近 20 个工作会话（id、标题、状态、时间），过程用现有 `chat.transcript` 读。
- 活动记录：反思相关的两类记录归到 `reflection` 名下，并带 `session: { id, source }`——“反思了一次”指向反思会话，“开始构建”指向构建会话。“开始构建”的句子里写出涉及的模块。
- MCP 新增 `chrona_system_apps`。

## 3. 网页（内置 web）

- 应用页在普通应用下方列出“系统”，注明“Chrona 自身的一部分，随 Chrona 版本更新，只能查看”。
- `/apps/system/<name>`：说明；最近的工作（每项可展开过程）；最近活动；提供的工具及谁能调用。没有版本、构建、停用入口。
- 活动行带会话时显示“查看过程”：构建会话打开构建页；其他（反思）打开所属系统应用页并展开该次过程（`?session=`）。
- 线上运行的是定制 web，需另经构建合并。

## 4. 同版附带（v2-19 修正）

反思的事实摘要加入最近 60 天的构建记录，见 v2-19 §4。

## 5. 不在本版

- 系统模块的运行状态、调用量统计。
- 把系统模块混进 `modules.list`（其结构是版本与进程，保持不变）。
