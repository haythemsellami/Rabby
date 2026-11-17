import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import type {
  TransactionGroup,
  TransactionHistoryItem,
} from '@/background/service/transactionHistory';
import { TransactionExplain } from '@/ui/views/TransactionHistory/components/TransactionExplain';
import { MonadTransactionDetails } from '@/ui/views/TransactionHistory/components/MonadTransactionDetails';
import { TransactionFee } from '@/ui/views/TransactionHistory/components/TransactionFee';

jest.mock('react-i18next', () => {
  const messages = require('../../_raw/locales/en/messages.json');
  const t = (key: string) =>
    key.split('.').reduce((obj, key) => obj?.[key], messages) || key;
  return { useTranslation: () => ({ t }) };
});
jest.mock('@/ui/utils', () => ({
  useWallet: () => mockWallet,
}));
jest.mock('@/ui/utils/token', () => ({
  getTokenSymbol: (token) => token.symbol,
  customTestnetTokenToTokenItem: (token) => token,
}));
jest.mock('@/utils/chain', () => ({
  findChain: () => ({
    id: 20143,
    nativeTokenAddress: '0x0000000000000000000000000000000000000000',
    nativeTokenSymbol: 'MON',
    nativeTokenDecimals: 18,
  }),
}));
jest.mock('@/utils/tx', () => ({ getPendingGroupCategory: jest.fn() }));
jest.mock('ui/assets', () => ({ SvgIconOpenExternal: () => null }));
jest.mock('@/ui/views/Approval/components/Actions/utils', () => ({
  getActionTypeText: () => 'Contract Interaction',
}));

const mockWallet = { refreshTransactionReceipt: jest.fn() };
const from = '0x3dc46eb55d472b326b634ec90baf2bdc7edc1009';
const to = '0x0000000000000000000000000000000000000001';
const transaction = (): TransactionHistoryItem => ({
  rawTx: {
    from,
    to,
    chainId: 20143,
    type: '0x40',
    nonce: '0x20000000000001',
    value: '0x20000000000001',
    data: '0x1234',
    gas: '0x5208',
    maxFeePerGas: '0x2f08236400',
    maxPriorityFeePerGas: '0x77359400',
  },
  createdAt: Date.now(),
  hash: '0x' + 'ab'.repeat(32),
  isCompleted: true,
  failed: false,
  gasUsed: 21000,
  receiptGasUsed: '0x5208',
  effectiveGasPrice: '0x17bfac7c00',
});
const group = (tx: TransactionHistoryItem): TransactionGroup => ({
  txs: [tx],
  chainId: 20143,
  nonce: '9007199254740993',
  isPending: false,
  isFailed: tx.failed,
  createdAt: tx.createdAt,
});

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mockWallet.refreshTransactionReceipt.mockReset().mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const render = async (component: React.ReactElement) => {
  await act(async () => root.render(component));
};
const explain = (
  tx: TransactionHistoryItem,
  action?: TransactionGroup['action']
) =>
  React.createElement(TransactionExplain, {
    transaction: tx,
    action,
    isFailed: tx.failed,
    isSubmitFailed: false,
    isCancel: false,
    isWithdrawed: false,
    onOpenScan: jest.fn(),
  });

it('labels a native call locally and retains its separate failed status', async () => {
  const tx = transaction();
  await render(explain(tx));
  expect(container.textContent).toContain('Monad transaction · 0x40');
  expect(container.textContent).not.toContain('Unknown Transaction');
  await render(explain({ ...tx, failed: true }));
  expect(container.textContent).toContain('Monad transaction · 0x40');
  expect(container.textContent).toContain('Failed');
});

it('retains existing Ethereum and backend action descriptions', async () => {
  const tx = transaction();
  await render(explain(tx));
  tx.rawTx.type = '0x2';
  await render(explain(tx));
  expect(container.textContent).toContain('Unknown Transaction');
  expect(container.textContent).not.toContain('Monad transaction');
  tx.rawTx.type = '0x40';
  await render(
    explain(tx, {
      actionData: { contractCall: {} },
      requiredData: { call: { func: 'transfer' } },
    } as any)
  );
  expect(container.textContent).toContain('transfer');
  expect(container.textContent).not.toContain('Monad transaction');
});

