const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const html = readFileSync(join(__dirname, 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const hash = `0x${'ab'.repeat(32)}`;
const blockHash = `0x${'cd'.repeat(32)}`;
const address = `0x${'12'.repeat(20)}`;
const requested = {
  type: '0x40', chainId: '0x4eaf', from: address, to: address,
  value: '0x0', data: '0x',
};
const pending = {
  type: '0x40', chainId: requested.chainId, from: address, to: address,
  value: '0x0', input: '0x', hash, blockHash: null, blockNumber: null,
  transactionIndex: null,
};
const inclusion = { blockHash, blockNumber: '0x1', transactionIndex: '0x0' };
const mined = { ...pending, ...inclusion };
const receipt = {
  type: '0x40', status: '0x1', transactionHash: hash, from: address,
  to: address, ...inclusion,
};
const block = { hash: blockHash, number: '0x1', transactions: [mined] };
const complete = { transaction: mined, receipt, block };

function page(snapshots) {
  let now = 0;
  let attempt = -1;
  const calls = [];
  const waits = [];
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      textContent: '', value: '', addEventListener() {},
    });
    return elements.get(id);
  };
  const wallet = {
    isRabby: true,
    async request({ method, params }) {
      calls.push({ method, params });
      if (method === 'eth_chainId') return requested.chainId;
      if (method === 'eth_accounts') return [address];
      if (method === 'eth_getBalance') return '0x0';
      if (method === 'eth_getTransactionReceipt') attempt++;
      const snapshot = snapshots[Math.min(attempt, snapshots.length - 1)];
      if (method === 'eth_getTransactionReceipt') return snapshot.receipt;
      if (method === 'eth_getTransactionByHash') return snapshot.transaction;
      if (method === 'eth_getBlockByHash') return snapshot.block;
      throw new Error(`Unexpected RPC: ${method}`);
    },
  };
  const context = vm.createContext({
    window: { ethereum: wallet, addEventListener() {}, dispatchEvent() {} },
    document: { getElementById: element, querySelectorAll: () => [] },
    Event: class {},
    Date: class extends Date { static now() { return now; } },
    setTimeout(callback, delay) {
      waits.push({ result: JSON.parse(element('result').textContent),
        status: element('status').textContent });
      now += delay;
      callback();
    },
  });
  vm.runInContext(script, context);
  return {
    verify: (intent = requested) => context.verify(hash, intent), calls, waits,
    status: () => element('status').textContent,
    result: () => JSON.parse(element('result').textContent),
  };
}

test('waits for cached pending metadata after receipt and block inclusion arrive', async () => {
  const p = page([{ ...complete, transaction: pending }, complete]);
  await p.verify();
  assert.equal(p.waits.length, 1);
  assert.equal(p.waits[0].result.state, 'syncing');
  assert.equal(p.waits[0].result.transaction.type, '0x40');
  assert.match(p.waits[0].status, /Receipt received/);
  assert.equal(p.result().state, 'mined');
  assert.equal(p.result().readAttempts, 2);
  assert.equal(p.result().readVia, 'Rabby provider');
  assert.deepEqual(p.result().pendingTransaction, pending);
  assert.equal(p.result().pendingTransaction.type, '0x40');
  assert.equal(p.result().transaction.blockHash, blockHash);
  assert.match(p.status(), /^PASS:/);
});

test('does not invent pending evidence when the first response is already mined', async () => {
  const p = page([complete]);
  await p.verify();
  assert.equal(p.result().pendingTransaction, undefined);
  assert.equal(p.result().pendingObservedAt, undefined);
  assert.match(p.status(), /^PASS:/);
});

test('waits for missing receipt, transaction, persisted block and block entry', async () => {
  const p = page([
    { transaction: pending, receipt: null, block: null },
    { ...complete, transaction: null },
    { ...complete, block: null },
    { ...complete, block: { ...block, transactions: [] } },
    complete,
  ]);
  await p.verify();
  assert.equal(p.result().readAttempts, 5);
  assert.equal(p.waits[0].result.state, 'pending');
  assert.match(p.status(), /^PASS:/);
  assert(p.calls.every(({ method }) => !method.startsWith('eth_send')));
});

for (const [name, alter] of [
  ['transaction block hash', (s) => { s.transaction.blockHash = `0x${'ef'.repeat(32)}`; }],
  ['transaction block number', (s) => { s.transaction.blockNumber = '0x2'; }],
  ['transaction index', (s) => { s.transaction.transactionIndex = '0x1'; }],
  ['block hash', (s) => { s.block.hash = `0x${'ef'.repeat(32)}`; }],
  ['block number', (s) => { s.block.number = '0x2'; }],
  ['included transaction block hash', (s) => { s.block.transactions[0].blockHash = null; }],
  ['included transaction block number', (s) => { s.block.transactions[0].blockNumber = null; }],
  ['included transaction index', (s) => { s.block.transactions[0].transactionIndex = null; }],
  ['malformed inclusion quantity', (s) => { s.transaction.blockNumber = '1'; }],
]) {
  test(`waits for consistent ${name}`, async () => {
    // JSON cloning keeps the queried transaction and block entry independent.
    const stale = JSON.parse(JSON.stringify(complete));
    alter(stale);
    const p = page([stale, complete]);
    await p.verify();
    assert.equal(p.waits.length, 1);
    assert.equal(p.result().readAttempts, 2);
    assert.match(p.status(), /^PASS:/);
  });
}

