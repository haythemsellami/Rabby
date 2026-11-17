import React, { useEffect, useRef, useState } from 'react';
import { Alert, Spin } from 'antd';
import { formatEther } from 'viem-monad';
import type { Account } from '@/background/service/preference';
import type { PreparedMonadRequest } from '@/utils/monad';
import { findChain } from '@/utils/chain';
import {
  bindApproval,
  useApproval,
  useWallet,
  useCommonPopupView,
} from '@/ui/utils';
import { useEnterPassphraseModal } from '@/ui/hooks/useEnterPassphraseModal';
import { KEYRING_TYPE } from '@/constant';
import { FooterBar } from './FooterBar/FooterBar';
import { OriginInfo } from './OriginInfo';
import { Card } from './Card';

export function SignMonadTx({
  params,
  origin = '',
  account,
  approvalId,
}: {
  params: any;
  origin?: string;
  account: Account;
  approvalId?: string;
}) {
  const wallet = useWallet();
  const chain = findChain({ id: Number(params.data[0].chainId) });
  const [prepared, setPrepared] = useState<{
    id: string;
    tx: PreparedMonadRequest;
  }>();
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const ready = !!prepared && prepared.id === approvalId && !error;
  const [getApproval, resolveApproval, rejectApproval] = useApproval(
    bindApproval(approvalId, 'SignTx', () => ready)
  );
  const enterPassphrase = useEnterPassphraseModal('address');
  const { activeApprovalPopup } = useCommonPopupView();

  useEffect(() => {
    let cancelled = false;
    setPrepared(undefined);
    setError('');
    if (approvalId) {
      wallet
        .prepareMonadTransaction(approvalId)
        .then(({ transaction }) => {
          if (!cancelled) setPrepared({ id: approvalId, tx: transaction });
        })
        .catch((e) => {
          if (!cancelled) setError(e.message || String(e));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [approvalId, wallet]);

  const submit = async () => {
    if (!ready || !prepared || submitting.current || activeApprovalPopup())
      return;
    submitting.current = true;
    try {
      if (account.type === KEYRING_TYPE.HdKeyring)
        await enterPassphrase(account.address);
      const approval = await getApproval();
      if (
        !approval ||
        approval.id !== approvalId ||
        approval.data.approvalComponent !== 'SignTx'
      )
        throw new Error('Transaction approval expired');
      await resolveApproval({
        monadTransaction: prepared.tx,
        monadApprovalId: approvalId,
        signingTxId: approval.signingTxId,
      });
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      submitting.current = false;
    }
  };

  const tx = ready ? prepared?.tx : undefined;
  const rows = tx
    ? [
        ['Network', `${chain?.name} (${tx.chainId})`],
        ['From', tx.from],
        ['To', tx.to ?? 'Create contract'],
        [
          'Value',
          `${formatEther(BigInt(tx.value))} ${chain?.nativeTokenSymbol ?? ''}`,
        ],
        ['Nonce', BigInt(tx.nonce).toString()],
        ['Gas limit', BigInt(tx.gas).toString()],
        ['Maximum fee per gas (wei)', BigInt(tx.maxFeePerGas).toString()],
        [
          'Priority fee per gas (wei)',
          BigInt(tx.maxPriorityFeePerGas).toString(),
        ],
        [
          'Maximum network fee',
          `${formatEther(BigInt(tx.gas) * BigInt(tx.maxFeePerGas))} ${
            chain?.nativeTokenSymbol ?? ''
          }`,
        ],
        ['Data', tx.data],
      ]
    : [];

  return (
    <>
      <div className="approval-tx p-20 overflow-x-hidden">
        {chain && (
          <OriginInfo
            chain={chain}
            origin={origin}
            originLogo={params.session?.icon}
          />
        )}
        <Card>
          <h2 className="text-18 font-medium mb-16">
            Monad development transaction
          </h2>
          {error ? (
            <Alert type="error" message={error} />
          ) : !tx ? (
            <Spin />
          ) : (
            <>
              <p className="mb-16">
                Gas estimated by the development RPC. Asset-change simulation is
                unavailable.
              </p>
              <dl>
                {rows.map(([label, value]) => (
                  <div key={label} className="mb-12">
                    <dt className="text-r-neutral-body">{label}</dt>
                    <dd className="break-all whitespace-pre-wrap">{value}</dd>
                  </div>
                ))}
              </dl>
              {tx.accessList !== undefined && (
                <details>
                  <summary>Access list ({tx.accessList.length})</summary>
                  <pre className="whitespace-pre-wrap break-all">
                    {JSON.stringify(tx.accessList, null, 2)}
                  </pre>
                </details>
              )}
            </>
          )}
        </Card>
      </div>
      <FooterBar
        chain={chain ?? undefined}
        account={account}
        origin={origin}
        originLogo={params.session?.icon}
        isTestnet
        disabledProcess={!ready}
        onIgnoreAllRules={() => undefined}
        onSubmit={submit}
        onCancel={() => {
          void rejectApproval('User rejected the request.');
        }}
      />
    </>
  );
}
