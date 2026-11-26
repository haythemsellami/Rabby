# Native Monad batches in Rabby

The custom development-network wallet supports atomic native batches through
`eth_sendTransaction` with `type: "0x40"`. It uses the pinned Viem fork at
[`5ed1f42cf495`](https://github.com/haythemsellami/viem/pull/2).
Enable the existing wallet integration with `MONAD_DEV_CHAIN_ID=20143` and use
an imported-key or mnemonic account. The shared test endpoint is
`https://sgp-006.tail08a730.ts.net:8080/`.

## Dapp request

```javascript
const [from] = await window.ethereum.request({ method: 'eth_requestAccounts' });
const hash = await window.ethereum.request({
  method: 'eth_sendTransaction',
  params: [{
    type: '0x40',
    chainId: '0x4eaf',
    from,
    calls: [
      { to: from, value: '0x0', data: '0x1234' },
      { to: from, value: '0x0', data: '0xabcd' },
    ],
  }],
});
```

Use `data` for each call's complete signing intent, matching Viem's transaction
builder. The adapter converts it to the node's `input` field for estimation.
RPC transaction-query entries use `input` and describe attempted execution;
they are deliberately rejected as wallet signing requests.

The nonempty `calls` array replaces top-level `to`, `value` and `data`; even
explicit null scalar fields are rejected. Each entry accepts only `to`, `value`
and `data`. Values default to zero and data to empty bytes. An absent or null
destination selects contract creation, allowed only at index zero. A one-entry
array still signs CALLS `0x08`, distinct from a scalar CALL transaction.

The wallet retains uint64 nonce/gas and uint128 fee-cap limits. Each call's value
is uint256. Wallet chain IDs must also be JavaScript safe integers. Authorization
lists, sponsorship, external keyrings and internal send flows remain outside
this development integration. This does not add `wallet_sendCalls` or `mon_`
methods.

## Approval, execution and history

Rabby estimates the whole batch, displays every call in order, and shows one
nonce and maximum network fee. All call contents, ordering and feature presence
are bound to the original request and checked again against the signed bytes.
An estimation failure disables approval. Existing approval identity and session
boundary checks apply, and recipient checks cover every call.

Calls share one transaction execution context. A failure reverts their effects;
the transaction still consumes its nonce and network fee. Later calls may reuse
funds returned by earlier calls, so preparation does not reject a batch solely
because the sum of its values exceeds the opening balance.

History keeps the complete signed call list, canonical transaction bytes and
submission bytes. Failed records still show every signed entry and explain the
rollback. The shared history schema has empty scalar placeholders for a batch;
only the stored call list is restored for signing validation or exact-byte
rebroadcast. It is never replaced with the node's attempted prefix.

Cached pending `eth_getTransactionByHash` responses match the updated node:
`calls: []`, `to: null`, `value: "0x0"`, `input: "0x"`, with empty optional lists
normalized to `[]`. Mined queries expose attempted entries. One aggregate receipt
provides status, logs, gas used and effective gas price. History computes the fee
once from that receipt. Fetch `debug_getRawTransaction` when complete canonical
signed bytes are required.

## Validation and demo

```sh
yarn
yarn check
yarn jest --runInBand __tests__/monad
node --test examples/monad-devnet/demo.test.cjs
```

The opt-in live test uses the public development key `1`, funded on the disposable
chain 20143. It creates a storage contract, executes two ordered writes, checks
canonical bytes and aggregate receipts, and verifies rollback after a later call
reverts. It separately verifies that normal wallet preparation rejects that
reverting batch before signing. Do not point it at a chain holding real funds.

```sh
MONAD_RABBY_RPC_URL=https://sgp-006.tail08a730.ts.net:8080/ \
  yarn jest --runInBand __tests__/monad/batch.live.test.ts
```

The versioned [demo source](../examples/monad-devnet/index.html) provides single
self-calls and two-call atomic batches. Its verifier waits for wallet/RPC/block
inclusion agreement, accepts the empty pending projection, and checks every
successful batch entry and the aggregate fee. Published `release.json` metadata
selects the immutable wallet ZIP without embedding its own future commit hash.
The page detects completed setup steps without prompting, draws the batch as one
envelope of ordered calls, and shows the verifier's progress as five checks; the
raw result remains available under **Raw RPC evidence**.

For a browser check, reload the updated unpacked extension in the existing
**Monad 0x40** Chrome profile, unlock privately, and open
[the shared demo](https://sgp-006.tail08a730.ts.net:8080/demo/). Review both calls,
approve once, wait for the batch PASS result, then inspect its complete call list
and receipt fee in **Transactions → Custom Network**. Reject a second request
and verify that no transaction is submitted. Updating must retain the existing
extension directory and wallet data.
