package engine

import (
	"strings"
	"unicode/utf8"
)

// Media kinds of a response body. Text bodies have kind "" and are previewed as
// text; everything else is shown as media (image / audio / video) or offered as
// a file (pdf, binary) — never as a string, which would only be mojibake.
const (
	MediaNone   = ""
	MediaImage  = "image"
	MediaAudio  = "audio"
	MediaVideo  = "video"
	MediaPDF    = "pdf"
	MediaBinary = "binary"
)

// renderableImages are the image types the webview shows in an <img> (SVG
// included: scripts in an SVG do not run when it is loaded as an image).
var renderableImages = map[string]bool{
	"image/png": true, "image/jpeg": true, "image/jpg": true, "image/gif": true, "image/webp": true,
	"image/bmp": true, "image/x-icon": true, "image/vnd.microsoft.icon": true, "image/avif": true, "image/svg+xml": true,
}

// MimeType is the bare, lower-cased media type of a Content-Type value.
func MimeType(contentType string) string {
	return strings.ToLower(strings.TrimSpace(strings.SplitN(contentType, ";", 2)[0]))
}

// MediaKind classifies a body by its Content-Type, falling back to sniffing:
// a body whose first bytes are not valid UTF-8 text (or contain NUL) is binary.
func MediaKind(contentType string, body []byte) string {
	mt := MimeType(contentType)
	switch {
	case renderableImages[mt]:
		return MediaImage
	case strings.HasPrefix(mt, "image/"):
		return MediaBinary // e.g. TIFF / HEIC: not displayable, still a file
	case strings.HasPrefix(mt, "audio/"):
		return MediaAudio
	case strings.HasPrefix(mt, "video/"):
		return MediaVideo
	case mt == "application/pdf":
		return MediaPDF
	case mt == "application/octet-stream" || mt == "application/zip" || mt == "application/gzip" ||
		strings.HasPrefix(mt, "font/") || mt == "application/wasm":
		return MediaBinary
	}
	if looksBinary(body) {
		return MediaBinary
	}
	return MediaNone
}

func looksBinary(body []byte) bool {
	sample := body[:min(len(body), 8192)]
	for _, b := range sample {
		if b == 0 {
			return true
		}
	}
	if utf8.Valid(sample) {
		return false
	}
	// A sample cut mid-rune is still text: drop up to 3 trailing bytes and retry.
	for cut := 1; cut <= 3 && cut < len(sample); cut++ {
		if utf8.Valid(sample[:len(sample)-cut]) {
			return false
		}
	}
	return true
}
