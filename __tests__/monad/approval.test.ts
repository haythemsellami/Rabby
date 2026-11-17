import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { runInNewContext } from 'vm';
import { JsxEmit, ModuleKind, transpileModule } from 'typescript';
import { formatEther } from 'viem-monad';

const tx = {
  type: '0x40',
  chainId: 31337,
  from: '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf',
  to: '0x0000000000000000000000000000000000000002',
  data: '0xaabbccdd',
  value: '0x0',
  nonce: '0x20000000000001',
  gas: '0x5208',
  maxFeePerGas: '0x8',
  maxPriorityFeePerGas: '0x2',
  accessList: [],
};
const wallet = { prepareMonadTransaction: jest.fn() };
const getApproval = jest.fn();
const resolveApproval = jest.fn(async () => true);
const rejectApproval = jest.fn();
let binding: any;

function loadComponent(): React.ComponentType<any> {
  const childrenOnly = ({ children }: any) =>
    React.createElement(React.Fragment, null, children);
  const modules = {
    react: React,
    antd: {
      Alert: ({ message }: any) =>
        React.createElement('div', { role: 'alert' }, message),
      Spin: () => React.createElement('span', null, 'Loading'),
    },
    'viem-monad': { formatEther },
    '@/utils/chain': {
      findChain: () => ({
        id: 31337,
        name: 'Monad dev',
        nativeTokenSymbol: 'MON',
        isTestnet: true,
      }),
    },
    '@/ui/utils': {
      useWallet: () => wallet,
      bindApproval: (approvalId, approvalComponent, canResolve) =>
        approvalId ? { approvalId, approvalComponent, canResolve } : null,
      useApproval: (value) => {
        binding = value;
        return [getApproval, resolveApproval, rejectApproval];
      },
      useCommonPopupView: () => ({ activeApprovalPopup: () => false }),
    },
    '@/ui/hooks/useEnterPassphraseModal': {
      useEnterPassphraseModal: () => jest.fn(async () => undefined),
    },
    '@/constant': { KEYRING_TYPE: { HdKeyring: 'HD Key Tree' } },
    './FooterBar/FooterBar': {
      FooterBar: ({ onSubmit, onCancel, disabledProcess }: any) =>
        React.createElement(
          'div',
          null,
          React.createElement(
            'button',
            { disabled: disabledProcess, onClick: onSubmit },
            'Approve'
          ),
          React.createElement('button', { onClick: onCancel }, 'Reject')
        ),
    },
    './OriginInfo': { OriginInfo: () => null },
    './Card': { Card: childrenOnly },
  };
  const compiled = transpileModule(
    readFileSync(
      resolve(
        __dirname,
        '../../src/ui/views/Approval/components/SignMonadTx.tsx'
      ),
      'utf8'
    ),
    {
      compilerOptions: {
        module: ModuleKind.CommonJS,
        jsx: JsxEmit.React,
        esModuleInterop: true,
      },
    }
  ).outputText;
  const exports: any = {};
  runInNewContext(compiled, {
    exports,
    require: (name: string) => {
      if (!(name in modules))
        throw new Error(`Missing test dependency ${name}`);
      return modules[name];
    },
  });
  return exports.SignMonadTx;
}

const Component = loadComponent();
let root: Root;
let container: HTMLDivElement;
const props = {
  params: { data: [tx], session: { origin: 'https://example.test' } },
  origin: 'https://example.test',
  account: { address: tx.from, type: 'Simple Key Pair', brandName: '' },
};
async function render(id?: string) {
  await act(async () => {
    root.render(React.createElement(Component, { ...props, approvalId: id }));
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  wallet.prepareMonadTransaction.mockResolvedValue({ transaction: tx });
  getApproval.mockResolvedValue({
    id: 'approval-1',
    signingTxId: 'signing-1',
    data: { approvalComponent: 'SignTx' },
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it('shows and resolves the exact prepared quantities with bound approval identity', async () => {
  await render('approval-1');
  expect(container.textContent).toContain('9007199254740993');
  expect(container.textContent).toContain(tx.data);
  expect(container.textContent).toContain(
    'Asset-change simulation is unavailable'
  );
  expect(binding.approvalId).toBe('approval-1');
  expect(binding.approvalComponent).toBe('SignTx');
  expect(binding.canResolve()).toBe(true);
  await act(async () => container.querySelector('button')!.click());
  expect(resolveApproval).toHaveBeenCalledWith({
    monadTransaction: tx,
    monadApprovalId: 'approval-1',
    signingTxId: 'signing-1',
  });
});
it.each(['missing', 'wrong component', 'wrong id'])(
  'does not resolve a %s approval',
  async (scenario) => {
    await render(scenario === 'missing' ? undefined : 'approval-1');
    if (scenario === 'wrong component')
      getApproval.mockResolvedValue({
        id: 'approval-1',
        data: { approvalComponent: 'SignText' },
      });
    if (scenario === 'wrong id')
      getApproval.mockResolvedValue({
        id: 'approval-2',
        data: { approvalComponent: 'SignTx' },
      });
    await act(async () => container.querySelector('button')!.click());
    expect(resolveApproval).not.toHaveBeenCalled();
  }
);
it('discards a preparation result after switching to a different approval', async () => {
  let finish!: (value: any) => void;
  wallet.prepareMonadTransaction.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render('approval-1');
  await render('approval-2');
  await act(async () =>
    finish({ transaction: { ...tx, nonce: '0xdeadbeef' } })
  );
  expect(container.textContent).toContain('9007199254740993');
  expect(container.textContent).not.toContain('3735928559');
  expect(binding.approvalId).toBe('approval-2');
});
it('keeps approval disabled when preparation fails', async () => {
  wallet.prepareMonadTransaction.mockRejectedValue(
    new Error('Unsupported Monad field: authorizationList')
  );
  await render('approval-1');
  expect(container.querySelector('button')!.disabled).toBe(true);
  expect(container.querySelector('[role=alert]')!.textContent).toContain(
    'authorizationList'
  );
});
