# Neon + SQLite persistence contract

## Deployment requirements

Each Render web service must set `INVISTA_PLATFORM` to exactly one of:

- `v10` for Invista Pro V10
- `aura` for Aura System Style

Each service's `DATABASE_URL` must point to its own Neon PostgreSQL database. Do not reuse the same Neon database for both services. At boot, the migration claims the database with a singleton identity row and fails closed if the stored platform does not match the service. This prevents silent cross-platform sharing.

Both services must also configure the same valid `ENCRYPTION_KEY` across restarts of that platform so encrypted Deriv tokens remain decryptable. Never log or commit connection strings or keys.

## Data placement

Neon stores the durable essentials: users/identity, Deriv tokens and account association, trading configuration, risk/modality preferences, and modality-module configuration. Writes to these records are confirmed in Neon before the local SQLite copy is attempted. If Neon is unavailable, essential writes fail instead of reporting false success.

SQLite remains the local working store for trade operations/history, AI logs, market data, active sessions, WebSocket subscriptions, heartbeats, and other high-frequency operational state. These are not bulk-uploaded to Neon at startup. The balance shown for a Deriv account must be refreshed from Deriv and must not be treated as authoritative from a cached database value.

At boot, after the PostgreSQL schema migration, a one-time additive backfill imports only local users absent from Neon and their essential tokens/configurations/module settings. Existing Neon users always win; their local data never overwrites Neon. The completion marker is written only after the backfill succeeds. Then essential snapshots are restored from Neon into SQLite in a local transaction. For users present in Neon, token/configuration snapshots are reconciled against Neon. Trade history and market data are not touched by that reconciliation.

## Persistence limits

The SQLite file is stored at `database/investpro.db`. On Render instances without a persistent disk, local-only history, logs, and cache data may be lost on restart or redeploy. Neon restoration protects only the essential records listed above. If local trade history must survive deploys, attach a supported persistent disk or implement a separate archive; do not move every trade/tick into Neon as a workaround.

## Verification before production

1. Set the correct `INVISTA_PLATFORM` and a distinct Neon `DATABASE_URL` for each service.
2. Confirm the database identity row matches that platform.
3. Register/update a test user, DEMO token, selected modalities, risk preferences, and module-slot preferences.
4. Restart the service and confirm those records are restored from Neon into SQLite.
5. Confirm trades, ticks, AI logs, and WebSocket events do not create Neon rows.
6. Confirm a database-identity mismatch blocks API readiness and never silently switches to the other platform's data.
7. Keep Render auto-deploy disabled until CI and a controlled staging verification pass.
