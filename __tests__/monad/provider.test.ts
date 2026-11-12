/** @jest-environment node */
import 'reflect-metadata';
import { TransactionFactory } from '@ethereumjs/tx';
import { Transaction, Submission } from 'viem-monad/monad';
import { PrivateKeyKeyring } from '@/background/service/keyring/monad';
import provider from '@/background/controller/provider/controller';
import rpcFlow from '@/background/controller/provider/rpcFlow';
import notification from '@/background/service/notification';
import {
  keyringService,
  transactionHistoryService,
  transactionWatchService,
} from 'background/service';
import {
  getMonadSessionVersion,
  invalidateMonadSession,
} from '@/background/service/monadSession';
import { hasBlockedAddress } from '@/background/service/blockedAddress';

const from = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf';
const keyring = new PrivateKeyKeyring(['1'.padStart(64, '0')]);
const chain = {
  id: 31337,
  enum: 'CUSTOM_31337',
  serverId: 'custom_31337',
  isTestnet: true,
};
const rpc = jest.fn(async ({ method, params }) => {
  if (method === 'eth_chainId') return '0x7a69';
  if (method === 'eth_getTransactionCount') return '0x0';
  if (method === 'eth_sendRawTransaction')
    return Transaction.hash(Submission.deserialize(params[0]));
  throw new Error(`Unexpected RPC ${method}`);
});

jest.mock('background/service', () => ({
  keyringService: {
    memStore: { getState: () => ({ isUnlocked: true }) },
    getKeyringForAccount: jest.fn(async () => keyring),
    isUnlocked: jest.fn(() => true),
    signTransaction: jest.fn((selected, tx, address) =>
      selected.signTransaction(address, tx)
    ),
  },
  transactionHistoryService: {
    getMonadReservedNonces: jest.fn(() => new Set<bigint>()),
    addTx: jest.fn(),
    removeSigningTx: jest.fn(),
  },
  transactionWatchService: { addTx: jest.fn() },
  notificationService: jest.requireActual('@/background/service/notification')
    .default,
  permissionService: {
    getConnectedSite: () => ({ chain: 'CUSTOM_31337' }),
    hasPermission: () => true,
    isInternalOrigin: () => false,
    updateConnectSite: jest.fn(),
  },
  preferenceService: {},
  RPCService: { probeBestRPC: jest.fn() },
}));
jest.mock('consts', () => ({
  KEYRING_TYPE: { SimpleKeyring: 'Simple Key Pair', HdKeyring: 'HD Key Tree' },
  KEYRING_CATEGORY_MAP: {},
  KEYRING_CLASS: {},
  SUPPORT_1559_KEYRING_TYPE: [],
  EVENTS: { COMMON_HARDWARE: { REJECTED: 'REJECTED' } },
  INTERNAL_REQUEST_ORIGIN: 'internal',
}));
jest.mock('@/utils/chain', () => ({
  findChain: () => chain,
  findChainByEnum: () => chain,
}));
jest.mock('@/i18n', () => ({ t: (key) => key }));
jest.mock('@/utils', () => ({ resemblesETHAddress: () => false }));
jest.mock('@/utils/sentry', () => ({
  takeSigningCarrier: () => undefined,
  getSigningContext: () => undefined,
  isSigningCarrierReported: () => false,
}));
jest.mock('webextension-polyfill', () => ({
  __esModule: true,
  default: {
    windows: { getAll: jest.fn(async () => []), update: jest.fn() },
    action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn() },
    browserAction: {
      setBadgeText: jest.fn(),
      setBadgeBackgroundColor: jest.fn(),
    },
  },
}));
jest.mock('background/webapi', () => ({
  winMgr: {
    event: { on: jest.fn() },
    openNotification: jest.fn(async () => 1),
    remove: jest.fn(),
  },
}));
jest.mock('@/background/service/transactionHistory', () => ({
  __esModule: true,
  default: {
    addSigningTx: jest.fn(() => 'signing-1'),
    removeSigningTx: jest.fn(),
    removeAllSigningTx: jest.fn(),
  },
}));
jest.mock('background/utils', () => ({
  PromiseFlow: jest.requireActual('@/background/utils/PromiseFlow').default,
  underline2Camelcase: (value: string) =>
    value.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
}));
jest.mock('@/utils/env', () => ({ isManifestV3: false }));
jest.mock('@/utils/transaction', () => ({
  buildSignTx: jest.fn(),
  normalizeTxParams: (tx) => tx,
  shouldUpdateNonce: () => false,
}));
jest.mock('@/background/service/signTxPreparation', () => ({
  startSignTxPreparation: jest.fn(),
  cancelSignTxPreparation: jest.fn(),
}));
jest.mock('@/background/controller/provider/gnosisController', () => ({
  gnosisController: {},
}));
jest.mock('@/utils/signEvent', () => ({
  waitSignComponentAmounted: async () => undefined,
}));
jest.mock('@/background/utils/errorTxRetry', () => ({ bgRetryTxMethods: {} }));
jest.mock('@/eventBus', () => ({
  __esModule: true,
  default: { emit: jest.fn() },
}));
jest.mock('@sentry/browser', () => ({ captureException: jest.fn() }));
jest.mock('@/background/controller/base', () => class {});
jest.mock('@/background/controller/wallet', () => ({}));
jest.mock('@/background/controller/utils', () => ({}));
jest.mock('@/background/service/customTestnet', () => ({
  customTestnetService: {
    getClient: () => ({ request: (...args) => rpc(...(args as [any])) }),
  },
}));
jest.mock('@/background/utils/rpcCache', () => ({}));
jest.mock('@/background/utils/buildinProvider', () => ({}));
jest.mock('@/background/utils/tx', () => ({}));
jest.mock('@/background/utils/gasAccountLogin', () => ({}));
jest.mock('@/background/controller/walletUtils/fix', () => ({}));
jest.mock('@/background/service/blockedAddress', () => ({
  hasBlockedAddress: jest.fn(async () => false),
  getTxAddressesToCheck: (tx) => (tx.to ? [tx.to] : []),
}));

