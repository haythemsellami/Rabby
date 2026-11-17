import type { TransactionGroup } from '@/background/service/transactionHistory';
import { useWallet } from '@/ui/utils';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLoadTxData } from '../hooks';

export const TransactionFee = ({ item }: { item: TransactionGroup }) => {
  const { t } = useTranslation();
  const wallet = useWallet();
  const [refreshing, setRefreshing] = useState(false);
  const { gasTokenCount, gasTokenSymbol, gasUSDValue } = useLoadTxData(item);
  const completedTx = item.txs.find(
    (tx) => tx.isCompleted && !tx.isSubmitFailed && !tx.isWithdrawed
  );

  return (
    <span className="text-r-neutral-foot text-right">
      {gasTokenCount !== undefined ? (
        `Gas: ${gasTokenCount.toFixed(6)} ${gasTokenSymbol} ($${gasUSDValue})`
      ) : (
        <>
          {t('page.transactions.feeUnavailable')}
          {completedTx?.hash && (
            <button
              type="button"
              className="ml-6 text-r-blue-default disabled:opacity-50"
              disabled={refreshing}
              aria-busy={refreshing}
              onClick={async () => {
                setRefreshing(true);
                try {
                  await wallet.refreshTransactionReceipt({
                    address: completedTx.rawTx.from,
                    chainId: item.chainId,
                    nonce: item.nonce,
                  });
                } catch {
                  // Leave the fee unavailable when the receipt cannot be read.
                } finally {
                  setRefreshing(false);
                }
              }}
            >
              {t('page.transactions.refreshReceipt')}
            </button>
          )}
        </>
      )}
    </span>
  );
};
