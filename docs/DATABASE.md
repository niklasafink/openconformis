# Database and authentication foundation

## Hosted database decision

The official hosted deployment uses **Neon PostgreSQL in AWS Frankfurt
(`eu-central-1`) through the Vercel Marketplace**. Vercel Postgres is no longer a
separate product; new Vercel projects connect an external Postgres provider through
Marketplace. Drizzle is not a database provider: it remains the portable TypeScript
schema, query and migration layer above PostgreSQL.

Neon is the leanest fit because it provides pooled and direct endpoints, database
branches for Vercel previews, managed Postgres and point-in-time restore without
duplicating application Auth, Storage or Realtime. Supabase remains a valid
alternative, but those additional platform services are not used here. AWS Aurora
is unnecessarily operationally heavy for the public beta.

Production configuration:

- `DATABASE_URL`: pooled Neon endpoint for Vercel Functions, with
  `DATABASE_CLIENT_MAX=1` and `prepare: false`;
- `DATABASE_URL_UNPOOLED`: direct endpoint for the protected migration job only;
- `WORKER_DATABASE_URL`: direct endpoint for the persistent `pg-boss` worker;
- Production compute in Frankfurt with scale-to-zero disabled;
- an isolated Neon project for Production and branch-per-preview databases that
  never contain Production policies;
- point-in-time restore enabled and tested before confidential processing.

Use separate least-privilege roles for web, migrations and the worker. The worker
role needs the permissions required by its dedicated `pgboss` schema; the web role
must not have general schema-migration privileges.

References:

- [Postgres on Vercel](https://vercel.com/docs/postgres)
- [Vercel Marketplace storage](https://vercel.com/docs/marketplace-storage)
- [Neon connection pooling](https://neon.com/docs/connect/connection-pooling)
- [Neon scale to zero](https://neon.com/docs/introduction/scale-to-zero)

## Local PostgreSQL

The local profile uses the pinned PostgreSQL image in `compose.yaml`.

```bash
docker compose up -d postgres
cp .env.example .env.local
```

Set both local database URLs:

```dotenv
DATABASE_URL=postgresql://conformis:conformis@127.0.0.1:5432/conformis
DATABASE_URL_UNPOOLED=postgresql://conformis:conformis@127.0.0.1:5432/conformis
```

`DATABASE_URL` is the pooled application connection. `DATABASE_URL_UNPOOLED` is
reserved for release-time migrations. They may point to the same local database,
but hosted environments must use the provider's respective pooled and direct URLs.

## Migration workflow

The TypeScript schema is the source of truth. Application boot never mutates the
database.

```bash
pnpm db:generate
pnpm db:check
pnpm db:migrate
```

- `drizzle/0000_identity_tenancy.sql` contains the generated identity, tenancy,
  anonymous-draft, grant and audit tables.
- `drizzle/0001_identity_constraints.sql` is deliberately maintained SQL. It adds
  the concurrency-safe unique membership constraint and makes audit events
  append-only at database level.
- `drizzle/0002_regulatory_catalogue.sql` adds framework metadata, localized names,
  versioned releases, requirements and subrequirements.
- `drizzle/0003_catalogue_integrity.sql` enforces release integrity, matching
  parent/release ownership and immutable published regulatory content at database
  level.
- `drizzle/0004_catalogue_administrators.sql` separates global catalogue
  administrators from organization-level administrators.
- Production migrations run once in a release job against the direct connection;
  they never run from a Vercel request or application startup.

## Regulatory catalogue

The application has two explicit catalogue drivers:

```dotenv
CATALOGUE_DRIVER=fixture
```

- `fixture` keeps local development and source-available evaluation independent
  from PostgreSQL. It serves the typed DORA demo release directly.
- `database` requires `DATABASE_URL` and serves only persisted, published releases.
  It never silently falls back to fixtures.

Apply migrations and seed the initial catalogue locally:

```bash
pnpm db:migrate
pnpm db:seed:catalogue
```

The seed creates eight framework directory entries and publishes one explicitly
non-verified DORA demo release containing ten parent requirements. EU AML and
MaRisk remain included directory entries with zero published requirements until an
administrator publishes their first release. The seed is idempotent. If content
under an already published version changes, it fails and requires a new version.

Production execution is deliberately guarded:

```dotenv
CATALOGUE_SEED_PRODUCTION_CONFIRM=PUBLISH_DORA_DEMO_RELEASE
```

Do not use that confirmation as a general deployment default. The demo release is
not a legally reviewed source of truth.

Every requirement and subrequirement stores:

- regulatory ID, title, authoritative text and source locator;
- ordered assessment aspects;
- separate proportionality guidance for small, medium and large institutions;
- deterministic content hash and display order.

The size guidance changes expected evidence and implementation depth, never the
underlying legal obligation. Published release content is immutable. Editing starts
from a new draft, and publication assigns a release hash. Archiving hides a release
from new selections while preserving historical analyses.

Global catalogue administration requires an active `catalogue_administrators`
assignment. For first-time bootstrap only, a verified owner/admin account listed in
the server-only `CATALOGUE_ADMIN_EMAILS` variable is accepted. Organization admin
status alone does not grant permission to change global regulatory content.

## Neon Auth and application identity

Neon Auth owns credentials, provider accounts and sessions in Neon's managed
`neon_auth` schema. `src/server/db/schema/auth.ts` contains only the application's
identity projection and tenancy model. On the first authenticated application
request, the verified Neon user ID is mirrored into `public.users`; no credential
or session token is copied.

The application owns organizations, memberships and roles. This preserves stable
foreign keys and keeps authorization decisions in the application domain instead
of coupling them to an authentication-provider plugin.

Enable e-mail/password, magic link, Google and Microsoft in Neon Console. Provider
and mail credentials belong there, not in Vercel or this repository.

If `NEON_AUTH_BASE_URL` or a 32-character `NEON_AUTH_COOKIE_SECRET` is absent, the
auth route returns `503 authentication_not_configured`. The build remains possible
for public fixture deployments, but the fallback values cannot authenticate.

## Safe diagnostics

`GET /api/health` reports only whether the database is configured and reachable. It
does not return connection details, server versions, tenant counts or errors.

## Current tables

- Identity projection: users only; credentials and sessions exist exclusively in
  Neon's managed `neon_auth` schema.
- Tenancy: organizations, members and invitations.
- Public workflow: anonymous drafts with hashed cookie binding and expiry.
- Cost control: one sponsored-run grant per verified user.
- Operations: append-only audit events with bounded, redacted metadata.
- Regulatory catalogue: frameworks, localizations, immutable published releases,
  requirements, subrequirements and global catalogue-admin assignments.

Policies and analyses are added in later forward-only migrations.
