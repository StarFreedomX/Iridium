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
- 页面要放宽什么（接入、命令行、全部文件夹、添加服务器）都要本机对话框确认；收窄直接生效；加文件夹用本机的文件夹选择框（选了就是允许）。权限按服务器各一份。

## 登录（2026-11-20）

内嵌网页里没有 Passkey（Linux WebKitGTK、未签名的 Mac），在系统浏览器里登录（`internal/webapp/applogin.go`）：

1. 应用窗口停在登录页时，页面认出应用（`window._wails`，等事件 `wails:runtime-config-ready`），按钮换成“在浏览器中登录”。
2. 应用自己生成一个密钥，把它的 SHA-256 发给 `POST /_ir/api/app/start {name, verifier}`，拿到 `{id, code, url}`；页面显示代码，系统浏览器打开 `/_ir/app?id=…`。
3. 浏览器里用 Passkey 登录（已登录就跳过），看到“「电脑名」上的 Iridium 应用请求以你的身份登录”和代码，核对后允许或拒绝。
4. 应用轮询 `POST /_ir/api/app/poll {id, secret}`，允许后拿到一次性凭证（2 分钟），窗口打开 `/_ir/app/finish?ticket=…`，这边给这个窗口一个同一登录的会话，回到首页。
5. 请求 10 分钟过期，只在内存；同时待批最多 50 个。只看到浏览器地址栏里的 id 拿不到任何东西。

## 右上角

应用里的网页顶栏右上角（`web/src/appkey.tsx`，浏览器里不出现）一个键，弹出：服务器（切换、添加、移除；添加时先查 `/_ir/health`，不是 Iridium 不加）、这台电脑对这个服务器的接入/命令行/文件夹、应用自己（登录时打开、版本和更新）。网页和应用之间：`ir:hello`、`ir:switch:`、`ir:add:`、`ir:remove:`、`ir:set:{json}`、`ir:pickroot`、`ir:autostart:`、`ir:update:check|restart`、`ir:login`，回的是事件 `ir-app`（整个状态，或 `error`、`notice`、`code`）。

## 更新

和服务器分开发版：只有应用自己变了才发（`app-v0.1.0` 这类版本）。

- 清单 `update.json`：`app`（`ir-app`）、`version`、每个系统的文件（`os`、`arch`、`url`、`size`、`sha256`），整份用应用的 ed25519 私钥签名，签名在 `update.json.sig`（base64）。版本号也在签名里，旧版冒充不了新版。
- 公钥构建时写进程序（`-X main.updateKey`），没有公钥的构建不更新。私钥只在发版的地方（`IR_APP_SIGN_KEY`）。
- 先问列表里每个服务器的 `/app/update.json`（服务器代理 GitHub，还没做），再问 GitHub 的 release `app`（每次发版替换它的文件）。启动时查一次，之后每 6 小时。
- 窗口版：新版下载、校验后放好，托盘出现“重启以更新到 x”，点了才换（正在跑的 agent 会结束）。换的是 Wails 自带的（Mac 换整个 .app）。
- 无头版：校验后替换自己的文件，下次启动生效（服务重启、开机），不自己重启。
- 安卓（以后）：下载 APK 后交给系统安装器（`PackageInstaller`），要用户点安装。

## 构建

Mac 的 .app 必须整个签名（临时签名，不用 Apple ID）：只有 Go 链接器给程序的那个签名、Info.plist 和资源没封装时，下载来的会被说成“已损坏”，设置里也打不开（2026-11-20 实测）。整个签了以后是“无法验证开发者”，系统设置 → 隐私与安全性里能“仍要打开”。脚本在有 `codesign`（Mac）或 `rcodesign` 的机器上签，都没有就警告：发版要在 Mac 上（CI 的 macOS 机器）打包。

`scripts/app-build.sh <版本> <目录>`：`ir-app-linux-<arch>`、`ir-app-windows-amd64.exe`、`ir-app-darwin-<arch>.zip`（Iridium.app）；有 `IR_APP_SIGN_KEY` 时再出清单和签名。密钥 `cd app && go run ./release keygen`。大小：Windows 13MB，Mac 约 19MB（zip 9MB），Linux 20MB（含 `ir` 命令行）。

## 还没做

- 浏览器登录时顺带完成执行端配对（现在登录后网页里还要再批一次配对卡片）。
- 弹窗里的通知、密钥存储（TOKEN 进钥匙串）。
- 服务器的 `/app/update.json` 代理、电脑列表里的“应用”标志、CI 发版。
- 截屏、键鼠（`screen.*`、`input.*`），本机操作记录。
- Windows 图标资源、Mac 签名公证。空闲时自动重启更新。

## 应用自己的页面（2026-11-20）

- 登录页等应用本地的页面写在 `web/src/appwin`，用网页同一套样式和组件（`IrMark`、Base UI 菜单），`npm run build:app` 构建到 `app/assets/ui`（不进 git，`scripts/app-build.sh` 先构建）。服务器用 ir 的弹出菜单选，菜单里“添加服务器”；不用系统下拉框。
- Mac 上这个无 cgo 的网页视图里 ⌘V 不进输入框（粘贴事件到了页面，但不写进去）：应用页面的输入框自己处理 ⌘C/⌘X/⌘V/⌘A，经应用读写剪贴板（`ir:clipboard`、`ir:copy:`，只认应用自己的页面）。服务器网页里的输入框还没处理。
