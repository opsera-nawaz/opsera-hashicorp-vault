package weak

import "crypto/tls"

var cfg = &tls.Config{
	MinVersion: tls.VersionTLS11,
}
