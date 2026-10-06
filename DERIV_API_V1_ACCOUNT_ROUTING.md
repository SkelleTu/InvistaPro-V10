# Deriv API v1 Account Routing

## Current architecture

Invista must treat the user's PAT/OAuth authorization token as the credential and the Deriv Options account as the execution scope.

The account is selected before the authenticated WebSocket is opened:

1. Send `Authorization: Bearer <token>` to `GET https://api.derivws.com/trading/v1/options/accounts`.
2. Resolve the requested `accountType`: `demo` or `real`.
3. Resolve the corresponding `accountId`.
4. Call `POST https://api.derivws.com/trading/v1/options/accounts/{accountId}/otp`.
5. Use the returned `data.url` immediately.
6. The returned WebSocket URL is account-scoped:
   - `wss://api.derivws.com/trading/v1/options/ws/demo?otp=...`
   - `wss://api.derivws.com/trading/v1/options/ws/real?otp=...`
7. Trading calls such as balance, proposal, buy, sell and open-contract monitoring are sent through that already authenticated account-scoped WebSocket.

## Important safety rule

The application must never decide Demo vs Real by merely changing a token value or by sending an account selector inside individual trading calls.

A WebSocket connection is bound to exactly one account context:

`authorization token -> accountId -> OTP -> demo/real WebSocket -> account operations`

Switching from Demo to Real must create a new account context and a new authenticated WebSocket. Never reuse a Demo socket for Real, or a Real socket for Demo.

## PAT headers

For PAT authentication, REST requests require:

`Authorization: Bearer <PAT>`

and:

`Deriv-App-ID: <APP_ID>`

OAuth access tokens do not require the Deriv-App-ID header according to the current Deriv documentation.

## OTP

OTP is short-lived and single-use. Generate it immediately before connecting and never persist it as a long-lived credential.

## Legacy API

The old `wss://ws.derivws.com/websockets/v3?app_id=...` + `authorize` architecture is legacy for this account-routing layer. It must not be used for the new Options account gateway.

## Implementation

Canonical gateway:

`server/services/deriv-account-gateway.ts`

Trading service:

`server/services/deriv-api.ts`

The trading service receives an account-scoped WebSocket from the gateway and does not perform a second `authorize` call.

## Audit requirements

CI must verify:

- centralized account context exists;
- Demo and Real are explicit values;
- accountId is resolved;
- OTP endpoint is used;
- PAT REST requests include Deriv-App-ID;
- the authenticated WebSocket URL is validated against the requested account type;
- legacy v3 WebSocket/authentication markers are absent from the active trading implementation;
- TypeScript compilation passes.

Source of truth: current Deriv developer documentation.