it('shows exact stored call fields without describing simulated effects', async () => {
  const tx = transaction();
  await render(
    React.createElement(MonadTransactionDetails, { transaction: tx })
  );
  expect(container.querySelector('summary')?.textContent).toBe('Call');
  expect(container.querySelector('details')?.open).toBe(false);
  expect(container.textContent).toContain(from);
  expect(container.textContent).toContain(to);
  expect(container.textContent).toContain('9007199254740993 wei');
  expect(container.textContent).toContain('0x1234');
  tx.rawTx.data = '0x';
  tx.rawTx.value = '0x0';
  await render(
    React.createElement(MonadTransactionDetails, { transaction: tx })
  );
  expect(container.querySelector('summary')?.textContent).toBe('Call');
  expect(container.textContent).toContain('0 wei');
  expect(container.textContent).not.toContain('Transfer');
});

it.each([null, undefined])(
  'distinguishes creation with to=%s and displays initcode',
  async (to) => {
    const tx = transaction();
    tx.rawTx.to = to as any;
    tx.rawTx.data = '0x6000';
    await render(
      React.createElement(MonadTransactionDetails, { transaction: tx })
    );
    expect(container.querySelector('summary')?.textContent).toBe(
      'Contract creation'
    );
    expect(container.textContent).toContain('0x6000');
    expect(
      [...container.querySelectorAll('dt')].map((el) => el.textContent)
    ).not.toContain('To');
  }
);

it('does not add native details to an Ethereum transaction', async () => {
  const tx = transaction();
  tx.rawTx.type = '0x2';
  await render(
    React.createElement(MonadTransactionDetails, { transaction: tx })
  );
  expect(container.textContent).toBe('');
});

it.each([false, true])(
  'renders the actual 0.002142 MON fee when failed=%s',
  async (failed) => {
    const item = group({ ...transaction(), failed });
    await render(React.createElement(TransactionFee, { item }));
    expect(container.textContent).toBe('Gas: 0.002142 MON ($0.00)');
    expect(container.textContent).not.toContain('0.004242');
    expect(container.querySelector('button')).toBeNull();
  }
);

it('renders a zero fee instead of an unknown fee', async () => {
  const item = group({ ...transaction(), effectiveGasPrice: '0x0' });
  await render(React.createElement(TransactionFee, { item }));
  expect(container.textContent).toBe('Gas: 0.000000 MON ($0.00)');
});

it('uses token decimals and decimal arithmetic for fee formatting', async () => {
  const item = group({
    ...transaction(),
    receiptGasUsed: '0x1',
    effectiveGasPrice: '0x12d687',
  });
  item.explain = {
    native_token: { symbol: 'TEST', decimals: 6, price: 2 },
  } as any;
  await render(React.createElement(TransactionFee, { item }));
  expect(container.textContent).toBe('Gas: 1.234567 TEST ($2.47)');
});

it('refreshes an old record by its exact nonce and renders the reconciled fee', async () => {
  const tx = { ...transaction(), effectiveGasPrice: undefined };
  const item = group(tx);
  let finish!: () => void;
  mockWallet.refreshTransactionReceipt.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  await render(React.createElement(TransactionFee, { item }));
  expect(container.textContent).toContain('Fee unavailable');
  const button = container.querySelector('button')!;
  await act(async () => button.click());
  expect(button.disabled).toBe(true);
  expect(mockWallet.refreshTransactionReceipt).toHaveBeenCalledWith({
    address: from,
    chainId: 20143,
    nonce: '9007199254740993',
  });
  await act(async () => finish());
  expect(button.disabled).toBe(false);
  await render(
    React.createElement(TransactionFee, { item: group(transaction()) })
  );
  expect(container.textContent).toBe('Gas: 0.002142 MON ($0.00)');
});

it('keeps a missing fee unavailable after a failed refresh', async () => {
  const item = group({ ...transaction(), effectiveGasPrice: undefined });
  mockWallet.refreshTransactionReceipt.mockRejectedValueOnce(
    new Error('offline')
  );
  await render(React.createElement(TransactionFee, { item }));
  await act(async () => container.querySelector('button')!.click());
  expect(container.textContent).toContain('Fee unavailable');
  expect(container.querySelector('button')!.disabled).toBe(false);
  expect(container.textContent).not.toContain('0.004242');
});
