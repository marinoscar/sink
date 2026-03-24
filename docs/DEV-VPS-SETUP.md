# DEV VPS Setup Guide

Complete guide for deploying a new application on the dev VPS at `*.dev.marin.cr`. This covers everything from domain mapping to running the app with Docker Compose.

---

## Prerequisites

- VPS with Docker and Docker Compose installed
- Wildcard SSL certificate for `*.dev.marin.cr` (already provisioned via certbot + dns-route53)
- External PostgreSQL container running on the `devnet` Docker network
- AWS account with Route53 access (for SSL renewal) and S3 bucket
- Google OAuth credentials configured in Google Cloud Console

---

## 1. SSL Certificate (Already in Place)

The VPS uses a **wildcard certificate** for `*.dev.marin.cr` via Let's Encrypt with DNS validation through AWS Route53. Any new `<app>.dev.marin.cr` subdomain is automatically covered — no new cert needed.

**Certificate location:**
```
/etc/letsencrypt/live/dev.marin.cr/fullchain.pem
/etc/letsencrypt/live/dev.marin.cr/privkey.pem
```

**Renewal:** Managed automatically by certbot using the `dns-route53` plugin. Certbot renewal config is at `/etc/letsencrypt/renewal/dev.marin.cr.conf`.

**If the cert ever needs to be re-issued:**
```bash
sudo certbot certonly --dns-route53 -d "*.dev.marin.cr" -d "dev.marin.cr"
```

This requires AWS IAM credentials with Route53 permissions available to certbot.

---

## 2. Nginx Wildcard Proxy Configuration

The host nginx uses a single wildcard vhost that maps subdomains to local Docker ports via a `map` block.

**File:** `/etc/nginx/sites-available/dev-wildcard`

```nginx
# Map subdomain → backend port
map $host $backend_port {
    knecta.dev.marin.cr       8319;
    clipboard.dev.marin.cr    8320;
    semantic.dev.marin.cr     8321;
    vitalmesh.dev.marin.cr    8322;
    shellkeep.dev.marin.cr    8323;
    sink.dev.marin.cr         3535;
}

# HTTPS server — catch-all for *.dev.marin.cr
server {
    listen 443 ssl;
    server_name *.dev.marin.cr;

    ssl_certificate /etc/letsencrypt/live/dev.marin.cr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dev.marin.cr/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    client_max_body_size 200m;

    if ($backend_port = "") {
        return 444;
    }

    location / {
        proxy_pass http://127.0.0.1:$backend_port;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_buffering off;
    }
}

# HTTP → HTTPS redirect
server {
    listen 80;
    server_name *.dev.marin.cr;
    return 301 https://$host$request_uri;
}
```

### Adding a new app subdomain

1. Edit the file:
   ```bash
   sudo nano /etc/nginx/sites-available/dev-wildcard
   ```

2. Add a line to the `map` block:
   ```nginx
   myapp.dev.marin.cr    <PORT>;
   ```

3. Test and reload:
   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```

That's it — the wildcard cert covers the new subdomain automatically.

---

## 3. Docker Network Setup

All apps share an external PostgreSQL instance running on a Docker bridge network called `devnet`. Application containers join this network to reach the database.

**Check the network exists:**
```bash
docker network ls | grep devnet
```

**If it doesn't exist, create it:**
```bash
docker network create devnet
```

**Verify the postgres container is on it:**
```bash
docker inspect postgres --format '{{json .NetworkSettings.Networks}}' | python3 -m json.tool
```

The postgres container should have `devnet` in its network list with an alias like `postgres`.

---

## 4. Setting Up the .env File

Copy the template and fill in values:

```bash
cd infra/compose
cp .env.example .env
```

**Key values to configure:**

```bash
# Project identity
COMPOSE_PROJECT_NAME=sink

# Application URL (must match your subdomain)
APP_URL=https://sink.dev.marin.cr

# Database — point to the external postgres container
# POSTGRES_HOST must match the container name/alias on the devnet network
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_USER=<your-db-user>
POSTGRES_PASSWORD=<your-db-password>
POSTGRES_DB=sink
POSTGRES_SSL=false

