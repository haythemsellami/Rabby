/** @jest-environment node */
import { Transaction, Submission } from 'viem-monad/monad';
import {
  PrivateKeyKeyring,
  MnemonicKeyring,
} from '@/background/service/keyring/monad';
import {
  prepareMonadTransaction,
  rebroadcastMonadTransaction,
} from '@/background/service/monad';
import {
  normalizeMonadRequest,
  prepareMonadFields,
  monadEnvelope,
  monadRpcRequest,
  assertMonadApproval,
  encodeMonadSubmission,
  monadHistoryRequest,
  monadRequestFromHistory,
  formatMonadPendingTransaction,
} from '@/utils/monad';

const from = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf';
const target = '0x000000000000000000000000000000000000ba7c';
const request = {
  type: '0x40',
  chainId: 20143,
  from,
  calls: [
    { to: from, value: '0x1', data: '0x1234' },
    { to: target, value: '0x2', data: '0xabcd' },
  ],
  nonce: '0x20000000000001',
  gas: '0x186a0',
  maxFeePerGas: '0x8',
  maxPriorityFeePerGas: '0x2',
};

it('preserves every call and maps signing data to node input without scalar placeholders', () => {
  const tx = prepareMonadFields(request);
  const wire = monadRpcRequest(tx);
  expect(tx.calls).toEqual(request.calls);
  expect(wire).toHaveProperty(
    'calls',
    request.calls.map(({ data, ...call }) => ({ ...call, input: data }))
  );
  for (const key of ['to', 'data', 'value']) {
    expect(tx).not.toHaveProperty(key);
    expect(wire).not.toHaveProperty(key);
  }
  const envelope = monadEnvelope(tx);
  expect(envelope.features.find(([key]) => key === '0x08')?.[1]).toHaveLength(
    2
  );
  expect(envelope.features.some(([key]) => key === '0x03')).toBe(false);
});

it.each(['to', 'value', 'data'])(
  'rejects a scalar %s even when explicitly null or undefined',
  (key) => {
    for (const value of [null, undefined, '0x'])
      expect(() => normalizeMonadRequest({ ...request, [key]: value })).toThrow(
        'cannot be combined'
      );
  }
);

it.each([
  [],
  null,
  {},
  [null],
  new Array(2),
  [{ to: target }, {}],
  [{ to: '0x1234' }],
  [{ to: target, data: '0x1' }],
  [{ to: target, value: `0x1${'0'.repeat(64)}` }],
  [{ to: target, input: '0x' }],
  [{ to: target, calls: [] }],
  [{ to: target, authorizationList: [] }],
])('rejects malformed or ambiguous batch entries: %j', (calls) => {
  expect(() => normalizeMonadRequest({ ...request, calls })).toThrow();
});

it('allows CREATE only at index zero and preserves one-entry CALLS as a batch', () => {
  const tx = prepareMonadFields({
    ...request,
    calls: [{ to: null, data: '0x6000' }],
  });
  expect(tx.calls).toEqual([{ data: '0x6000', value: '0x0' }]);
  expect(
    monadEnvelope(tx).features.find(([key]) => key === '0x08')?.[1]
  ).toHaveLength(1);
});

it('retains uint128 fee caps and uint256 call values', () => {
  expect(() =>
    prepareMonadFields({ ...request, maxFeePerGas: `0x${'f'.repeat(32)}` })
  ).not.toThrow();
  for (const field of ['maxFeePerGas', 'maxPriorityFeePerGas'])
    expect(() =>
      normalizeMonadRequest({ ...request, [field]: `0x1${'0'.repeat(32)}` })
    ).toThrow('uint128');
  expect(() =>
    prepareMonadFields({
      ...request,
      calls: [{ to: target, value: `0x${'f'.repeat(64)}` }],
    })
  ).not.toThrow();
});

it('binds count, order, contents and CALLS presence to approval', () => {
  const original = normalizeMonadRequest(request);
  for (const calls of [
    [...request.calls].reverse(),
    request.calls.slice(0, 1),
    [...request.calls, request.calls[0]],
    [request.calls[0], { ...request.calls[1], data: '0x' }],
    [request.calls[0], { ...request.calls[1], value: '0x3' }],
    [request.calls[0], { ...request.calls[1], to: from }],
  ])
    expect(() =>
      assertMonadApproval(original, prepareMonadFields({ ...request, calls }))
    ).toThrow('calls');
  const { calls, ...common } = request;
  expect(() =>
    assertMonadApproval(
      normalizeMonadRequest({ ...common, ...calls[0] }),
      prepareMonadFields({ ...common, calls: [calls[0]] })
    )
  ).toThrow();
});

