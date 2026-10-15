# chrona-steward 0.4.0 (Hermes 0.21.7)

Chrona 已迁移到独立的 QQ 官方机器人「Chrona」。两个机器人使用不同的
app-scoped openid，不能把 Hermes 的身份当作新机器人的身份。

## 行为

- `/chrona`（任意参数）由命令处理器直接返回迁移提示，不进入 Hermes 模型。
- 不读取 config.json 或凭据，不调用 Chrona，不发 RPC，不记录消息 ID。
  无需配置或身份查询；所有调用者仅获得提示，不获得任何服务权限。
- 提示说明本条未做任何更改，请在新机器人私聊中直接发送需求或回复码，
  无需 `/chrona` 前缀。旧通知的回复码仍有效。
- 示例回显参数，移除 Unicode 控制/格式字符，最多 200 字；空参数显示「帮助」。
- 引用带唯一回复码的旧 `【Chrona】` 通知再发 `/chrona 暂后` 等动作，
  仍补上回复码供迁移示例使用，不执行动作。已有回复码不覆盖，多码通知不猜测。
- 普通聊天不改写；仅引用中的 `/chrona` 不触发命令。无模型工具或上下文注入。

## 更新与回滚（操作员执行）

保留 0.3.0 插件目录备份，再将本目录复制到
`<hermes home>/plugins/chrona-steward`，保持 `plugins.enabled` 中已启用。
0.4.0 无需创建或修改原有配置与凭据文件，也不会读取它们。

使用 Hermes 的 Python 热加载，无需重启：

```sh
python3 -c 'from pathlib import Path; from gateway.control_socket import reload_gateway_plugins; print(reload_gateway_plugins(Path.home()/".hermes"))'
```

回滚：恢复 **0.3.0 备份**，再用同一命令热加载。
注意：回滚会恢复旧版读取配置/凭据与调用 Chrona 的行为，需操作员确认旧身份、
权限和服务配置仍适用；不会自动迁移两个机器人的 openid。

## 测试（本插件目录内）

```sh
python3 -m unittest discover -s tests -v
```
