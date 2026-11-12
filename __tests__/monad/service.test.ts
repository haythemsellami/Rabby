/** @jest-environment node */
import { rebroadcastMonadTransaction } from '@/background/service/monad';
import { PrivateKeyKeyring } from '@/background/service/keyring/monad';
import {
  prepareMonadTransaction,
  sendApprovedMonadTransaction,
} from '@/background/service/monad';
import {
  assertMonadSession,
  getMonadSessionVersion,
  invalidateMonadSession,
} from '@/background/service/monadSession';
import { normalizeMonadRequest, prepareMonadFields } from '@/utils/monad';
import { Transaction, Submission } from 'viem-monad/monad';

const from = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf';
const base = {
  type: '0x40',
  chainId: 31337,
  from,
  to: '0x0000000000000000000000000000000000000002',
  value: '0x0',
  data: '0x',
};
const keyring = new PrivateKeyKeyring(['1'.padStart(64, '0')]);

function rpcFixture(overrides: Record<string, any> = {}) {
  const values = {
    eth_chainId: '0x7a69',
    eth_getTransactionCount: '0x20000000000001',
    eth_getBalance: '0xffffffffffffffffffffffffffffffff',
    eth_maxPriorityFeePerGas: '0x2',
    eth_getBlockByNumber: { baseFeePerGas: '0x3' },
    eth_estimateGas: '0x5208',
    ...overrides,
  };
  return jest.fn(async (method: string, params: unknown[]) => {
    if (method === 'eth_sendRawTransaction' && !(method in values))
      return Transaction.hash(
        Submission.deserialize(params[0] as `0x${string}`)
      );
    if (!(method in values)) throw new Error(`Unexpected RPC: ${method}`);
    if (values[method] instanceof Error) throw values[method];
    return values[method];
  });
}

describe('Monad custom-network preparation', () => {
  it('fills an available nonce below a future reservation without reusing the reserved nonce', async () => {
    const reserved = new Set([5n]);
    const { transaction } = await prepareMonadTransaction(
      base,
      rpcFixture({ eth_getTransactionCount: '0x0' }),
      reserved
    );
    expect(transaction.nonce).toBe('0x0');
    await expect(
      prepareMonadTransaction(
        { ...base, nonce: '0x5' },
        rpcFixture({ eth_getTransactionCount: '0x0' }),
        reserved
      )
    ).rejects.toThrow('already used');
  });
  it('uses pending quantities and estimates the actual type with exact fields', async () => {
    const rpc = rpcFixture();
    const { transaction } = await prepareMonadTransaction(
      { ...base, accessList: [] },
      rpc,
      new Set<bigint>()
    );
    expect(transaction).toMatchObject({
      type: '0x40',
      nonce: '0x20000000000001',
      gas: '0x5208',
      maxFeePerGas: '0x8',
      maxPriorityFeePerGas: '0x2',
      accessList: [],
    });
    expect(rpc).toHaveBeenCalledWith('eth_getTransactionCount', [
      from,
      'pending',
    ]);
    expect(rpc).toHaveBeenCalledWith('eth_estimateGas', [
      expect.objectContaining({
        type: '0x40',
        nonce: '0x20000000000001',
        accessList: [],
      }),
      'pending',
    ]);
  });
  it('retains explicit fees, gas, nonce, and contract creation', async () => {
    const rpc = rpcFixture({ eth_getTransactionCount: '0x0' });
    const input = {
      ...base,
      to: null,
      data: '0x6000',
      nonce: '0x0',
      gas: '0x7530',
      maxFeePerGas: '0xa',
      maxPriorityFeePerGas: '0xa',
    };
    const { transaction } = await prepareMonadTransaction(
      input,
      rpc,
      new Set<bigint>()
    );
    expect(transaction).toEqual(prepareMonadFields(input));
    expect(
      rpc.mock.calls.some(([method]) => method === 'eth_maxPriorityFeePerGas')
    ).toBe(false);
  });
  it('reserves from exact local pending history without wrapping uint64', async () => {
    const { transaction } = await prepareMonadTransaction(
      base,
      rpcFixture(),
      new Set([9007199254740993n, 9007199254740994n])
    );
    expect(transaction.nonce).toBe('0x20000000000003');
    await expect(
      prepareMonadTransaction(
        base,
        rpcFixture({ eth_getTransactionCount: '0xffffffffffffffff' }),
        new Set([(1n << 64n) - 1n])
      )
    ).rejects.toThrow('uint64');
    await expect(
      prepareMonadTransaction(
        { ...base, nonce: '0x0' },
        rpcFixture(),
        new Set<bigint>()
      )
    ).rejects.toThrow('already used');
  });
  it.each([
    [{ eth_chainId: '0x1' }, 'chain'],
    [{ eth_getBalance: '0x1' }, 'balance'],
    [{ eth_estimateGas: new Error('unsupported type') }, 'unsupported type'],
    [{ eth_getBlockByNumber: {} }, 'base fee'],
  ])(
    'fails closed on an incompatible endpoint or preparation failure',
    async (overrides, message) => {
      await expect(
        prepareMonadTransaction(
          base,
          rpcFixture(overrides as any),
          new Set<bigint>()
        )
      ).rejects.toThrow(message as string);
    }
  );
});

