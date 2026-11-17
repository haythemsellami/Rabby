export type TransactionNonce = number | string;

export function compareNonces(a: TransactionNonce, b: TransactionNonce) {
  const left = BigInt(a);
  const right = BigInt(b);
  return left === right ? 0 : left < right ? -1 : 1;
}

export function safeNonceNumber(nonce: TransactionNonce): number {
  const value = Number(nonce);
  if (!Number.isSafeInteger(value))
    throw new Error(
      'This transaction flow cannot represent the account nonce; use the Monad development transaction flow'
    );
  return value;
}

export function historyNonce(tx: {
  nonce: string;
  type?: unknown;
}): TransactionNonce {
  return tx.type === '0x40' ? BigInt(tx.nonce).toString() : Number(tx.nonce);
}
