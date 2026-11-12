/** @jest-environment node */
import 'reflect-metadata';
import { TransactionFactory } from '@ethereumjs/tx';
import { Transaction, Submission } from 'viem-monad/monad';
import { PrivateKeyKeyring } from '@/background/service/keyring/monad';
import provider from '@/background/controller/provider/controller';
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
  permissionService: { getConnectedSite: () => ({ chain: 'CUSTOM_31337' }) },
  RPCService: { probeBestRPC: jest.fn() },
}));
jest.mock('consts', () => ({
  KEYRING_TYPE: { SimpleKeyring: 'Simple Key Pair', HdKeyring: 'HD Key Tree' },
  KEYRING_CATEGORY_MAP: {},
  EVENTS: { COMMON_HARDWARE: { REJECTED: 'REJECTED' } },
  INTERNAL_REQUEST_ORIGIN: 'internal',
}));
jest.mock('@/utils/chain', () => ({
  findChain: () => chain,
  findChainByEnum: () => chain,
}));
jest.mock('@/i18n', () => ({ t: (key) => key }));
jest.mock('@/utils', () => ({}));
jest.mock('@/utils/sentry', () => ({
  takeSigningCarrier: () => undefined,
  getSigningContext: () => undefined,
}));
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
