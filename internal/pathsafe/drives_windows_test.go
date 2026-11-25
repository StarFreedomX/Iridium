package pathsafe

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestBrowserDriveScope(t *testing.T) {
	const available = 1<<('C'-'A') | 1<<('D'-'A') | 1<<('Z'-'A')
	for _, tc := range []struct {
		name         string
		roots, scope []string
		want         []string
	}{
		{name: "unrestricted", want: []string{"C:", "D:", "Z:"}},
		{name: "computer only", roots: []string{`D:\work`}, want: []string{"D:"}},
		{name: "login only", scope: []string{`d:\work`, `E:\offline`}, want: []string{"D:"}},
		{name: "intersections both directions", roots: []string{`C:\Work`, `D:\repos\sample`}, scope: []string{`c:\WORK\project`, `d:\repos`}, want: []string{"C:", "D:"}},
		{name: "different drives", roots: []string{`C:\work`}, scope: []string{`D:\work`}},
		{name: "different folders on the same drive", roots: []string{`C:\work`}, scope: []string{`C:\workbench`}},
		{name: "UNC is not a logical drive", scope: []string{`\\server\share\work`}},
		{name: "no usable computer roots", roots: []string{}},
		{name: "no usable login scope", scope: []string{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			names := driveNames(available, intersectBrowserRoots(tc.roots, tc.scope))
			if !slices.Equal(names, tc.want) {
				t.Fatalf("got %v, want %v", names, tc.want)
			}
		})
	}
}

func TestBrowserDrivesExcludeBlockedRoots(t *testing.T) {
	base := t.TempDir()
	drive := strings.ToUpper(filepath.VolumeName(base))
	if len(drive) != 2 || drive[1] != ':' || drive[0] < 'A' || drive[0] > 'Z' {
		t.Skip("temp directory is not on a logical drive")
	}
	mask := uint32(1) << (drive[0] - 'A')
	private := filepath.Join(base, "private")
	uploads := filepath.Join(private, "uploads")
	work := filepath.Join(base, "work")
	for _, dir := range []string{uploads, work} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			t.Fatal(err)
		}
	}

	guard := New(nil, []string{private}, []string{uploads})
	if names := guard.browserDriveNames(mask, guard.browserRoots(nil, []string{uploads})); len(names) != 0 {
		t.Fatalf("drive with only an exception behind a denied ancestor: %v", names)
	}
	if dir, err := guard.BrowserDirectory(uploads, nil, []string{uploads}); err != nil || dir.Real == "" {
		t.Fatalf("direct exception should remain open: %+v, %v", dir, err)
	}
	if names := guard.browserDriveNames(mask, guard.browserRoots(nil, []string{uploads, work})); !slices.Equal(names, []string{drive}) {
		t.Fatalf("drive with a navigable sibling grant: %v", names)
	}

	deniedDrive := New(nil, []string{drive + string(filepath.Separator)}, nil)
	if names := deniedDrive.browserDriveNames(mask, nil); len(names) != 0 {
		t.Fatalf("unrestricted login should not list a denied drive: %v", names)
	}
}
