import type { TransactionHistoryItem } from '@/background/service/transactionHistory';

/** Accept both raw RPC quantities and Viem's bigint receipt fields. */
export function receiptQuantity(value: unknown): bigint | undefined {
  if (typeof value === 'bigint') return value >= 0n ? value : undefined;
  if (typeof value === 'number')
    return Number.isSafeInteger(value) && value >= 0
      ? BigInt(value)
      : undefined;
  if (typeof value === 'string' && /^(?:0x[\da-f]+|\d+)$/i.test(value))
    return BigInt(value);
  return undefined;
}

export function receiptFeeFields(receipt: {
  gasUsed?: unknown;
  effectiveGasPrice?: unknown;
}) {
  const gasUsed = receiptQuantity(receipt.gasUsed);
  const effectiveGasPrice = receiptQuantity(receipt.effectiveGasPrice);
  return {
    receiptGasUsed:
      gasUsed === undefined ? undefined : `0x${gasUsed.toString(16)}`,
    effectiveGasPrice:
      effectiveGasPrice === undefined
        ? undefined
        : `0x${effectiveGasPrice.toString(16)}`,
  };
}

export function transactionGasFee(
  tx: TransactionHistoryItem
): bigint | undefined {
  if (!tx.isCompleted || tx.isSubmitFailed || tx.isWithdrawed) return undefined;
  const gasUsed = receiptQuantity(tx.receiptGasUsed ?? tx.gasUsed);
  let price = receiptQuantity(tx.effectiveGasPrice);
  if (tx.effectiveGasPrice === undefined) {
    const type = receiptQuantity(tx.rawTx.type);
    // Old fixed-price records can recover the actual price from the signed tx.
    // A dynamic fee cap is never evidence of the amount paid.
    if (
      (tx.rawTx.type === undefined || type === 0n || type === 1n) &&
      tx.rawTx.maxFeePerGas === undefined &&
      tx.rawTx.maxPriorityFeePerGas === undefined
    )
      price = receiptQuantity(tx.rawTx.gasPrice);
  }
  return gasUsed === undefined || price === undefined
    ? undefined
    : gasUsed * price;
}
