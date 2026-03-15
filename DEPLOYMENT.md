# Deployment (Single VPS, Docker Compose)

> Nota importante (Architettura A): questo repo supporta deploy con **Nginx su host + Docker Compose solo `db`/`backend` + frontend statico su host**. Eventuali riferimenti a `proxy`/`frontend` container in documentazione legacy non sono usati in Architettura A.

This project can run on a single VPS with:
- `app` (Node + Express + Vite-built frontend)
- `db` (PostgreSQL 16)

The app container:
1. waits for DB reachability
2. runs `prisma migrate deploy`
3. starts the server

## Prerequisites (VPS)

- Ubuntu/Debian VPS
- Docker Engine + Docker Compose plugin
- Git
- Reverse proxy already installed (recommended): Nginx or Caddy

## First-Time Setup (fresh VPS)

```bash
sudo apt-get update
sudo apt-get install -y git
git clone <YOUR_REPO_URL> dispatcher_operativo
cd dispatcher_operativo
cp .env.example .env
```

Edit `.env` and set at minimum:
- `DATABASE_URL`
- `JWT_SECRET`
- `POSTGRES_PASSWORD`
- `ALLOW_DEMO_TOKEN=false`

Start services:

```bash
docker compose up -d --build
```

Check logs:

```bash
docker compose logs -f app
docker compose logs -f db
```

Check health:

```bash
curl -sS http://127.0.0.1:3000/api/health
```

Expected response when ready:

```json
{"ok":true,"db":true}
```

If DB is temporarily unavailable, endpoint still returns `200` with `db:false` (readiness signal):

```json
{"ok":true,"db":false}
```

## Reverse Proxy (Nginx/Caddy) Notes

The app is exposed only on localhost:
- `127.0.0.1:3000` (app)
- `127.0.0.1:5432` (db, optional host access)

Proxy your domain to `http://127.0.0.1:3000`.

Important:
- `server.ts` is configured with `app.set("trust proxy", 1)` for production proxy setups.
- Rate limiting will correctly use proxy headers when the reverse proxy forwards client IPs.

## Nginx hardened reverse proxy example

A versioned example config is included at:

- `deploy/nginx/app.conf.example`

Typical install flow on VPS:

```bash
sudo cp deploy/nginx/app.conf.example /etc/nginx/sites-available/dispatcher_operativo.conf
sudo ln -s /etc/nginx/sites-available/dispatcher_operativo.conf /etc/nginx/sites-enabled/dispatcher_operativo.conf
sudo nginx -t
sudo systemctl reload nginx
```

Notes:
- The example on port 80 is only a baseline reverse proxy to `http://127.0.0.1:3000`.
- In production, prefer HTTP -> HTTPS redirect and configure HSTS only on the TLS server block (`listen 443 ssl`).
- TLS directives/certbot setup are intentionally not included in this file.
- Keep HSTS enabled only after HTTPS is stable on your production domain/subdomains.

## Update Workflow (safe + repeatable)

```bash
cd /path/to/dispatcher_operativo
git pull
docker compose up -d --build
docker compose logs --tail=100 app
curl -sS http://127.0.0.1:3000/api/health
```

Notes:
- DB migrations are automatically applied by the app entrypoint (`prisma migrate deploy`).
- No manual migration command is required during normal updates.

## Backups (Postgres)

Backup:

```bash
docker compose exec -T db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup_$(date +%F_%H%M%S).sql
```

Restore (from host file):

```bash
cat backup.sql | docker compose exec -T db psql -U "$POSTGRES_USER" "$POSTGRES_DB"
```

## Useful Commands

Show running containers:

```bash
docker compose ps
```

Tail logs:

```bash
docker compose logs -f app
docker compose logs -f db
```

Restart only app:

```bash
docker compose restart app
```

Rebuild app only:

```bash
docker compose up -d --build app
```

## Troubleshooting

### Migrations failing at startup

Symptoms:
- app container exits after startup
- logs show Prisma migration errors

Actions:

```bash
docker compose logs --tail=200 app
docker compose exec db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c '\dt'
```

Check `.env`:
- `DATABASE_URL` host must be `db` (inside compose network), not `localhost`

### DB not reachable

Check DB health:

```bash
docker compose ps
docker compose logs --tail=200 db
```

Check app health endpoint:

```bash
curl -sS http://127.0.0.1:3000/api/health
```

### Auth issues after deploy

Check:
- `JWT_SECRET` is set and unchanged across restarts
- client is using correct domain/proxy origin

### Frontend not loading in production

The server serves static files from `dist/` in production. Ensure app image was rebuilt:

```bash
docker compose up -d --build app
```

## Go-Live Checklist

1. `.env` created from `.env.example`
2. `JWT_SECRET` set to a long random secret
3. `POSTGRES_PASSWORD` changed from default
4. `ALLOW_DEMO_TOKEN=false`
5. Reverse proxy configured (HTTPS enabled)
6. `docker compose up -d --build` completed successfully
7. `curl http://127.0.0.1:3000/api/health` returns `{"ok":true,"db":true}`
8. Login works in browser
9. Basic flow test:
   - open intervention
   - open work report
   - save work report details
   - start/pause/stop timer flow (optional smoke test)
10. Backup command tested once
