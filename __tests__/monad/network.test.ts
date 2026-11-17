/** @jest-environment node */
import { privateKeyToAccount } from 'viem-monad/accounts';
import { Transaction } from 'viem-monad/monad';
import { sendApprovedMonadTransaction } from '@/background/service/monad';
import {
  assertMonadSession,
  getMonadSessionVersion,
} from '@/background/service/monadSession';
import { monadEnvelope, prepareMonadFields } from '@/utils/monad';
import { findChain } from '@/utils/chain';
import { http } from '@/background/utils/http';
import RPCService from '@/background/service/rpc';
import {
  customTestnetService as networks,
  createTestnetChain,
} from '@/background/service/customTestnet';

jest.mock('@/constant', () => ({ CUSTOM_RPC_ENABLED: true }));
jest.mock('@/utils/chain', () => ({
  findChain: jest.fn(),
  updateChainStore: jest.fn(),
}));
jest.mock('@/ui/utils/token', () => ({
  customTestnetTokenToTokenItem: (token) => token,
}));
jest.mock('@/background/utils', () => ({ createPersistStore: jest.fn() }));
jest.mock('@/background/utils/http', () => ({
  http: { post: jest.fn(), get: jest.fn() },
}));
jest.mock('@/background/utils/ipfs', () => ({
  getFormattedIpfsUrl: jest.fn(),
}));
jest.mock('@/background/webapi', () => ({ storage: {} }));
jest.mock('@/background/service/rpc', () => ({
  __esModule: true,
  default: { hasCustomRPC: jest.fn(() => false) },
}));
jest.mock('viem/actions', () => ({
  getBlock: jest.fn(),
  getTransactionReceipt: jest.fn(),
}));

const network = {
  id: 31337,
  name: 'Monad development',
  nativeTokenSymbol: 'MON',
  rpcUrl: 'http://localhost:18545',
};
const override = { chainId: network.id, url: 'http://localhost:28545' };

beforeEach(() => {
  jest.clearAllMocks();
  networks.store.customTestnet = {
    [network.id]: createTestnetChain({ ...network }),
  };
  networks.chains = {};
  jest.spyOn(networks, 'detectEip1559').mockResolvedValue(undefined);
  jest.spyOn(networks, 'syncChainList').mockImplementation(() => undefined);
  jest.mocked(findChain).mockReturnValue(createTestnetChain({ ...network }));
  jest.mocked(RPCService.hasCustomRPC).mockReturnValue(false);
  jest.mocked(http.post).mockResolvedValue({ data: { result: '0x7a69' } });
});
afterEach(() => jest.restoreAllMocks());

it.each(['set', 'remove'])(
  'expires existing consent when the RPC override is %s',
  async (action) => {
    await networks.update({ ...network });
    if (action === 'remove') networks.setCustomRPC(override);
    const oldClient = networks.getClient(network.id);
    const version = getMonadSessionVersion();
    if (action === 'set') networks.setCustomRPC(override);
    else networks.removeCustomRPC(network.id);
    expect(networks.getClient(network.id)).not.toBe(oldClient);
    expect(() => assertMonadSession(version)).toThrow('expired');
  }
);

it.each([false, true])(
  'expires approvals created during network validation at configuration commit (override enabled: %s)',
  async (hasOverride) => {
    await networks.update({ ...network });
    jest.mocked(RPCService.hasCustomRPC).mockReturnValue(hasOverride);
    const oldClient = networks.getClient(network.id);
    const before = getMonadSessionVersion();
    let finish!: (value: any) => void;
    jest
      .mocked(http.post)
      .mockImplementationOnce(
        () => new Promise((resolve) => (finish = resolve))
      );
    const update = networks.update({ ...network, rpcUrl: override.url });
    expect(() => assertMonadSession(before)).toThrow('expired');
    const duringValidation = getMonadSessionVersion();
    expect(networks.getClient(network.id)).toBe(oldClient);
    finish({ data: { result: '0x7a69' } });
    await update;
    expect(networks.store.customTestnet[network.id].rpcUrl).toBe(override.url);
    expect(networks.getClient(network.id) === oldClient).toBe(hasOverride);
    expect(() => assertMonadSession(duringValidation)).toThrow('expired');
  }
);

it('keeps the existing client and approvals opened during unsuccessful validation', async () => {
  await networks.update({ ...network });
  const oldClient = networks.getClient(network.id);
  jest.mocked(http.post).mockResolvedValueOnce({ data: { result: '0x1' } });
  const update = networks.update({ ...network, rpcUrl: override.url });
  const duringValidation = getMonadSessionVersion();
  await expect(update).resolves.toHaveProperty('error');
  expect(networks.getClient(network.id)).toBe(oldClient);
  expect(() => assertMonadSession(duringValidation)).not.toThrow();
});

it.each(['nonce check', 'signing'])(
  'does not broadcast if the effective RPC changes during %s',
  async (phase) => {
    await networks.update({ ...network });
    const version = getMonadSessionVersion();
    const account = privateKeyToAccount(`0x${'1'.padStart(64, '0')}`);
    const approved = prepareMonadFields({
      type: '0x40',
      chainId: network.id,
      from: account.address,
      to: '0x0000000000000000000000000000000000000002',
      nonce: '0x0',
      gas: '0x5208',
      value: '0x0',
      data: '0x',
      maxFeePerGas: '0x2',
      maxPriorityFeePerGas: '0x1',
    });
    const rpc = jest.fn(async (method: string) => {
      if (method === 'eth_chainId') return '0x7a69';
      if (method === 'eth_getTransactionCount') {
        if (phase === 'nonce check') networks.setCustomRPC(override);
        return '0x0';
      }
      throw new Error(`Unexpected RPC ${method}`);
    });
    const sign = jest.fn(async () => {
      networks.setCustomRPC(override);
      return {
        kind: 'monad' as const,
        canonicalSerializedTransaction: await Transaction.sign({
          account,
          transaction: monadEnvelope(approved),
        }),
      };
    });
    const record = jest.fn();
    await expect(
      sendApprovedMonadTransaction({
        original: approved,
        approved,
        rpc,
        sign,
        record,
        assertSession: () => assertMonadSession(version),
        reservedNonces: () => new Set<bigint>(),
      })
    ).rejects.toThrow('expired');
    expect(sign).toHaveBeenCalledTimes(phase === 'signing' ? 1 : 0);
    expect(record).not.toHaveBeenCalled();
    expect(
      rpc.mock.calls.some(([method]) => method === 'eth_sendRawTransaction')
    ).toBe(false);
  }
);
