package engine

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"os"
	"path/filepath"
	"strings"
)

// Multipart bodies (multipart/form-data). Text fields carry their (resolved)
// value; file fields are STREAMED from disk at send time — never read into
// memory, never stored anywhere else: the body is a list of segments (the
// framing bytes multipart.Writer produces, and the files by path), so its exact
// length is known up front (Content-Length, no chunking) and a 307 / 308 re-send
// simply re-opens the files (payload.open). Every file is checked BEFORE the
// request goes out: a missing or unreadable one aborts the send with a message
// naming the field and the file.

// Multipart field kinds.
const (
	PartText = "text"
	PartFile = "file"
)

// sniffLen is how much of a file http.DetectContentType looks at.
const sniffLen = 512

// Part is one multipart field. Path is where a file field's bytes are on this
// machine (filled by the app from local storage; never serialized).
type Part struct {
	Key      string `json:"key"`
	Kind     string `json:"kind"` // PartText | PartFile
	Value    string `json:"value"`
	FileName string `json:"fileName"` // display name (synced)
	Path     string `json:"-"`
	Enabled  bool   `json:"enabled"`
}

// payload is a request body that can be opened any number of times (for
// redirects) and whose length is known before sending.
type payload struct {
	open        func() (io.ReadCloser, error)
	length      int64
	contentType string
}

func bytesPayload(data []byte, contentType string) *payload {
	return &payload{
		open:        func() (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(data)), nil },
		length:      int64(len(data)),
		contentType: contentType,
	}
}

// bodyPayload builds the body to send (nil for none).
func bodyPayload(b Body) (*payload, error) {
	if b.Type == BodyMultipart {
		return multipartPayload(b.Parts)
	}
	r, ct := encodeBody(b)
	if r == nil {
		return nil, nil
	}
	data, err := io.ReadAll(r)
	if err != nil {
		return nil, err
	}
	return bytesPayload(data, ct), nil
}

// segment is a run of framing bytes, or a file to stream (path + size checked
// when the payload was built).
type segment struct {
	data []byte
	path string
	size int64
}

// enabledParts are the parts that are sent: enabled, with a key.
func enabledParts(parts []Part) []Part {
	out := make([]Part, 0, len(parts))
	for _, p := range parts {
		if p.Enabled && strings.TrimSpace(p.Key) != "" {
			out = append(out, p)
		}
	}
	return out
}

func multipartPayload(parts []Part) (*payload, error) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	var segs []segment
	flush := func() {
		if buf.Len() > 0 {
			segs = append(segs, segment{data: bytes.Clone(buf.Bytes())})
			buf.Reset()
		}
	}
	for _, p := range enabledParts(parts) {
		key := strings.TrimSpace(p.Key)
		if p.Kind != PartFile {
			fw, err := w.CreateFormField(key)
			if err == nil {
				_, err = io.WriteString(fw, p.Value)
			}
			if err != nil {
				return nil, fmt.Errorf("multipart field '%s': %w", key, err)
			}
			continue
		}
		size, contentType, err := inspectFile(key, p)
		if err != nil {
			return nil, err
		}
		h := make(textproto.MIMEHeader)
		h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="%s"; filename="%s"`, quoteEscape(key), quoteEscape(filepath.Base(p.Path))))
		h.Set("Content-Type", contentType)
		if _, err := w.CreatePart(h); err != nil {
			return nil, fmt.Errorf("multipart field '%s': %w", key, err)
		}
		flush()
		segs = append(segs, segment{path: p.Path, size: size})
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	flush()
	var length int64
	for _, s := range segs {
		length += int64(len(s.data)) + s.size
	}
	return &payload{
		open:        func() (io.ReadCloser, error) { return &segmentReader{segs: segs}, nil },
		length:      length,
		contentType: w.FormDataContentType(),
	}, nil
}

// inspectFile checks a file field before sending and sniffs its content type
// (the first 512 bytes; application/octet-stream when nothing matches).
func inspectFile(key string, p Part) (int64, string, error) {
	name := p.FileName
	if name == "" && p.Path != "" {
		name = filepath.Base(p.Path)
	}
	if p.Path == "" {
		if name == "" {
			return 0, "", fmt.Errorf("no file chosen for field '%s'", key)
		}
		return 0, "", fmt.Errorf("file for field '%s' is not on this machine: %s — choose it again", key, name)
	}
	info, err := os.Stat(p.Path)
	switch {
	case errors.Is(err, fs.ErrNotExist):
		return 0, "", fmt.Errorf("file for field '%s' not found: %s", key, name)
	case err != nil:
		return 0, "", fmt.Errorf("file for field '%s' cannot be read: %s", key, name)
	case info.IsDir():
		return 0, "", fmt.Errorf("file for field '%s' is a folder: %s", key, name)
	}
	f, err := os.Open(p.Path)
	if err != nil {
		return 0, "", fmt.Errorf("file for field '%s' cannot be read: %s", key, name)
	}
	defer f.Close()
	head := make([]byte, sniffLen)
	n, err := io.ReadFull(f, head)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
		return 0, "", fmt.Errorf("file for field '%s' cannot be read: %s", key, name)
	}
	ct := "application/octet-stream"
	if n > 0 {
		ct = http.DetectContentType(head[:n])
	}
	return info.Size(), ct, nil
}

func quoteEscape(s string) string {
	return strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s)
}

// segmentReader streams the segments in order, opening each file only when its
// turn comes (and closing it when done), reading exactly its checked size.
type segmentReader struct {
	segs []segment
	i    int
	cur  io.Reader
	file *os.File
}

func (r *segmentReader) Read(p []byte) (int, error) {
	for {
		if r.cur == nil {
			if r.i >= len(r.segs) {
				return 0, io.EOF
			}
			s := r.segs[r.i]
			r.i++
			if s.path == "" {
				r.cur = bytes.NewReader(s.data)
			} else {
				f, err := os.Open(s.path)
				if err != nil {
					return 0, fmt.Errorf("file %s cannot be read any more", filepath.Base(s.path))
				}
				r.file, r.cur = f, io.LimitReader(f, s.size)
			}
		}
		n, err := r.cur.Read(p)
		if errors.Is(err, io.EOF) {
			r.closeFile()
			r.cur = nil
			if n > 0 {
				return n, nil
			}
			continue
		}
		return n, err
	}
}

func (r *segmentReader) closeFile() {
	if r.file != nil {
		_ = r.file.Close()
		r.file = nil
	}
}

func (r *segmentReader) Close() error {
	r.closeFile()
	r.i = len(r.segs)
	return nil
}

// MultipartSummary is a multipart body as text for history and scripts: one
// line per sent field, "key: value", a file as "key: [file name, N bytes]" —
// never its bytes.
func MultipartSummary(parts []Part) string {
	lines := make([]string, 0, len(parts))
	for _, p := range enabledParts(parts) {
		key := strings.TrimSpace(p.Key)
		if p.Kind != PartFile {
			lines = append(lines, key+": "+p.Value)
			continue
		}
		name := p.FileName
		if name == "" && p.Path != "" {
			name = filepath.Base(p.Path)
		}
		if info, err := os.Stat(p.Path); p.Path != "" && err == nil && !info.IsDir() {
			lines = append(lines, fmt.Sprintf("%s: [file %s, %d bytes]", key, name, info.Size()))
		} else {
			lines = append(lines, fmt.Sprintf("%s: [file %s, not on this machine]", key, name))
		}
	}
	return strings.Join(lines, "\n")
}
