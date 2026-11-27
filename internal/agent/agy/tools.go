package agy

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"path/filepath"
	"strconv"
	"strings"
	"unicode/utf8"
)

// names are agy's tools by the names the page knows (Claude's, pi's): seen in agy 1.5.9's
// run_command, write_file, read_file and edit_file; the others as its binary names them.
var names = map[string]string{
	"run_command":          "bash",
	"write_file":           "write",
	"write_to_file":        "write",
	"create_file":          "write",
	"read_file":            "read",
	"view_file":            "read",
	"edit_file":            "edit",
	"replace_file_content": "edit",
	"grep_search":          "grep",
	"find_by_name":         "find",
	"list_dir":             "ls",
	"search_web":           "websearch",
	"read_url_content":     "webfetch",
}

// aliases are agy's input fields by the names the page reads (file_path, command...), each
// given the first of its own that is there.
var aliases = []struct {
	to   string
	from []string
}{
	{"file_path", []string{"Path", "AbsolutePath", "TargetFile", "File"}},
	{"command", []string{"CommandLine"}},
	{"cwd", []string{"Cwd"}},
	{"content", []string{"Content", "CodeContent"}},
	{"old_string", []string{"Target", "TargetContent"}},
	{"new_string", []string{"Replacement", "ReplacementContent"}},
	{"pattern", []string{"Query", "Pattern"}},
	{"path", []string{"SearchPath", "SearchDirectory", "DirectoryPath"}},
	{"url", []string{"Url", "URL"}},
	{"description", []string{"toolSummary"}},
}

// toolOf is a call as Iridium shows it: its name and its input, agy's fields renamed where the
// page reads others (the rest kept as they are). A call agy names nothing is its title's.
func toolOf(u *update) (string, any) {
	name := u.Name
	if n, ok := names[name]; ok {
		name = n
	}
	if name == "" {
		name = u.Title
	}
	var in map[string]any
	if json.Unmarshal(u.RawInput, &in) != nil || in == nil {
		return name, map[string]any{}
	}
	if name != u.Name {
		for _, a := range aliases {
			for _, f := range a.from {
				if v, ok := in[f]; ok {
					if _, taken := in[a.to]; !taken {
						in[a.to] = v
					}
					delete(in, f)
					break
				}
			}
		}
		delete(in, "WaitMsBeforeAsync")
	}
	return name, in
}

// resultOf is a call's result as text: what its content says (a command that exited 0: its output
// past agy's header of times and exit code), else its raw output's.
func resultOf(u *update) string {
	var pieces []piece
	_ = json.Unmarshal(u.Content, &pieces)
	var parts []string
	for _, p := range pieces {
		switch p.Type {
		case "content":
			var c piece
			if json.Unmarshal(p.Content, &c) == nil && c.Type == "text" {
				parts = append(parts, c.Text)
			}
		case "text":
			parts = append(parts, p.Text)
		}
	}
	text := strings.Join(parts, "\n\n")
	if text == "" {
		var out struct {
			Output string `json:"output"`
			Error  string `json:"error"`
		}
		if json.Unmarshal(u.RawOutput, &out) == nil {
			text = out.Output + out.Error
		}
	}
	// The header goes where the command did well; an exit code of another number stays said.
	if head, rest, ok := strings.Cut(text, "\nCommand output:\n"); ok && strings.HasPrefix(text, "Created At:") && strings.Contains(head, "exited with code 0.") {
		text = rest
	}
	return strings.ReplaceAll(text, "\r\n", "\n")
}

// pictureMax is the most of a picture agy read that is kept with its result.
const pictureMax = 8 << 20

// pictureTypes are the pictures by the end of their name, as the model is given them.
var pictureTypes = map[string]string{".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp"}

// pictureOf is the picture a read of u gave the model, as content blocks the record keeps
// (transcript.Entry.Content): agy's ACP says only the file's path, so it is read where agy runs
// as the read ends, the picture it was just given (otae, 2026-11-23: agy's 读图片 had nothing to
// open). Nil for anything else, a failed read, or one not to be read.
func (d *Driver) pictureOf(u *update) json.RawMessage {
	if u.Status != "completed" || u.ToolKind != "read" || d.readFile == nil {
		return nil
	}
	path := ""
	if len(u.Locations) > 0 {
		path = u.Locations[0].Path
	}
	if path == "" {
		var in struct {
			Path string `json:"Path"`
		}
		_ = json.Unmarshal(u.RawInput, &in)
		path = in.Path
	}
	mime := pictureTypes[strings.ToLower(filepath.Ext(path))]
	if mime == "" {
		return nil
	}
	data, err := d.readFile(path)
	if err != nil || len(data) == 0 || len(data) > pictureMax {
		return nil
	}
	b, _ := json.Marshal([]map[string]string{{"type": "image", "data": base64.StdEncoding.EncodeToString(data), "mimeType": mime}})
	return b
}

// readTextMax caps the raw file size read for a text read_file result, and readLinesMax /
// readBytesMax mirror agy's read_file window (800 lines, 46 KiB).
const (
	readTextMax  = 2 << 20
	readLinesMax = 800
	readBytesMax = 46080
)

// readTextOf reads the text slice that agy's read_file just gave the model when ACP's
// tool_call_update omits output content (same reason as pictureOf above). Skips binary files,
// pictures, failed reads, and oversized files.
func (d *Driver) readTextOf(u *update, t tool) string {
	if u.Status != "completed" || (u.ToolKind != "read" && t.name != "read") || d.readFile == nil {
		return ""
	}
	path := ""
	if len(u.Locations) > 0 {
		path = u.Locations[0].Path
	}
	var startLine, endLine int
	var in map[string]any
	if len(u.RawInput) > 0 {
		_ = json.Unmarshal(u.RawInput, &in)
	}
	if in == nil {
		in, _ = t.input.(map[string]any)
	}
	if in != nil {
		if path == "" {
			for _, k := range []string{"Path", "file_path", "AbsolutePath", "TargetFile", "File"} {
				if s, ok := in[k].(string); ok && s != "" {
					path = s
					break
				}
			}
		}
		if v, ok := in["StartLine"].(float64); ok && v > 0 {
			startLine = int(v)
		}
		if v, ok := in["EndLine"].(float64); ok && v > 0 {
			endLine = int(v)
		}
	}
	if path == "" || pictureTypes[strings.ToLower(filepath.Ext(path))] != "" {
		return ""
	}
	data, err := d.readFile(path)
	if err != nil || len(data) == 0 || len(data) > readTextMax {
		return ""
	}
	sample := data[:min(len(data), 4096)]
	if bytes.IndexByte(sample, 0) >= 0 || !utf8.Valid(sample) {
		return ""
	}
	text := strings.ReplaceAll(string(data), "\r\n", "\n")
	lines := strings.Split(text, "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	if len(lines) == 0 {
		return ""
	}
	from := max(1, startLine)
	if from > len(lines) {
		return ""
	}
	to := len(lines)
	if endLine > 0 && endLine < to {
		to = endLine
	}
	if to-from+1 > readLinesMax {
		to = from + readLinesMax - 1
	}
	var sb strings.Builder
	for i := from; i <= to; i++ {
		line := strconv.Itoa(i) + ": " + lines[i-1]
		if sb.Len() > 0 {
			if sb.Len()+1+len(line) > readBytesMax {
				break
			}
			sb.WriteByte('\n')
		} else if len(line) > readBytesMax {
			sb.WriteString(line[:readBytesMax])
			break
		}
		sb.WriteString(line)
	}
	return sb.String()
}
