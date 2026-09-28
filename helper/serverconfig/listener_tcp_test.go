// Copyright IBM Corp. 2016, 2025
// SPDX-License-Identifier: BUSL-1.1

package server

import (
	"crypto/tls"
	"crypto/x509"
	"io/ioutil"
	"net"
	"os"
	"testing"
	"time"

	"github.com/hashicorp/cli"
	"github.com/hashicorp/go-sockaddr"
	"github.com/hashicorp/vault/internalshared/configutil"
	"github.com/hashicorp/vault/internalshared/listenerutil"
	"github.com/pires/go-proxyproto"
	"github.com/stretchr/testify/require"
)

func TestTCPListener(t *testing.T) {
	ln, _, _, err := tcpListenerFactory(&configutil.Listener{
		Address:    "127.0.0.1:0",
		TLSDisable: true,
	}, nil, cli.NewMockUi())
	require.NoError(t, err)

	connFn := func(lnReal net.Listener) (net.Conn, error) {
		return net.Dial("tcp", ln.Addr().String())
	}

	testListenerImpl(t, ln, connFn, "", 0, "127.0.0.1", false)
}

// TestTCPListener_tls tests TLS generally
func TestTCPListener_tls(t *testing.T) {
	wd, _ := os.Getwd()
	wd += "/test-fixtures/reload/"

	// Setup initial certs
	inBytes, err := os.ReadFile(wd + "reload_ca.pem")
	require.NoError(t, err)

	certPool := x509.NewCertPool()
	ok := certPool.AppendCertsFromPEM(inBytes)
	require.True(t, ok, "not ok when appending CA cert")

	ln, _, _, err := tcpListenerFactory(&configutil.Listener{
		Address:                       "127.0.0.1:0",
		TLSCertFile:                   wd + "reload_foo.pem",
		TLSKeyFile:                    wd + "reload_foo.key",
		TLSRequireAndVerifyClientCert: true,
		TLSClientCAFile:               wd + "reload_ca.pem",
	}, nil, cli.NewMockUi())
	require.NoError(t, err)

	cwd, _ := os.Getwd()

	clientCert, _ := tls.LoadX509KeyPair(
		cwd+"/test-fixtures/reload/reload_foo.pem",
		cwd+"/test-fixtures/reload/reload_foo.key")

	connFn := func(clientCerts bool) func(net.Listener) (net.Conn, error) {
		return func(lnReal net.Listener) (net.Conn, error) {
			conf := &tls.Config{
				RootCAs: certPool,
			}
			if clientCerts {
				conf.Certificates = []tls.Certificate{clientCert}
			}
			conn, err := tls.Dial("tcp", ln.Addr().String(), conf)
			if err != nil {
				return nil, err
			}
			if err = conn.Handshake(); err != nil {
				return nil, err
			}
			return conn, nil
		}
	}

	testListenerImpl(t, ln, connFn(true), "foo.example.com", 0, "127.0.0.1", false)

	ln, _, _, err = tcpListenerFactory(&configutil.Listener{
		Address:                       "127.0.0.1:0",
		TLSCertFile:                   wd + "reload_foo.pem",
		TLSKeyFile:                    wd + "reload_foo.key",
		TLSRequireAndVerifyClientCert: true,
		TLSDisableClientCerts:         true,
		TLSClientCAFile:               wd + "reload_ca.pem",
	}, nil, cli.NewMockUi())
	require.Error(t, err, "expected error due to mutually exclusive client cert options")

	ln, _, _, err = tcpListenerFactory(&configutil.Listener{
		Address:               "127.0.0.1:0",
		TLSCertFile:           wd + "reload_foo.pem",
		TLSKeyFile:            wd + "reload_foo.key",
		TLSDisableClientCerts: true,
		TLSClientCAFile:       wd + "reload_ca.pem",
	}, nil, cli.NewMockUi())
	require.NoError(t, err)

	testListenerImpl(t, ln, connFn(false), "foo.example.com", 0, "127.0.0.1", false)
}

