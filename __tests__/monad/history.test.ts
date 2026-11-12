/** @jest-environment node */
jest.mock('background/utils', () => ({
  createPersistStore: jest.fn(async ({ template }) =>
    structuredClone(template)
  ),
  isSameAddress: (a: string, b: string) => a.toLowerCase() === b.toLowerCase(),
}));
jest.mock('@/background/service/openapi', () => ({
  __esModule: true,
  default: {},
}));
jest.mock('@/background/service/permission', () => ({
  __esModule: true,
  default: {
    getConnectedSite: () => ({
      origin: 'https://example.test',
      chain: 'CUSTOM_31337',
    }),
  },
}));
jest.mock('consts', () => ({
  INTERNAL_REQUEST_ORIGIN: 'internal',
  CHAINS_ENUM: {},
  EVENTS: {},
  EVENTS_IN_BG: {},
}));
jest.mock('@/utils/chain', () => ({
  findChainByID: () => ({ id: 31337, isTestnet: true }),
  findChain: ({ id }) => ({
    id: id ?? 31337,
    isTestnet: true,
    scanLink: '',
    name: 'Development',
  }),
  findChainByEnum: () => ({ id: 31337, isTestnet: true }),
}));
jest.mock('@/utils/transaction', () => ({ makeTransactionId: jest.fn() }));
jest.mock('@/utils/history', () => ({ getGasDepositTxKey: jest.fn() }));
jest.mock('@/eventBus', () => ({
  __esModule: true,
  default: { emit: jest.fn() },
}));
jest.mock('@/background/service/customTestnet', () => ({
  customTestnetService: { getTx: jest.fn(), getTransactionReceipt: jest.fn() },
}));
jest.mock('background/service', () => ({
  RPCService: {},
  uninstalledService: { setTx: jest.fn() },
  transactionHistoryService: { reloadTx: jest.fn() },
  i18n: { t: jest.fn((key) => key) },
}));
jest.mock('background/webapi', () => ({ notification: { create: jest.fn() } }));
jest.mock('@/utils', () => ({ getTxScanLink: jest.fn(() => '') }));
jest.mock('interval-promise', () => jest.fn());

import history, {
  TransactionHistoryItem,
} from '@/background/service/transactionHistory';
import watcher from '@/background/service/transactionWatcher';
import { customTestnetService } from '@/background/service/customTestnet';
import { transactionHistoryService } from 'background/service';
import { createPersistStore } from 'background/utils';

const address = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf';
function add(nonce: bigint, type = '0x40') {
  const hash = `0x${nonce.toString(16).padStart(64, '0')}`;
  const tx: TransactionHistoryItem = {
    rawTx: {
      type,
      from: address,
      to: address,
      chainId: 31337,
      nonce: `0x${nonce.toString(16)}`,
      gas: '0x5208',
      maxFeePerGas: '0x8',
      maxPriorityFeePerGas: '0x2',
      value: '0x0',
      data: '0x',
    } as any,
    hash,
    createdAt: Date.now(),
    isCompleted: false,
    failed: false,
    canonicalSerializedTransaction: '0x40c2',
    submissionTransaction: '0x40c3',
  };
  history.addTx({
    tx,
    explain: undefined,
    actionData: undefined,
    origin: 'https://example.test',
  });
  return tx;
}

beforeEach(async () => {
  jest.clearAllMocks();
  history.removeAllSigningTx();
  await history.init();
  await watcher.init();
});

it('reserves submitted Ethereum nonces but excludes unsubmitted and completed transactions', () => {
  const tx = add(5n, '0x2');
  const group = history.getTxGroup({ address, chainId: 31337, nonce: 5 })!;
  group.isPending = false;
  const id = history.addSigningTx({ ...tx.rawTx, nonce: '0x6' });
  expect(history.getMonadReservedNonces(address, 31337)).toEqual(new Set());
  history.updateSigningTx(id, { isSubmitted: true });
  expect(history.getMonadReservedNonces(address, 31337)).toEqual(new Set([6n]));
  expect(history.getMonadReservedNonces(address, 31338)).toEqual(new Set());
  history.removeSigningTx(id);
  expect(history.getMonadReservedNonces(address, 31337)).toEqual(new Set());
});

it('keeps adjacent wide nonces distinct through sorting, lookup, and storage reload', async () => {
  add(1n, '0x2');
  const first = add(9007199254740992n);
  add(9007199254740993n);
  expect(
    history.getList(address).pendings.map((group) => group.nonce)
  ).toEqual(['9007199254740993', '9007199254740992', 1]);
  expect(
    history.getPendingTxsByNonce(address, 31337, '0x20000000000000')[0].txs[0]
      .hash
  ).toBe(first.hash);
  expect(history.getMonadReservedNonces(address, 31337)).toEqual(
    new Set([1n, 9007199254740992n, 9007199254740993n])
  );
  const snapshot = JSON.parse(JSON.stringify(history.store));
  jest.mocked(createPersistStore).mockResolvedValueOnce(snapshot);
  await history.init();
  expect(history.getList(address).pendings).toHaveLength(3);
  expect(
    history.getTxGroup({ address, chainId: 31337, nonce: '0x20000000000000' })!
      .txs[0].canonicalSerializedTransaction
  ).toBe('0x40c2');
});

it.each([0, 1])(
  'uses canonical hashes to complete a wide-nonce receipt with status %s',
  async (status) => {
    const tx = add(9007199254740993n);
    jest.mocked(customTestnetService.getTx).mockResolvedValue({
      hash: tx.hash,
      code: 0,
      status,
      gas_used: 21000,
    } as any);
    await history.reloadTx({
      address,
      chainId: 31337,
      nonce: '0x20000000000001',
    });
    expect(customTestnetService.getTx).toHaveBeenCalledWith({
      chainId: 31337,
      hash: tx.hash,
    });
    const group = history.getTxGroup({
      address,
      chainId: 31337,
      nonce: '9007199254740993',
    });
    expect(group!.isPending).toBe(false);
    expect(group!.isFailed).toBe(status === 0);
    expect(group!.txs[0].hash).toBe(tx.hash);
  }
);

it('forwards an exact nonce from the watcher to receipt reconciliation', async () => {
  const tx = add(9007199254740993n);
  const id = `${address}_0x20000000000001_CUSTOM_31337`;
  watcher.addTx(id, {
    chain: 'CUSTOM_31337' as any,
    hash: tx.hash!,
    nonce: '0x20000000000001',
  });
  await watcher.notify(id, { status: '0x1' });
  expect(transactionHistoryService.reloadTx).toHaveBeenCalledWith({
    address,
    chainId: 31337,
    nonce: '9007199254740993',
  });
});

it('clears only earlier exact nonces on the same custom network', () => {
  const entries = [
    ['0x20000000000000', 'CUSTOM_31337'],
    ['0x20000000000001', 'CUSTOM_31337'],
    ['0x20000000000002', 'CUSTOM_31337'],
    ['0x20000000000000', 'CUSTOM_31338'],
  ];
  for (const [nonce, chain] of entries)
    watcher.addTx(`${address}_${nonce}_${chain}`, {
      nonce,
      chain: chain as any,
      hash: '0x01',
    });
  watcher._removeTx(`${address}_0x20000000000001_CUSTOM_31337`);
  expect(Object.keys(watcher.store.pendingTx)).toEqual([
    `${address}_0x20000000000002_CUSTOM_31337`,
    `${address}_0x20000000000000_CUSTOM_31338`,
  ]);
});
