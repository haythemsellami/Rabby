import {
  assertMonadApproval,
  encodeMonadSubmission,
  monadHex,
  monadQuantity,
  normalizeMonadRequest,
  prepareMonadFields,
  MonadRequest,
  MonadSigningResult,
  PreparedMonadRequest,
  monadRpcRequest,
} from '@/utils/monad';

export type MonadRpc = (method: string, params: unknown[]) => Promise<any>;

export async function assertMonadRpcChain(rpc: MonadRpc, chainId: number) {
  if (
    monadQuantity(await rpc('eth_chainId', []), 256, 'RPC chainId') !==
    BigInt(chainId)
  ) {
    throw new Error('Monad RPC chain does not match the approved network');
  }
}

export async function prepareMonadTransaction(
  input: unknown,
  rpc: MonadRpc,
  reservedNonces: ReadonlySet<bigint>
) {
  const tx = normalizeMonadRequest(input);
  await assertMonadRpcChain(rpc, tx.chainId);
  const [pendingNonce, balance] = await Promise.all([
    rpc('eth_getTransactionCount', [tx.from, 'pending']).then((value) =>
      monadQuantity(value, 64, 'pending nonce')
    ),
    rpc('eth_getBalance', [tx.from, 'pending']).then((value) =>
      monadQuantity(value, 256, 'balance')
    ),
  ]);
  let nextNonce = pendingNonce;
  while (reservedNonces.has(nextNonce)) nextNonce += 1n;
  if (tx.nonce === undefined) tx.nonce = monadHex(nextNonce);
  else if (
    BigInt(tx.nonce) < pendingNonce ||
    reservedNonces.has(BigInt(tx.nonce))
  )
    throw new Error('Monad nonce is already used or pending');
  if (tx.maxPriorityFeePerGas === undefined) {
    let tip = monadQuantity(
      await rpc('eth_maxPriorityFeePerGas', []),
      256,
      'priority fee'
    );
    if (tx.maxFeePerGas !== undefined && tip > BigInt(tx.maxFeePerGas))
      tip = BigInt(tx.maxFeePerGas);
    tx.maxPriorityFeePerGas = monadHex(tip);
  }
  if (tx.maxFeePerGas === undefined) {
    const block = await rpc('eth_getBlockByNumber', ['pending', false]);
    const baseFee = monadQuantity(block?.baseFeePerGas, 256, 'base fee');
    tx.maxFeePerGas = monadHex(baseFee * 2n + BigInt(tx.maxPriorityFeePerGas));
  }
  // Validate quantities before estimation, including overflow in computed fees.
  const estimated = monadQuantity(
    await rpc('eth_estimateGas', [monadRpcRequest(tx), 'pending']),
    64,
    'estimated gas'
  );
  if (tx.gas === undefined) tx.gas = monadHex(estimated);
  if (BigInt(tx.gas) < estimated)
    throw new Error('Monad gas limit is below the estimate');
  const transaction = prepareMonadFields(tx);
  if (
    BigInt(transaction.value) +
      BigInt(transaction.gas) * BigInt(transaction.maxFeePerGas) >
    balance
  ) {
    throw new Error(
      'Insufficient native balance for the Monad transaction and maximum fee'
    );
  }
  return {
    transaction,
    estimatedGas: monadHex(estimated),
    balance: monadHex(balance),
  };
}

export type MonadSubmission = Awaited<ReturnType<typeof encodeMonadSubmission>>;

export async function broadcastMonadSubmission(
  signed: MonadSubmission,
  rpc: MonadRpc
) {
  let returnedHash: unknown;
  try {
    returnedHash = await rpc('eth_sendRawTransaction', [signed.submission]);
  } catch (error) {
    throw new Error(
      `Monad submission not confirmed; track canonical transaction ${
        signed.transactionHash
      }: ${error.message || String(error)}`
    );
  }
  if (
    typeof returnedHash !== 'string' ||
    returnedHash.toLowerCase() !== signed.transactionHash.toLowerCase()
  ) {
    throw new Error(
      `Monad RPC returned a different hash; track canonical transaction ${signed.transactionHash}`
    );
  }
  return signed.transactionHash;
}

export async function rebroadcastMonadTransaction({
  canonical,
  submission,
  hash,
  approved,
  rpc,
  assertSession,
}: {
  canonical: `0x${string}`;
  submission: string;
  hash: string;
  approved: PreparedMonadRequest;
  rpc: MonadRpc;
  assertSession: () => void;
}) {
  assertSession();
  const signed = await encodeMonadSubmission(
    { kind: 'monad', canonicalSerializedTransaction: canonical },
    approved
  );
  if (signed.transactionHash !== hash || signed.submission !== submission)
    throw new Error(
      'Stored Monad transaction bytes do not match their canonical identity'
    );
  await assertMonadRpcChain(rpc, approved.chainId);
  assertSession();
  return broadcastMonadSubmission(signed, rpc);
}

// Serializes signing/submission per account so two approvals cannot consume the same nonce.
const activeAccounts = new Set<string>();
export async function sendApprovedMonadTransaction({
  original,
  approved,
  rpc,
  assertSession,
  reservedNonces,
  sign,
  record,
}: {
  original: MonadRequest;
  approved: PreparedMonadRequest;
  rpc: MonadRpc;
  assertSession: () => void;
  reservedNonces: () => ReadonlySet<bigint>;
  sign: () => Promise<MonadSigningResult>;
  record: (signed: MonadSubmission) => void;
}) {
  const key = `${approved.chainId}:${approved.from}`;
  if (activeAccounts.has(key))
    throw new Error(
      'A Monad transaction is already being submitted for this account'
    );
  activeAccounts.add(key);
  try {
    assertSession();
    assertMonadApproval(original, approved);
    await assertMonadRpcChain(rpc, approved.chainId);
    const pendingNonce = monadQuantity(
      await rpc('eth_getTransactionCount', [approved.from, 'pending']),
      64,
      'pending nonce'
    );
    assertSession();
    if (
      BigInt(approved.nonce) < pendingNonce ||
      reservedNonces().has(BigInt(approved.nonce))
    ) {
      throw new Error(
        'Monad nonce is already used or pending; request a new approval'
      );
    }
    const signed = await encodeMonadSubmission(await sign(), approved);
    assertSession();
    // Keep the canonical identity even if the endpoint times out after accepting it.
    record(signed);
    assertSession();
    return await broadcastMonadSubmission(signed, rpc);
  } finally {
    activeAccounts.delete(key);
  }
}
