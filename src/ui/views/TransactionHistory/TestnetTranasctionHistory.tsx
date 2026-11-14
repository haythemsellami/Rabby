import { EVENTS } from '@/constant';
import { useCurrentAccount } from '@/ui/hooks/backgroundState/useAccount';
import { useEventBusListener } from '@/ui/hooks/useEventBusListener';
import { findChainByID } from '@/utils/chain';
import { useRequest } from 'ahooks';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Empty } from 'ui/component';
import { isSameAddress, useWallet } from 'ui/utils';
import { TransactionItem } from './components/TransactionItem';
import './style.less';

export const TestnetTransactionHistory = () => {
  const wallet = useWallet();
  const { t } = useTranslation();
  const address = useCurrentAccount()?.address;

  const { data, loading, refresh } = useRequest(
    async () => {
      if (!address) return { address, transactions: [] };
      const { pendings, completeds } = await wallet.getTransactionHistory(
        address
      );
      return {
        address,
        transactions: [...pendings, ...completeds].filter(
          (item) => findChainByID(item?.chainId)?.isTestnet
        ),
      };
    },
    { refreshDeps: [address] }
  );
  useEventBusListener(
    EVENTS.RELOAD_TX,
    (params: { addressList?: string[] }) => {
      if (
        address &&
        params?.addressList?.some((item) => isSameAddress(item, address))
      )
        refresh();
    }
  );
  const transactions = data?.address === address ? data?.transactions : [];

  if (loading) {
    return null;
  }

  return (
    <div className="tx-history h-full overflow-auto">
      {transactions?.length ? (
        <div className="tx-history__completed">
          {transactions.map((item) => (
            <TransactionItem
              txRequests={{}}
              item={item}
              key={`${item.chainId}-${item.nonce}`}
              canCancel={false}
            />
          ))}
        </div>
      ) : (
        <Empty
          title={t('page.transactions.empty.title')}
          className="pt-[108px]"
        ></Empty>
      )}
    </div>
  );
};