function options() {
  const tx = {
    type: '0x40',
    from,
    to: '0x0000000000000000000000000000000000000002',
    chainId: 31337,
    data: '0x',
    value: '0x0',
    nonce: '0x20000000000001',
    gas: '0x5208',
    maxFeePerGas: '0x2',
    maxPriorityFeePerGas: '0x2',
    accessList: [],
  };
  return {
    data: { params: [tx] },
    session: { origin: 'https://example.test', name: '', icon: '' },
    account: { address: from, type: 'Simple Key Pair', brandName: '' },
    approvalRes: {
      monadTransaction: { ...tx },
      monadApprovalId: 'approval-1',
      signingTxId: 'signing-1',
    } as any,
    monadApproval: { id: 'approval-1', version: getMonadSessionVersion() },
    pushed: false,
    result: undefined,
  };
}

beforeEach(() => {
  process.env.MONAD_DEV_CHAIN_ID = '31337';
  jest.clearAllMocks();
  jest.mocked(keyringService.isUnlocked).mockReturnValue(true);
  jest.mocked(hasBlockedAddress).mockResolvedValue(false);
  notification.approvals = [];
  notification.currentApproval = null;
  notification.notifiWindowId = 1;
  notification.dappManager.clear();
});

async function queueTransactions() {
  const request = (nonce: string) => {
    const args = options();
    return {
      data: {
        method: 'eth_sendTransaction',
        params: [{ ...args.data.params[0], nonce }],
      },
      session: args.session,
      account: args.account,
    };
  };
  const first = rpcFlow(request('0x1')).catch((error) => error);
  const second = rpcFlow(request('0x2'));
  for (let n = 0; notification.approvals.length < 2 && n < 20; n++)
    await new Promise(setImmediate);
  expect(notification.approvals).toHaveLength(2);
  return { first, second };
}

function approveCurrent() {
  const approval = notification.getApproval()!;
  expect(
    notification.resolveApprovalFor({
      approval: { id: approval.id, component: 'SignTx' },
      data: {
        monadApprovalId: approval.id,
        monadTransaction: { ...approval.data.params.data[0] },
        signingTxId: approval.signingTxId,
      },
    })
  ).toEqual({ accepted: true });
}

