/** @jest-environment node */
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createClient, http } from 'viem';
import { ethers } from 'ethers';
import { PrivateKeyKeyring } from '@/background/service/keyring/monad';
import {
  prepareMonadTransaction,
  sendApprovedMonadTransaction,
} from '@/background/service/monad';
import { normalizeMonadRequest } from '@/utils/monad';

it('runs preparation and submission through the custom-network HTTP transport', async () => {
  const calls: { method: string; params: any[] }[] = [];
  let receivedCanonical = '';
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const message = JSON.parse(body);
    calls.push(message);
    const values = {
      eth_chainId: '0x7a69',
      eth_getTransactionCount: '0x20000000000001',
      eth_getBalance: '0xffffffffffffffffffffffffffffffff',
      eth_maxPriorityFeePerGas: '0x1',
      eth_getBlockByNumber: { baseFeePerGas: '0x2' },
      eth_estimateGas: '0x7530',
    };
    let result = values[message.method];
    if (message.method === 'eth_sendRawTransaction') {
      const raw = message.params[0];
      const fields = ethers.utils.RLP.decode(`0x${raw.slice(4)}`);
      if (
        !raw.startsWith('0x40') ||
        fields.length !== 3 ||
        JSON.stringify(fields[2]) !== '[]'
      ) {
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32602,
              message: 'Expected empty-auxiliary submission',
            },
          })
        );
        return;
      }
      receivedCanonical = `0x40${ethers.utils.RLP.encode(
        fields.slice(0, 2)
      ).slice(2)}`;
      result = ethers.utils.keccak256(receivedCanonical);
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const client = createClient({
      transport: http(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        { retryCount: 0 }
      ),
    });
    const rpc = (method: string, params: unknown[]) =>
      client.request({ method, params } as any);
    const keyring = new PrivateKeyKeyring(['1'.padStart(64, '0')]);
    const [from] = await keyring.getAccounts();
    const original = normalizeMonadRequest({
      type: '0x40',
      chainId: 31337,
      from,
      to: null,
      data: '0x6000',
      accessList: [],
    });
    const { transaction } = await prepareMonadTransaction(
      original,
      rpc,
      new Set<bigint>()
    );
    const record = jest.fn();
    const hash = await sendApprovedMonadTransaction({
      original,
      approved: transaction,
      rpc,
      assertSession: () => undefined,
      reservedNonces: () => new Set<bigint>(),
      sign: () => keyring.signTransaction(from, transaction),
      record,
    });
    expect(hash).toBe(ethers.utils.keccak256(receivedCanonical));
    expect(record.mock.calls[0][0].canonicalSerializedTransaction).toBe(
      receivedCanonical
    );
    const estimate = calls.find(({ method }) => method === 'eth_estimateGas')!;
    expect(estimate.params).toEqual([
      {
        type: '0x40',
        chainId: '0x7a69',
        from,
        data: '0x6000',
        value: '0x0',
        accessList: [],
        nonce: '0x20000000000001',
        maxFeePerGas: '0x5',
        maxPriorityFeePerGas: '0x1',
      },
      'pending',
    ]);
    expect(
      calls.filter(({ method }) => method === 'eth_sendRawTransaction')
    ).toHaveLength(1);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});