# JWT — generate strong secrets
# openssl rand -base64 32
JWT_SECRET=<generated-secret-min-32-chars>
COOKIE_SECRET=<generated-secret-min-32-chars>

# Google OAuth — from console.cloud.google.com
GOOGLE_CLIENT_ID=<your-client-id>
GOOGLE_CLIENT_SECRET=<your-client-secret>
GOOGLE_CALLBACK_URL=https://sink.dev.marin.cr/api/auth/google/callback

# AWS S3 — for file storage
S3_BUCKET=<your-bucket-name>
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=<your-key>
AWS_SECRET_ACCESS_KEY=<your-secret>

# First admin user
INITIAL_ADMIN_EMAIL=<your-email>

# Observability (disable unless you need it)
OTEL_ENABLED=false
```

**Important:** The `GOOGLE_CALLBACK_URL` must exactly match the authorized redirect URI in Google Cloud Console.

---

## 5. Vite Allowed Hosts

When running the dev server behind the VPS proxy, Vite blocks requests from unknown hosts. You must add your subdomain to `apps/web/vite.config.ts`:

```typescript
export default defineConfig({
  server: {
    port: 5173,
    host: true,
    allowedHosts: ['sink.dev.marin.cr'],  // <-- add your subdomain here
    // ...
  },
});
```

Without this, you'll see: `Blocked request. This host ("sink.dev.marin.cr") is not allowed.`

---

## 6. Docker Compose — Building and Starting

All commands run from `infra/compose/`:

```bash
cd infra/compose
```

### Build and start in dev mode (hot reload)
```bash
docker compose -f base.compose.yml -f dev.compose.yml up --build -d
```

### Check container status
```bash
docker compose -f base.compose.yml -f dev.compose.yml ps
```

### View logs
```bash
docker compose -f base.compose.yml -f dev.compose.yml logs -f api
docker compose -f base.compose.yml -f dev.compose.yml logs -f web
```

### Stop everything
```bash
docker compose -f base.compose.yml -f dev.compose.yml down
```

### Rebuild a single service
```bash
docker compose -f base.compose.yml -f dev.compose.yml up -d --build api
```

### Architecture
```
Internet (HTTPS:443)
    ↓
Host Nginx (SSL termination, *.dev.marin.cr wildcard)
    ↓ maps sink.dev.marin.cr → 127.0.0.1:3535
Docker Nginx (port 3535:80, path-based routing)
    ├── /api → API container (port 3000) ──→ devnet ──→ postgres
    └── /   → Web container (port 5173 dev / 80 prod)
```

---

## 7. Database Migrations and Seeding

The database is external (not a Docker container in this project). Prisma needs `DATABASE_URL` to connect. There are two ways to run migrations:

### Option A: Inside the API container (recommended)

The API container already has the env vars set and is on the `devnet` network:

```bash
# Apply migrations
docker exec sink-api-1 sh -c "node scripts/prisma-env.js migrate deploy"

# Run seed
docker exec sink-api-1 sh -c "node scripts/prisma-env.js db seed"

# Create a new migration (dev only — requires writable filesystem)
# Use Option B for this since dev compose mounts src as read-only
```

### Option B: From the host with DATABASE_URL

Read the values from `infra/compose/.env` and construct the URL:

```bash
cd apps/api

# Format: postgresql://USER:PASSWORD@HOST:PORT/DB
# The HOST must be reachable from where you run the command.
# If postgres is a Docker container, use localhost with the exposed port,
# or the container's IP on the devnet.

# Example using docker network IP (find it with docker inspect postgres):
DATABASE_URL="postgresql://admin:MyPassword@172.18.0.2:5432/sink" npx prisma migrate dev --name my_migration