func TestTCPListener_tls13(t *testing.T) {
	wd, _ := os.Getwd()
	wd += "/test-fixtures/reload/"

	// Setup initial certs
	inBytes, _ := ioutil.ReadFile(wd + "reload_ca.pem")
	certPool := x509.NewCertPool()
	ok := certPool.AppendCertsFromPEM(inBytes)
	require.True(t, ok, "not ok when appending CA cert")

	ln, _, _, err := tcpListenerFactory(&configutil.Listener{
		Address:                       "127.0.0.1:0",
		TLSCertFile:                   wd + "reload_foo.pem",
		TLSKeyFile:                    wd + "reload_foo.key",
		TLSRequireAndVerifyClientCert: true,
		TLSClientCAFile:               wd + "reload_ca.pem",
		TLSMinVersion:                 "tls13",
	}, nil, cli.NewMockUi())
	require.NoError(t, err)

	cwd, _ := os.Getwd()

	clientCert, _ := tls.LoadX509KeyPair(
		cwd+"/test-fixtures/reload/reload_foo.pem",
		cwd+"/test-fixtures/reload/reload_foo.key")

	connFn := func(clientCerts bool) func(net.Listener) (net.Conn, error) {
		return func(lnReal net.Listener) (net.Conn, error) {
			conf := &tls.Config{
				RootCAs: certPool,
			}
			if clientCerts {
				conf.Certificates = []tls.Certificate{clientCert}
			}
			conn, err := tls.Dial("tcp", ln.Addr().String(), conf)
			if err != nil {
				return nil, err
			}
			if err = conn.Handshake(); err != nil {
				return nil, err
			}
			return conn, nil
		}
	}

	testListenerImpl(t, ln, connFn(true), "foo.example.com", tls.VersionTLS13, "127.0.0.1", false)

	ln, _, _, err = tcpListenerFactory(&configutil.Listener{
		Address:                       "127.0.0.1:0",
		TLSCertFile:                   wd + "reload_foo.pem",
		TLSKeyFile:                    wd + "reload_foo.key",
		TLSRequireAndVerifyClientCert: true,
		TLSDisableClientCerts:         true,
		TLSClientCAFile:               wd + "reload_ca.pem",
		TLSMinVersion:                 "tls13",
	}, nil, cli.NewMockUi())
	require.Error(t, err, "expected error due to mutually exclusive client cert options")

	ln, _, _, err = tcpListenerFactory(&configutil.Listener{
		Address:               "127.0.0.1:0",
		TLSCertFile:           wd + "reload_foo.pem",
		TLSKeyFile:            wd + "reload_foo.key",
		TLSDisableClientCerts: true,
		TLSClientCAFile:       wd + "reload_ca.pem",
		TLSMinVersion:         "tls13",
	}, nil, cli.NewMockUi())
	require.NoError(t, err)

	testListenerImpl(t, ln, connFn(false), "foo.example.com", tls.VersionTLS13, "127.0.0.1", false)

	ln, _, _, err = tcpListenerFactory(&configutil.Listener{
		Address:               "127.0.0.1:0",
		TLSCertFile:           wd + "reload_foo.pem",
		TLSKeyFile:            wd + "reload_foo.key",
		TLSDisableClientCerts: true,
		TLSClientCAFile:       wd + "reload_ca.pem",
		TLSMaxVersion:         "tls12",
	}, nil, cli.NewMockUi())
	require.NoError(t, err)

	testListenerImpl(t, ln, connFn(false), "foo.example.com", tls.VersionTLS12, "127.0.0.1", false)
}

// fipsListenerConfig returns a valid TCP listener config using the shared
// reload test-fixtures, with the given cipher suites and minimum TLS
// version overrides applied. It is used by TestTCPListener_fipsCipherSuites
// below to exercise listenerutil.TLSConfig() directly (rather than through
// tcpListenerFactory) so the resulting *tls.Config can be inspected.
func fipsListenerConfig(cipherSuites []uint16, minVersion string) *configutil.Listener {
	wd, _ := os.Getwd()
	wd += "/test-fixtures/reload/"
	return &configutil.Listener{
		Address:               "127.0.0.1:0",
		TLSCertFile:           wd + "reload_foo.pem",
		TLSKeyFile:            wd + "reload_foo.key",
		TLSDisableClientCerts: true,
		TLSCipherSuites:       cipherSuites,
		TLSMinVersion:         minVersion,
	}
}