for (const field of ['type', 'hash', 'chainId', 'from', 'to', 'value', 'input']) {
  for (const source of ['transaction', 'block transaction']) {
    test(`rejects an incorrect ${source} ${field} without a retry masking it`, async () => {
      const invalid = JSON.parse(JSON.stringify(complete));
      const tx = source === 'transaction' ? invalid.transaction : invalid.block.transactions[0];
      // A different hash in a block means the requested entry is absent, tested above.
      if (source === 'block transaction' && field === 'hash') {
        invalid.block.transactions[0].hash = `0x${'ef'.repeat(32)}`;
        const p = page([invalid]);
        await assert.rejects(p.verify(), /not yet consistent/);
        assert.doesNotMatch(p.status(), /^PASS:/);
        return;
      }
      tx[field] = field === 'type' ? '0x2' : field === 'value' ? '0x1' : field === 'input' ? '0x12' : '0x';
      const p = page([invalid, complete]);
      await assert.rejects(p.verify(), /do not match the native request/);
      assert.equal(p.waits.length, 0);
      assert.doesNotMatch(p.status(), /^PASS:/);
    });
  }
}

test('does not accept a type-2 pending cache entry even when the receipt is native', async () => {
  const p = page([{ ...complete, transaction: { ...pending, type: '0x2' } }, complete]);
  await assert.rejects(p.verify(), /do not match the native request/);
  assert.equal(p.waits.length, 0);
});

for (const field of ['type', 'transactionHash', 'from', 'to']) {
  test(`rejects incorrect receipt ${field}`, async () => {
    const p = page([{ ...complete, receipt: { ...receipt, [field]: '0x' } }]);
    await assert.rejects(p.verify(), /Receipt identity/);
  });
}

test('reports a reverted transaction', async () => {
  const p = page([{ ...complete, receipt: { ...receipt, status: '0x0' } }]);
  await assert.rejects(p.verify(), /did not succeed/);
  assert.equal(p.waits.length, 0);
});

test('times out a persistent pending record without resubmitting', async () => {
  const p = page([{ ...complete, transaction: pending }]);
  await assert.rejects(p.verify(), /Verify existing transaction; do not resend/);
  assert.equal(p.waits.length, 120);
  assert.equal(p.result().state, 'syncing');
  assert(p.calls.every(({ method }) => !method.startsWith('eth_send')));
  assert.doesNotMatch(p.status(), /^PASS:/);
});

const batchRequest = {
  type: '0x40', chainId: requested.chainId, from: address,
  calls: [{ to: address, value: '0x0', data: '0x1234' }, { to: address, value: '0x0', data: '0xabcd' }],
};
const batchTransaction = {
  ...mined, to: null, value: '0x0', input: '0x',
  calls: batchRequest.calls.map(({ data, ...call }) => ({ ...call, input: data })),
};
const batchComplete = {
  transaction: batchTransaction,
  receipt: { ...receipt, to: null, gasUsed: '0xa460', effectiveGasPrice: '0x17bfac7c00' },
  block: { ...block, transactions: [batchTransaction] },
};

test('accepts the empty pending projection, then verifies all executed batch entries and one fee', async () => {
  const projected = { ...pending, to: null, calls: [] };
  const p = page([{ ...batchComplete, transaction: projected }, batchComplete]);
  await p.verify(batchRequest);
  assert.equal(p.result().state, 'mined');
  assert.equal(p.result().attemptedCalls, 2);
  assert.equal(p.result().networkFeeWei, (BigInt('0xa460') * BigInt('0x17bfac7c00')).toString());
  assert.match(p.status(), /atomic batch succeeded/);
  assert.deepEqual(p.result().requested.calls, batchRequest.calls);
});

test('accepts the updated pending projection for an existing single call', async () => {
  const p = page([{ ...complete, transaction: { ...pending, to: null, calls: [] } }, complete]);
  await p.verify();
  assert.equal(p.result().state, 'mined');
});

for (const [name, change] of [
  ['missing calls', tx => delete tx.calls],
  ['empty mined calls', tx => { tx.calls = []; }],
  ['partial mined calls', tx => { tx.calls.pop(); }],
  ['reordered calls', tx => { tx.calls.reverse(); }],
  ['changed calldata', tx => { tx.calls[1].input = '0x'; }],
  ['changed destination', tx => { tx.calls[1].to = null; }],
  ['changed value', tx => { tx.calls[1].value = '0x1'; }],
]) test(`rejects batch ${name}`, async () => {
  const invalid = JSON.parse(JSON.stringify(batchComplete));
  change(invalid.transaction);
  await assert.rejects(page([invalid]).verify(batchRequest), /do not match/);
});

test('reports a failed batch without mistaking its attempted prefix for the full signed list', async () => {
  const failed = JSON.parse(JSON.stringify(batchComplete));
  failed.transaction.calls.pop();
  failed.receipt.status = '0x0';
  failed.receipt.to = address;
  const p = page([failed]);
  await assert.rejects(p.verify(batchRequest), /did not succeed/);
  assert.equal(p.result().state, 'failed');
  assert.deepEqual(p.result().requested.calls, batchRequest.calls);
});
