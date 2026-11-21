//go:build darwin && !wails_cgo && !ios && production && !devtools && !server

package application

func (w *macosWebviewWindow) enableDevTools() {}
func (w *macosWebviewWindow) openDevTools()   {}
