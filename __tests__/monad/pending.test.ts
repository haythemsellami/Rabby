/** @jest-environment node */
import { ethers } from 'ethers';
import { privateKeyToAccount } from 'viem-monad/accounts';
import { Transaction, Submission } from 'viem-monad/monad';
import type { TransactionHistoryItem } from '@/background/service/transactionHistory';
import { formatTxMetaForRpcResult } from '@/background/utils/tx';
import {
  encodeMonadSubmission,
  monadEnvelope,
  prepareMonadFields,
} from '@/utils/monad';

const account = privateKeyToAccount(`0x${'1'.padStart(64, '0')}`);
const request = {
  type: '0x40',
  chainId: 20143,
  from: account.address.toLowerCase(),
  to: '0x0000000000000000000000000000000000000002',
  data: '0x1234',
  value: '0x0',
  nonce: '0x20000000000001',
  gas: '0x5208',
  maxFeePerGas: '0x100000000000000000000000000000001',
  maxPriorityFeePerGas: '0x0',
};

async function pending(overrides = {}): Promise<TransactionHistoryItem> {
  const approved = prepareMonadFields({ ...request, ...overrides });
  const canonicalSerializedTransaction = await Transaction.sign({
    account,
    transaction: monadEnvelope(approved),
  });
  const signed = await encodeMonadSubmission(
    { kind: 'monad', canonicalSerializedTransaction },
    approved
  );
  return {
    rawTx: { ...approved, to: approved.to ?? '' },
    canonicalSerializedTransaction,
    submissionTransaction: signed.submission,
    hash: signed.transactionHash,
    createdAt: 1,
    isCompleted: false,
    failed: false,
  } as TransactionHistoryItem;
}

it('returns native pending fields, full-width quantities and the actual signature', async () => {
  const item = await pending();
  const before = JSON.stringify(item);
  const tx = formatTxMetaForRpcResult(item);
  const decoded = ethers.utils.RLP.decode(
    `0x${item.canonicalSerializedTransaction!.slice(4)}`
  );
  const [parity, r, s] = decoded[1].find(([key]) => key === '0x06')[1];
  const expectedParity =
    parity === '0x' ? '0x0' : ethers.utils.hexValue(parity);

  expect(tx).toEqual({
    type: '0x40',
    chainId: '0x4eaf',
    from: request.from,
    to: request.to,
    input: request.data,
    value: '0x0',
    nonce: request.nonce,
    gas: request.gas,
    maxFeePerGas: request.maxFeePerGas,
    maxPriorityFeePerGas: '0x0',
    gasPrice: request.maxFeePerGas,
    hash: ethers.utils.keccak256(item.canonicalSerializedTransaction!),
    r: ethers.utils.hexZeroPad(r, 32),
    s: ethers.utils.hexZeroPad(s, 32),
    v: expectedParity,
    yParity: expectedParity,
    blockHash: null,
    blockNumber: null,
    transactionIndex: null,
  });
  expect(tx.hash).not.toBe(ethers.utils.keccak256(item.submissionTransaction!));
  decoded[1].find(([key]) => key === '0x06')[1] = [];
  const digest = ethers.utils.keccak256(
    `0x40${ethers.utils.RLP.encode(decoded).slice(2)}`
  );
  expect(
    ethers.utils
      .recoverAddress(digest, {
        r: tx.r,
        s: tx.s,
        recoveryParam: Number(BigInt(tx.yParity)),
      })
      .toLowerCase()
  ).toBe(request.from);
  expect(JSON.stringify(item)).toBe(before);
});

it('formats contract creation with a null destination', async () => {
  const item = await pending({ to: null });
  expect(item.rawTx.to).toBe('');
  expect(formatTxMetaForRpcResult(item)).toMatchObject({
    type: '0x40',
    to: null,
    input: '0x1234',
  });
});

