package vault

import (
	"crypto/aes"
	"crypto/cipher"
)

var (
	_ = aes.BlockSize
	_ cipher.AEAD
)
