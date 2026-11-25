package pathsafe

import (
	"slices"
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
			names := driveNames(available, tc.roots, tc.scope)
			if !slices.Equal(names, tc.want) {
				t.Fatalf("got %v, want %v", names, tc.want)
			}
		})
	}
}
