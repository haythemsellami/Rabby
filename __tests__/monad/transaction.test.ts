/** @jest-environment node */
import { ethers } from 'ethers';
import { Common, Hardfork } from '@ethereumjs/common';
import { TransactionFactory } from '@ethereumjs/tx';
import { Transaction, Submission } from 'viem-monad/monad';
import {
  PrivateKeyKeyring,
  MnemonicKeyring,
} from '@/background/service/keyring/monad';
import {
  assertMonadAccount,
  assertMonadApproval,
  assertMonadNetwork,
  encodeMonadSubmission,
  monadEnvelope,
  normalizeMonadRequest,
  prepareMonadFields,
} from '@/utils/monad';

const privateKey = '1'.padStart(64, '0');
const from = new ethers.Wallet(`0x${privateKey}`).address.toLowerCase();
export const request = {
  type: '0x40',
  chainId: 31337,
  from,
  to: '0x0000000000000000000000000000000000000002',
  data: '0x',
  value: '0x0',
  nonce: '0x20000000000001',
  gas: '0x5208',
  maxFeePerGas: '0x77359400',
  maxPriorityFeePerGas: '0x3b9aca00',
} as const;

describe('Monad baseline request', () => {
  it.each([
    'authorizationList',
    'calls',
    'feePayer',
    'feePayerSignature',
    'gasPrice',
    'auxiliaryData',
    'features',
    'raw',
    'blobs',
    'nonceKey',
    'isSpeedUp',
    'isGasLess',
  ])('rejects %s without silently stripping it', (field) => {
    expect(() => normalizeMonadRequest({ ...request, [field]: [] })).toThrow(
      'Unsupported Monad field'
    );
  });
  it.each(['0x00', '0x', '-1', '9007199254740993', 9007199254740992, 1n])(
    'rejects noncanonical or non-JSON nonce %s',
    (nonce) => {
      expect(() => normalizeMonadRequest({ ...request, nonce })).toThrow();
    }
  );
  it('preserves zero, uint64/uint256 limits, creation, and optional-list presence', () => {
    const tx = prepareMonadFields({
      ...request,
      to: null,
      nonce: '0xffffffffffffffff',
      gas: '0xffffffffffffffff',
      value: `0x${'f'.repeat(64)}`,
    });
    expect(tx.to).toBeUndefined();
    expect(tx.nonce).toBe('0xffffffffffffffff');
    expect(normalizeMonadRequest({ ...request, nonce: '0x0' }).nonce).toBe(
      '0x0'
    );
    expect(monadEnvelope(tx).features.some(([key]) => key === '0x04')).toBe(
      false
    );
    expect(
      monadEnvelope(prepareMonadFields({ ...request, accessList: [] })).features
    ).toContainEqual(['0x04', []]);
    expect(() =>
      prepareMonadFields({ ...request, nonce: '0x10000000000000000' })
    ).toThrow('uint64');
    expect(() =>
      prepareMonadFields({ ...request, value: `0x1${'0'.repeat(64)}` })
    ).toThrow('uint256');
  });
  it('rejects invalid fee ordering, destination, data, access-list entries, and missing signing fields', () => {
    for (const override of [
      { maxFeePerGas: '0x1' },
      { to: '0x' },
      { data: '0x1' },
      { accessList: [{ address: from, storageKeys: ['0x00'] }] },
      { nonce: undefined },
    ])
      expect(() => prepareMonadFields({ ...request, ...override })).toThrow();
  });
  it('binds call fields, explicit fees/nonce, and list presence to the original request', () => {
    const original = normalizeMonadRequest(request);
    for (const override of [
      { to: from },
      { value: '0x1' },
      { nonce: '0x0' },
      { accessList: [] },
      { data: '0x00' },
    ]) {
      expect(() =>
        assertMonadApproval(
          original,
          prepareMonadFields({ ...request, ...override })
        )
      ).toThrow();
    }
  });
  it('requires explicit development-network activation and local accounts', () => {
    const previous = process.env.MONAD_DEV_CHAIN_ID;
    try {
      delete process.env.MONAD_DEV_CHAIN_ID;
      expect(() =>
        assertMonadNetwork({ id: 31337, isTestnet: true })
      ).toThrow();
      process.env.MONAD_DEV_CHAIN_ID = '31337';
      expect(() =>
        assertMonadNetwork({ id: 31337, isTestnet: true })
      ).not.toThrow();
      expect(() => assertMonadNetwork({ id: 31337 })).toThrow();
      expect(() => assertMonadNetwork({ id: 143, isTestnet: true })).toThrow();
      expect(() =>
        assertMonadAccount({ address: from, type: 'Ledger Hardware' })
      ).toThrow();
      expect(() =>
        assertMonadAccount({ address: from, type: 'HD Key Tree' })
      ).not.toThrow();
    } finally {
      if (previous === undefined) delete process.env.MONAD_DEV_CHAIN_ID;
      else process.env.MONAD_DEV_CHAIN_ID = previous;
    }
  });
});

