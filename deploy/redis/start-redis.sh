#!/bin/sh
set -eu

case "$REDIS_PASSWORD" in
  *[!a-zA-Z0-9_-]*|"") echo "REDIS_PASSWORD must be URL-safe letters, digits, underscores or hyphens." >&2; exit 1 ;;
esac
case "${REDIS_MAXMEMORY:-192mb}" in
  *[!0-9mbgk]*) echo "Invalid REDIS_MAXMEMORY." >&2; exit 1 ;;
esac

if [ "${#REDIS_PASSWORD}" -lt 32 ]; then
  echo "REDIS_PASSWORD must contain at least 32 characters." >&2
  exit 1
fi

umask 077
mkdir -p /run/agencyos-redis
{
  echo "bind 0.0.0.0"
  echo "protected-mode yes"
  echo "port 6379"
  echo "appendonly yes"
  echo "appendfsync everysec"
  echo "save 60 1000"
  echo "maxmemory ${REDIS_MAXMEMORY:-192mb}"
  echo "maxmemory-policy noeviction"
  printf 'requirepass %s\n' "$REDIS_PASSWORD"
} > /run/agencyos-redis/redis.conf
chmod 600 /run/agencyos-redis/redis.conf
exec redis-server /run/agencyos-redis/redis.conf
