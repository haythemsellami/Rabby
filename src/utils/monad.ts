import { isAddress, padHex, recoverAddress } from 'viem-monad';
import type { Address, Hex, AccessList } from 'viem-monad';
import { Formatters, Submission, Transaction } from 'viem-monad/monad';

export const MONAD_TRANSACTION_TYPE = '0x40';
const localKeyrings = ['Simple Key Pair', 'HD Key Tree'];
const fields = new Set([
  'type',
  'chainId',
  'from',
  'to',
  'data',
  'value',
  'nonce',
  'gas',
  'maxFeePerGas',
  'maxPriorityFeePerGas',
  'accessList',
]);

export type MonadRequest = {
  type: '0x40';
  chainId: number;
  from: Address;
  to?: Address;
  data: Hex;
  value: Hex;
  nonce?: Hex;
  gas?: Hex;
  maxFeePerGas?: Hex;
  maxPriorityFeePerGas?: Hex;
  accessList?: AccessList;
};
export type PreparedMonadRequest = MonadRequest &
  Required<
    Pick<
      MonadRequest,
      'nonce' | 'gas' | 'maxFeePerGas' | 'maxPriorityFeePerGas'
    >
  >;
export type MonadSigningResult = {
  kind: 'monad';
  canonicalSerializedTransaction: Hex;
};

export function isMonadTransaction(tx: unknown): boolean {
  const type = (tx as { type?: unknown } | undefined)?.type;
  return (
    type === 'monad' ||
    type === 64 ||
    (typeof type === 'string' && /^(0x0*40|64)$/i.test(type))
  );
}

export function monadQuantity(
  value: unknown,
  bits: number,
  name: string
): bigint {
  if (typeof value !== 'string' || !/^0x(0|[1-9a-f][0-9a-f]*)$/i.test(value)) {
    throw new Error(`Monad ${name} must be a canonical hex quantity`);
  }
  const result = BigInt(value);
  if (result >= 1n << BigInt(bits))
    throw new Error(`Monad ${name} exceeds uint${bits}`);
  return result;
}

export const monadHex = (value: bigint): Hex => `0x${value.toString(16)}`;

export function assertMonadNetwork(
  chain?: { id: number; isTestnet?: boolean } | null
) {
  const configured = process.env.MONAD_DEV_CHAIN_ID;
  if (
    !configured ||
    !/^[1-9][0-9]*$/.test(configured) ||
    !Number.isSafeInteger(Number(configured)) ||
    !chain?.isTestnet ||
    chain.id !== Number(configured)
  ) {
    throw new Error(
      'Monad type 0x40 requires the explicitly configured custom development network'
    );
  }
}

export function assertMonadAccount(account?: {
  address: string;
  type: string;
}) {
  if (!account || !localKeyrings.includes(account.type)) {
    throw new Error(
      'Monad type 0x40 supports only imported-key and mnemonic accounts'
    );
  }
}

export function normalizeMonadRequest(input: unknown): MonadRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid Monad request');
  const tx = input as Record<string, unknown>;
  for (const key of Object.keys(tx)) {
    if (!fields.has(key)) throw new Error(`Unsupported Monad field: ${key}`);
  }
  if (tx.type !== '0x40')
    throw new Error('Monad transaction type must be 0x40');
  const chainId =
    typeof tx.chainId === 'number'
      ? tx.chainId
      : Number(monadQuantity(tx.chainId, 256, 'chainId'));
  if (!Number.isSafeInteger(chainId) || chainId <= 0)
    throw new Error('Invalid Monad chainId');
  if (typeof tx.from !== 'string' || !isAddress(tx.from, { strict: false }))
    throw new Error('Invalid Monad sender');
  if (
    tx.to != null &&
    (typeof tx.to !== 'string' || !isAddress(tx.to, { strict: false }))
  )
    throw new Error('Invalid Monad destination');
  const data = tx.data ?? '0x';
  if (typeof data !== 'string' || !/^0x([0-9a-f]{2})*$/i.test(data))
    throw new Error('Invalid Monad data');
  const result: MonadRequest = {
    type: '0x40',
    chainId,
    from: tx.from.toLowerCase() as Address,
    ...(tx.to == null
      ? {}
      : { to: (tx.to as string).toLowerCase() as Address }),
    data: data.toLowerCase() as Hex,
    value: monadHex(monadQuantity(tx.value ?? '0x0', 256, 'value')),
  };
  for (const [name, bits] of [
    ['nonce', 64],
    ['gas', 64],
    ['maxFeePerGas', 256],
    ['maxPriorityFeePerGas', 256],
  ] as const) {
    if (tx[name] !== undefined)
      result[name] = monadHex(monadQuantity(tx[name], bits, name));
  }
  if (
    result.maxFeePerGas !== undefined &&
    result.maxPriorityFeePerGas !== undefined &&
    BigInt(result.maxPriorityFeePerGas) > BigInt(result.maxFeePerGas)
  ) {
    throw new Error('Monad priority fee exceeds the fee cap');
  }
  if ('accessList' in tx) {
    if (!Array.isArray(tx.accessList))
      throw new Error('Invalid Monad access list');
    result.accessList = tx.accessList.map((entry) => {
      if (
        !entry ||
        Object.keys(entry).some(
          (key) => key !== 'address' && key !== 'storageKeys'
        ) ||
        typeof entry.address !== 'string' ||
        !isAddress(entry.address, { strict: false }) ||
        !Array.isArray(entry.storageKeys) ||
        entry.storageKeys.some(
          (key: unknown) =>
            typeof key !== 'string' || !/^0x[0-9a-f]{64}$/i.test(key)
        )
      ) {
        throw new Error('Invalid Monad access list entry');
      }
      return {
        address: entry.address.toLowerCase(),
        storageKeys: entry.storageKeys.map((key: string) => key.toLowerCase()),
      };
    });
  }
  return result;
}

