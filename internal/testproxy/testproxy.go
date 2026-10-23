// Package testproxy is a small forward proxy for tests and local verification
// (tools/testproxy runs it on :3128). One port speaks both protocols, told
// apart by the first byte: SOCKS5 (0x05) and HTTP — absolute-URI forwarding
// and CONNECT tunnels. With credentials set it requires them (HTTP:
// Proxy-Authorization Basic → 407 otherwise; SOCKS5: username/password
// method). Every request is logged (Log), passwords never.
package testproxy

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Server is a running proxy.
type Server struct {
	User, Pass string // required credentials ("" = none)

	ln  net.Listener
	mu  sync.Mutex
	log []string
	// OnLog, when set, also receives each line (tools/testproxy prints them).
	OnLog func(string)
}

// Start listens on addr ("127.0.0.1:0" for a free port).
func Start(addr, user, pass string) (*Server, error) {
	ln, err := (&net.ListenConfig{}).Listen(context.Background(), "tcp", addr)
	if err != nil {
		return nil, err
	}
	s := &Server{User: user, Pass: pass, ln: ln}
	go s.serve()
	return s, nil
}

// Addr is the listening host:port.
func (s *Server) Addr() string { return s.ln.Addr().String() }

// Port is the listening port.
func (s *Server) Port() int { return s.ln.Addr().(*net.TCPAddr).Port }

// Close stops listening (open tunnels finish on their own).
func (s *Server) Close() error { return s.ln.Close() }

// Log returns the lines so far: "GET http://host/path", "CONNECT host:443",
// "SOCKS host:port", each with " auth=ok" / " auth=missing" / " auth=bad"
// when credentials are required.
func (s *Server) Log() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.log...)
}

func (s *Server) record(line string) {
	s.mu.Lock()
	s.log = append(s.log, line)
	s.mu.Unlock()
	if s.OnLog != nil {
		s.OnLog(line)
	}
}

func (s *Server) serve() {
	for {
		c, err := s.ln.Accept()
		if err != nil {
			return
		}
		go s.handle(c)
	}
}

func (s *Server) handle(c net.Conn) {
	defer c.Close()
	_ = c.SetDeadline(time.Now().Add(2 * time.Minute))
	br := bufio.NewReader(c)
	first, err := br.Peek(1)
	if err != nil {
		return
	}
	if first[0] == 0x05 {
		s.socks(c, br)
		return
	}
	s.http(c, br)
}

// ---- HTTP ----

func (s *Server) authHTTP(r *http.Request) string {
	if s.User == "" {
		return ""
	}
	h := r.Header.Get("Proxy-Authorization")
	if h == "" {
		return "missing"
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(h, "Basic "))
	if err != nil || string(raw) != s.User+":"+s.Pass {
		return "bad"
	}
	return "ok"
}

var forward = &http.Transport{Proxy: nil, DisableKeepAlives: true}