// TestTCPListener_fipsCipherSuites covers WO-029: FIPS-140-3 TLS 1.2
// minimum enforcement and Approved cipher suite allowlisting in
// listenerutil.TLSConfig(). Because this CE checkout has no fips-tagged
// implementation of helper/constants.IsFIPS that returns true (see
// fips/inventory/ce_fips_build_tag_verification.yaml), FIPS mode is
// simulated via listenerutil.OverrideFIPSModeForTesting instead of a
// fips-tagged build.
func TestTCPListener_fipsCipherSuites(t *testing.T) {
	approvedSuites := []uint16{
		tls.TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
		tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
		tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
		tls.TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,
	}
	nonApprovedSuite := tls.TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256

	// (a) FIPS mode, no cipher config configured -> Approved defaults.
	t.Run("fips mode with no cipher config uses Approved defaults", func(t *testing.T) {
		restore := listenerutil.OverrideFIPSModeForTesting(true)
		defer restore()

		tlsConf, _, err := listenerutil.TLSConfig(fipsListenerConfig(nil, ""), map[string]string{}, cli.NewMockUi())
		require.NoError(t, err)
		require.ElementsMatch(t, approvedSuites, tlsConf.CipherSuites)
	})

	// (b) FIPS mode, explicit Approved cipher config -> succeeds unchanged.
	t.Run("fips mode with Approved cipher config succeeds", func(t *testing.T) {
		restore := listenerutil.OverrideFIPSModeForTesting(true)
		defer restore()

		configured := approvedSuites[:2]
		tlsConf, _, err := listenerutil.TLSConfig(fipsListenerConfig(configured, ""), map[string]string{}, cli.NewMockUi())
		require.NoError(t, err)
		require.Equal(t, configured, tlsConf.CipherSuites)
	})

	// (c) FIPS mode, explicit non-Approved cipher config -> descriptive error.
	t.Run("fips mode with non-Approved cipher config returns error", func(t *testing.T) {
		restore := listenerutil.OverrideFIPSModeForTesting(true)
		defer restore()

		_, _, err := listenerutil.TLSConfig(fipsListenerConfig([]uint16{nonApprovedSuite}, ""), map[string]string{}, cli.NewMockUi())
		require.Error(t, err)
		require.Contains(t, err.Error(), "non-FIPS-Approved")
		require.Contains(t, err.Error(), "TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305")
	})

	// Edge case: a mix of Approved and non-Approved suites must reject the
	// entire configuration, not silently filter out the bad ones.
	t.Run("fips mode with mixed Approved and non-Approved cipher config rejects entire config", func(t *testing.T) {
		restore := listenerutil.OverrideFIPSModeForTesting(true)
		defer restore()

		mixed := []uint16{approvedSuites[0], nonApprovedSuite}
		_, _, err := listenerutil.TLSConfig(fipsListenerConfig(mixed, ""), map[string]string{}, cli.NewMockUi())
		require.Error(t, err)
		require.Contains(t, err.Error(), "TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305")
	})

	// (d) non-FIPS mode, any cipher config (including non-Approved) ->
	// unchanged legacy behavior, no enforcement.
	t.Run("non-fips mode with non-Approved cipher config succeeds unchanged", func(t *testing.T) {
		tlsConf, _, err := listenerutil.TLSConfig(fipsListenerConfig([]uint16{nonApprovedSuite}, ""), map[string]string{}, cli.NewMockUi())
		require.NoError(t, err)
		require.Equal(t, []uint16{nonApprovedSuite}, tlsConf.CipherSuites)
	})

	t.Run("non-fips mode with no cipher config leaves CipherSuites unset", func(t *testing.T) {
		tlsConf, _, err := listenerutil.TLSConfig(fipsListenerConfig(nil, ""), map[string]string{}, cli.NewMockUi())
		require.NoError(t, err)
		require.Empty(t, tlsConf.CipherSuites)
	})

	// implementation_steps #6: tls_min_version below tls12 must be
	// rejected outright under FIPS mode, not merely left at the tls12/tls13
	// defaults.
	t.Run("fips mode rejects tls10 minimum version", func(t *testing.T) {
		restore := listenerutil.OverrideFIPSModeForTesting(true)
		defer restore()

		_, _, err := listenerutil.TLSConfig(fipsListenerConfig(nil, "tls10"), map[string]string{}, cli.NewMockUi())
		require.Error(t, err)
		require.Contains(t, err.Error(), "FIPS")
	})

	t.Run("fips mode rejects tls11 minimum version", func(t *testing.T) {
		restore := listenerutil.OverrideFIPSModeForTesting(true)
		defer restore()

		_, _, err := listenerutil.TLSConfig(fipsListenerConfig(nil, "tls11"), map[string]string{}, cli.NewMockUi())
		require.Error(t, err)
		require.Contains(t, err.Error(), "FIPS")
	})

	t.Run("fips mode allows tls12 minimum version", func(t *testing.T) {
		restore := listenerutil.OverrideFIPSModeForTesting(true)
		defer restore()

		_, _, err := listenerutil.TLSConfig(fipsListenerConfig(nil, "tls12"), map[string]string{}, cli.NewMockUi())
		require.NoError(t, err)
	})

	t.Run("non-fips mode allows tls10 minimum version unchanged", func(t *testing.T) {
		_, _, err := listenerutil.TLSConfig(fipsListenerConfig(nil, "tls10"), map[string]string{}, cli.NewMockUi())
		require.NoError(t, err)
	})
}

