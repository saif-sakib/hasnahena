package utils

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
)

// GenerateReceipt creates a standardized receipt or loan number
// Format: [PREFIX]-[YYYYMMDD]-[RANDOM(6)]
func GenerateReceipt(prefix string) string {
	dateStr := time.Now().Format("20060102")
	b := make([]byte, 3)
	rand.Read(b)
	suffix := strings.ToUpper(hex.EncodeToString(b))
	return fmt.Sprintf("%s-%s-%s", prefix, dateStr, suffix)
}
