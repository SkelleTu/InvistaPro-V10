# Deriv API - Quick Reference Guide

## WebSocket Connection
**Endpoint:** `wss://ws.derivws.com/websockets/v3?app_id=YOUR_APP_ID`

**Test App ID:** 1089 (testing only)

**Keep-Alive:** Connection closes after 2 minutes of inactivity - send `ping` or `time` every 30-60 seconds

---

## Core Workflow

### 1. **authorize** - Authenticate Session
```json
{
  "authorize": "YOUR_API_TOKEN"
}
```
**Response:** Contains `balance`, `currency`, `loginid`, `email`, `scopes`
**Required:** Must be first call after connecting

### 2. **balance** - Get Account Balance
```json
{
  "balance": 1,
  "subscribe": 1
}
```
**Response:** Current `balance` and `currency`

### 3. **active_symbols** - Get Available Symbols
```json
{
  "active_symbols": "full"
}
```
**Response:** List of tradable symbols with metadata

### 4. **proposal** - Get Contract Price Quote
```json
{
  "proposal": 1,
  "amount": 100,
  "barrier": "0",
  "basis": "payout",
  "contract_type": "DIGITDIFF",
  "currency": "USD",
  "duration": 5,
  "duration_unit": "t",
  "symbol": "R_100"
}
```
**Response:** Quote with `id` (proposal_id needed for buy)
**Key Parameters:**
- `amount`: Stake amount in USD
- `basis`: "stake" or "payout"
- `contract_type`: DIGITDIFF, CALL, PUT, etc.
- `currency`: USD, EUR, GBP, etc.
- `duration`: How many ticks/seconds/minutes/hours
- `duration_unit`: "t" (ticks), "s" (seconds), "m" (minutes), "h" (hours), "d" (days)
- `symbol`: R_50, R_100, frxEURUSD, etc.
- `barrier`: For digit contracts (0-9 for which digit differs)

### 5. **buy** - Purchase Contract
```json
{
  "buy": "PROPOSAL_ID_FROM_PROPOSAL_RESPONSE",
  "price": 100
}
```
**Response:** Contains `contract_id`, `buy_price`, `payout`
**Must follow:** Successful `proposal` call

### 6. **proposal_open_contract** - Monitor Open Position
```json
{
  "proposal_open_contract": 1,
  "contract_id": "123456789",
  "subscribe": 1
}
```
**Response:** Live updates of contract status, profit/loss

### 7. **portfolio** - Get All Open Contracts
```json
{
  "portfolio": 1
}
```
**Response:** List of all open contracts for the account

### 8. **profit_table** - Trading History
```json
{
  "profit_table": 1,
  "description": 1,
  "limit": 50,
  "offset": 0
}
```
**Response:** Historical trades with profit/loss

### 9. **sell** - Close Contract Early
```json
{
  "sell": "CONTRACT_ID",
  "price": 50
}
```
**Response:** `sell_price` and status

### 10. **statement** - Account Statement
```json
{
  "statement": 1,
  "description": 1,
  "limit": 100,
  "offset": 0
}
```
**Response:** All account transactions (deposits, withdrawals, trades)

---

## Real-Time Subscriptions
Any call can include `"subscribe": 1` to get live updates:

```json
{
  "balance": 1,
  "subscribe": 1
}
```

Server will send updates when balance changes, instead of just one-time response.

---

## Keep-Alive Ping
Prevent connection timeout:
```json
{
  "time": 1
}
```
Send every 30-60 seconds when idle.

---

## Trading Symbols (DIGIT DIFFERS)

### Recommended for Digit Differs Strategy
- **R_50** - Random 50 (volatile, high movement)
- **R_75** - Random 75
- **R_100** - Random 100 (most common)
- **1HZ50V** - 1Hz 50 (50 ticks per hour)
- **1HZ75V** - 1Hz 75
- **1HZ100V** - 1Hz 100

### Duration Examples
- **1-10 ticks** - Ultra-short (1-5 seconds)
- **1-5 minutes** - Short term
- **1-24 hours** - Long term

---

## API Token Setup

1. Log in: https://app.deriv.com
2. Go to: **Settings → Security & Limits → API Token**
3. Click: **Create new token**
4. Select: Account type (CR = Real trading account)
5. Select Scopes:
   - ✅ **Trade** (Required for buy/sell)
   - ✅ **Read** (Required for balance/account info)
   - ❌ **Payments** (Not needed for trading)
   - ⚠️ **Admin** (Only if absolutely necessary - full account access)
6. Copy token immediately (not shown again for security!)

---

## Account Types

| Type | Description | Use Case |
|------|-------------|----------|
| **VRT** | Virtual Real Trade (Demo) | Testing/practice |
| **CR** | Real trading account | Live trading with real money |
| **CRW/VRW** | Wallet account | Not suitable for options trading |
| **MLT** | Maltainvest | EU regulated |

---

## Error Handling

### Common Errors
1. **"Unauthorized"** → Token invalid/expired
2. **"InvalidContractType"** → Symbol doesn't support contract type
3. **"InvalidDuration"** → Duration not allowed for symbol
4. **"InsufficientBalance"** → Not enough funds
5. **"RequestLimit"** → Rate limited (max 10 requests/second)

### Response Structure
```json
{
  "error": {
    "code": "ValidationError",
    "message": "Error details here"
  }
}
```

---

## Connection Lifecycle

```javascript
// 1. Connect to WebSocket
ws.connect("wss://ws.derivws.com/websockets/v3?app_id=1089");

// 2. Wait for onopen event
// 3. Send authorize request
send({authorize: "YOUR_TOKEN"});

// 4. Get balance
send({balance: 1});

// 5. Get available symbols
send({active_symbols: "full"});

// 6. Get proposal (quote)
send({proposal: 1, amount: 100, contract_type: "DIGITDIFF", ...});

// 7. Buy contract
send({buy: proposal_id, price: amount});

// 8. Monitor contract
send({proposal_open_contract: 1, contract_id: contract_id, subscribe: 1});

// 9. Keep connection alive (every 30-60 seconds)
send({time: 1});

// 10. When done - close
ws.close();
```

---

## Rate Limits
- **Max 10 requests per second**
- **Max 1000 concurrent subscriptions**
- **Connection timeout: 2 minutes** (send ping to keep alive)

---

## Resources
- **API Explorer:** https://api.deriv.com/api-explorer/
- **Official Docs:** https://developers.deriv.com/docs
- **GitHub JS:** https://github.com/deriv-com/deriv-api
- **GitHub Python:** https://github.com/deriv-com/python-deriv-api

---

**Last Updated:** December 19, 2025  
**API Version:** v3 (latest)