# Seed
DATABASE_URL="postgresql://admin:MyPassword@172.18.0.2:5432/sink" npx prisma db seed
```

**Note:** `npx prisma migrate dev` creates migration files, so it must be run where the filesystem is writable (the host, not the read-only mounted container).

### How prisma-env.js works

The script at `apps/api/scripts/prisma-env.js` automatically constructs `DATABASE_URL` from individual env vars:

```
postgresql://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}
```

This is why `docker exec` works without specifying `DATABASE_URL` — the container already has the individual vars from the `.env` file.

### After schema changes

1. Edit `apps/api/prisma/schema.prisma`
2. Generate the Prisma client locally:
   ```bash
   cd apps/api && npx prisma generate
   ```
3. Create the migration from the host (Option B above)
4. Rebuild the API container to pick up new migration files:
   ```bash
   cd infra/compose
   docker compose -f base.compose.yml -f dev.compose.yml up -d --build api
   ```
5. Apply the migration inside the container:
   ```bash
   docker exec sink-api-1 sh -c "node scripts/prisma-env.js migrate deploy"
   ```

---

## 8. Google OAuth Setup

1. Go to [Google Cloud Console > Credentials](https://console.cloud.google.com/apis/credentials)
2. Create or select an OAuth 2.0 Client ID
3. Add the authorized redirect URI:
   ```
   https://sink.dev.marin.cr/api/auth/google/callback
   ```
4. Copy the Client ID and Client Secret into your `.env` file

**Tip:** If you reuse the same OAuth client across multiple apps, just add each app's callback URL as an additional authorized redirect URI.

---

## 9. Quick Start Checklist (New App)

For deploying a brand new app at `<app>.dev.marin.cr`:

- [ ] **Choose a port** — pick an unused port (check the nginx map block)
- [ ] **Add nginx mapping** — add `<app>.dev.marin.cr <PORT>;` to `/etc/nginx/sites-available/dev-wildcard` and reload
- [ ] **Create .env** — copy `.env.example`, set `APP_URL`, database credentials, OAuth, S3, admin email
- [ ] **Vite allowedHosts** — add `<app>.dev.marin.cr` to `vite.config.ts`
- [ ] **Docker network** — ensure the API service joins the `devnet` network in `base.compose.yml`
- [ ] **Google OAuth** — add `https://<app>.dev.marin.cr/api/auth/google/callback` as redirect URI
- [ ] **Build and start** — `docker compose -f base.compose.yml -f dev.compose.yml up --build -d`
- [ ] **Run migrations** — `docker exec <app>-api-1 sh -c "node scripts/prisma-env.js migrate deploy"`
- [ ] **Seed database** — `docker exec <app>-api-1 sh -c "node scripts/prisma-env.js db seed"`
- [ ] **Verify** — `curl https://<app>.dev.marin.cr/api/health`

---

## 10. Troubleshooting

### "Site not reachable" / Connection refused
- Check nginx map block has your subdomain → port mapping
- Verify nginx reloaded: `sudo nginx -t && sudo systemctl reload nginx`
- Verify containers are running: `docker compose -f base.compose.yml -f dev.compose.yml ps`
- Check the port matches: your compose exposes port X, nginx maps to port X

### "502 Bad Gateway"
- API container is still starting — wait 10-15 seconds and retry
- Check API logs: `docker compose -f base.compose.yml -f dev.compose.yml logs api`
- Common cause: API can't reach the database (wrong `POSTGRES_HOST` or not on `devnet`)

### Vite "Blocked request" error
- Add your subdomain to `allowedHosts` in `apps/web/vite.config.ts`
- Rebuild the web container: `docker compose -f base.compose.yml -f dev.compose.yml up -d --build web`

### "Can't reach database server"
- Verify the postgres container is running: `docker ps | grep postgres`
- Verify it's on the devnet: `docker inspect postgres --format '{{json .NetworkSettings.Networks}}'`
- Verify your `.env` has `POSTGRES_HOST=postgres` (the container hostname on devnet)
- Verify the API container is on devnet: check `base.compose.yml` has `devnet` in the api service networks

### Migration fails with "file or directory not found"
- Dev compose mounts `prisma/` as read-only — run `migrate dev` from the host (Option B), not inside the container
- For `migrate deploy` (applying existing migrations), running inside the container works fine

### OAuth redirect mismatch
- Ensure `GOOGLE_CALLBACK_URL` in `.env` exactly matches the redirect URI in Google Cloud Console
- Must be `https://`, not `http://`
- Path must be `/api/auth/google/callback`