func TestTCPListener_proxyProtocol(t *testing.T) {
	for name, tc := range map[string]struct {
		Behavior       string
		Header         *proxyproto.Header
		AuthorizedAddr string
		ExpectedAddr   string
		ExpectError    bool
	}{
		"none-no-header": {
			Behavior:     "",
			ExpectedAddr: "127.0.0.1",
			Header:       nil,
		},
		"none-v1": {
			Behavior:     "",
			ExpectedAddr: "127.0.0.1",
			ExpectError:  true,
			Header: &proxyproto.Header{
				Version:           1,
				Command:           proxyproto.PROXY,
				TransportProtocol: proxyproto.TCPv4,
				SourceAddr: &net.TCPAddr{
					IP:   net.ParseIP("10.1.1.1"),
					Port: 1000,
				},
				DestinationAddr: &net.TCPAddr{
					IP:   net.ParseIP("20.2.2.2"),
					Port: 2000,
				},
			},
		},
		"none-v2": {
			Behavior:     "",
			ExpectedAddr: "127.0.0.1",
			ExpectError:  true,
			Header: &proxyproto.Header{
				Version:           2,
				Command:           proxyproto.PROXY,
				TransportProtocol: proxyproto.TCPv4,
				SourceAddr: &net.TCPAddr{
					IP:   net.ParseIP("10.1.1.1"),
					Port: 1000,
				},
				DestinationAddr: &net.TCPAddr{
					IP:   net.ParseIP("20.2.2.2"),
					Port: 2000,
				},
			},
		},

		// use_always makes it possible to send the PROXY header but does not
		// require it
		"use_always-no-header": {
			Behavior:     "use_always",
			ExpectedAddr: "127.0.0.1",
			Header:       nil,
		},

		"use_always-header-v1": {
			Behavior:     "use_always",
			ExpectedAddr: "10.1.1.1",
			Header: &proxyproto.Header{
				Version:           1,
				Command:           proxyproto.PROXY,
				TransportProtocol: proxyproto.TCPv4,
				SourceAddr: &net.TCPAddr{
					IP:   net.ParseIP("10.1.1.1"),
					Port: 1000,
				},
				DestinationAddr: &net.TCPAddr{
					IP:   net.ParseIP("20.2.2.2"),
					Port: 2000,
				},
			},
		},
		"use_always-header-v1-unknown": {
			Behavior:     "use_always",
			ExpectedAddr: "127.0.0.1",
			Header: &proxyproto.Header{
				Version:           1,
				Command:           proxyproto.PROXY,
				TransportProtocol: proxyproto.UNSPEC,
			},
		},
		"use_always-header-v2": {
			Behavior:     "use_always",
			ExpectedAddr: "10.1.1.1",
			Header: &proxyproto.Header{
				Version:           2,
				Command:           proxyproto.PROXY,
				TransportProtocol: proxyproto.TCPv4,
				SourceAddr: &net.TCPAddr{
					IP:   net.ParseIP("10.1.1.1"),
					Port: 1000,
				},
				DestinationAddr: &net.TCPAddr{
					IP:   net.ParseIP("20.2.2.2"),
					Port: 2000,
				},
			},
		},
		"use_always-header-v2-unknown": {
			Behavior:     "use_always",
			ExpectedAddr: "127.0.0.1",
			Header: &proxyproto.Header{
				Version:           2,
				Command:           proxyproto.LOCAL,
				TransportProtocol: proxyproto.UNSPEC,
			},
		},
		"allow_authorized-no-header-in": {
			Behavior:       "allow_authorized",
			AuthorizedAddr: "127.0.0.1/32",
			ExpectedAddr:   "127.0.0.1",
		},
		"allow_authorized-no-header-not-in": {
			Behavior:       "allow_authorized",
			AuthorizedAddr: "10.0.0.1/32",
			ExpectedAddr:   "127.0.0.1",
		},
		"allow_authorized-v1-in": {
			Behavior:       "allow_authorized",
			AuthorizedAddr: "127.0.0.1/32",
			ExpectedAddr:   "10.1.1.1",
			Header: &proxyproto.Header{
				Version:           1,
				Command:           proxyproto.PROXY,
				TransportProtocol: proxyproto.TCPv4,
				SourceAddr: &net.TCPAddr{
					IP:   net.ParseIP("10.1.1.1"),
					Port: 1000,
				},
				DestinationAddr: &net.TCPAddr{
					IP:   net.ParseIP("20.2.2.2"),
					Port: 2000,
				},
			},
		},

		// allow_authorized still accepts the PROXY header when not in the
		// authorized addresses but discards it silently
		"allow_authorized-v1-not-in": {
			Behavior:       "allow_authorized",
			AuthorizedAddr: "10.0.0.1/32",
			ExpectedAddr:   "127.0.0.1",
			Header: &proxyproto.Header{
				Version:           1,
				Command:           proxyproto.PROXY,
				TransportProtocol: proxyproto.TCPv4,
				SourceAddr: &net.TCPAddr{
					IP:   net.ParseIP("10.1.1.1"),
					Port: 1000,
				},
				DestinationAddr: &net.TCPAddr{
					IP:   net.ParseIP("20.2.2.2"),
					Port: 2000,
				},
			},
		},

		"deny_unauthorized-no-header-in": {
			Behavior:       "deny_unauthorized",
			AuthorizedAddr: "127.0.0.1/32",
			ExpectedAddr:   "127.0.0.1",
		},
		"deny_unauthorized-no-header-not-in": {
			Behavior:       "deny_unauthorized",
			AuthorizedAddr: "10.0.0.1/32",
			ExpectedAddr:   "127.0.0.1",
			ExpectError:    true,
		},
		"deny_unauthorized-v1-in": {
			Behavior:       "deny_unauthorized",
			AuthorizedAddr: "127.0.0.1/32",
			ExpectedAddr:   "10.1.1.1",
			Header: &proxyproto.Header{
				Version:           1,
				Command:           proxyproto.PROXY,
				TransportProtocol: proxyproto.TCPv4,
				SourceAddr: &net.TCPAddr{
					IP:   net.ParseIP("10.1.1.1"),
					Port: 1000,
				},
				DestinationAddr: &net.TCPAddr{
					IP:   net.ParseIP("20.2.2.2"),
					Port: 2000,
				},
			},
		},
		"deny_unauthorized-v1-not-in": {
			Behavior:       "deny_unauthorized",
			AuthorizedAddr: "10.0.0.1/32",
			ExpectedAddr:   "127.0.0.1",
			ExpectError:    true,
			Header: &proxyproto.Header{
				Version:           1,
				Command:           proxyproto.PROXY,
				TransportProtocol: proxyproto.TCPv4,
				SourceAddr: &net.TCPAddr{
					IP:   net.ParseIP("10.1.1.1"),
					Port: 1000,
				},
				DestinationAddr: &net.TCPAddr{
					IP:   net.ParseIP("20.2.2.2"),
					Port: 2000,
				},
			},
		},
	} {
		t.Run(name, func(t *testing.T) {
			proxyProtocolAuthorizedAddrs := []*sockaddr.SockAddrMarshaler{}
			if tc.AuthorizedAddr != "" {
				sockAddr, err := sockaddr.NewSockAddr(tc.AuthorizedAddr)
				require.NoError(t, err)
				proxyProtocolAuthorizedAddrs = append(
					proxyProtocolAuthorizedAddrs,
					&sockaddr.SockAddrMarshaler{SockAddr: sockAddr},
				)
			}

			ln, _, _, err := tcpListenerFactory(&configutil.Listener{
				Address:                      "127.0.0.1:0",
				TLSDisable:                   true,
				ProxyProtocolBehavior:        tc.Behavior,
				ProxyProtocolAuthorizedAddrs: proxyProtocolAuthorizedAddrs,
			}, nil, cli.NewMockUi())
			require.NoError(t, err)

			connFn := func(lnReal net.Listener) (net.Conn, error) {
				d := net.Dialer{Timeout: 3 * time.Second}
				conn, err := d.Dial("tcp", lnReal.Addr().String())
				if err != nil {
					return nil, err
				}

				if tc.Header != nil {
					_, err = tc.Header.WriteTo(conn)
				}
				return conn, err
			}

			testListenerImpl(t, ln, connFn, "", 0, tc.ExpectedAddr, tc.ExpectError)
		})
	}
}