it.each(['private', 'mnemonic'])(
  'signs the full batch with a %s keyring and rejects signed mutations',
  async (kind) => {
    const keyring =
      kind === 'private'
        ? new PrivateKeyKeyring(['1'.padStart(64, '0')])
        : new MnemonicKeyring({
            mnemonic:
              'test test test test test test test test test test test junk',
            activeIndexes: [0],
          } as any);
    const [address] = await keyring.getAccounts();
    const tx = prepareMonadFields({ ...request, from: address });
    const signed = await encodeMonadSubmission(
      await keyring.signTransaction(address, tx),
      tx
    );
    expect(
      Transaction.hash(
        Transaction.deserialize(signed.canonicalSerializedTransaction)
      )
    ).toBe(signed.transactionHash);
    expect(
      Transaction.serialize(Submission.deserialize(signed.submission))
    ).toBe(signed.canonicalSerializedTransaction);
    const changed = prepareMonadFields({
      ...request,
      from: address,
      calls: [...request.calls].reverse(),
    });
    await expect(
      encodeMonadSubmission(await keyring.signTransaction(address, changed), tx)
    ).rejects.toThrow('changed');
  }
);

it('keeps signed intent in history and rebroadcast bytes while pending reads expose no attempted calls', async () => {
  const tx = prepareMonadFields(request);
  const keyring = new PrivateKeyKeyring(['1'.padStart(64, '0')]);
  const signed = await encodeMonadSubmission(
    await keyring.signTransaction(from, tx),
    tx
  );
  const rawTx = JSON.parse(JSON.stringify(monadHistoryRequest(tx)));
  expect(monadRequestFromHistory(rawTx)).toEqual(tx);
  const pending = formatMonadPendingTransaction({
    rawTx,
    canonicalSerializedTransaction: signed.canonicalSerializedTransaction,
    hash: signed.transactionHash,
  });
  expect(pending).toMatchObject({
    calls: [],
    to: null,
    input: '0x',
    value: '0x0',
    accessList: [],
    authorizationList: [],
    nonce: request.nonce,
  });
  expect(rawTx.calls).toEqual(request.calls);
  const rpc = jest.fn(async (method, params) =>
    method === 'eth_chainId'
      ? '0x4eaf'
      : Transaction.hash(Submission.deserialize(params[0]))
  );
  await expect(
    rebroadcastMonadTransaction({
      canonical: signed.canonicalSerializedTransaction,
      submission: signed.submission,
      hash: signed.transactionHash,
      approved: monadRequestFromHistory(rawTx),
      rpc,
      assertSession: () => undefined,
    })
  ).resolves.toBe(signed.transactionHash);
  expect(rpc.mock.calls).toEqual([
    ['eth_chainId', []],
    ['eth_sendRawTransaction', [signed.submission]],
  ]);
  rawTx.calls.reverse();
  expect(
    formatMonadPendingTransaction({
      rawTx,
      canonicalSerializedTransaction: signed.canonicalSerializedTransaction,
      hash: signed.transactionHash,
    })
  ).toBeNull();
});

it('estimates a whole batch and does not reject values reused across calls', async () => {
  const value = (1n << 255n).toString(16);
  const rpc = jest.fn(
    async (method: string, _params: unknown[]) =>
      ({
        eth_chainId: '0x4eaf',
        eth_getTransactionCount: '0x0',
        eth_getBalance: `0x${'f'.repeat(64)}`,
        eth_estimateGas: '0xa410',
      }[method])
  );
  const { transaction } = await prepareMonadTransaction(
    {
      ...request,
      calls: [
        { to: from, value: `0x${value}` },
        { to: from, value: `0x${value}` },
      ],
    },
    rpc,
    new Set()
  );
  expect(transaction.calls).toHaveLength(2);
  expect(rpc).toHaveBeenCalledWith('eth_estimateGas', [
    expect.objectContaining({
      calls: expect.arrayContaining([
        { to: from, value: `0x${value}`, input: '0x' },
      ]),
    }),
    'pending',
  ]);
});
