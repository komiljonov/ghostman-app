package main

import (
	"embed"
	"log/slog"
	"os"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"

	"ghostman/internal/engine"
)

//go:embed all:frontend/dist
var assets embed.FS

// defaultServerURL is the server used until the user sets one in Settings.
// localhost here is for `wails dev` and tests; `task build` links in the
// production server (https://api.ghostman.uz, see Taskfile.yml) at link time:
//
//	wails build -ldflags "-X main.defaultServerURL=https://api.ghostman.uz"
//
// (`task build SERVER_URL=...` picks another). It is a var, not a const, so -X can set it.
var defaultServerURL = "http://localhost:8080"

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil)))

	app := NewApp(engine.New(engine.DefaultTimeout), defaultServerURL)

	err := wails.Run(&options.App{
		Title:     "Ghostman",
		Width:     1100,
		Height:    780,
		MinWidth:  640,
		MinHeight: 480,
		AssetServer: &assetserver.Options{
			Assets: assets,
			// /history-media/{id} and /response-media/{tab}: image / audio / video bodies (history_media.go).
			Middleware: app.mediaMiddleware,
		},
		BackgroundColour: &options.RGBA{R: 22, G: 24, B: 29, A: 1},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		OnBeforeClose:    app.beforeClose,
		Bind: []any{
			app,
		},
	})
	if err != nil {
		slog.Error("ghostman exited with error", "err", err)
		os.Exit(1)
	}
}
