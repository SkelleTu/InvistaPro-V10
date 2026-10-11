import assert from 'node:assert/strict';
import { selectModuleTokenForAccount } from '../server/services/module-account-routing';

const tokens = [
  { slotIndex: 0, token: 'demo-slot-0', accountType: 'demo', isActive: true },
  { slotIndex: 1, token: 'real-slot-1', accountType: 'real', isActive: true },
  { slotIndex: 2, token: 'inactive-real', accountType: 'real', isActive: false },
  { slotIndex: null, token: 'main-demo', accountType: 'demo', isActive: true },
];

assert.equal(selectModuleTokenForAccount(tokens, 0, 'demo')?.token, 'demo-slot-0', 'prefer matching slot');
assert.equal(selectModuleTokenForAccount(tokens, 0, 'real')?.token, 'real-slot-1', 'select requested account type independently');
assert.equal(selectModuleTokenForAccount(tokens, 1, 'real')?.token, 'real-slot-1', 'prefer slot with matching account type');
assert.equal(selectModuleTokenForAccount(tokens, 8, 'demo')?.token, 'main-demo', 'use same-type primary token before another slot');
assert.equal(selectModuleTokenForAccount(tokens, 8, 'real')?.token, 'real-slot-1', 'never select a Demo token for Real');
assert.equal(selectModuleTokenForAccount(tokens, 8, 'demo')?.accountType, 'demo');
assert.equal(selectModuleTokenForAccount([{ slotIndex: 0, token: 'only-demo', accountType: 'demo', isActive: true }], 0, 'real'), undefined, 'no cross-environment fallback');
console.log('Module account routing tests passed.');
