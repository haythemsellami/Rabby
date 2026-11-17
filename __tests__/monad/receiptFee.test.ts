/** @jest-environment node */
import type { TransactionHistoryItem } from '@/background/service/transactionHistory';
import {
  receiptFeeFields,
  receiptQuantity,
  transactionGasFee,
} from '@/utils/transactionReceipt';

const tx = {
  rawTx: {
    type: '0x40',
    maxFeePerGas: '0x2f08236400', // 202 gwei
    maxPriorityFeePerGas: '0x77359400',
  },
  isCompleted: true,
  failed: false,
  gasUsed: 21000,
  receiptGasUsed: '0x5208',
  effectiveGasPrice: '0x17bfac7c00', // 102 gwei
} as TransactionHistoryItem;

it.each([false, true])(
  'calculates the receipt fee, not the cap, when reverted=%s',
  (failed) => {
    expect(transactionGasFee({ ...tx, failed })).toBe(2142000000000000n);
  }
);

it.each(['0x0', '0x1', '0x2', '0x3', '0x4', '0x40'])(
  'uses effectiveGasPrice for type %s',
  (type) => {
    expect(
      transactionGasFee({
        ...tx,
        rawTx: { ...tx.rawTx, type, gasPrice: '0x1' },
      })
    ).toBe(2142000000000000n);
  }
);

it.each([undefined, '0x0', '0x1'])(
  'retains old fixed-price history for type %s',
  (type) => {
    expect(
      transactionGasFee({
        ...tx,
        receiptGasUsed: undefined,
        effectiveGasPrice: undefined,
        rawTx: {
          ...tx.rawTx,
          type,
          gasPrice: '0x17bfac7c00',
          maxFeePerGas: undefined,
          maxPriorityFeePerGas: undefined,
        },
      })
    ).toBe(2142000000000000n);
  }
);

it.each([undefined, '0x0', '0x1', '0x2', '0x3', '0x4', '0x40'])(
  'never guesses a missing dynamic receipt price from type %s or gasPrice',
  (type) => {
    expect(
      transactionGasFee({
        ...tx,
        effectiveGasPrice: undefined,
        rawTx: { ...tx.rawTx, type, gasPrice: '0x2f08236400' },
      })
    ).toBeUndefined();
  }
);

it('distinguishes free receipts and zero gas from missing receipt data', () => {
  expect(transactionGasFee({ ...tx, effectiveGasPrice: '0x0' })).toBe(0n);
  expect(transactionGasFee({ ...tx, receiptGasUsed: '0x0' })).toBe(0n);
  expect(
    transactionGasFee({ ...tx, receiptGasUsed: undefined, gasUsed: undefined })
  ).toBeUndefined();
});

it('multiplies exact quantities even when the legacy gasUsed number loses precision', () => {
  expect(
    transactionGasFee({
      ...tx,
      gasUsed: 9007199254740992,
      receiptGasUsed: '0x20000000000001',
      effectiveGasPrice: '0xffffffffffffffff',
    })
  ).toBe(9007199254740993n * 18446744073709551615n);
  expect(
    transactionGasFee({
      ...tx,
      receiptGasUsed: undefined,
      gasUsed: 9007199254740992,
    })
  ).toBeUndefined();
});

it.each([
  { isCompleted: false },
  { isSubmitFailed: true },
  { isWithdrawed: true },
])(
  'does not report an actual fee for an unincluded transaction: %j',
  (state) => {
    expect(transactionGasFee({ ...tx, ...state })).toBeUndefined();
  }
);

it.each([
  { gasUsed: 21000n, effectiveGasPrice: 102000000000n },
  { gasUsed: '0x5208', effectiveGasPrice: '0x17bfac7c00' },
  { gasUsed: '21000', effectiveGasPrice: '102000000000' },
])('normalizes receipt fields to JSON-safe exact quantities: %#', (receipt) => {
  expect(JSON.parse(JSON.stringify(receiptFeeFields(receipt)))).toEqual({
    receiptGasUsed: '0x5208',
    effectiveGasPrice: '0x17bfac7c00',
  });
});

it.each([
  undefined,
  null,
  '',
  '0x',
  '-1',
  '-0x1',
  '1.5',
  ' 2 ',
  -1,
  -1n,
  NaN,
  Infinity,
  9007199254740992,
])('does not fabricate a quantity for invalid or imprecise input %s', (value) =>
  expect(receiptQuantity(value)).toBeUndefined()
);
