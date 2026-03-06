#!/bin/sh
set -eu

MAX_RETRIES="${DB_WAIT_RETRIES:-60}"
SLEEP_SECONDS="${DB_WAIT_SLEEP_SECONDS:-2}"

echo "[entrypoint] Waiting for PostgreSQL..."
attempt=1
until node -e "const net=require('net'); const raw=process.env.DATABASE_URL; if(!raw){process.exit(1)}; let u; try{u=new URL(raw)}catch{process.exit(1)}; const host=u.hostname||'db'; const port=Number(u.port||5432); const s=net.createConnection({host,port}); s.setTimeout(2000); s.on('connect',()=>{s.end(); process.exit(0)}); s.on('timeout',()=>{s.destroy(); process.exit(1)}); s.on('error',()=>process.exit(1));"; do
  if [ "$attempt" -ge "$MAX_RETRIES" ]; then
    echo "[entrypoint] Database did not become reachable after ${MAX_RETRIES} attempts."
    exit 1
  fi
  echo "[entrypoint] DB not ready yet (attempt ${attempt}/${MAX_RETRIES}), retrying in ${SLEEP_SECONDS}s..."
  attempt=$((attempt + 1))
  sleep "$SLEEP_SECONDS"
done

echo "[entrypoint] Running Prisma migrations..."
npx prisma migrate deploy --schema=prisma/schema.prisma

echo "[entrypoint] Starting app..."
exec npx tsx server.ts

