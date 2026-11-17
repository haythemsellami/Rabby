# Testing Rabby type 0x40 against a Monad development node

Paths starting with `../../` refer to sibling checkouts or local deployment artifacts in the development workspace. The [shared demo](https://sgp-006.tail08a730.ts.net:8080/demo/) and wallet build instructions below can be used without those local artifacts.

Browser validation: 2026-11-13; historical node-source inspection: 2026-11-12. Wallet: `feat/monad-type-40-wallet` at `5ecf48760796babc068dbd259764cd3c78198a20`. Protocol authority: the [main universal transaction design](proposals/monad-universal-transaction-draft.md), with the [baseline wallet scope](rabby-monad-transaction-reference.md#development-milestone-implementation).

The wallet is implemented. Baseline native node support is published on paired `feat/monad-type-40` branches: the current devnet uses BFT `6dab54f1efcc6ade9bb2f3225b3c31dfcf13874f`, which pins execution `d2fadff7c960e655ff7d3e76ea244f4dc8346aa4` under `monad-bft/monad-execution/` (repository `category-labs/monad`). The fork branches back linked upstream draft PRs: [execution #2840](https://github.com/category-labs/monad/pull/2840) and [BFT #3352](https://github.com/category-labs/monad-bft/pull/3352), both titled `demo: monad universal tx type 0x40`. The earlier fork-only PRs are closed. The inspected upstream base commits do not support this type. The full paired build and corrected MONAD_TEN integration suite pass on category-box. A native Rabby browser self-call also passes on the persistent network; see the [recorded browser result](#recorded-browser-smoke-test-2026-11-13). See the [implementation reference](rabby-monad-transaction-reference.md#native-node-baseline-implementation) and [node build/test notes](../../monad-bft/docs/monad-type-40.md).

## Persistent category-box devnet

For wallet testing, the single-validator node is now running independently at `/home/hsellami/Projects/monad-type40-devnet` on category-box. Its chain ID is **20143**, currency **MON**, with MONAD_TEN and phase 0 native transactions. A native transfer and a full stop/start persistence check passed on 2026-11-13. The browser signing/approval test below subsequently passed against this network.

With the laptop connected to the company Tailscale network, use custom RPC **`https://sgp-006.tail08a730.ts.net:8080/`**, chain ID **20143**, and currency **MON**. The WebSocket endpoint is `wss://sgp-006.tail08a730.ts.net:8081/`. Both ports match the approved tailnet rules. A fresh native transaction submitted from the laptop over HTTPS passed canonical hash, raw-byte, receipt, block-entry, and balance checks; WebSocket `newHeads` delivery passed. No SSH tunnel is needed for this path.

The server's persistent loopback RPC remains `127.0.0.1:8545`. An alternative is `ssh -N -L 18545:127.0.0.1:8545 category-box`, then custom RPC `http://127.0.0.1:18545`. See the [deployment runbook](../../devnet/category-box/README.md) for startup, logs, test funding, persistence, exact source pins, and access-policy details. No monad-integration changes were needed for this deployment.

## Two-validator integration profile

The separate `/Users/haythem/Projects/Category/monad-integration` checkout has an opt-in profile on `feat/monad-type-40`, published in upstream [draft PR #478](https://github.com/category-labs/monad-integration/pull/478). It pins the two node PR heads above. The selected baseline is **MONAD_TEN**, with NEXT disabled and `MONAD_DB_STATE_MACHINE=monad` enforced for page-encoded storage. The shared RPC environment correction is in separate [draft PR #479](https://github.com/category-labs/monad-integration/pull/479), merged into #478. The runner supports Docker and Podman through the `docker` CLI. See the [review and rerun evidence](rabby-monad-transaction-reference.md#integration-fixes-and-rerun-2026-11-12).

The full paired build and the corrected suite pass on category-box: **15 offline tests and five live tests**, the latter in **46.396 seconds** using the unmodified runner. Tests now catch mismatched access-list simulation on both validators, wait for database height after receipts, and force TrieDB transaction/receipt/raw-byte/root/log/state reads through an RPC without an event ring. The completed tmux session is `type40-fixes-478`; its log is `.build/type40/category-box-fixes-478/test-session.log` under the remote integration checkout, with a local copy. All test containers were stopped. The profile does not enable authorization lists, sponsorship or batching.

Lint and formatting pass. Fresh standalone type-checking has two pre-existing BLS import errors, also reproduced against clean main; details are in the reference. They do not prevent the passing network run.

On category-box, from `/home/hsellami/Projects/monad-integration`:

```sh
.build/type40/venv/bin/python scripts/type40.py check
.build/type40/venv/bin/python scripts/type40.py test
# Keep a network running for wallet testing instead:
.build/type40/venv/bin/python scripts/type40.py run
```

Use tmux for these remote commands. `run` prints ephemeral RPC ports; expose one to the local browser through an SSH tunnel before adding the custom wallet network. The run guide in #478 documents first-time preparation and builds for another Linux x86-64 host.

## Node baseline and development chain

Inspected revisions:

| Component | Revision | Role |
| --- | --- | --- |
| [monad-bft](https://github.com/category-labs/monad-bft/tree/e844f6086acac664f4bd2a8ffcc99f3b5ce4b9af) | `e844f6086acac664f4bd2a8ffcc99f3b5ce4b9af` (`master` at inspection) | Rust RPC, transaction pool, consensus, block validation and transport |
| [Paired execution submodule](https://github.com/category-labs/monad/tree/75800de50c3983f536afa0ef1ee2966abfe2368c) | `75800de50c3983f536afa0ef1ee2966abfe2368c` | Native implementation including the upstream `main` merge, pinned by BFT `d1861e6c` |
| [Execution main](https://github.com/category-labs/monad/tree/27ad173ddf730deadc433987770e5c886ff1255b) | `27ad173ddf730deadc433987770e5c886ff1255b` | Upstream base merged into the native execution branch |

Use a matched consensus/execution pair. The [submodule definition](https://github.com/category-labs/monad-bft/blob/e844f6086acac664f4bd2a8ffcc99f3b5ce4b9af/.gitmodules) points to `category-labs/monad`; the local BFT implementation commit updates that pin to execution `75800de50c3983f536afa0ef1ee2966abfe2368c`.

Use **chain ID 20143 (`0x4eaf`)** for the first native devnet test. Both [chain configuration](https://github.com/category-labs/monad-bft/blob/e844f6086acac664f4bd2a8ffcc99f3b5ce4b9af/monad-chain-config/src/lib.rs#L34) and the supplied [node configuration](https://github.com/category-labs/monad-bft/blob/e844f6086acac664f4bd2a8ffcc99f3b5ce4b9af/docker/devnet/monad/config/node.toml#L25) define this ID. The [RPC execution-chain mapping](https://github.com/category-labs/monad-bft/blob/e844f6086acac664f4bd2a8ffcc99f3b5ce4b9af/monad-rpc/src/handlers/mod.rs#L100) accepts a fixed set of chains; arbitrary `31337` is not supported there. The wallet's earlier `31337` build was an HTTP fixture configuration, not a verified native-node configuration.

The [single-node nets compose setup](https://github.com/category-labs/monad-bft/blob/e844f6086acac664f4bd2a8ffcc99f3b5ce4b9af/docker/single-node/nets/compose.yaml) initializes TrieDB/genesis and runs `monad_execution`, `monad_node`, and `monad_rpc`, exposing RPC on port **8080**. This is the appropriate existing starting point after native `0x40` support is implemented. Its [launcher](https://github.com/category-labs/monad-bft/blob/e844f6086acac664f4bd2a8ffcc99f3b5ce4b9af/docker/single-node/nets/run.sh) resolves the repository root as `../..`, so its expected working directory is `monad-bft/docker/single-node`:

```sh
# In the modified monad-bft checkout, with its modified execution submodule:
cd docker/single-node
bash nets/run.sh
```

This launcher has been inspected, not executed here. Build from the modified sources; published/prebuilt images will not include the new type. The separate [Hive harness](https://github.com/category-labs/monad-bft/blob/e844f6086acac664f4bd2a8ffcc99f3b5ce4b9af/docker/single-node/hive/README.md) does not start consensus or a transaction pool and explicitly does not support raw submission.

Run the node on a suitable Linux x86-64 host. The paired execution [build instructions](https://github.com/category-labs/monad/blob/27ad173ddf730deadc433987770e5c886ff1255b/README.md) identify Ubuntu as the primary platform and require x86-64-v3/Haswell CPU features. Rabby can run on the Mac and connect to that host's RPC; native Apple Silicon node execution is not established by the extension build.

## Local node branch configuration

Use the two local branches together. Execution support is in `monad-bft/monad-execution/`, and the BFT implementation commit already records the matching execution revision. Keep the submodule at that implementation pin when building. Do not use prebuilt public images for this feature.

Execution's conflicts against upstream `main` are resolved, and BFT's submodule pin records the merged implementation. Codec, validation, execution-event reconstruction and Linux adapter checks were rerun together. The simulation bridge passes its existing validation flag to the updated execution API. Both upstream PRs remain drafts. The later persistent-devnet test below verifies one native wallet round trip; the broader negative and contract cases remain separate validation work.

For this baseline, pass `MONAD_DEVNET_FORK_TS=18446744073709551615` to **both execution and RPC**, and to genesis creation. The matched BFT source models Prague transaction gas, while execution's default devnet activates NEXT's extra access-list gas charges. The added Compose overlay selects the compatible pre-NEXT devnet configuration:

```sh
cd monad-bft/docker/single-node
COMPOSE_FILE=compose.yaml:compose.type40.yaml ./nets/run.sh --toolchain gcc-avx2
```

The launcher builds local source and creates a new data directory. Its Docker requirements remain those of the node project (Linux x86-64/AVX2, privileged node containers and the configured build toolchain). This command is documented, not verified as a complete running network here. See [node verification](../../monad-bft/docs/monad-type-40.md#verification) for checks actually completed.

Use a fresh ledger/TrieDB/event ring for this development profile. The execution event schema now records access-list feature presence, and readers must come from the same branch. Ordinary Ethereum transactions remain supported alongside native transactions. Native authorization lists, sponsorship, batching and nonempty auxiliary data are rejected.


## Build and load Rabby

The [shared demo](https://sgp-006.tail08a730.ts.net:8080/demo/) offers the current
ready-to-load ZIP compiled for chain **20143**, with its exact source commit,
SHA-256 checksum, build metadata, and update instructions.
Download and extract it, then follow the Chrome loading steps below, selecting
`rabby-monad-20143` instead of `dist`. Keep that directory. This is a manual development installation in a separate
profile; the manifest retains Rabby's existing extension ID. To update, replace
files in the same folder and use **Reload**, without removing the extension.

The initial ZIP at `0a187c6e8e74` predates the native pending-transaction formatter
correction in this branch. Use a release containing that correction, or build this
checkout. The demo waits for pending inclusion metadata to catch
up, but still rejects an older extension's incorrect `type: "0x2"` cache response.
If that happens, verify the existing hash after history completes; do not resend.

Building from source is optional:

From the Rabby repository root, using Node 22 or later and the repository's Corepack/Yarn installation:

```sh
git switch feat/monad-type-40-wallet
corepack yarn --immutable
corepack yarn clean
corepack yarn make-theme
MONAD_DEV_CHAIN_ID=20143 \
MANIFEST_TYPE=chrome-mv3 \
NODE_OPTIONS=--max-old-space-size=12288 \
corepack yarn webpack --env config=dev --no-watch
```

The output is `Rabby/dist`, containing `manifest.json`. The SDK is already vendored and installed as `viem-monad`; there is no need to rebuild or link the separate Viem checkout. `MONAD_DEV_CHAIN_ID` is compiled into the extension, so changing the node chain requires rebuilding and reloading the extension. `yarn build:dev` is the watch-mode alternative; the command above builds once.

Local validation on 2026-11-13: a clean Chrome MV3 build for **20143** completed successfully with Node `24.11.1` and Yarn `4.14.1`, and the generated background bundle was checked for the configured ID. Chrome loaded version `0.94.15` from `dist` in the separate **Monad 0x40** profile, extension ID `acmacodkjbdgmoleebolmdjonilkdbch`. The existing Ox Tempo dynamic-dependency warning remains. Build evidence is in [`rabby-build/build.json`](../../devnet/category-box/rabby-build/build.json). Wallet onboarding and the native self-call below also passed.

1. Open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose `Rabby/dist`. These are Chrome's [unpacked-extension instructions](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).
2. Use a browser profile with only this development wallet enabled, so the injected provider is unambiguous.
3. Import a disposable development private key or mnemonic. Fund its address on this devnet through the genesis allocation or another funded development account. Watch-only and hardware accounts cannot sign this milestone.
4. Open **Custom Network** and choose **Add Custom Network**. Set name `Monad 0x40 Devnet`, chain ID `20143`, RPC URL `https://sgp-006.tail08a730.ts.net:8080/`, and currency `MON`. An explorer URL is optional. Keep Tailscale connected.
5. Connect the test dapp to this custom network. Adding a custom RPC override to Rabby's integrated Monad mainnet/testnet entry does not enable this path.

After a rebuild, reload the extension on `chrome://extensions` and reload the dapp page. Inspect the extension's service worker/background views for wallet errors and the dapp's developer console for provider errors.

### Local test page and funding

The same page is now shared from category-box at
**https://sgp-006.tail08a730.ts.net:8080/demo/**. Use that URL in the development
Chrome profile to test without running a laptop web server. It requires
Tailscale access to the devnet and the custom Rabby build, and includes build
instructions for other testers. A devnet operator can fund each public test
address. The [deployment runbook](../../devnet/category-box/README.md#shared-rabby-test-page)
documents the separate tmux server and how to restart it after a host reboot.

The [local test page](../../devnet/category-box/rabby-dapp/index.html) exercises the injected provider without a dapp framework. From the workspace root:

```sh
python3 -m http.server 5173 --bind 127.0.0.1 \
  --directory devnet/category-box/rabby-dapp
```

Open `http://127.0.0.1:5173` in the **Monad 0x40** Chrome profile. Choose **Connect Rabby**, approve the connection, then **Add / switch devnet** and review the custom network in Rabby. The page displays the public account address and a funding command:

```sh
ssh category-box 'cd /home/hsellami/Projects/monad-type40-devnet && ./devnet fund 0xYOUR_TEST_ADDRESS 10'
```

This sends 10 development MON from the genesis test account. Refresh the balance, then choose **Send 0x40 self-call**. The request uses the connected account as both sender and recipient, zero value, empty data, and explicit `type: "0x40"` / `chainId: "0x4eaf"`. Rabby prepares the nonce, gas limit, and fee caps. Its **Monad development transaction** approval shows those prepared values. This milestone selects native transactions through the dapp request; the wallet's ordinary Send screen is not the native entry point.

The page queries transaction, receipt, and block data through Rabby's provider. Direct cross-origin browser JSON POSTs to this endpoint currently lack CORS preflight support; the extension's RPC transport is used instead. This does not require a node or integration-harness change.

After inclusion, independently verify the returned hash from the laptop:

```sh
node devnet/category-box/verify-rabby.cjs 0xTRANSACTION_HASH 0xTEST_WALLET_ADDRESS
```

The verifier uses the installed `viem-monad` codec to check stored canonical bytes, chain ID, canonical hashing, signer recovery, low-s normalization, receipt success, and `0x40` in the full block. It writes public evidence to `devnet/category-box/rabby-verification.json`. Its submission bytes are reconstructed from canonical data, not captured from the browser's HTTP request. Also open the wallet's custom-network history and verify that the transaction moves from pending to completed. Keep the password and recovery phrase private; only the test address and transaction hash are needed for funding and verification.

### Recorded browser smoke test (2026-11-13)

The loaded HD wallet `0x3dc46eb55d472b326b634ec90baf2bdc7edc1009` received 10 test MON, then signed and submitted the page's zero-value native self-call. Transaction `0x6a0b80816df5f646399692c78832ee0ead30c92ba82d4981c5b1146ab911a91b` succeeded in block **13625**, using 21,000 gas at an effective 102 gwei (**0.002142 MON**). The remaining balance was **9.997858 MON**.

The independent verifier passed canonical bytes/hash, low-s signing and sender recovery, RPC-field reconstruction, and native type in the transaction, receipt, and block. The browser's read-only recheck passed for the same hash. The initial immediate check failed before that recheck; the page now waits for all three RPC objects and supports **Verify existing transaction** without resending. The original transient responses were not saved, so its exact cause is not established.

The original smoke-test build displayed a completed entry in **Transactions → Custom Network**, with UI limitations: its title is **Unknown Transaction**; it displays the fee cap as the spent gas cost; and clicking the row opens a broken link if no explorer URL is set. These follow-ups, the scope of the passing test, and public evidence are recorded in the [reference](rabby-monad-transaction-reference.md#rabby-browser-smoke-test-2026-11-13). No wallet source changes or commits were made during this smoke test.

The subsequent local history fix labels native records **Monad transaction · 0x40** and provides expandable **Call** / **Contract creation** fields. Completed fees use the receipt's effective price. After reloading the rebuilt extension, open **Transactions → Custom Network**; old entries without a saved receipt price show **Fee unavailable**. Click **Refresh receipt** once to fetch their actual fee without resending the transaction. The original nonce-0 self-call was rechecked in Chrome after the rebuild: **Refresh receipt** changed its open history row to **0.002142 MON**, and expanding **Call** showed the expected sender, recipient, zero value, and empty calldata. This check did not send another transaction. New completions save this data automatically. Explorer-link behavior remains deferred until an explorer URL is configured. See [history UI corrections](rabby-monad-transaction-reference.md#history-ui-corrections-2026-11-13) for implementation and regression evidence.

## What the RPC must support

The wallet calls standard Ethereum method names, but the transaction-aware methods must understand the native `0x40` envelope. [Wallet preparation and submission](../src/background/service/monad.ts) is the authoritative method list for this milestone.

| Method | Required behavior |
| --- | --- |
| `eth_chainId` | Return the configured chain as a hex quantity, e.g. `0x4eaf`; the wallet verifies it before preparation and submission. |
| `eth_getTransactionCount(address, "pending")` | Return a canonical hex quantity without precision loss. Preparation and submission both check pending nonce; local wallet reservations are also considered. |
| `eth_getBalance(address, "pending")` | Return the sender balance used to check value plus maximum gas cost. |
| `eth_estimateGas(tx, "pending")` | Accept unsigned flat fields with explicit `type: "0x40"`, `from`, `chainId`, nonce, destination or creation, value/data, fee caps, and optional access list. Estimate according to the activated native type's rules. This call is made even if the dapp provides `gas`. |
| `eth_maxPriorityFeePerGas` | Used when `maxPriorityFeePerGas` is absent. Supplying both fee fields avoids the automatic fee lookups. |
| `eth_getBlockByNumber("pending", false)` | Supply `baseFeePerGas` when `maxFeePerGas` is absent. Ordinary block queries are also used by the surrounding wallet/network UI. |
| `eth_sendRawTransaction(bytes)` | Accept exactly the three-field empty-auxiliary submission below. Validate and admit it to the transaction pool, and return its canonical two-field transaction hash. |
| `eth_getTransactionReceipt(hash)` | Return `null` until available and then standard fields, including canonical `transactionHash`, `type: "0x40"`, block identifiers, transaction index, status, gas usage, logs/bloom, and applicable effective gas price/creation address. Rabby's watcher uses this to complete history. |
| `eth_getTransactionByHash(hash)` and block transaction queries | Return the native type and canonical hash with standard flat transaction fields. Full-block reads must represent `0x40` alongside existing types. Needed for the complete node integration and independent inclusion checks. |

The dapp invokes wallet `eth_sendTransaction`; the wallet signs locally and invokes node `eth_sendRawTransaction`. The node does not need to hold the user's key or implement wallet signing. `wallet_*` methods belong to the extension. This Rabby flow does not require `eth_fillTransaction`, sponsorship endpoints, batching APIs, or `eth_sendRawTransactionSync`. `eth_call`/`eth_getCode` are needed when testing contract state; ordinary wallet operation may also use the node's other existing Ethereum RPCs.

The byte contract is:

```text
signing digest = keccak256(0x40 || RLP([chainId, features with 0x06 value = []]))
canonical     = 0x40 || RLP([chainId, signedFeatures])
txHash        = keccak256(canonical)
submission    = 0x40 || RLP([chainId, signedFeatures, []])
```

The final empty list is auxiliary data. It is not part of transaction identity or the transaction-trie value. Decode and reconstruct the canonical envelope; do not hash the submitted bytes or remove an assumed byte suffix. The signature feature's empty value is an RLP list, not a byte string containing `c0`.

## Required node changes

The data path crosses both repositories:

```text
Rabby -> monad-rpc -> transaction-pool ingress -> block proposal/validation
          monad-bft repository                     |
                                                  v
                            monad execution -> TrieDB / receipts
                               monad repository         |
                                                       v
                                               monad-rpc -> Rabby
```

| Location | Current evidence | Work for this baseline |
| --- | --- | --- |
| `monad-bft/monad-rpc/src/handlers/eth/txn.rs` | [Raw submission](https://github.com/category-labs/monad-bft/blob/e844f6086acac664f4bd2a8ffcc99f3b5ce4b9af/monad-rpc/src/handlers/eth/txn.rs#L134) calls `TxEnvelope::decode_2718_exact` and passes an Alloy `TxEnvelope` to the pool. | Parse the three-field submission, reject unsupported/nonempty auxiliary data, validate the native envelope, compute canonical identity, and forward a representation that downstream components understand. |
| `monad-bft/monad-rpc/src/handlers/eth/call.rs`, `gas.rs`, and the execution bridge | [Request conversion](https://github.com/category-labs/monad-bft/blob/e844f6086acac664f4bd2a8ffcc99f3b5ce4b9af/monad-rpc/src/handlers/eth/call.rs#L205) builds legacy/type-2/type-4 envelopes from fee/authentication fields; [estimation](https://github.com/category-labs/monad-bft/blob/e844f6086acac664f4bd2a8ffcc99f3b5ce4b9af/monad-rpc/src/handlers/eth/gas.rs#L370) passes them to execution. | Preserve explicit native type and validate its actual fields/rules through estimation. A successful estimate from the existing conversion is not evidence of native support. |
| `monad-bft/monad-eth-types`, `monad-eth-txpool-executor`, `monad-eth-txpool`, `monad-eth-block-policy`, `monad-eth-block-validator` | [Block bodies](https://github.com/category-labs/monad-bft/blob/e844f6086acac664f4bd2a8ffcc99f3b5ce4b9af/monad-eth-types/src/lib.rs#L217) and validated transactions hold Alloy envelopes. [Ingress](https://github.com/category-labs/monad-bft/blob/e844f6086acac664f4bd2a8ffcc99f3b5ce4b9af/monad-eth-txpool-executor/src/lib.rs) decodes them again. [Validation](https://github.com/category-labs/monad-bft/blob/e844f6086acac664f4bd2a8ffcc99f3b5ce4b9af/monad-eth-block-policy/src/validation.rs#L58) checks signatures, fees, gas and activation-related rules. | Add a native Rust envelope/codec representation or a suitable Alloy extension, and thread it through recovery, pooling, gossip, proposal encoding/decoding, validation, transaction-root construction, persistence and reads. Preserve existing Ethereum variants. |
| `monad/category/execution/ethereum/core/transaction.*`, `core/rlp/transaction_rlp.*`, `validate_transaction.cpp` | The paired [transaction type enum](https://github.com/category-labs/monad/blob/f1a93dd450ec99d52b70b677cf8fb356a333277e/category/execution/ethereum/core/transaction.hpp#L33) lists Ethereum types 0–4. Main also explicitly [rejects unsupported types](https://github.com/category-labs/monad/blob/27ad173ddf730deadc433987770e5c886ff1255b/category/execution/ethereum/validate_transaction.cpp#L60). | Decode the canonical `0x40` body, verify its native signing digest, recover the sender, enforce activation/field/gas/fee/nonce rules, and project the validated call into the existing execution machinery. Preserve canonical bytes/presence for hashing, storage and transaction roots. |
| Execution receipt/database/event code plus Rust RPC readers | The inspected [receipt encoder](https://github.com/category-labs/monad/blob/27ad173ddf730deadc433987770e5c886ff1255b/category/execution/ethereum/core/rlp/receipt_rlp.cpp#L63) uses four Ethereum receipt fields and known Ethereum type prefixes. | Implement the main draft's `0x40` receipt envelope with a fifth, empty receipt-extension list for this baseline, and consistent receipt roots/storage. Update readers and expose standard JSON receipts under the canonical transaction hash. Audit execution events/indexers that assume the old type set. |

This changes consensus-visible transaction validity and block contents. It does not, by itself, require a new voting/finality algorithm or new EVM opcodes. The single-call EVM execution and existing sender-paid fee semantics can be reused after native decoding and validation. Forwarding an RPC-translated type-2 transaction would change the signed object and identity and would not implement this protocol.

The following implementation decisions are now resolved in the [native-node baseline](rabby-monad-transaction-reference.md#decisions-established-by-this-implementation). The list records the original integration requirements:

- **Native Rust envelope ownership:** use one representation across RPC, pool and block paths. Choose a local wrapper/extension or a pinned Alloy fork; changing only an RPC JSON type does not extend the rest of the node.
- **Canonical preservation:** the existing flat execution struct cannot distinguish an omitted access list from an explicitly empty one. Preserve original canonical bytes or sufficient feature/presence information for exact re-encoding. Both forms execute equivalently but have different commitments.
- **Gas and validity:** define the native type's activation and intrinsic gas rules consistently in estimation, Rust validation and execution. Do not treat the draft's 21,000-gas example as the final gas schedule.
- **Widths and authentication:** use the draft's uint64 nonce/gas and uint256 value/fee fields without silent narrowing through existing Ethereum adapters. Keep low-s sender signatures consistent across both implementations. Encoding the maximum uint64 nonce does not imply execution accepts it.
- **Receipt commitment:** implement the draft's fifth receipt field even when its list is empty. JSON receipt compatibility alone does not establish correct receipt-root encoding.

These are node implementation/activation choices. Sponsorship, batching, authorization-list support and nonempty auxiliary data remain outside the first Rabby test.

## Browser smoke test after node support exists

Verify the endpoint first:

```sh
curl -s http://127.0.0.1:8080 \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
```

Expect `result: "0x4eaf"`. Verify that blocks advance and that the imported development address has funds. If the node is on another host, substitute its reachable RPC URL throughout the setup.

Serve a minimal HTTP page from a separate directory, rather than opening an extension-internal page:

```sh
mkdir -p /tmp/rabby-monad-dapp
printf '<!doctype html><title>Monad devnet test</title><h1>Monad devnet test</h1>\n' > /tmp/rabby-monad-dapp/index.html
python3 -m http.server 5173 --bind 127.0.0.1 --directory /tmp/rabby-monad-dapp
```

Open `http://127.0.0.1:5173` and run the following in that page's developer console. The first request connects the wallet; the second selects the custom network. The transaction is a zero-value self-call, with fees paid by the funded development account.

```js
const provider = window.ethereum;
if (!provider?.isRabby) throw new Error('Select the development Rabby provider');
const [from] = await provider.request({ method: 'eth_requestAccounts' });
await provider.request({
  method: 'wallet_switchEthereumChain',
  params: [{ chainId: '0x4eaf' }],
});
const hash = await provider.request({
  method: 'eth_sendTransaction',
  params: [{
    type: '0x40',
    chainId: '0x4eaf',
    from,
    to: from,
    value: '0x0',
    data: '0x',
  }],
});
console.log({ hash });
```

Approve the dedicated **Monad development transaction** screen. It should display exact prepared fields and identify RPC estimation without asset-change simulation. No `gasPrice`, authorization list, sponsor, batch or auxiliary fields belong in this request. Use the direct provider request: the current Viem Monad configuration intentionally rejects JSON-RPC-account signing/sending, and typed injected-wallet integration is a later milestone.

Then poll for a receipt and inspect the transaction:

```js
let receipt;
for (let attempt = 0; attempt < 60; attempt++) {
  receipt = await provider.request({
    method: 'eth_getTransactionReceipt', params: [hash],
  });
  if (receipt) break;
  await new Promise(resolve => setTimeout(resolve, 1000));
}
if (!receipt) throw new Error('No receipt within 60 seconds');
const tx = await provider.request({
  method: 'eth_getTransactionByHash', params: [hash],
});
console.log({ tx, receipt });
if (tx?.type !== '0x40' || receipt.type !== '0x40')
  throw new Error('The node did not retain the native transaction type');
if (tx.hash !== hash || receipt.transactionHash !== hash)
  throw new Error('Canonical transaction identity changed');
if (receipt.status !== '0x1') throw new Error('The smoke transaction reverted');
```

## What establishes an end-to-end pass

- Rabby estimates and approves the actual `0x40` transaction, signs with a local keyring, and sends one empty-auxiliary submission.
- RPC, pool and block validation recover the same sender and retain the same canonical hash. Block inclusion, transaction lookup and receipt all identify `0x40`.
- Independent node vectors and the Viem implementation agree on unsigned signing digest, signed canonical bytes/hash, submitted bytes and sender recovery. When available, `debug_getRawTransaction` should expose canonical bytes, not the three-field submission; verify them with `Transaction.deserialize` and `Transaction.hash`.
- Execution updates the account nonce/balance or contract state as expected. Receipt status and transaction/receipt roots agree across consensus, execution and storage. Restart/replay retains the result.
- Rabby custom-network history changes from pending to completed while open. Repeat with a reverting contract call to verify reverted status.
- Repeat with an ordinary Ethereum transaction, explicit empty versus absent access lists, creation, queued approvals, and an RPC/network change during approval. A stale approval must reject before another signature or broadcast.

The existing [HTTP integration test](../__tests__/monad/http.test.ts) validates wallet preparation, signing and submission framing against a protocol fixture. It does not execute the EVM, produce blocks, or establish native-node interoperability.
