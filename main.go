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
// Release builds override it at link time:
//
//	wails build -ldflags "-X main.defaultServerURL=https://ghostman.example.com"
//
// (or `task build SERVER_URL=...`). It is a var, not a const, so -X can set it.
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
		},
		BackgroundColour: &options.RGBA{R: 22, G: 24, B: 29, A: 1},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind: []any{
			app,
		},
	})
	if err != nil {
		slog.Error("ghostman exited with error", "err", err)
		os.Exit(1)
	}
}
