# Wails v3.1.0，Iridium 的副本

github.com/wailsapp/wails/v3 v3.1.0 中 Iridium 用到的包（三个系统的纯 Go 后端），根 `go.mod` 用 `replace` 指到这里。没有测试、示例、命令行工具，也没有 cgo 后端的 C 和 Objective-C 文件。

## 改动

- **Linux 图形库晚加载。** GTK4 和 WebKitGTK 在创建应用时（`appNew`）才加载，不在 `init` 里。原来链接了 Wails 的程序一启动就加载图形库；Iridium 的服务、托管进程、`ir` 都是同一个程序，不能这样。NVIDIA 的 DMA-BUF 判断一起挪过去。见 `pkg/application/linux_purego.go` 的 `loadLinux`。
- **纯 Go 后端是默认的。** 原来要 `-tags purego`。所有 `//go:build` 行里 `!purego` 换成 `wails_cgo`，`purego` 换成 `!wails_cgo`；cgo 后端（`-tags wails_cgo`）编不了。这样 `go build`、`go test ./...` 不加标签、开不开 cgo 都能编。
- **macOS 隐藏标题栏的双击。** 隐藏标题栏后顶上那一条只能拖动，双击没反应。改成按系统设置（「双击窗口标题栏以」：缩放、最小化、无，`AppleActionOnDoubleClick`）缩放或最小化。见 `pkg/application/application_darwin_purego.go` 的 `titleBarDoubleClick`。
- **macOS 网页视图透明是默认的。** 原来要 `-tags private_mac_apis`，不加时 `wailsPrivateSetWebviewTransparent` 是空的：透明窗口（右上角弹窗、权限请求面板）整块是白的（kumo，2026-11-22）。`mac_private_api_darwin_purego.go` 改成默认编入，要只用公开接口加 `-tags public_mac_apis`。
- **macOS 隐藏标题栏右端留给页面。** `MacWindow.InvisibleTitleBarClearRight`：顶上那条右端这么宽的一段不拖窗口，按下去交给页面（Iridium 的键画在那里）。

## 升级

换新版时重新复制：三个系统上 `go list -tags purego -deps ./cmd/iridium` 列出的 `wailsapp` 包（不要 `_test.go`），加上其中只有资源的子目录（`internal/assetserver/defaults`、`pkg/application/assets`、`pkg/updater/assets`），删掉 `.c`、`.m`、`.h`，再做上面几处改动。
