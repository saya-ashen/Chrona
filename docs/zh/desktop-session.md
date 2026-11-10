# 本地桌面应用的宿主会话

普通应用可以在 `trusted-local` 模式下启动宿主已安装的桌面程序。应用仍使用现有模块入口、认证 IPC 和进程后代监督；不需要新增内核工具或 Manifest 字段。桌面窗口出现在 **Chrona 运行账号所在的本机图形会话**，不会出现在远程 Web 访问者的电脑上。

## Linux 环境传递范围

模块启动器只从 Chrona **宿主进程自身的环境**读取以下非空值，并原样传入子进程：

| 变量 | 用途 |
| --- | --- |
| `DISPLAY` | X11 / XWayland 显示连接 |
| `WAYLAND_DISPLAY` | Wayland 显示 socket 名称或路径 |
| `XAUTHORITY` | X11 认证文件路径 |
| `XDG_RUNTIME_DIR` | Wayland 等用户会话 socket 所在目录 |
| `DBUS_SESSION_BUS_ADDRESS` | 当前用户会话 D-Bus 地址 |

缺失或空值不会被补造；没有图形会话时，普通无窗口应用及一次性作者测试仍可运行。桌面应用应自行检查依赖并报告无法连接显示服务等错误。变量存在仅说明已传递连接信息，不证明显示服务、认证、D-Bus 或工具包实际可用。

这些会话变量不能由模块的 `env` 扩展覆盖，宿主缺失时也不能由扩展注入。扩展继续只接受既有 `CHRONA_` 命名范围，保留 `CHRONA_SOCKET`、`CHRONA_HTTP_SOCKET`、`CHRONA_IPC_ENDPOINT`、`CHRONA_IPC_TOKEN` 的限制；认证 IPC 地址与凭据来自受信任的启动参数。宿主的其他 `CHRONA_` 环境变量也不会因此自动传递。既有 `HOME`、受控的 `PATH` / `LANG` 及 Windows 基础环境处理保持原状；Linux 的这五项不会在 macOS 或 Windows 上新增传递。

不会整体复制宿主环境，也不会额外转发 `SSH_AUTH_SOCK`、`XDG_SESSION_TYPE`、`GDK_BACKEND`、工具包配置或 API 密钥。需要额外变量的程序应先说明具体需求，再单独评估；不要通过扩大到全部 `XDG_*`、`DBUS_*` 或全部环境来解决。

## 从桌面会话启动

在已登录桌面的终端中，以同一普通用户启动 Chrona。源码开发可在仓库根目录运行 `bun run server:start`；打包版本使用 `chrona start --no-open`（参见[运维说明](operations.md)）。启动时继承到 Chrona 宿主的上述变量，才会传给后续模块；从纯 SSH、系统服务或没有图形会话的终端启动不会自动获得本地桌面连接。

桌面程序、所需解释器与图形工具包须已安装，运行账号须能访问相应 socket 和认证文件。不要硬编码其他用户的 `/run/user/...`、伪造 `DISPLAY=:0` 或使用 `xhost +` 绕过认证。

## systemd 用户服务

`systemd --user` 管理器有独立的环境，不一定持有当前桌面终端的值。修改终端环境或导入管理器环境都不会改变已经运行的 Chrona 进程。优先由桌面登录流程启动服务，或让桌面登录流程在启动服务前导入下面这组明确命名的变量。

以下是供用户自行配置的 **Bash 示例**，应在目标桌面会话的终端中执行。它先清除管理器里这五项的旧值，再只导入当前终端实际存在的非空值；没有参数时绝不调用 `import-environment`，以免导入全部环境：

```bash
session_vars=(DISPLAY WAYLAND_DISPLAY XAUTHORITY XDG_RUNTIME_DIR DBUS_SESSION_BUS_ADDRESS)
present_vars=()
for name in "${session_vars[@]}"; do
  if [[ -n "${!name:-}" ]]; then
    present_vars+=("$name")
  fi
done
systemctl --user unset-environment "${session_vars[@]}"
if (( ${#present_vars[@]} > 0 )); then
  systemctl --user import-environment "${present_vars[@]}"
fi
```

这会修改用户管理器的环境，影响之后启动的用户服务；只在用户选定的桌面会话中操作。随后由用户按自己的服务配置决定何时启动或重启 Chrona。服务若通过 `Environment=`、`EnvironmentFile=` 或包装脚本覆盖或清除这些变量，还需同步检查那些配置。不要无参数执行 `systemctl --user import-environment`，也不要整体导入 shell 环境或写入凭据。多桌面会话时，单个用户管理器不能为同一个服务自动选择每个显示器；最后导入的值应对应用户选择的会话。退出登录、重新登录或启用 linger 后，仍需重新确认会话是否有效。

2026 年 11 月 10 日 12:53（UTC+8），用户授权将实现部署到本地 3112。部署没有修改用户管理器全局环境，而是为 `chrona-kernel-preview.service` 写入专属 `50-desktop-session.conf` drop-in，配置当前会话实际存在的四项变量并清除缺失的 `XAUTHORITY`。冷备份后重启服务，已验证服务和受监督应用进程实际继承对应值。配置记录的是本次桌面会话，重新登录或更换桌面后仍需重新确认。详见[部署验收记录](desktop-applications.md)。

## 停止与验证边界

会话传递沿用既有监督启动路径。模块停止、超时或退出后，启动器仍要求确认其进程后代已经停止；停止证据不明时不能当作成功释放。桌面程序若把打开窗口请求交给已存在的独立进程，那个既有进程不属于本次模块创建的后代，不能据此承诺关闭其窗口。

离线回归通过真正启动的脚本与显式解释器入口读取环境，覆盖 X11、Wayland / XWayland、缺失和空会话、会话与 IPC 覆盖拒绝、其他宿主环境过滤，以及脱离进程组的后代清理；另有无会话的一次性脚本验证。测试使用临时目录和合成连接值，不连接真实显示服务、D-Bus 或外部网络。因此它证明环境与生命周期边界，不证明真实窗口能打开、实际桌面工具包可用、systemd 配置已生效或跨平台桌面验收完成。
