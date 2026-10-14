//go:build devdialog

package main

import (
	"context"
	"os"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Verification builds only (wails dev -tags devdialog): the open dialog
// "chooses" the path written in the file named by GHOSTMAN_DEV_PICK (empty =
// cancel), so a headless UI driver can exercise the real choose flow. Never in
// shipped builds.
func init() {
	pick := os.Getenv("GHOSTMAN_DEV_PICK")
	if pick == "" {
		return
	}
	devOpenDialog = func(context.Context, runtime.OpenDialogOptions) (string, error) {
		b, err := os.ReadFile(pick)
		if err != nil {
			return "", nil
		}
		return strings.TrimSpace(string(b)), nil
	}
}
