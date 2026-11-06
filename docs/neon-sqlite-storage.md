# Neon + SQLite persistence contract

## Deployment requirements

Each Render web service must set `INVISTA_PLATFORM` to exactly one of:

- `v10` for Invista Pro V10
- `aura` for Aura System Style

These are two visual deployments of the same platform, not separate trading systems. Both services must use the same `DATABASE_URL` and the same valid `ENCRYPTION_KEY`, so users, sessions, Deriv tokens, account associations, strategies, and preferences remain consistent whichever visual version a user opens. The migration claims the database with the shared `invista-core` identity and fails closed if that identity conflicts with an existing claim.

Keep the same valid `ENCRYPTION_KEY` across restarts and redeploys of both services so encrypted Deriv tokens remain decryptable. Never log or commit connection strings or keys.

## Data placement

Neon stores durable identity and operational records: users/identity, Deriv tokens and account association, trading configuration, risk/modality preferences, modality-module configuration, financial movements, KYC document metadata, and Deriv contract history. Writes to users, movements, KYC metadata, and contracts are confirmed in Neon before the local SQLite cache is updated. If Neon is unavailable, these writes fail instead of reporting false success.

SQLite is the local working cache and fallback for the execution engine. At boot, durable movements, KYC metadata and contract history are rehydrated from Neon into SQLite. AI logs, market data, transient active-session state, WebSocket subscriptions and heartbeats remain local/high-frequency data. The balance shown for a Deriv account must be refreshed from Deriv and must not be treated as authoritative from a cached database value.

At boot, after the PostgreSQL schema migration, the essential backfill imports local users absent from Neon and their essential tokens/configurations/module settings. A separate idempotent operational backfill imports legacy movements, KYC metadata and trade history by record ID using conflict-do-nothing semantics; existing Neon rows always win. The operational completion marker is written only after the full import succeeds. Durable records are then restored from Neon into SQLite. A user identity mismatch or missing durable parent account stops the backfill instead of creating orphan records.

Legacy active Deriv tokens from older schemas may have no `slot_index`. Migration preserves these rows and never deactivates them merely because the new column is initially NULL. The explicit `is_primary` marker distinguishes a real primary credential from Frenético slots; ambiguous legacy rows are not promoted automatically. Slot uniqueness is enforced only for rows with an explicit slot index. Slot indexes are recovered only by exact encrypted-token identity match against the corresponding local SQLite record; if no local match exists, legacy rows remain active and unassigned rather than guessing from timestamps or order.

## Persistence limits

The SQLite file is stored at `database/investpro.db`. On Render instances without a persistent disk, local cache, logs and transient state may be lost on restart; durable Neon records are restored on boot. KYC file bytes must never be stored in the Git repository or on ephemeral production disk. Production uploads use a private Supabase Storage bucket named `kyc-documents` (or `SUPABASE_KYC_BUCKET`) through the server-only `SUPABASE_SERVICE_ROLE_KEY`. The bucket is created as private with a 5 MB limit and an explicit MIME allowlist. Without `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, production KYC uploads fail closed with HTTP 503. Local disk storage is development-only. Legacy KYC files can be migrated with `npm run migrate:kyc-documents`; the command verifies each uploaded object by SHA-256 before updating its Neon record and stops with an error if any source file is missing. Do not delete the original files until the migration reports zero missing files. Add `uploads/documents/` to Git ignore and never commit customer documents.

## Verification before production

1. Set `INVISTA_PLATFORM=v10` for V10 and `INVISTA_PLATFORM=aura` for Aura; confirm both use the same Neon `DATABASE_URL` and `ENCRYPTION_KEY`.
2. Confirm the database identity row matches that platform.
3. Register/update a test user, DEMO token, selected modalities, risk preferences, and module-slot preferences.
4. Restart the service and confirm those records are restored from Neon into SQLite.
5. Confirm financial movements, KYC metadata and Deriv contract history persist in Neon and rehydrate to SQLite; confirm AI logs, market ticks and WebSocket events remain local.
6. Confirm a database-identity mismatch blocks API readiness and never silently switches to the other platform's data.
7. Configure the private Supabase KYC bucket and server-only service-role secret; verify upload, authenticated admin download and deletion/retention policy.
8. Keep Render auto-deploy disabled until CI and a controlled verification pass; deploy V10 and Aura from the same validated core commit.
