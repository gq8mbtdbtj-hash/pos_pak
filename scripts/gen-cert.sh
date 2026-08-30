#!/usr/bin/env bash
# 生成自签 TLS 证书，用于「内置 TLS 端到端加密」（花生壳/frp 只做 TCP 转发，链路明文只有你能解）。
# 免费、10 年有效、免维护。浏览器首次会提示「不受信任」，确认继续即可（自用可接受）。
#
# 用法:
#   scripts/gen-cert.sh <域名或IP> [输出目录]
# 例:
#   scripts/gen-cert.sh os.example.com          # 花生壳给的域名
#   scripts/gen-cert.sh 192.168.3.7             # 局域网/内网 IP
set -euo pipefail

HOST="${1:-}"
OUT="${2:-./tls}"
if [ -z "$HOST" ]; then
  echo "用法: $0 <域名或IP> [输出目录]" >&2
  echo "例:  $0 os.example.com   |   $0 192.168.3.7" >&2
  exit 1
fi

mkdir -p "$OUT"
if [[ "$HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  SAN="IP:${HOST},DNS:localhost,IP:127.0.0.1"
else
  SAN="DNS:${HOST},DNS:localhost,IP:127.0.0.1"
fi

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$OUT/privkey.pem" -out "$OUT/fullchain.pem" \
  -days 3650 -subj "/CN=${HOST}" -addext "subjectAltName=${SAN}"

chmod 600 "$OUT/privkey.pem"
echo
echo "✅ 已生成（10 年有效）:"
echo "   $OUT/fullchain.pem"
echo "   $OUT/privkey.pem"
echo
echo "以 HTTPS 直接监听（示例 8443）:"
echo "   POS_ADDR=0.0.0.0:8443 \\"
echo "   POS_TLS_CERT=$OUT/fullchain.pem POS_TLS_KEY=$OUT/privkey.pem \\"
echo "   POS_DIST_DIR=./dist POS_DATA_DIR=./data ./personal-os-server"
