package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// The app's login (docs/app.md "登录", internal/webapp/applogin.go): its web view has no passkey,
// so the person allows it from the system's browser, where theirs is. The app holds a secret the
// browser never sees; only with it does the Iridium hand over the ticket that logs the web view in.

var httpc = &http.Client{Timeout: 15 * time.Second}

type loginStart struct {
	ID   string `json:"id"`
	Code string `json:"code"`
	URL  string `json:"url"`
}

// logins: one at a time for each Iridium; a new one ends the one before.
var logins = struct {
	mu sync.Mutex
	m  map[string]context.CancelFunc
}{m: map[string]context.CancelFunc{}}

// browserLogin asks server for a login, opens its page in the browser, tells said the code to
// check, and once the person allows it calls done with the address that logs the web view in.
func browserLogin(server, name string, open func(string) error, said func(map[string]string), done func(link, who string)) {
	ctx, cancel := context.WithTimeout(context.Background(), 11*time.Minute)
	logins.mu.Lock()
	if stop := logins.m[server]; stop != nil {
		stop()
	}
	logins.m[server] = cancel
	logins.mu.Unlock()
	go func() {
		defer cancel()
		ticket, who, err := loginFlow(ctx, server, name, open, said)
		switch {
		case errors.Is(err, context.Canceled):
		case err != nil:
			said(map[string]string{"error": err.Error()})
		default:
			done(server+"/_ir/app/finish?ticket="+ticket, who)
		}
	}()
}

// loginFlow is the ticket, and the name of the login that allowed it.
func loginFlow(ctx context.Context, server, name string, open func(string) error, said func(map[string]string)) (string, string, error) {
	raw := make([]byte, 32)
	_, _ = rand.Read(raw)
	secret := base64.RawURLEncoding.EncodeToString(raw)
	sum := sha256.Sum256([]byte(secret))
	var st loginStart
	if err := post(ctx, server+"/_ir/api/app/start", map[string]string{"name": name, "verifier": base64.RawURLEncoding.EncodeToString(sum[:])}, &st); err != nil {
		var se statusError
		if errors.As(err, &se) && (se == http.StatusNotFound || se == http.StatusMethodNotAllowed || se == http.StatusForbidden) {
			// An Iridium from before: no such route (a page's POST there, 403 for its Origin).
			return "", "", fmt.Errorf("%s 的版本不支持应用登录，请先更新", hostOf(server))
		}
		return "", "", fmt.Errorf("无法登录：%v", err)
	}
	if !strings.HasPrefix(st.URL, server+"/") {
		return "", "", errors.New("无法登录：服务器给的地址不对")
	}
	said(map[string]string{"code": st.Code})
	if err := open(st.URL); err != nil {
		return "", "", fmt.Errorf("无法打开浏览器：%v", err)
	}
	for {
		select {
		case <-ctx.Done():
			return "", "", ctx.Err()
		case <-time.After(2 * time.Second):
		}
		var p struct{ Status, Ticket, Name string }
		err := post(ctx, server+"/_ir/api/app/poll", map[string]string{"id": st.ID, "secret": secret}, &p)
		var se statusError
		switch {
		case errors.As(err, &se) && se == http.StatusNotFound:
			return "", "", errors.New("已过期，请重新登录")
		case err != nil:
			continue // a weak link: asked again
		case p.Status == "denied":
			return "", "", errors.New("已拒绝")
		case p.Status == "allowed" && p.Ticket != "":
			return p.Ticket, p.Name, nil
		}
	}
}

type statusError int

func (e statusError) Error() string { return http.StatusText(int(e)) }

func post(ctx context.Context, url string, body, into any) error {
	b, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := httpc.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	if res.StatusCode != http.StatusOK {
		return statusError(res.StatusCode)
	}
	return json.Unmarshal(data, into)
}

// isIridium: does address answer as an Iridium (its /_ir/health)? Not one, not added.
func isIridium(ctx context.Context, address string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, address+"/_ir/health", nil)
	if err != nil {
		return err
	}
	res, err := httpc.Do(req)
	if err != nil {
		return fmt.Errorf("连不上 %s", hostOf(address))
	}
	defer res.Body.Close()
	var h struct{ OK bool }
	if res.StatusCode != http.StatusOK || json.NewDecoder(io.LimitReader(res.Body, 4<<10)).Decode(&h) != nil || !h.OK {
		return fmt.Errorf("%s 不是 Iridium 服务器", hostOf(address))
	}
	return nil
}
