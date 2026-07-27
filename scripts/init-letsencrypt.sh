#!/usr/bin/env bash
# scripts/init-letsencrypt.sh — run this ONCE before the https nginx
# server block has a real certificate to serve. After this, the `certbot`
# service in docker-compose.yml handles renewal automatically every 12h.
#
# Usage:
#   ./scripts/init-letsencrypt.sh yourdomain.com you@yourdomain.com
#   ./scripts/init-letsencrypt.sh yourdomain.com you@yourdomain.com --staging   # test run, no rate limits
#
# Adapted from the well-known certbot+nginx+docker-compose pattern
# (https://github.com/wmnnd/nginx-certbot) for this project's compose file.

set -euo pipefail

DOMAIN="${1:?Usage: $0 <domain> <email> [--staging]}"
EMAIL="${2:?Usage: $0 <domain> <email> [--staging]}"
STAGING_FLAG=""
[[ "${3:-}" == "--staging" ]] && STAGING_FLAG="--staging"

DATA_PATH="./certbot-init-data"
RSA_KEY_SIZE=4096

echo "### Creating a dummy self-signed certificate so nginx can start at all ..."
mkdir -p "$DATA_PATH/conf/live/$DOMAIN"
docker compose run --rm --entrypoint "\
  openssl req -x509 -nodes -newkey rsa:$RSA_KEY_SIZE -days 1 \
    -keyout '/etc/letsencrypt/live/$DOMAIN/privkey.pem' \
    -out '/etc/letsencrypt/live/$DOMAIN/fullchain.pem' \
    -subj '/CN=localhost'" certbot

echo "### Starting nginx with the dummy certificate ..."
docker compose up --force-recreate -d nginx

echo "### Deleting dummy certificate ..."
docker compose run --rm --entrypoint "\
  rm -rf /etc/letsencrypt/live/$DOMAIN \
         /etc/letsencrypt/archive/$DOMAIN \
         /etc/letsencrypt/renewal/$DOMAIN.conf" certbot

echo "### Requesting the real Let's Encrypt certificate for $DOMAIN ..."
docker compose run --rm --entrypoint "\
  certbot certonly --webroot -w /var/www/certbot \
    $STAGING_FLAG \
    --email '$EMAIL' \
    -d '$DOMAIN' -d 'www.$DOMAIN' \
    --rsa-key-size $RSA_KEY_SIZE \
    --agree-tos \
    --non-interactive" certbot

echo "### Reloading nginx with the real certificate ..."
docker compose exec nginx nginx -s reload

echo "Done. Certificates will auto-renew via the 'certbot' service (checks every 12h)."
