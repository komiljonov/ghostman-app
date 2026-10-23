// Command testproxy runs internal/testproxy for local verification of the
// proxy feature: an HTTP (forwarding + CONNECT) and SOCKS5 proxy on one port
// that prints every request it handles.
//
//	go run ./tools/testproxy -addr 127.0.0.1:3128 [-user u -pass p]
package main

import (
	"flag"
	"fmt"
	"os"
	"os/signal"

	"ghostman/internal/testproxy"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:3128", "listen address")
	user := flag.String("user", "", "required username (empty = no auth)")
	pass := flag.String("pass", "", "required password")
	flag.Parse()
	s, err := testproxy.Start(*addr, *user, *pass)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	s.OnLog = func(line string) { fmt.Println(line) }
	fmt.Println("testproxy listening on", s.Addr())
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt)
	<-stop
	_ = s.Close()
}