func (s *Server) http(c net.Conn, br *bufio.Reader) {
	for {
		r, err := http.ReadRequest(br)
		if err != nil {
			return
		}
		auth := s.authHTTP(r)
		line := r.Method + " " + r.RequestURI
		if auth != "" {
			line += " auth=" + auth
		}
		s.record(line)
		if auth == "missing" || auth == "bad" {
			_, _ = io.WriteString(c, "HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"testproxy\"\r\nContent-Length: 0\r\n\r\n")
			return
		}
		if r.Method == http.MethodConnect {
			target, err := dial(r.Host)
			if err != nil {
				_, _ = io.WriteString(c, "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
				return
			}
			_, _ = io.WriteString(c, "HTTP/1.1 200 Connection established\r\n\r\n")
			splice(c, br, target)
			return
		}
		r.RequestURI = ""
		r.Header.Del("Proxy-Authorization")
		r.Header.Del("Proxy-Connection")
		resp, err := forward.RoundTrip(r)
		if err != nil {
			_, _ = io.WriteString(c, "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
			return
		}
		err = resp.Write(c)
		_ = resp.Body.Close()
		if err != nil || r.Close {
			return
		}
	}
}

func dial(addr string) (net.Conn, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return (&net.Dialer{}).DialContext(ctx, "tcp", addr)
}

func splice(client net.Conn, clientReader io.Reader, target net.Conn) {
	defer target.Close()
	done := make(chan struct{}, 2)
	go func() { _, _ = io.Copy(target, clientReader); done <- struct{}{} }()
	go func() { _, _ = io.Copy(client, target); done <- struct{}{} }()
	<-done
}

// ---- SOCKS5 (RFC 1928 / 1929; CONNECT only) ----

func (s *Server) socks(c net.Conn, br *bufio.Reader) {
	head := make([]byte, 2)
	if _, err := io.ReadFull(br, head); err != nil {
		return
	}
	methods := make([]byte, head[1])
	if _, err := io.ReadFull(br, methods); err != nil {
		return
	}
	want := byte(0x00)
	if s.User != "" {
		want = 0x02
	}
	if !strings.ContainsRune(string(methods), rune(want)) {
		_, _ = c.Write([]byte{0x05, 0xff})
		s.record("SOCKS refused: no acceptable auth method")
		return
	}
	_, _ = c.Write([]byte{0x05, want})
	auth := ""
	if want == 0x02 {
		user, pass, err := readUserPass(br)
		if err != nil {
			return
		}
		if user == s.User && pass == s.Pass {
			auth = "ok"
			_, _ = c.Write([]byte{0x01, 0x00})
		} else {
			_, _ = c.Write([]byte{0x01, 0x01})
			s.record("SOCKS auth=bad")
			return
		}
	}
	target, err := readSocksTarget(br)
	if err != nil {
		return
	}
	line := "SOCKS " + target
	if auth != "" {
		line += " auth=" + auth
	}
	s.record(line)
	conn, err := dial(target)
	if err != nil {
		_, _ = c.Write([]byte{0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0})
		return
	}
	_, _ = c.Write([]byte{0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0})
	splice(c, br, conn)
}

func readUserPass(r io.Reader) (string, string, error) {
	b := make([]byte, 2)
	if _, err := io.ReadFull(r, b); err != nil {
		return "", "", err
	}
	user := make([]byte, b[1])
	if _, err := io.ReadFull(r, user); err != nil {
		return "", "", err
	}
	if _, err := io.ReadFull(r, b[:1]); err != nil {
		return "", "", err
	}
	pass := make([]byte, b[0])
	if _, err := io.ReadFull(r, pass); err != nil {
		return "", "", err
	}
	return string(user), string(pass), nil
}

func readSocksTarget(r io.Reader) (string, error) {
	h := make([]byte, 4)
	if _, err := io.ReadFull(r, h); err != nil {
		return "", err
	}
	if h[1] != 0x01 {
		return "", errors.New("only CONNECT is supported")
	}
	var host string
	switch h[3] {
	case 0x01:
		ip := make([]byte, 4)
		if _, err := io.ReadFull(r, ip); err != nil {
			return "", err
		}
		host = net.IP(ip).String()
	case 0x04:
		ip := make([]byte, 16)
		if _, err := io.ReadFull(r, ip); err != nil {
			return "", err
		}
		host = net.IP(ip).String()
	case 0x03:
		n := make([]byte, 1)
		if _, err := io.ReadFull(r, n); err != nil {
			return "", err
		}
		name := make([]byte, n[0])
		if _, err := io.ReadFull(r, name); err != nil {
			return "", err
		}
		host = string(name)
	default:
		return "", fmt.Errorf("unknown address type %d", h[3])
	}
	p := make([]byte, 2)
	if _, err := io.ReadFull(r, p); err != nil {
		return "", err
	}
	return net.JoinHostPort(host, strconv.Itoa(int(binary.BigEndian.Uint16(p)))), nil
}
