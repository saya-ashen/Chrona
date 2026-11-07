# 本机统一模块 V1：最终审查与真实模型验收

日期：2026-11-07。核查起点：`31a726c9c1dc58a7a989a6beca57d573c59d7629`；分支：`platform-v2`。

范围：本机 V1 的集中审查、问题修复、隔离真实模型验收及提交推送。远端 V2、生产部署、私人数据迁移均不在此次范围内。设计与实现边界见[统一模块运行时方案](./unified-module-runtime-plan.md)。

## 审查结论与修复

审查覆盖 Provider 生命周期与 transcript、统一 module-call 路由、持久启动防重放、工作目录分配和清理、成果读取与快照、问答回调及取消恢复。保留内核唯一 Run 队列、授权、事务、预算及停止证据；未引入第二条调度路径。

本轮确认并修复三项缺陷：

1. 服务端 Provider 生命周期包装遗漏可选 `transcript`，导致运行时组合后无法通过统一路由读取历史。现在保留该方法；回归测试穿过真实 runtime 组合与 module router，并断言历史正文不写入 invocation。
2. 成果捕获在识别普通文件之前打开 FIFO，可能无限阻塞。现在以 `O_NONBLOCK | O_NOFOLLOW` 打开后检查文件类型；真实命名管道回归验证及时拒绝。
3. 真实模型的复合工具调用 ID 含 `|`，原先被 Pi detail 的协议 ID 正则静默丢弃。现在在适配器内将不符合协议、过长或含敏感值的 opaque ID 映射为稳定 SHA-256 ID；保留合法且安全的 ID。回归验证 start/end 关联、长 ID 前缀相同仍不碰撞、协议校验和敏感值不外泄。

## 真实模型环境与方法

- 使用现有已配置模型 `krill-ai-codex/gpt-6.1-sol`，Pi `1.5.0`，推理级别 `low`。
- 全新临时 SQLite、临时 Git 项目、独立工作树与专用临时 Pi profile；不连接真实设备或生产数据库。
- 运行实际 Hono HTTP 服务、SDK 模块进程、固定 release 的 coding/editor 模块、统一调用路由、真实 Pi 子进程与模型请求。
- 通过公开 `/api/editor/v1/commands` 执行 `start/get/send/answer/events/changes/results/accept/cancel`。
- 测试扩展仅在 native `write` 写入 `answer.ts` 前调用真实 `ctx.ui.confirm`，确保问答路径可重复触发。没有用假 Provider 代替真实模型。
- 专用服务 launcher 绕开个人交互式 Pi 包装器的启动扩展；模型配置与认证通过已有本地引用使用，验收后移除临时 profile 中的引用。凭据和 launcher 均不进入仓库。

## 已通过的真实场景

| 场景 | 实际断言与结果 |
| --- | --- |
| 编码 | 真实模型在工作树生成 `add`；模型运行检查后，验收程序独立执行 `bun check.ts`，退出码 0 |
| 中途补充指令 | native write 问答待答时，通过 `send` 补充精确注释要求；最终文件包含 `// reviewed through V1 injection` |
| 原生问答 | 公开 `answer` 接口答复真实 RPC confirmation；模型恢复执行 |
| 工具可观测性 | 最终代码重跑记录 3 个 tool start；每个都有相同协议 ID 的 tool end；复合 Provider ID 未丢失 |
| 成果与审阅 | `changes` 完整，成果没有缺失标记；不可变文件快照与实际工作目录一致；显式 `accept` 前后成果字节不变 |
| 启动幂等 | 相同 key 重提返回原 Run；不创建第二次模型执行 |
| 运行中取消 | 观察到真实 native `bash` 后取消；状态为 cancelled，取得真实停止确认 |
| 宿主崩溃与恢复 | 真实 native `bash` 执行中向隔离宿主发 SIGKILL，再用原临时数据库重启 |
| 未知结果防重放 | 重提原 key 仍返回原 Run；等待原租约结束后为 unknown、能力撤销、目录占用保留、没有伪造停止确认；实际启动总数恢复前后均为 5 |
| 成果持久性 | 崩溃恢复后，先前接受的成果与接受状态仍在，成果字节不变 |

最终编码 Run：`dec4ade8-f4a2-4762-8513-4e084085e51f`。其成果 ID：`result-44c79cc1841c6baba17856198359e2cbf1efd18b41056f384464cd313584b4a4`。显式接受由验收程序作为测试 owner 发起，用于检验 API 和持久化语义；不代表真实用户对生产成果的验收。

### 失败与重跑记录

保留全部失败记录，没有将失败轮次计为通过：

- 首轮个人 Pi launcher 导入交互扩展，未进入有效模型执行；改用专用服务 launcher。
- 测试宿主首次未向 Hono 传入 Bun socket bindings，正确触发 loopback 拒绝；补传真实 server 对象，未放宽鉴权。
- 模型拒绝 `minimal` reasoning；改为其实际支持的 `low`。
- 取消脚本最初未持续翻页；修正游标后继续定位，确认另有复合工具 ID 被丢弃的产品缺陷。缺陷修复前，两次目标任务正常完成，未计作取消成功。
- 修复适配器后，取消与崩溃恢复通过；随后再以最终代码跑完整编码、问答、指令注入、工具事件、成果与接受闭环通过。
- 一次宽路径定向测试误选旧 `dist` 测试；改为明确源码路径执行，不计入有效回归结果。

## 自动化与发行检查

- `bun run typecheck`、`bun run lint`（ratchet）、`bun run check:boundaries` 通过。
- 明确源码路径的定向回归：40 pass、1 skip、0 fail；覆盖 runtime/history、local runtime、transcript 与 Pi provider。
- 完整 Bun：1447 pass、7 skip、0 fail。
- 完整 API：65 pass、3 skip、0 fail。
- 最终源码重新编译 Linux x64 二进制并准备发行资源；ELF、模块资源及模块类型检查通过；使用隔离 fresh SQLite 启动真实服务并完成 HTTP smoke，`runtime: true`。
- 构建制品：`/tmp/chrona-v1-review-20261107/release/chrona-linux-x64/`。上述结果是本机开发与隔离验收结果，不是公开发行或生产部署。
- 检查保留既有环境 skip；不将 skip 计为通过。首次定向测试的旧 `dist` 误选失败及修复前的真实验收失败均单独保存。

本地原始证据：`/tmp/chrona-v1-review-20261107/`，包括 `evidence.json`、验收脚本、各轮日志、定向与全量测试日志、构建及 smoke 日志。该目录是本机临时证据，不是仓库随附资源；迁移机器或清理 `/tmp` 后不可依赖它。

## 验收边界

以上验证本机 `trusted-local` 与单个已配置模型路径。没有据此宣称远端 V2、多 Provider、多操作系统、生产部署或 required-isolation 的真实环境验收完成。真实子进程执行和恢复通过，不等于租约过期可以推断进程已停止：未知操作仍保留目录占用，等待可信停止证据或人工处理。
