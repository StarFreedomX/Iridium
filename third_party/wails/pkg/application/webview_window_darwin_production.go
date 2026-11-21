//go:build darwin && !ios && production && !devtools && !server && wails_cgo

package application

func (w *macosWebviewWindow) enableDevTools() {}
func (w *macosWebviewWindow) openDevTools()   {}
