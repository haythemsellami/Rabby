# Monad development wallet demo

Serve this directory as the `/demo/` page alongside the category-box RPC.
`index.html` uses Rabby's injected provider and contains no signing key.

```sh
node --test examples/monad-devnet/demo.test.cjs
```

Publish immutable release files under `downloads/`, then copy the build metadata
JSON to `release.json`. Required metadata includes `sourceCommit`, `chainId`,
`version`, `archiveBytes`, `archiveSha256` and `nativeBatching: true`. Release files
use `rabby-monad-20143-<first 12 commit characters>` with `.zip`, `.zip.sha256`,
`.json` and `-INSTALL.txt` suffixes. Verify the downloadable archive before
publishing the new metadata and page. The shared deployment is private to the
company tailnet.

The page is a four-step setup checklist beside a send panel. On load it reads
`eth_accounts`, `eth_chainId` and the balance through Rabby without prompting, so
completed steps (install, connect, devnet, funds) fold away. While funding is the
open step, it polls the balance every 5 seconds. Funding stays operator-assisted.

The send panel defaults to two distinct zero-value self-calls in one native batch;
a toggle selects the original single self-call. Review every call and the shared
network fee in Rabby before approval. Verification shows five checks (approval,
node lookup, receipt, block inclusion, call list), a PASS or failure summary with
block, nonce, calls, fee and time from approval, and a session history. The raw
verifier result stays in **Raw RPC evidence**. Existing-hash verification uses the
selected request shape and currently connected account.

The verifier, its 120-second polling and its `#status` / `#result` strings are
unchanged. Rendering is skipped when `document.querySelector` is unavailable, as
in the Node harness. `verificationView` maps a verifier result to the visible
checks and is covered by the tests. The header block height is the only read that
goes directly to the RPC (same-origin `eth_blockNumber`); wallet and verification
reads use Rabby's provider.

See [the wallet contract and validation guide](../../docs/monad-native-batching.md).
