package api

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
)

// NormalizeServerURL validates a user-entered server URL and returns its canonical
// form: trimmed, http(s) only, no trailing slash. Errors are human messages.
func NormalizeServerURL(raw string) (string, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", errors.New("server URL is required")
	}
	lower := strings.ToLower(s)
	if !strings.HasPrefix(lower, "http://") && !strings.HasPrefix(lower, "https://") {
		return "", errors.New("server URL must start with http:// or https://")
	}

	u, err := url.Parse(s)
	if err != nil {
		return "", fmt.Errorf("server URL %q is not a valid URL", s)
	}
	if u.Host == "" || u.Hostname() == "" {
		return "", errors.New("server URL must include a host, e.g. http://localhost:8080")
	}
	if u.User != nil {
		return "", errors.New("server URL must not contain a username or password")
	}
	if u.RawQuery != "" || u.Fragment != "" {
		return "", errors.New("server URL must not contain a query string or fragment")
	}
	if port := u.Port(); port == "" && strings.HasSuffix(u.Host, ":") {
		return "", errors.New("server URL has an empty port")
	}

	u.Scheme = strings.ToLower(u.Scheme)
	u.Host = strings.ToLower(u.Host)
	return strings.TrimRight(u.String(), "/"), nil
}
