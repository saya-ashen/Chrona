# v2-30 规格：把凭据交给外部工具

状态：§2–§3 已实现，2026-11-02 随 0.8.34 部署；§4 OAuth 托管 2026-11-02 随 0.8.35 部署。依赖 [v2-16](platform-v2-16-module-secrets-requests.md)（凭据存储与 `secrets.get`）、[v2-6](platform-v2-6-packages.md)（系统程序 `packages`）。

## 1. 背景

模块开始调用成熟的命令行工具（例如用 himalaya 访问任意 IMAP 邮箱），这些工具从环境变量、密码命令、配置文件或系统 keyring 读取凭据。v2-16 只给出 `secrets.get`，模块要么自己把密码写进数据目录的配置文件，要么放弃这类工具。写进数据目录会让凭据跟着版本数据、备份和构建检查走，并绕过设置页的替换与删除。

同日取消了每个模块最多声明 5 个凭据的上限（v2-16 §2）。

## 2. 规则

1. **凭据只存一处**：Chrona 凭据库（`<dataDir>/secrets`，v2-16）。模块不得把凭据值写入 `chrona.paths.data`、`chrona.paths.content`、日志、工具结果或模型提示。
2. **非敏感配置归模块**：工具的服务器、端口、用户名等配置文件放在 `chrona.paths.data`，其中的密码项写成从环境变量或文件读取（例如 himalaya `backend.auth.cmd = "printenv MAIL_PASSWORD"`）。
3. **按工具读取方式交付，只交给本次子进程**：
   | 工具读取方式 | 交付方式 |
   |---|---|
   | 环境变量、密码命令 | `secretEnv`：只写入该子进程的环境变量 |
   | 必须读文件（服务账号 JSON、私钥、kubeconfig） | `secretFiles`：内存盘上的临时 0600 文件，路径经环境变量传给子进程，子进程结束即删除 |
   | 只认系统 keyring | 不支持。几乎所有支持 keyring 的工具也支持命令、环境变量或文件，改用上两行 |
   | OAuth | `tokenEnv`：内核刷新后的短期 access token（§4） |
4. 子进程输出中出现的、本次交给它的凭据字段值替换为 `[redacted]` 后才返回给模块（未交出的字段如用户名、服务器可正常出现在输出中）；截断发生在替换之后，被截断处不会漏出凭据的前半段。
5. 环境变量对同一用户的其他进程可见（`/proc/<pid>/environ`）。未隔离运行时模块本就以 Chrona 用户身份运行，不构成新的暴露面；隔离运行时进程彼此不可见。

## 3. SDK：`chrona.exec`

```ts
const result = await chrona.exec("himalaya", ["-o", "json", "envelope", "list"], {
  secretEnv: { MAIL_PASSWORD: { secret: "mail_qq", field: "password" } },
  secretFiles: { GOOGLE_APPLICATION_CREDENTIALS: { secret: "gcp", field: "json" } },
  env: { HIMALAYA_CONFIG: `${chrona.paths.data}/himalaya.toml` },
  cwd: chrona.paths.data, stdin: "", timeoutMs: 60_000, maxOutputBytes: 1_048_576,
});
// { code: number | null, signal: string | null, stdout: string, stderr: string, timedOut: boolean, truncated: boolean }
```

- 凭据经 `secrets.get` 取得（模块须在清单 `secrets` 声明；未声明 `forbidden`，未配置 `unavailable`，构建与测试期间 `unavailable`，测试中用 `stubs.secret`）。同一次调用内每个凭据只取一次。所引用的字段不存在时不启动子进程，拒绝并说明凭据名和字段名，不含任何值。
- 子进程环境：模块自身环境（内核已只保留 `PATH`/`HOME`/`LANG`/`CHRONA_*`）+ `env` + 凭据变量；不经 shell，参数按数组传递。
- `secretFiles`：在 `/dev/shm`（不存在时用系统临时目录）建 0700 目录、写 0600 文件，变量值为文件路径；子进程结束、超时或启动失败后都删除目录。隔离运行时该目录在沙箱自己的内存盘上，随沙箱消失。
- 超时（默认 60 秒）结束整个子进程；`stdout`、`stderr` 各自超过 `maxOutputBytes`（默认 1 MiB）时截断并置 `truncated`。
- 系统程序本身按 v2-6 声明 `packages`。

## 4. OAuth 托管

2026-11-02 用户决定由内核托管（`mail` 需要 Gmail 与 Outlook）。内核负责授权与刷新，模块只拿短期 access token；刷新令牌不离开内核。

### 4.1 凭据格式

OAuth 凭据是普通凭据（v2-16），字段：

