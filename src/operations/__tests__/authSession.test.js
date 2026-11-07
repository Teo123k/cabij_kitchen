import test from 'node:test';
import assert from 'node:assert/strict';
import { observeAuthUser } from '../authSession.js';
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  let callback, resolve, unsubscribed = false;
  const users = [], errors = [];
  const client = { auth: { onAuthStateChange(fn) { callback = fn; return { data: { subscription: { unsubscribe() { unsubscribed = true; } } } }; }, getUser() { return new Promise(r => { resolve = r; }); } } };
  const stop = observeAuthUser(client, { onUser: user => users.push(user), onError: error => errors.push(error) });
  return { users, errors, stop, event: (event, user) => callback(event, user ? { user } : null), resolve: user => resolve({ data: { user }, error: null }), unsubscribed: () => unsubscribed };
}
test('restored session and repeated SIGNED_IN preserve the same workspace identity', async () => { const h = harness(); await flush(); h.event('INITIAL_SESSION', { id: 'chef' }); h.event('SIGNED_IN', { id: 'chef' }); h.event('SIGNED_IN', { id: 'chef' }); h.event('TOKEN_REFRESHED', { id: 'chef' }); h.resolve({ id: 'chef' }); await flush(); assert.equal(h.users.length, 1); assert.equal(h.users[0].id, 'chef'); h.stop(); });
test('login after anonymous startup updates identity without a reload', async () => { const h = harness(); await flush(); h.resolve(null); await flush(); h.event('SIGNED_IN', { id: 'chef' }); assert.deepEqual(h.users, [false, { id: 'chef' }]); h.stop(); });
test('late startup response cannot sign a user back in after sign-out', async () => { const h = harness(); await flush(); h.event('SIGNED_OUT'); h.resolve({ id: 'stale-user' }); await flush(); assert.deepEqual(h.users, [false]); h.stop(); });
test('account switches emit the new identity and sign-out clears it', async () => { const h = harness(); await flush(); h.resolve({ id: 'first' }); await flush(); h.event('SIGNED_IN', { id: 'second' }); h.event('SIGNED_OUT'); assert.deepEqual(h.users, [{ id: 'first' }, { id: 'second' }, false]); h.stop(); });
test('unmount cancels startup and unsubscribes the listener', async () => { const h = harness(); await flush(); h.stop(); h.resolve({ id: 'chef' }); h.event('SIGNED_IN', { id: 'chef' }); await flush(); assert.equal(h.unsubscribed(), true); assert.deepEqual(h.users, []); });
