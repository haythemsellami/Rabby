import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { useRequest } from 'ahooks';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { runInNewContext } from 'vm';
import { JsxEmit, ModuleKind, transpileModule } from 'typescript';
import eventBus from '@/eventBus';
import { useEventBusListener } from '@/ui/hooks/useEventBusListener';

const EVENTS = { RELOAD_TX: 'RELOAD_TX' };
const address = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf';
const otherAddress = '0x0000000000000000000000000000000000000002';
const wallet = { getTransactionHistory: jest.fn() };
let account: { address: string } | undefined;

function history(owner = address, status = 'Pending') {
  const item = { chainId: 31337, nonce: '0', owner, status };
  return {
    pendings: status === 'Pending' ? [item] : [],
    completeds: status === 'Pending' ? [] : [item],
  };
}

function loadComponent(): React.ComponentType {
  const modules = {
    react: React,
    ahooks: { useRequest },
    'react-i18next': { useTranslation: () => ({ t: (key: string) => key }) },
    '@/constant': { EVENTS },
    '@/ui/hooks/backgroundState/useAccount': {
      useCurrentAccount: () => account,
    },
    '@/ui/hooks/useEventBusListener': { useEventBusListener },
    '@/utils/chain': { findChainByID: () => ({ isTestnet: true }) },
    'ui/component': { Empty: () => React.createElement('div', null, 'Empty') },
    'ui/utils': {
      useWallet: () => wallet,
      isSameAddress: (a: string, b: string) =>
        a.toLowerCase() === b.toLowerCase(),
    },
    './components/TransactionItem': {
      TransactionItem: ({ item }: any) =>
        React.createElement('div', null, `${item.owner}: ${item.status}`),
    },
    './style.less': {},
  };
  const compiled = transpileModule(
    readFileSync(
      resolve(
        __dirname,
        '../../src/ui/views/TransactionHistory/TestnetTranasctionHistory.tsx'
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
  return exports.TestnetTransactionHistory;
}

const Component = loadComponent();
let root: Root | undefined;
let container: HTMLDivElement;
const render = async () => {
  await act(async () => root!.render(React.createElement(Component)));
};
const reload = async (addressList: string[]) => {
  await act(async () => eventBus.emit(EVENTS.RELOAD_TX, { addressList }));
};

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  account = { address };
  wallet.getTransactionHistory.mockReset().mockResolvedValue(history());
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
});

it.each(['Confirmed', 'Reverted'])(
  'refreshes a pending row to %s after receipt reconciliation',
  async (status) => {
    await render();
    expect(container.textContent).toContain('Pending');
    wallet.getTransactionHistory.mockResolvedValue(history(address, status));
    await reload([address.toUpperCase()]);
    expect(container.textContent).toContain(status);
    expect(container.textContent).not.toContain('Pending');
    expect(wallet.getTransactionHistory).toHaveBeenCalledTimes(2);
  }
);

it('ignores updates for other accounts and stops listening on unmount', async () => {
  await render();
  await reload([otherAddress]);
  expect(wallet.getTransactionHistory).toHaveBeenCalledTimes(1);
  await act(async () => root!.unmount());
  root = undefined;
  await reload([address]);
  expect(wallet.getTransactionHistory).toHaveBeenCalledTimes(1);
  expect(eventBus.events[EVENTS.RELOAD_TX]).toHaveLength(0);
});

it('does not restore an old account snapshot when a refresh finishes after switching accounts', async () => {
  await render();
  let finish!: (value: ReturnType<typeof history>) => void;
  wallet.getTransactionHistory.mockImplementationOnce(
    () => new Promise((resolve) => (finish = resolve))
  );
  await reload([address]);
  account = { address: otherAddress };
  wallet.getTransactionHistory.mockResolvedValue(
    history(otherAddress, 'Confirmed')
  );
  await render();
  expect(container.textContent).toContain(`${otherAddress}: Confirmed`);
  await act(async () => finish(history(address, 'Reverted')));
  expect(container.textContent).toContain(`${otherAddress}: Confirmed`);
  expect(container.textContent).not.toContain(address);
  const calls = wallet.getTransactionHistory.mock.calls.length;
  await reload([address]);
  expect(wallet.getTransactionHistory).toHaveBeenCalledTimes(calls);
});

it('clears the view and avoids history RPCs when there is no current account', async () => {
  await render();
  account = undefined;
  await render();
  await reload([address]);
  expect(container.textContent).toBe('Empty');
  expect(wallet.getTransactionHistory).toHaveBeenCalledTimes(1);
});
