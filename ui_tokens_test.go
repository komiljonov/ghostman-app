package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// Colors are defined only in frontend/src/tokens.css (dark + light sets). Any color
// literal elsewhere in the frontend breaks theming, so this test fails on one.
// It is a Go test so it runs in `task test` identically on Windows and Linux.
func TestNoColorLiteralsOutsideTokens(t *testing.T) {
	colorLiteral := regexp.MustCompile(`#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|:\s*(white|black)\s*[;}]`)
	root := filepath.Join("frontend", "src")
	var bad []string
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		name := d.Name()
		ext := filepath.Ext(name)
		if name == "tokens.css" || strings.Contains(name, ".test.") || (ext != ".css" && ext != ".ts" && ext != ".tsx") {
			return nil
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for i, line := range strings.Split(string(raw), "\n") {
			if colorLiteral.MatchString(line) {
				bad = append(bad, path+":"+strconv.Itoa(i+1)+": "+strings.TrimSpace(line))
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(bad) > 0 {
		t.Fatalf("color literals outside tokens.css (use a var(--token)):\n%s", strings.Join(bad, "\n"))
	}
}
