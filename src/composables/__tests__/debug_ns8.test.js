// Quick debug test to trace NS8
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { _resetIDBSingleton } from '../useIDB.js';
import { _resetDirectusSyncSingleton, useDirectusSync } from '../useDirectusSync.js';
import { _resetDirectusClientSingleton } from '../useDirectusClient.js';
import { appConfig } from '../../utils/index.js';
import { _resetEnqueueSeq } from '../useSyncQueue.js';

async function flushPromises(rounds = 30) {
  for (let i = 0; i < rounds; i++) {
    await new Promise(r => setImmediate ? setImmediate(r) : setTimeout(r, 0));
  }
}

function directusListResponse(data) {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('debug NS8', () => {
  beforeEach(async () => {
    await _resetIDBSingleton();
    _resetDirectusSyncSingleton();
    _resetDirectusClientSingleton();
    _resetEnqueueSeq();
    vi.restoreAllMocks();
    vi.stubGlobal('navigator', { onLine: true });
    appConfig.directus = { enabled: true, url: 'https://directus.test', staticToken: 'tok_test', venueId: 1 };
  });
  afterEach(() => { _resetDirectusSyncSingleton(); vi.unstubAllGlobals(); });
  
  it('trace', async () => {
    let ordersFetchCount = 0;
    let resolveSlowFetch;
    const slowFetchPromise = new Promise(res => { resolveSlowFetch = res; });
    
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/items/orders')) {
        ordersFetchCount++;
        console.log('[MOCK] orders fetch #' + ordersFetchCount);
        if (ordersFetchCount === 1) {
          return slowFetchPromise.then(() => directusListResponse([]));
        }
        return Promise.resolve(directusListResponse([]));
      }
      return Promise.resolve(directusListResponse([]));
    });
    
    const sync = useDirectusSync();
    
    const pull1 = sync.forcePull();
    await flushPromises(20);
    
    console.log('[TEST] before pull2, ordersFetchCount=', ordersFetchCount);
    const pull2 = sync.forcePull();
    
    resolveSlowFetch();
    
    const [result1, result2] = await Promise.all([pull1, pull2]);
    
    console.log('[TEST] result2.ok=', result2.ok, 'ordersFetchCount=', ordersFetchCount);
    expect(ordersFetchCount).toBeGreaterThanOrEqual(2);
  });
});
