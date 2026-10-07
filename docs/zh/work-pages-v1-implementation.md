# 可持续使用的工作页面 v1 — 实施记录

状态：**本版本地功能完成，2026-09-18；未部署，待用户体验反馈。**
用户批准按 `agent-authored-work-pages-proposal.md` 完成本版本地功能。现有凭据未扩权，仓库 skill 未自动安装到日常 Pi；旧 Provider 改动与 staging 保持。普通用户体验是否足够直观，仍由用户实际使用评价。

## 本版完整范围

- TaskResult 不可变语义版本可附带严格、版本化的声明式页面；独立于 Provider/Plan/Run/Goal。
- 复用 json-render，隔离于 runtime-control 的内容目录：章节、文字、提示、数据表、比较、指标、链接、表单；本地筛选/排序/合计、折叠、条件字段。
- 显式页面读取/编排权限；旧 result/full/work credentials 不自动获得新能力。页面写入默认关闭，验证/预览与发布分离。
- 用户笔记与具体表单版本回答独立持久化；CAS、UUID 幂等、审计、分页与配额。Agent 只读用户输入，不能伪造用户回答。新结果不会覆盖笔记；旧版本回答保留，无自动字段迁移。
- 内容优先的页面、首页/最近工作/新建空白页。日程保持一级入口；目标、执行、审批、任务编辑及既有成果审阅仍可经“更多功能”访问。
- Web 与管理 MCP 接通同一用例；catalog、validate、page_read，新页面仍经 result_submit 发布。仓库 skill、JSON 示例与可执行隔离演示齐备。

## 数据与安全边界

- `TaskResultVersion.content.page` 保存页面/数据/表单定义，不建立平行 Task/Result 系统。
- `WorkPageInput` / `WorkPageCommand` 归属同一 TaskResult；inputRevision 与结果 editRevision 分离。回答固定 versionId/formKey，笔记按稳定 UUID 跨版本持续存在；历史不可变。
- 不开放旧运行 action catalog、任意表达式/JS/HTML/CSS、任意 HTTP endpoint 或 SQL。
- 日程/审批/接受成果是固定产品控件，表单日期与普通选择不能触发领域动作。
- 旧或不支持的页面定义不阻断语义成果读取：返回降级标志与原有摘要；不执行内容，不能把不可呈现内容当作可接受页面。
- 同请求重试保留 UUID/参数；冲突显式读取、对照和确认；关闭事项/关闭写入仍保留只读内容。
- 任意 HTML、AG-UI/A2UI 适配、自动通知/Agent 唤醒、旧 Run 统一和外部成果晋升 Goal 不在本版范围。

完整契约与启动方式：[Work pages](../en/work-pages.md)。

## 执行清单

- [x] 契约、受限 catalog/validator/计算与输入规则及单测
- [x] additive persistence、已知升级路径与历史保持
- [x] 授权/发布/交互/读取/验证应用服务及安全测试
- [x] MCP/HTTP/capabilities/presets；原权限回归
- [x] 真实 renderer、表单/笔记/草稿/版本冲突与安全 fallback
- [x] 内容优先 workspace、日程/高级入口与最近工作导航
- [x] skill、示例、文档、隔离演示数据库
- [x] typecheck、UI/边界/发布检查、单元/API/三尺寸 E2E、构建升级 smoke
- [ ] 仓库整体 lint 全绿：仅两个原有不变文件 ratchet 阻塞，见下；本版新增代码显式 lint 无警告
- [ ] 用户体验反馈，以及单独授权的生产部署/日常 Agent 接入

## 验证结果（2026-09-18）

证据保留在 `~/.local/share/chrona-development/20260918-work-pages/`。

