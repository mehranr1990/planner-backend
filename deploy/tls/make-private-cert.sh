#!/bin/sh
# Private CA + server certificate for Nginx Proxy Manager ("Custom" SSL).
# No public CA issues certificates for *.localhost or a bare private IP.
# Keep the output directory OUTSIDE the repository; never commit it.
#   sh deploy/tls/make-private-cert.sh <out-dir> [dns-or-ip ...]
# Default names: planner.localhost localhost 127.0.0.1. Works in Git Bash and Linux (OpenSSL 1.1.1+).
# CA_DIR=<existing-out-dir> signs a new server certificate with that existing CA
# (clients keep trusting the same root); <out-dir> then receives server.* only.
set -eu
export MSYS_NO_PATHCONV=1 # keep "/CN=..." intact under Git Bash
out=${1:?Usage: make-private-cert.sh <out-dir> [dns-or-ip ...]}
shift
[ "$#" -gt 0 ] || set -- planner.localhost localhost 127.0.0.1
umask 077
mkdir -p "$out"
ca_dir=${CA_DIR:-$out}
if [ -e "$out/server.key" ] || { [ -z "${CA_DIR:-}" ] && [ -e "$out/ca.key" ]; }; then
  echo "Refusing to overwrite existing keys in $out" >&2
  exit 1
fi
if [ -n "${CA_DIR:-}" ] && [ ! -r "$ca_dir/ca.key" ]; then
  echo "CA_DIR has no readable ca.key: $ca_dir" >&2
  exit 1
fi
san=''
for name in "$@"; do
  case $name in
    *:*) entry="IP:$name" ;;
    *[!0-9.]*) entry="DNS:$name" ;;
    *) entry="IP:$name" ;;
  esac
  san="${san:+$san,}$entry"
done
[ -n "${CA_DIR:-}" ] || openssl req -x509 -newkey rsa:3072 -sha256 -days 825 -nodes \
  -keyout "$out/ca.key" -out "$out/ca.crt" -subj "/CN=Mehran Planner Private CA" \
  -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
openssl req -newkey rsa:2048 -sha256 -nodes -keyout "$out/server.key" \
  -out "$out/server.csr" -subj "/CN=$1" 2>/dev/null
printf 'subjectAltName=%s\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' \
  "$san" >"$out/server.ext"
openssl x509 -req -in "$out/server.csr" -CA "$ca_dir/ca.crt" -CAkey "$ca_dir/ca.key" \
  -CAcreateserial -CAserial "$out/ca.srl" -days 397 -sha256 -extfile "$out/server.ext" -out "$out/server.crt" 2>/dev/null
rm -f "$out/server.csr" "$out/server.ext"
echo "Root CA: $ca_dir/ca.crt (trust as root CA on client devices)."
printf "Created "
echo "$out/server.crt + $out/server.key (upload to NPM as a Custom certificate)."
echo "Keep $ca_dir/ca.key offline; it can sign certificates your devices trust."
