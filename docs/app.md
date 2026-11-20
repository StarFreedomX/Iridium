# ir-app 桌面客户端

`app/`（2026-11-20 起，原型）：Iridium 的桌面客户端。一个窗口打开 Iridium 的网页，同时把这台电脑接入（同 `ir-computer`，代码是 `internal/join`），一个程序。用 Wails v3（Go），Mac、Linux 走 purego 后端：不用 cgo，三个系统都在 Linux 上交叉编译。单独的 Go 模块（`app/go.mod`，`replace` 到上层），根目录的 `go test ./...` 不碰它。

以后电脑优先用它接入；`ir-computer` 和一行命令先保留（用户，2026-11-20）。

## 组成

- 窗口：系统自带的网页引擎（Mac WKWebView、Windows WebView2、Linux WebKitGTK）直接打开服务器地址，网页不打包。关窗口留在托盘。只跑一份：再次打开就显示已有的窗口。
- 托盘：每个服务器一项（状态、在窗口中显示、接入这台电脑、移除），添加服务器、登录时打开、检查更新或重启以更新、退出。
- 接入：列表里开着的服务器各一条执行端连接，握手里 `program` 是 `ir-app <版本>`。TOKEN 和 `ir-computer` 共用（同一目录），已配对的不用再配；同一服务器同时只有一个在跑（锁）。
- 无头：`ir-app headless [--name] [--roots] [--no-shell] [地址…]`，给没有屏幕的机器。不加载图形库。

## 安全

- 这台电脑能做什么由这里定（`app.json` 和启动参数），服务器只能请求。
- 服务器请求放开时，窗口版弹本机对话框（允许、拒绝，不放进网页）；无头版在它的终端里问，没有终端（服务）就拒绝。
- 网页和应用之间：网页 `window._wails.invoke("…")`，应用按消息的来源处理，只认列表里服务器的来源（协议、主机、端口都对上）；地址页只认 `ir:add:`。回给网页的是事件 `ir-app`（网页先发 `wails:runtime:ready` 才收得到）。现在只有 `ir:hello` → `{app, version}`。网页里没有任何放开权限的口。
- 内嵌网页里没有 Passkey（Linux WebKitGTK、未签名的 Mac）：登录改在系统浏览器里做，下一步。

## 更新

和服务器分开发版：只有应用自己变了才发（`app-v0.1.0` 这类版本）。

- 清单 `update.json`：`app`（`ir-app`）、`version`、每个系统的文件（`os`、`arch`、`url`、`size`、`sha256`），整份用应用的 ed25519 私钥签名，签名在 `update.json.sig`（base64）。版本号也在签名里，旧版冒充不了新版。
- 公钥构建时写进程序（`-X main.updateKey`），没有公钥的构建不更新。私钥只在发版的地方（`IR_APP_SIGN_KEY`）。
- 先问列表里每个服务器的 `/app/update.json`（服务器代理 GitHub，还没做），再问 GitHub 的 release `app`（每次发版替换它的文件）。启动时查一次，之后每 6 小时。
- 窗口版：新版下载、校验后放好，托盘出现“重启以更新到 x”，点了才换（正在跑的 agent 会结束）。换的是 Wails 自带的（Mac 换整个 .app）。
- 无头版：校验后替换自己的文件，下次启动生效（服务重启、开机），不自己重启。
- 安卓（以后）：下载 APK 后交给系统安装器（`PackageInstaller`），要用户点安装。

## 构建

`scripts/app-build.sh <版本> <目录>`：`ir-app-linux-<arch>`、`ir-app-windows-amd64.exe`、`ir-app-darwin-<arch>.zip`（Iridium.app）；有 `IR_APP_SIGN_KEY` 时再出清单和签名。密钥 `cd app && go run ./release keygen`。大小：Windows 13MB，Mac 约 19MB（zip 9MB），Linux 20MB（含 `ir` 命令行）。

## 还没做

- 系统浏览器登录（一次允许，网页登录和配对一起）。
- 服务器的 `/app/update.json` 代理、电脑列表里的“应用”标志、CI 发版。
- 截屏、键鼠（`screen.*`、`input.*`），本机规则的设置界面和记录，TOKEN 进钥匙串。
- Windows 图标资源、Mac 签名公证。空闲时自动重启更新。
