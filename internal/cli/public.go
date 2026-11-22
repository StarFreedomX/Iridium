package cli

import (
	"context"
	"errors"
	"io"
	"runtime"

	"github.com/kumoSleeping/iridium/internal/config"
	"github.com/kumoSleeping/iridium/internal/public"
)

// PublicOptions are ir public's options for a program with no terminal (the desktop app's
// 公网访问): the Iridium of the config file at cfgPath, over its socket; Ask nil, so every
// question takes its default (public.Options.Ask). Set Host, OnLink and OnInvite, then
// public.On; PublicOff takes it down. Not on Windows, whose tunnel has no service of its own yet.
func PublicOptions(cfgPath string, out io.Writer) (public.Options, error) {
	if runtime.GOOS == "windows" {
		return public.Options{}, errors.New("公网访问在 Windows 上还不能用")
	}
	cfg, err := config.Load(cfgPath)
	if err != nil {
		return public.Options{}, err
	}
	e := adminEnv{cfg: cfg, cfgPath: cfgPath, client: socketClient(cfg.SocketPath())}
	o, err := publicOptions(e, out)
	if err != nil {
		return o, err
	}
	o.Ask = nil
	return o, nil
}

// PublicOff takes the public way in down (ir public off) for the Iridium at cfgPath.
func PublicOff(ctx context.Context, cfgPath string, out io.Writer) error {
	o, err := PublicOptions(cfgPath, out)
	if err != nil {
		return err
	}
	return public.Off(ctx, o)
}
