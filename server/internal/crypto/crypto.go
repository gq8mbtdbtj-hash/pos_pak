// Package crypto mirrors the desktop Rust vault crypto so packs stay interoperable.
//
// Alignment with src-tauri/src/services/crypto.rs:
//   - Argon2id, version 0x13 (19), params m=19456 KiB, t=2, p=1, 32-byte output.
//   - Domain-separated key derivation: argon2id(password, salt || info) -> 32 bytes.
//   - AES-256-GCM with a random 12-byte nonce prepended: out = nonce || ciphertext(+tag).
//   - Password hash stored as a standard Argon2id PHC string.
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

const (
	NonceLen = 12
	KeyLen   = 32
	SaltLen  = 16

	argonMemory  = 19456 // KiB
	argonTime    = 2
	argonThreads = 1
)

// Domain separation info strings (identical to the Rust constants).
var (
	infoDB    = []byte("personal-os/db-v1")
	infoSync  = []byte("personal-os/sync-v1")
	infoVault = []byte("personal-os/vault-v1")
)

// DerivedKeys holds the three split keys unlocked from the master password.
type DerivedKeys struct {
	DB    [KeyLen]byte
	Sync  [KeyLen]byte
	Vault [KeyLen]byte
}

// GenerateSalt returns SaltLen cryptographically random bytes.
func GenerateSalt() []byte {
	b := make([]byte, SaltLen)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return b
}

func deriveRaw(password string, salt, info []byte) [KeyLen]byte {
	material := make([]byte, 0, len(salt)+len(info))
	material = append(material, salt...)
	material = append(material, info...)
	out := argon2.IDKey([]byte(password), material, argonTime, argonMemory, argonThreads, KeyLen)
	var k [KeyLen]byte
	copy(k[:], out)
	return k
}

// DeriveKeyed exposes the domain-separated derivation for portable bundles.
func DeriveKeyed(password string, salt, info []byte) [KeyLen]byte {
	return deriveRaw(password, salt, info)
}

// DeriveKeysSplit derives the db/sync/vault keys from the master password.
func DeriveKeysSplit(password string, vaultSalt, syncSalt []byte) DerivedKeys {
	return DerivedKeys{
		DB:    deriveRaw(password, vaultSalt, infoDB),
		Sync:  deriveRaw(password, syncSalt, infoSync),
		Vault: deriveRaw(password, vaultSalt, infoVault),
	}
}

// HashPassword produces a standard Argon2id PHC string using a fresh random salt.
func HashPassword(password string, salt []byte) string {
	hash := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, KeyLen)
	b64 := base64.RawStdEncoding
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemory, argonTime, argonThreads,
		b64.EncodeToString(salt), b64.EncodeToString(hash))
}

// VerifyPassword checks a password against a stored Argon2id PHC string.
func VerifyPassword(password, phc string) bool {
	parts := strings.Split(phc, "$")
	// ["", "argon2id", "v=19", "m=..,t=..,p=..", "<salt>", "<hash>"]
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false
	}
	var version, mem, time, threads int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil {
		return false
	}
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &mem, &time, &threads); err != nil {
		return false
	}
	b64 := base64.RawStdEncoding
	salt, err := b64.DecodeString(parts[4])
	if err != nil {
		return false
	}
	want, err := b64.DecodeString(parts[5])
	if err != nil {
		return false
	}
	got := argon2.IDKey([]byte(password), salt, uint32(time), uint32(mem), uint8(threads), uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1
}

// Encrypt seals plaintext with AES-256-GCM; output = nonce(12) || ciphertext+tag.
func Encrypt(key [KeyLen]byte, plaintext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, NonceLen)
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	ct := gcm.Seal(nil, nonce, plaintext, nil)
	out := make([]byte, 0, NonceLen+len(ct))
	out = append(out, nonce...)
	out = append(out, ct...)
	return out, nil
}

// Decrypt opens a blob produced by Encrypt.
func Decrypt(key [KeyLen]byte, blob []byte) ([]byte, error) {
	if len(blob) < NonceLen+16 {
		return nil, errors.New("ciphertext too short")
	}
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := blob[:NonceLen]
	pt, err := gcm.Open(nil, nonce, blob[NonceLen:], nil)
	if err != nil {
		return nil, errors.New("解密失败：密码错误或数据已损坏")
	}
	return pt, nil
}

// ContentHash returns the hex SHA-256 of data.
func ContentHash(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
