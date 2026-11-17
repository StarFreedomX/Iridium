package join

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kumoSleeping/iridium/internal/remote/executor"
)

// What the person at the terminal reads of a denial: the path with ~, why, and once how to allow it.
func TestDeniedLines(t *testing.T) {
	var out bytes.Buffer
	o := Options{URL: "https://ir.example.com", Out: &out}
	home, _ := os.UserHomeDir()
	o.denied(executor.Denial{What: executor.DeniedPath, Path: filepath.Join(home, "x")})
	o.denied(executor.Denial{What: executor.DeniedShell, By: "会话「a」"})
	o.denied(executor.Denial{What: executor.DeniedSecret, Path: "/k"})
	got := out.String()
	for _, want := range []string{"已拒绝访问 ~/x：不在可访问的文件夹内", "已拒绝执行命令（会话「a」）：命令行未开", "已拒绝访问 /k：密钥和登录信息不提供"} {
		if !strings.Contains(got, want) {
			t.Errorf("no %q in:\n%s", want, got)
		}
	}
	if n := strings.Count(got, "放开："); n != 1 {
		t.Errorf("the hint %d times:\n%s", n, got)
	}
}