describe('local keyring signing and canonical identity', () => {
  it.each([false, true])(
    'signs with an imported key; creation=%s',
    async (creation) => {
      const keyring = new PrivateKeyKeyring([privateKey]);
      const tx = prepareMonadFields({
        ...request,
        ...(creation ? { to: null, data: '0x6000' } : {}),
        accessList: [],
      });
      const result = await keyring.signTransaction(from, tx);
      const signed = await encodeMonadSubmission(result, tx);
      const canonicalFields = ethers.utils.RLP.decode(
        `0x${signed.canonicalSerializedTransaction.slice(4)}`
      );
      const submittedFields = ethers.utils.RLP.decode(
        `0x${signed.submission.slice(4)}`
      );
      expect(canonicalFields).toHaveLength(2);
      expect(submittedFields).toEqual([...canonicalFields, []]);
      expect(signed.transactionHash).toBe(
        ethers.utils.keccak256(signed.canonicalSerializedTransaction)
      );
      expect(signed.transactionHash).not.toBe(
        ethers.utils.keccak256(signed.submission)
      );
      const features = canonicalFields[1];
      const signature = features.find(([key]) => key === '0x06')[1];
      const preimage = `0x40${ethers.utils.RLP.encode([
        canonicalFields[0],
        features.map(([key, value]) => [key, key === '0x06' ? [] : value]),
      ]).slice(2)}`;
      expect(
        ethers.utils
          .recoverAddress(ethers.utils.keccak256(preimage), {
            r: ethers.utils.hexZeroPad(signature[1], 32),
            s: ethers.utils.hexZeroPad(signature[2], 32),
            v: signature[0] === '0x' ? 27 : 28,
          })
          .toLowerCase()
      ).toBe(from);
      expect(
        Transaction.serialize(Submission.deserialize(signed.submission))
      ).toBe(signed.canonicalSerializedTransaction);
      await expect(
        encodeMonadSubmission(
          result,
          prepareMonadFields({ ...tx, data: '0x01' })
        )
      ).rejects.toThrow('changed');
      await expect(
        keyring.signTransaction(from, { ...tx, from: request.to })
      ).rejects.toThrow('sender');
    }
  );
  it.each([undefined, 'development passphrase'])(
    'signs with the inherited mnemonic account (passphrase=%s)',
    async (passphrase) => {
      const keyring = new MnemonicKeyring({
        mnemonic: 'test test test test test test test test test test test junk',
        activeIndexes: [0],
        passphrase,
      } as any);
      const [address] = await keyring.getAccounts();
      const tx = prepareMonadFields({ ...request, from: address });
      await expect(
        encodeMonadSubmission(await keyring.signTransaction(address, tx), tx)
      ).resolves.toHaveProperty('transactionHash');
    }
  );
  it.each(['private', 'mnemonic'])(
    'preserves Ethereum and Tempo signing for %s accounts',
    async (kind) => {
      const keyring =
        kind === 'private'
          ? new PrivateKeyKeyring([privateKey])
          : new MnemonicKeyring({
              mnemonic:
                'test test test test test test test test test test test junk',
              activeIndexes: [0],
            } as any);
      const [address] = await keyring.getAccounts();
      const legacy = TransactionFactory.fromTxData(
        {
          type: 2,
          chainId: 1,
          nonce: 0,
          gasLimit: 21000,
          maxFeePerGas: 2,
          maxPriorityFeePerGas: 1,
          to: request.to,
        },
        { common: Common.custom({ chainId: 1 }, { hardfork: Hardfork.London }) }
      );
      expect(
        (await keyring.signTransaction(address, legacy))
          .getSenderAddress()
          .toString()
      ).toBe(address.toLowerCase());
      const tempo = await keyring.signTransaction(address, {
        type: '0x76',
        chainId: 42431,
        nonce: '0x0',
        gas: '0x186a0',
        maxFeePerGas: '0x2',
        maxPriorityFeePerGas: '0x1',
        calls: [{ to: request.to, value: '0x0', data: '0x' }],
      });
      expect(tempo.serializedTransaction.startsWith('0x76')).toBe(true);
    }
  );
});