| 检查 | 最终观察 |
| --- | --- |
| typecheck | 通过，包括 E2E TypeScript |
| Vitest | 109 文件 / 818 通过 |
| Bun | 326 文件 / 2297 通过、11 跳过；无重试 |
| API | 66 文件 / 430 通过；与 Bun 存在重叠，不能累加称独立覆盖 |
| 旧功能全量 E2E | 最终重跑 161 通过 / 16 既有跳过；桌面/平板/手机 |
| 页面 E2E | 9/9：真实保存/刷新、独立客户端读、v2 保留笔记和旧回答、创建/草稿导航保护/恢复、安全拒绝；三个尺寸 |
| 事项 E2E | 12/12：会议、来源、改期/取消、未知回执与重试、关闭只读、旧记录接续 |
| 成果 E2E | 最终 12/12：附件/下载/精确版本审阅/历史、失败恢复、关闭状态 |
| 新页面迁移强化测试 | 1/1、90 断言；fixture SHA 固定，所有旧表旧列保持，含接受指针、附件 BLOB/绑定、来源/回执；fresh/upgrade/no-op/FK/integrity/immutable guards |
| UI foundation | 通过 |
| boundaries | 0 errors / 10 既有 engine-test warnings |
| release consistency / diff-check | 通过 |
| 新增页面代码 ESLint | 显式包含 untracked 新文件；0 errors / 0 warnings |
| 整体 lint | 未全绿：`features/schedule/ui/forms/task-config-save.ts`、`packages/engine/src/modules/tasks/manual-task-lifecycle.ts` 原有 ratchet 债务未动 |
| Linux x64 build | 成功；Bun 打印非致命 directory mismatch 诊断，产物及随后 smoke 成功 |
| packaged smoke | fresh/已发布库升级/备份恢复通过 |

### 保留失败记录，不改写历史

旧 `/tmp/chrona-work-pages` 消失，先前 background full-test-3 结果未确认；不将其计为成功。现在使用持久目录。

- 首轮本次 full-test 在 E2E 遇到旧导航断言和开发中 HMR 错误，主动中断，保留 `full-test.log` / `full-test-note.txt`。
- 后续 `full-test-2.log` 的 Vitest/Bun/API 全过，但 E2E 初次为 158 过/3 失败/16 跳过：旧全页面文字定位先匹配到了新侧栏里隐藏的标题。修正为目标主内容区域，保留首页、概览、任务、日程的原业务断言；最终完整重跑见 `legacy-e2e-final.log`，不是把第一次 `bun run test` 写成通过。
- 成果 E2E 初次旧入口“Work results”不可见；更新为内容页“更多 → 成果”，并实际经“执行与任务设置”验证完成/重开。最终12项全过。
- 降级读取新测试曾发现 Zod refined object 不允许 `.omit()`，已改为移除输入中的可选页面后用原 schema 验证，定向及全量后端测试通过。
- demo 首次因 AiClient 委托大小写错误失败；保留失败目录，修正后使用全新 `demo-2`，未 reset/reuse 原目录。

## 可实际试用的本地演示

- 脚本：`scripts/demo-work-pages.ts`，只接受全新目录；重复初始化拒绝。`--serve` 仅监听127.0.0.1:43200/43201，独立 config/DB、无凭据发行、无 provider/执行器。
- 当前演示目录：`~/.local/share/chrona-development/20260918-work-pages/demo-2`。
- 页面：`http://127.0.0.1:43200/zh/tasks/cmu6awfts0000yafz079uy1tx`；服务需仍在运行，停止后可用 docs/en/work-pages.md 中的命令恢复。
- **全部配件/价格/预算/回答均虚构**。已通过 Chrome DevTools 在真实 UI 保存“再等等/9000/先和家里商量”的演示回答及单独笔记，再刷新读取；不是用户实际购买决定。
- SQLite 只读复核：Task Ready/manual，2条输入，0 Provider/Plan/Run/ExecutionSession/Review/WorkBlock。`demo-browser-readback.json` 记录证据。
- 手动浏览器看过桌面与真实390×844顶部；后续手机表单截图两次超时，未换交互浏览器后端、未冒称成功。另有正式 E2E 的1440×900、1024×768、390×844页面/表单截图留在 `page-e2e-artifacts/`，已查看桌面/平板主页面和手机保存表单。E2E 图与手动截图是不同证据。

## 保护范围与交付限制

本次未改线上服务、Nix部署、既有令牌/权限、真实任务/日历/邮件；无commit/push，Git index保持空。保护的 Pi-provider diff 仍为 `a6fc01fa068ef02a71d227517a7e3ecd55f97b68`。

源基线为 HEAD `cca19a55…` 加此前大量未提交成果/事项改动，不是假称干净 release commit。原 `/tmp` baseline 不可再取；最终工作树路径/哈希和验证结果记录在持久证据目录。未来部署需重新冻结来源、备份并演练迁移、明确开启 flags 和按最小权限接入，不将本轮开发授权扩展成生产操作。
