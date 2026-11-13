import type { TransactionHistoryItem } from '@/background/service/transactionHistory';
import { receiptQuantity } from '@/utils/transactionReceipt';
import React from 'react';
import { useTranslation } from 'react-i18next';

export const MonadTransactionDetails = ({
  transaction,
}: {
  transaction: TransactionHistoryItem;
}) => {
  const { t } = useTranslation();
  const tx = transaction.rawTx;
  if (tx.type !== '0x40') return null;
  const value = receiptQuantity(tx.value);
  const fields = [
    [t('page.transactions.monad.from'), tx.from],
    ...(tx.to ? [[t('page.transactions.monad.to'), tx.to]] : []),
    [
      t('page.transactions.monad.value'),
      value === undefined
        ? t('page.activities.signedTx.common.unknown')
        : `${value.toString()} wei`,
    ],
    [t('page.transactions.monad.data'), tx.data || '0x'],
  ];

  return (
    <details className="mt-8 text-12 text-r-neutral-body">
      <summary className="cursor-pointer">
        {t(
          tx.to
            ? 'page.transactions.monad.call'
            : 'page.transactions.monad.creation'
        )}
      </summary>
      <dl className="mt-8 grid grid-cols-[auto_1fr] gap-x-8 gap-y-4">
        {fields.map(([label, value]) => (
          <React.Fragment key={label}>
            <dt className="text-r-neutral-foot">{label}</dt>
            <dd className="m-0 break-all font-mono max-h-[120px] overflow-auto">
              {value}
            </dd>
          </React.Fragment>
        ))}
      </dl>
    </details>
  );
};