export function prepareMonadFields(input: unknown): PreparedMonadRequest {
  const tx = normalizeMonadRequest(input);
  for (const field of [
    'nonce',
    'gas',
    'maxFeePerGas',
    'maxPriorityFeePerGas',
  ] as const) {
    if (tx[field] === undefined) throw new Error(`Missing Monad ${field}`);
  }
  const complete = tx as PreparedMonadRequest;
  Transaction.getSignPayload(monadEnvelope(complete));
  return complete;
}

export function monadRpcRequest(input: MonadRequest) {
  const tx = normalizeMonadRequest(input);
  return Formatters.formatTransactionRequest({
    ...tx,
    type: 'monad',
    value: BigInt(tx.value),
    nonce: tx.nonce === undefined ? undefined : BigInt(tx.nonce),
    gas: tx.gas === undefined ? undefined : BigInt(tx.gas),
    maxFeePerGas:
      tx.maxFeePerGas === undefined ? undefined : BigInt(tx.maxFeePerGas),
    maxPriorityFeePerGas:
      tx.maxPriorityFeePerGas === undefined
        ? undefined
        : BigInt(tx.maxPriorityFeePerGas),
  });
}

export function monadEnvelope(tx: PreparedMonadRequest): Transaction.Envelope {
  return Transaction.from({
    chainId: tx.chainId,
    to: tx.to,
    data: tx.data,
    value: BigInt(tx.value),
    nonce: BigInt(tx.nonce),
    gas: BigInt(tx.gas),
    maxFeePerGas: BigInt(tx.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas),
    ...(tx.accessList === undefined ? {} : { accessList: tx.accessList }),
  });
}

export function assertMonadApproval(
  original: MonadRequest,
  approved: PreparedMonadRequest
) {
  for (const key of fields) {
    const field = key as keyof MonadRequest;
    if (
      original[field] !== undefined &&
      JSON.stringify(original[field]) !== JSON.stringify(approved[field])
    ) {
      throw new Error(`Monad approval changed requested ${field}`);
    }
  }
  // Presence is part of the signed commitment, including an explicitly empty list.
  if (
    JSON.stringify(original.accessList) !==
      JSON.stringify(approved.accessList) ||
    original.to !== approved.to
  ) {
    throw new Error('Monad approval changed the requested call or access list');
  }
}

export async function encodeMonadSubmission(
  result: MonadSigningResult,
  approved: PreparedMonadRequest
) {
  if (result?.kind !== 'monad') throw new Error('Invalid Monad signing result');
  const envelope = Transaction.deserialize(
    result.canonicalSerializedTransaction
  );
  const hashToSign = Transaction.getSignPayload(envelope);
  if (hashToSign !== Transaction.getSignPayload(monadEnvelope(approved)))
    throw new Error('Monad signer changed the approved transaction');
  const signature = envelope.features.find(([key]) => key === '0x06')?.[1];
  if (
    !Array.isArray(signature) ||
    signature.length !== 3 ||
    signature.some((v) => typeof v !== 'string')
  )
    throw new Error('Missing Monad signature');
  const [parity, r, s] = signature as Hex[];
  const sValue = BigInt(s === '0x' ? '0x0' : s);
  if (
    sValue > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n
  )
    throw new Error('Monad signature must be low-s');
  const sender = await recoverAddress({
    hash: hashToSign,
    signature: {
      r: padHex(r, { size: 32 }),
      s: padHex(s, { size: 32 }),
      yParity: Number(parity === '0x' ? 0 : BigInt(parity)),
    },
  });
  if (sender.toLowerCase() !== approved.from)
    throw new Error('Monad signature does not match the approved sender');
  return {
    canonicalSerializedTransaction: result.canonicalSerializedTransaction,
    transactionHash: Transaction.hash(envelope),
    submission: Submission.serialize(envelope),
  };
}
