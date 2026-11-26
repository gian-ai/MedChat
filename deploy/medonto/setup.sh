#!/usr/bin/env bash
# Run once on homelab from this folder. Writes .env and the admin login without printing secrets.
set -euo pipefail
umask 077
if [ ! -f .env ]; then
  key=$(grep -E '^API_KEYS=' ../../../med-ontology/.env | sed -E 's/^API_KEYS=([^:]+):.*/\1/')
  {
    echo "MEDONTO_API_KEY=$key"
    echo "JWT_SECRET=$(openssl rand -hex 32)"
    echo "JWT_REFRESH_SECRET=$(openssl rand -hex 32)"
    echo "CREDS_KEY=$(openssl rand -hex 32)"
    echo "CREDS_IV=$(openssl rand -hex 16)"
    echo "DOMAIN_CLIENT=http://192.168.8.10:3080"
    echo "DOMAIN_SERVER=http://192.168.8.10:3080"
  } > .env
fi
mkdir -p ~/.config/medonto
[ -f ~/.config/medonto/librechat-admin ] || { echo "admin@medonto.local"; openssl rand -base64 18; } > ~/.config/medonto/librechat-admin
