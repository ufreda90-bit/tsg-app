# Field Service SaaS

Operational field-service application for dispatchers and technicians:
- planner/dispatch board
- intervention lifecycle management
- technician work reports (bolla), attachments, signatures
- customer registry and intervention history

## Tech Stack

- Node.js + TypeScript
- Express API (`server.ts`)
- React + Vite frontend (served by Express in production)
- Prisma ORM
- PostgreSQL datasource

## Prerequisites

- Node.js 20+
- npm
- PostgreSQL 14+ (project uses PostgreSQL datasource via Prisma)

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create env file:

```bash
cp .env.example .env
```

3. Set required values in `.env`: `DATABASE_URL`, `JWT_SECRET`.

4. Generate Prisma client and apply migrations:

```bash
npm run db:generate
npm run db:migrate
```

5. (Optional) seed demo data:

```bash
npm run db:seed
```

6. Start development server:

```bash
npm run dev
```

Default app URL: `http://localhost:3000`

## Scripts

- `npm run dev` - run API + frontend in dev mode (`tsx watch server.ts`)
- `npm run build` - TypeScript build + Vite build
- `npm run lint` - TypeScript type-check (`tsc --noEmit`)
- `npm run clean` - remove `dist`

## Prisma / Database Commands

- `npm run db:generate` - regenerate Prisma client
- `npm run db:migrate` - create/apply migrations in development
- `npm run db:deploy` - apply existing migrations (deployment-safe)
- `npm run db:push` - sync schema without migrations (use carefully)
- `npm run db:seed` - run seed script

## Build & Run Commands

Development server:

```bash
npm run dev
```

Production build:

```bash
npm run build
```

Static preview build (Vite preview):

```bash
npm run preview
```

Notes:
- Commands above match the scripts currently defined in `package.json`.
- This repo currently has no dedicated `start` script for production process startup.
- In production, set `TRUST_PROXY=1` when behind reverse proxy.
- Configure `CORS_ALLOWED_ORIGINS` explicitly.
- Set `ALLOW_DEMO_TOKEN=false`.
- Use a strong `JWT_SECRET`.

## Deployment Notes

- Keep runtime env values outside git (`.env`, secrets manager, CI/CD variables).
- Run `npm run db:deploy` before (or during) startup.
- Ensure persistence for PostgreSQL data and `uploads/` directory (attachments, media).
- Existing deployment guidance is in `DEPLOYMENT.md`; validate it against your actual infrastructure before go-live.

## Backup Considerations

- Database backup (example):

```bash
pg_dump "$DATABASE_URL" > backup_$(date +%F_%H%M%S).sql
```

- Uploads backup (example):

```bash
tar -czf uploads_$(date +%F_%H%M%S).tar.gz uploads
```

- Restore planning should include both DB and `uploads/` for full data consistency.
