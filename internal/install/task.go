package install

import (
	"bytes"
	"encoding/binary"
	"encoding/xml"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf16"

	"github.com/kumoSleeping/iridium/internal/config"
)

// TaskXML is the Task Scheduler task that runs exe serve -config configPath at user's logon: in
// the user's session with the user's own environment, never stopped for running long (the
// default stops a task after three days) nor on battery, started again a minute after a crash.
func TaskXML(exe, configPath, user string) string {
	esc := func(s string) string {
		var b bytes.Buffer
		_ = xml.EscapeText(&b, []byte(s))
		return b.String()
	}
	return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Iridium (written by iridium install)</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>` + esc(user) + `</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>` + esc(user) + `</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>` + esc(exe) + `</Command>
      <Arguments>` + esc(`serve -config "`+configPath+`"`) + `</Arguments>
    </Exec>
  </Actions>
</Task>
`
}

// utf16File is s as schtasks /XML reads it: UTF-16LE with its byte order mark, CRLF lines.
func utf16File(s string) []byte {
	u := utf16.Encode([]rune(strings.ReplaceAll(s, "\n", "\r\n")))
	b := make([]byte, 2+2*len(u))
	binary.LittleEndian.PutUint16(b, 0xFEFF)
	for i, c := range u {
		binary.LittleEndian.PutUint16(b[2+2*i:], c)
	}
	return b
}

// installTask is Install on Windows: the task o.Unit, run at once with Now, else at the next
// logon. A task has no environment of its own: Env and Path are the user's.
func installTask(o Options, cfg config.Config) error {
	if o.User == "" {
		return fmt.Errorf("install: no user to run the task as")
	}
	if len(o.Env) > 0 {
		fmt.Fprintf(o.Out, "注意：任务计划没有自己的环境变量，%s 不生效；在用户环境变量里设置。\n", strings.Join(o.Env, " "))
	}
	file := filepath.Join(cfg.StatePath(), o.Unit+"-task.xml")
	if err := os.WriteFile(file, utf16File(TaskXML(o.Exe, o.ConfigPath, o.User)), 0o600); err != nil {
		return err
	}
	fmt.Fprintf(o.Out, "写了 %s：%s serve，状态在 %s。\n", file, o.Exe, cfg.StatePath())
	if o.Schtasks == nil {
		return nil
	}
	if err := o.Schtasks("/Create", "/TN", o.Unit, "/XML", file, "/F"); err != nil {
		return fmt.Errorf("schtasks /Create: %w", err)
	}
	if o.Now {
		if err := o.Schtasks("/Run", "/TN", o.Unit); err != nil {
			return fmt.Errorf("schtasks /Run: %w", err)
		}
		fmt.Fprintf(o.Out, "已启动（任务计划程序里的 %s）。\n", o.Unit)
		return nil
	}
	fmt.Fprintf(o.Out, "下次登录时启动；现在启动：schtasks /Run /TN %s\n", o.Unit)
	return nil
}