it('preserves omitted, empty and populated access lists', async () => {
  const absent = await pending();
  const empty = await pending({ accessList: [] });
  const accessList = [
    { address: request.to, storageKeys: [`0x${'12'.repeat(32)}`] },
  ];
  const populated = await pending({ accessList });
  expect(formatTxMetaForRpcResult(absent)).not.toHaveProperty('accessList');
  expect(formatTxMetaForRpcResult(empty).accessList).toEqual([]);
  expect(formatTxMetaForRpcResult(populated).accessList).toEqual(accessList);
  expect(absent.hash).not.toBe(empty.hash);
});

it.each(['0x0', '0x1', '0x2', '0x3'])(
  'encodes zero/nonzero signature parity as a quantity for nonce %s',
  async (nonce) => {
    const item = await pending({ nonce });
    const tx = formatTxMetaForRpcResult(item);
    const decoded = ethers.utils.RLP.decode(
      `0x${item.canonicalSerializedTransaction!.slice(4)}`
    );
    const [parity] = decoded[1].find(([key]) => key === '0x06')[1];
    expect(tx.yParity).toBe(
      parity === '0x' ? '0x0' : ethers.utils.hexValue(parity)
    );
    expect(tx.v).toBe(tx.yParity);
  }
);

it.each([
  [
    'missing canonical bytes',
    (item) => delete item.canonicalSerializedTransaction,
  ],
  ['missing hash', (item) => delete item.hash],
  [
    'malformed bytes',
    (item) => (item.canonicalSerializedTransaction = '0x40c2'),
  ],
  [
    'submission bytes',
    (item) =>
      (item.canonicalSerializedTransaction = item.submissionTransaction),
  ],
  ['wrong hash', (item) => (item.hash = `0x${'00'.repeat(32)}`)],
  ['different nonce', (item) => (item.rawTx.nonce = '0x3')],
  ['different chain', (item) => (item.rawTx.chainId = 31337)],
  ['different fee', (item) => (item.rawTx.maxFeePerGas = '0x1')],
  ['different call', (item) => (item.rawTx.data = '0x')],
  ['different access-list presence', (item) => (item.rawTx.accessList = [])],
  ['unsupported fields', (item) => (item.rawTx.authorizationList = [])],
] as const)('returns no cached representation for %s', async (_, mutate) => {
  const item = await pending();
  mutate(item as any);
  expect(formatTxMetaForRpcResult(item)).toBeNull();
});

it('does not expose an unsigned envelope as a pending signed transaction', async () => {
  const item = await pending();
  const envelope = monadEnvelope(prepareMonadFields(request));
  item.canonicalSerializedTransaction = Transaction.serialize(envelope);
  item.hash = Transaction.hash(envelope);
  item.submissionTransaction = Submission.serialize(envelope);
  expect(formatTxMetaForRpcResult(item)).toBeNull();
});

it.each([
  [{ gasPrice: '0x7' }, { type: '0x0', gasPrice: '0x7' }],
  [
    { maxFeePerGas: '0x7', maxPriorityFeePerGas: '0x0' },
    {
      type: '0x2',
      gasPrice: '0x7',
      maxFeePerGas: '0x7',
      maxPriorityFeePerGas: '0x0',
    },
  ],
])('preserves existing Ethereum pending responses for %o', (fees, expected) => {
  const rawTx = {
    from: request.from,
    to: request.to,
    gas: '0x5208',
    nonce: '0x0',
    value: '0x0',
    data: '0x',
    r: '0x1',
    s: '0x2',
    v: '0x1b',
    ...fees,
  };
  const hash = `0x${'ab'.repeat(32)}`;
  expect(
    formatTxMetaForRpcResult({ rawTx, hash } as TransactionHistoryItem)
  ).toEqual({
    to: rawTx.to,
    gas: rawTx.gas,
    from: rawTx.from,
    hash,
    nonce: rawTx.nonce,
    input: rawTx.data,
    value: rawTx.value,
    blockHash: null,
    blockNumber: null,
    transactionIndex: null,
    r: rawTx.r,
    s: rawTx.s,
    v: rawTx.v,
    ...expected,
  });
});