it.each(['approve', 'reject'])(
  'signs and broadcasts a queued Monad transaction after %s of the previous approval',
  async (settlement) => {
    const { first, second } = await queueTransactions();
    const queuedId = notification.approvals[1].id;
    if (settlement === 'approve') approveCurrent();
    else
      await notification.rejectApprovalFor({
        approval: { id: notification.getApproval()!.id, component: 'SignTx' },
      });
    const firstResult = await first;
    if (settlement === 'approve')
      expect(firstResult).toMatch(/^0x[0-9a-f]{64}$/);
    else expect(firstResult).toHaveProperty('code', 4001);

    expect(notification.getApproval()!.id).toBe(queuedId);
    approveCurrent();
    await expect(second).resolves.toMatch(/^0x[0-9a-f]{64}$/);
    const broadcasts = rpc.mock.calls.filter(
      ([call]) => call.method === 'eth_sendRawTransaction'
    );
    expect(broadcasts).toHaveLength(settlement === 'approve' ? 2 : 1);
    const finalTransaction = Submission.deserialize(
      broadcasts[broadcasts.length - 1][0].params[0]
    );
    expect(Transaction.serialize(finalTransaction)).toBe(
      jest.mocked(transactionHistoryService.addTx).mock.calls.slice(-1)[0][0].tx
        .canonicalSerializedTransaction
    );
    expect(keyringService.signTransaction).toHaveBeenLastCalledWith(
      keyring,
      expect.objectContaining({ nonce: '0x2' }),
      from
    );
  }
);

it('cannot renew an expired promoted approval by reopening its window', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const { first, second } = await queueTransactions();
  const rejected = expect(second).rejects.toThrow('expired');
  await notification.rejectApprovalFor({
    approval: { id: notification.getApproval()!.id, component: 'SignTx' },
  });
  await first;
  invalidateMonadSession();
  await notification.activeFirstApproval();
  approveCurrent();
  await rejected;
  expect(keyringService.signTransaction).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});
afterEach(() => {
  delete process.env.MONAD_DEV_CHAIN_ID;
  jest.restoreAllMocks();
});

it('dispatches the approved custom-network transaction through the local keyring without EthereumJS reconstruction', async () => {
  const factory = jest.spyOn(TransactionFactory, 'fromTxData');
  const args = options();
  const hash = await provider.ethSendTransaction(args);
  expect(factory).not.toHaveBeenCalled();
  expect(keyringService.signTransaction).toHaveBeenCalledWith(
    keyring,
    args.approvalRes.monadTransaction,
    from
  );
  expect(transactionHistoryService.addTx).toHaveBeenCalledWith(
    expect.objectContaining({
      tx: expect.objectContaining({
        hash,
        rawTx: expect.objectContaining({
          type: '0x40',
          accessList: [],
          nonce: '0x20000000000001',
        }),
      }),
    })
  );
  expect(transactionWatchService.addTx).toHaveBeenCalledWith(
    expect.any(String),
    { hash, nonce: '0x20000000000001', chain: 'CUSTOM_31337' }
  );
  expect(transactionHistoryService.removeSigningTx).toHaveBeenCalledWith(
    'signing-1'
  );
});

it.each([
  'missing approval',
  'wrong approval',
  'expired session',
  'locked',
  'blocked',
  'authorization list',
  'wrong signer',
])('rejects %s before signing or broadcasting', async (scenario) => {
  const args = options();
  if (scenario === 'missing approval') args.monadApproval = undefined as any;
  if (scenario === 'wrong approval') args.approvalRes.monadApprovalId = 'other';
  if (scenario === 'expired session') invalidateMonadSession();
  if (scenario === 'locked')
    jest.mocked(keyringService.isUnlocked).mockReturnValue(false);
  if (scenario === 'blocked')
    jest.mocked(hasBlockedAddress).mockResolvedValue(true);
  if (scenario === 'authorization list')
    args.approvalRes.monadTransaction.authorizationList = [];
  if (scenario === 'wrong signer') args.account.type = 'Ledger Hardware';
  await expect(provider.ethSendTransaction(args)).rejects.toThrow();
  expect(keyringService.signTransaction).not.toHaveBeenCalled();
  expect(transactionHistoryService.addTx).not.toHaveBeenCalled();
  expect(transactionHistoryService.removeSigningTx).toHaveBeenCalledWith(
    'signing-1'
  );
  expect(
    rpc.mock.calls.some(([call]) => call.method === 'eth_sendRawTransaction')
  ).toBe(false);
});