// TestTCPListener_proxyProtocol_keepAcceptingOnInvalidUpstream ensures that the server side listener
// never returns an error from the listener.Accept method if the error is that the
// upstream proxy isn't trusted. If an error is returned, underlying Go HTTP native
// libraries may close down a server and stop listening.
func TestTCPListener_proxyProtocol_keepAcceptingOnInvalidUpstream(t *testing.T) {
	timeout := 3 * time.Second

	// Configure proxy so we hit the deny unauthorized behavior.
	header := &proxyproto.Header{
		Version:           1,
		Command:           proxyproto.PROXY,
		TransportProtocol: proxyproto.TCPv4,
		SourceAddr: &net.TCPAddr{
			IP:   net.ParseIP("10.1.1.1"),
			Port: 1000,
		},
		DestinationAddr: &net.TCPAddr{
			IP:   net.ParseIP("20.2.2.2"),
			Port: 2000,
		},
	}

	var authAddrs []*sockaddr.SockAddrMarshaler
	sockAddr, err := sockaddr.NewSockAddr("10.0.0.1/32")
	require.NoError(t, err)
	authAddrs = append(authAddrs, &sockaddr.SockAddrMarshaler{SockAddr: sockAddr})

	ln, _, _, err := tcpListenerFactory(&configutil.Listener{
		Address:                      "127.0.0.1:0",
		TLSDisable:                   true,
		ProxyProtocolBehavior:        "deny_unauthorized",
		ProxyProtocolAuthorizedAddrs: authAddrs,
	}, nil, cli.NewMockUi())
	require.NoError(t, err)

	// Kick off setting up server side, if we ever accept a connection send it out
	// via a channel.
	serverConnCh := make(chan net.Conn, 1)
	go func() {
		serverConn, err := ln.Accept()
		// We shouldn't ever have an error if the problem was only that the upstream
		// proxy wasn't trusted.
		// An error would lead to the http.Serve closing the listener and giving up.
		require.NoError(t, err, "server side listener errored")
		serverConnCh <- serverConn
	}()

	// Now try to connect as the client.
	d := net.Dialer{Timeout: timeout}
	clientConn, err := d.Dial("tcp", ln.Addr().String())
	require.NoError(t, err)
	defer clientConn.Close()
	_, err = header.WriteTo(clientConn)
	require.NoError(t, err)

	// Wait for the server to have accepted a connection, or we time out.
	select {
	case <-time.After(timeout):
		// The server still hasn't accepted any valid client connection.
		// Try to write another header using the same connection which should have
		// been closed by the server, we expect that this client side connection was
		// closed as it us untrusted,
		_, err = header.WriteTo(clientConn)
		require.Error(t, err, "reused a rejected connection without error")
	case serverConn := <-serverConnCh:
		require.NotNil(t, serverConn)
		defer serverConn.Close()
	}
}
