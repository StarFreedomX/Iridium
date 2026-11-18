package gate

import (
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// ClientKey identifies the client a request comes from, as the logs and the pairing limits
// name it. The forwarded-IP header is trusted
// only when the peer is loopback (cloudflared or a reverse proxy on this machine). IPv6
// clients are grouped by /64, which one client can cycle through freely.
func ClientKey(r *http.Request, header string) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	addr, err := netip.ParseAddr(host)
	if err != nil {
		return "peer:" + host
	}
	addr = addr.Unmap()
	if addr.IsLoopback() && header != "" {
		if v := r.Header.Get(header); v != "" {
			if i := strings.LastIndexByte(v, ','); i >= 0 { // X-Forwarded-For style: the last hop is the proxy's
				v = v[i+1:]
			}
			if a, err := netip.ParseAddr(strings.TrimSpace(v)); err == nil {
				addr = a.Unmap()
			}
		}
	}
	if addr.Is6() {
		p, _ := addr.Prefix(64)
		return p.String()
	}
	return addr.String()
}
