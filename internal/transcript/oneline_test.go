package transcript

import "testing"

func TestOneLineLinks(t *testing.T) {
	t.Parallel()
	for in, want := range map[string]string{
		"看一下 [KDJ仓库概览](ir:session/1ca494a5) 和 [a b](<ir:folder//x/a b>)\n里的": "看一下 KDJ仓库概览 和 a b 里的",
		"see ![plot](ir:abcdefghij) and [web](https://x.y)":                          "see plot and [web](https://x.y)",
	} {
		if got := oneLine(in); got != want {
			t.Errorf("oneLine(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestFilesAsWords(t *testing.T) {
	for in, want := range map[string]string{
		"[附件] `/w/.iridium/uploads/a.PNG`":            "[图片]",
		"look\n[附件] `/w/a.jpg`\n[附件] `/w/b.pdf`":      "look\n[图片]\n[文件]",
		"[文件] `/w/out.csv`":                           "[文件]",
		"no files here, `code` and [附件] in a sentence": "no files here, `code` and [附件] in a sentence",
	} {
		if got := FilesAsWords(in); got != want {
			t.Errorf("FilesAsWords(%q) = %q, want %q", in, got, want)
		}
	}
	if s := Said(true, "[附件] `/w/a.png`", "", 0); s.Text != "[图片]" {
		t.Errorf("a picture alone: %q", s.Text)
	}
}