| 字段 | 谁写 | 说明 |
|---|---|---|
| `clientId`、`clientSecret` | 用户在设置 → 凭据填写 | 用户在 Google Cloud / Microsoft Entra 注册的应用；`clientSecret` 对公共客户端可省略 |
| `refreshToken`、`refreshToken_<account>` | 内核（授权回调、令牌轮换） | 同一应用可授权多个账户：带 `account` 时用后者 |
| `scope`、`scope_<account>` | 内核 | 授权所得范围 |

已有的 `gmail_oauth`（`clientId`/`clientSecret`/`refreshToken`）符合此格式，无需迁移。内核写过的凭据带 `oauthManaged` 标记，此后 `secrets.get` 不返回其中的 `clientSecret` 与 `refreshToken`；`refreshToken_<account>` 只由内核写，始终不返回。用户自己填写、内核未写过的凭据照旧完整返回（现有 `gmail` 模块自行刷新，迁移前依赖这一点）。用户在设置页替换凭据即去掉标记。`account` 为 1–30 位小写字母、数字、下划线，首位字母。

### 4.2 提供方

内核固定两家，模块不能指定端点：

- `google`：授权 `https://accounts.google.com/o/oauth2/v2/auth`（加 `access_type=offline`、`prompt=consent`），令牌 `https://oauth2.googleapis.com/token`。
- `microsoft`：授权 `https://login.microsoftonline.com/common/oauth2/v2.0/authorize`，令牌 `…/common/oauth2/v2.0/token`；范围自动加 `offline_access`。

### 4.3 授权：`secrets.authorize`

- `secrets.authorize({ name, provider, scopes, account? })` → `{ url, redirectUri, expiresAt }`。调用方须在清单 `secrets` 声明 `name`（入口模块可授权任何凭据）；凭据里须已有 `clientId`；须设置 `CHRONA_PUBLIC_URL`。
- 授权码流程 + PKCE（S256）；`state` 为 32 字节随机数，只在内存，10 分钟内一次有效，最多 20 个待完成。
- `redirectUri` 固定为 `<CHRONA_PUBLIC_URL>/oauth/callback`，用户须在提供方的应用里登记这一地址（Google 选“Web 应用”类型；“桌面应用”类型只接受回环地址）。
- 回调 `GET /oauth/callback` 由内核处理、不经 API key（浏览器从提供方跳回，凭 `state` 认人）：用授权码换令牌，把刷新令牌与范围并入该凭据，审计 `secret_set`（只记名字），页面显示“已授权，可关闭”。用户拒绝或失败只显示原因类别。
- 链接经工具结果交给用户；模块不得替用户打开。授权页显示应用名与范围，由用户在提供方页面确认。

### 4.4 令牌：`secrets.token`

- `secrets.token({ name, provider, account? })` → `{ accessToken, expiresAt }`。调用方须声明 `name`；参数与结果不进调用记录。
- 内核在内存缓存 access token 至过期前 60 秒（按凭据、账户、提供方区分，最多 200 条）；同一令牌的并发请求只刷新一次；写回前重读凭据，期间被替换或删除则不写；凭据被替换或删除后不再使用旧缓存。提供方返回新的刷新令牌时（Microsoft 会轮换）写回凭据。
- 刷新令牌缺失或被拒（`invalid_grant`）报错误码 `reauthorize`，信息提示调用 `secrets.authorize` 重新授权；网络或提供方故障报 `unavailable`。构建与测试期间 `unavailable`。

### 4.5 交给外部工具

`chrona.exec` 增加 `tokenEnv: { VAR: { secret, provider, account? } }`：经 `secrets.token` 取 access token 放入子进程环境变量，并与 `secretEnv` 一样从输出中替换为 `[redacted]`。例如 himalaya：`imap.sasl.xoauth2.token.command = ["printenv", "MAIL_TOKEN"]`，或 Gmail / Microsoft Graph 后端的 `gmail.auth.token.command`、`msgraph.auth.token.command`。

## 5. 验证

- `secretEnv` 只进入子进程环境，模块进程环境不变；未声明、未配置、字段缺失时不启动子进程且错误不含值。
- `secretFiles` 文件权限 0600、目录 0700，子进程正常结束、非零退出、超时后目录均不存在。
- 输出中的凭据值被替换为 `[redacted]`；超时结束子进程并置 `timedOut`；超长输出截断并置 `truncated`。
- OAuth：未声明的凭据不能授权或取令牌；`state` 一次有效、过期与伪造被拒；回调把刷新令牌并入凭据而不覆盖 `clientId`；缓存命中不再请求提供方；轮换的刷新令牌写回；`invalid_grant` 报 `reauthorize`；`tokenEnv` 的值被替换。