describe('Monad approved signing and submission', () => {
  async function setup(overrides: Record<string, any> = {}) {
    const rpc = rpcFixture(overrides);
    const { transaction: approved } = await prepareMonadTransaction(
      base,
      rpc,
      new Set<bigint>()
    );
    rpc.mockClear();
    const version = getMonadSessionVersion();
    return {
      original: normalizeMonadRequest(base),
      approved,
      rpc,
      assertSession: () => assertMonadSession(version),
      reservedNonces: jest.fn(() => new Set<bigint>()),
      sign: jest.fn(() => keyring.signTransaction(from, approved)),
      record: jest.fn(),
    };
  }
  it('records canonical identity and sends exactly one three-field envelope', async () => {
    const args = await setup();
    const hash = await sendApprovedMonadTransaction(args);
    const signed = args.record.mock.calls[0][0];
    expect(hash).toBe(signed.transactionHash);
    expect(
      args.rpc.mock.calls.filter(
        ([method]) => method === 'eth_sendRawTransaction'
      )
    ).toEqual([['eth_sendRawTransaction', [signed.submission]]]);
    expect(
      Transaction.serialize(Submission.deserialize(signed.submission))
    ).toBe(signed.canonicalSerializedTransaction);
    expect(args.record.mock.invocationCallOrder[0]).toBeLessThan(
      args.rpc.mock.invocationCallOrder[2]
    );
  });
  it('does not broadcast when the session changes while recording the signed identity', async () => {
    const args = await setup();
    args.record.mockImplementation(() => invalidateMonadSession());
    await expect(sendApprovedMonadTransaction(args)).rejects.toThrow('expired');
    expect(
      args.rpc.mock.calls.some(
        ([method]) => method === 'eth_sendRawTransaction'
      )
    ).toBe(false);
  });
  it('rejects a signer that changes the approved fields before recording or broadcasting', async () => {
    const args = await setup();
    args.sign.mockImplementation(() =>
      keyring.signTransaction(from, { ...args.approved, value: '0x1' })
    );
    await expect(sendApprovedMonadTransaction(args)).rejects.toThrow('changed');
    expect(args.record).not.toHaveBeenCalled();
  });
  it.each(['before signing', 'during signing'])(
    'invalidates consent %s after a session boundary',
    async (when) => {
      const args = await setup();
      if (when === 'before signing') invalidateMonadSession();
      else
        args.sign.mockImplementation(async () => {
          invalidateMonadSession();
          return keyring.signTransaction(from, args.approved);
        });
      await expect(sendApprovedMonadTransaction(args)).rejects.toThrow(
        'expired'
      );
      expect(args.record).not.toHaveBeenCalled();
      expect(
        args.rpc.mock.calls.some(
          ([method]) => method === 'eth_sendRawTransaction'
        )
      ).toBe(false);
    }
  );
  it('rejects a nonce consumed after preparation without changing the approved request', async () => {
    const args = await setup();
    args.reservedNonces.mockReturnValue(new Set([BigInt(args.approved.nonce)]));
    const before = JSON.stringify(args.approved);
    await expect(sendApprovedMonadTransaction(args)).rejects.toThrow(
      'new approval'
    );
    expect(args.sign).not.toHaveBeenCalled();
    expect(JSON.stringify(args.approved)).toBe(before);
  });
  it('prevents concurrent sends for the same account and releases the guard on failure', async () => {
    const args = await setup();
    let unblock!: () => void;
    const pending = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    args.sign.mockImplementation(async () => {
      await pending;
      return keyring.signTransaction(from, args.approved);
    });
    const first = sendApprovedMonadTransaction(args);
    await expect(sendApprovedMonadTransaction(args)).rejects.toThrow(
      'already being submitted'
    );
    unblock();
    await first;
    await expect(sendApprovedMonadTransaction(args)).resolves.toMatch(
      /^0x[0-9a-f]{64}$/
    );
  });
  it.each([
    new Error('timeout after acceptance'),
    new Error('already known'),
    '0xdeadbeef',
  ])(
    'retains canonical tracking on ambiguous submission results',
    async (response) => {
      const args = await setup({ eth_sendRawTransaction: response });
      await expect(sendApprovedMonadTransaction(args)).rejects.toThrow();
      expect(args.record).toHaveBeenCalledTimes(1);
      expect(
        args.rpc.mock.calls.filter(
          ([method]) => method === 'eth_sendRawTransaction'
        )
      ).toHaveLength(1);
      const signed = args.record.mock.calls[0][0];
      expect(signed.transactionHash).toBe(
        Transaction.hash(
          Transaction.deserialize(signed.canonicalSerializedTransaction)
        )
      );
    }
  );
});

