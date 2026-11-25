/** @jest-environment node */
import { writeFileSync } from 'fs';
import { getContractAddress } from 'viem-monad';
import { PrivateKeyKeyring } from '@/background/service/keyring/monad';
import {
  prepareMonadTransaction,
  sendApprovedMonadTransaction,
} from '@/background/service/monad';
import {
  normalizeMonadRequest,
  prepareMonadFields,
  monadRequestFromHistory,
  monadHistoryRequest,
} from '@/utils/monad';

const endpoint = process.env.MONAD_RABBY_RPC_URL;
const live = endpoint ? test : test.skip;

live(
  'signs, submits and reads native batches against the development node',
  async () => {
    // Public development key; use only the disposable chain-20143 account.
    const from = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf';
    const keyring = new PrivateKeyKeyring(['1'.padStart(64, '0')]);
    const rpc = async (method: string, params: unknown[] = []) => {
      const response = await fetch(endpoint!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
      const body = await response.json();
      if (body.error) throw new Error(JSON.stringify(body.error));
      return body.result;
    };
    expect(await rpc('eth_chainId')).toBe('0x4eaf');
    const nonce = BigInt(
      await rpc('eth_getTransactionCount', [from, 'pending'])
    );
    const contract = getContractAddress({ from, nonce }).toLowerCase();
    const word = (value: number) => `0x${value.toString(16).padStart(64, '0')}`;
    // Store calldata word zero in slot zero; revert when the word is 255.
    const initcode =
      '0x6014600c60003960146000f36000358060ff14600e57600055005b60006000fd';
    const request = {
      type: '0x40',
      chainId: 20143,
      from,
      calls: [
        { data: initcode },
        { to: contract, data: word(1) },
        { to: contract, data: word(2) },
      ],
    };
    const { transaction } = await prepareMonadTransaction(
      request,
      rpc,
      new Set()
    );
    const records: any[] = [];
    const send = async (original, approved) =>
      sendApprovedMonadTransaction({
        original: normalizeMonadRequest(original),
        approved,
        rpc,
        assertSession: () => undefined,
        reservedNonces: () => new Set(),
        sign: () => keyring.signTransaction(from, approved),
        record: (signed) =>
          records.push({ ...signed, rawTx: monadHistoryRequest(approved) }),
      });
    const wait = async (hash: string) => {
      for (let i = 0; i < 60; i++) {
        const receipt = await rpc('eth_getTransactionReceipt', [hash]);
        if (
          receipt &&
          BigInt(await rpc('eth_blockNumber')) > BigInt(receipt.blockNumber)
        )
          return receipt;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      throw new Error(`Receipt timeout for ${hash}; do not resend`);
    };
    const hash = await send(request, transaction);
    const receipt = await wait(hash);
    expect(receipt).toMatchObject({
      type: '0x40',
      status: '0x1',
      to: null,
      contractAddress: contract,
      gasUsed: transaction.gas,
    });
    const mined = await rpc('eth_getTransactionByHash', [hash]);
    expect(mined.calls).toHaveLength(3);
    expect(await rpc('debug_getRawTransaction', [hash])).toBe(
      records[0].canonicalSerializedTransaction
    );
    expect(await rpc('eth_getStorageAt', [contract, '0x0', 'latest'])).toBe(
      word(2)
    );
    expect(BigInt(await rpc('eth_getTransactionCount', [from, 'latest']))).toBe(
      nonce + 1n
    );
    const block = await rpc('eth_getBlockByHash', [receipt.blockHash, true]);
    expect(block.transactions.find((tx) => tx.hash === hash).calls).toEqual(
      mined.calls
    );

    const failing = {
      type: '0x40',
      chainId: 20143,
      from,
      calls: [
        { to: contract, data: word(3) },
        { to: contract, data: word(255) },
        { to: contract, data: word(4) },
      ],
    };
    // The wallet refuses a batch whose gas estimation reverts.
    await expect(
      prepareMonadTransaction(failing, rpc, new Set())
    ).rejects.toThrow();
    expect(records).toHaveLength(1);
    // Exercise failed receipt/history semantics with an explicitly gas-filled test transaction.
    const approved = prepareMonadFields({
      ...failing,
      nonce: `0x${(nonce + 1n).toString(16)}`,
      gas: '0x493e0',
      maxFeePerGas: transaction.maxFeePerGas,
      maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
    });
    const failedHash = await send(failing, approved);
    const failedReceipt = await wait(failedHash);
    const failedTransaction = await rpc('eth_getTransactionByHash', [
      failedHash,
    ]);
    expect(failedReceipt).toMatchObject({
      status: '0x0',
      gasUsed: approved.gas,
      to: null,
    });
    expect(failedTransaction.calls).toHaveLength(2);
    expect(
      monadRequestFromHistory(JSON.parse(JSON.stringify(records[1].rawTx)))
        .calls
    ).toHaveLength(3);
    expect(await rpc('debug_getRawTransaction', [failedHash])).toBe(
      records[1].canonicalSerializedTransaction
    );
    expect(await rpc('eth_getStorageAt', [contract, '0x0', 'latest'])).toBe(
      word(2)
    );
    expect(BigInt(await rpc('eth_getTransactionCount', [from, 'latest']))).toBe(
      nonce + 2n
    );
    if (process.env.MONAD_RABBY_EVIDENCE)
      writeFileSync(
        process.env.MONAD_RABBY_EVIDENCE,
        JSON.stringify(
          {
            endpoint,
            contract,
            hash,
            receipt,
            mined,
            failedHash,
            failedReceipt,
            failedTransaction,
            records,
          },
          null,
          2
        )
      );
  },
  150000
);
