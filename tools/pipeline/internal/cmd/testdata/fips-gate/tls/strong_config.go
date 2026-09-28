package strong

import "crypto/tls"

var cfg = &tls.Config{
	MinVersion: tls.VersionTLS12,
}