describe('exact-byte Monad rebroadcast', () => {
  async function stored() {
    const rpc = rpcFixture();
    const { transaction: approved } = await prepareMonadTransaction(
      base,
      rpc,
      new Set<bigint>()
    );
    const record = jest.fn();
    await sendApprovedMonadTransaction({
      original: normalizeMonadRequest(base),
      approved,
      rpc,
      record,
      assertSession: () => undefined,
      reservedNonces: () => new Set<bigint>(),
      sign: () => keyring.signTransaction(from, approved),
    });
    const signed = record.mock.calls[0][0];
    rpc.mockClear();
    return {
      canonical: signed.canonicalSerializedTransaction,
      submission: signed.submission,
      hash: signed.transactionHash,
      approved,
      rpc,
      assertSession: () => undefined,
    };
  }
  it('resubmits the stored bytes without estimating or signing again', async () => {
    const args = await stored();
    const sign = jest.spyOn(keyring, 'signTransaction');
    try {
      await expect(rebroadcastMonadTransaction(args)).resolves.toBe(args.hash);
      expect(args.rpc.mock.calls).toEqual([
        ['eth_chainId', []],
        ['eth_sendRawTransaction', [args.submission]],
      ]);
      expect(sign).not.toHaveBeenCalled();
    } finally {
      sign.mockRestore();
    }
  });
  it.each(['submission', 'hash', 'approved'])(
    'rejects tampered stored %s before broadcasting',
    async (field) => {
      const args = await stored();
      if (field === 'submission') args.submission = args.canonical;
      if (field === 'hash') args.hash = '0xdeadbeef';
      if (field === 'approved')
        args.approved = { ...args.approved, value: '0x1' };
      await expect(rebroadcastMonadTransaction(args)).rejects.toThrow();
      expect(args.rpc).not.toHaveBeenCalled();
    }
  );
});
