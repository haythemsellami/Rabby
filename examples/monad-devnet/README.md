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

The page defaults to two distinct zero-value self-calls in one native batch.
The selector also supports the original single self-call. Review every call and
the shared network fee in Rabby before approval. Existing-transaction verification
uses the selected request shape and currently connected account.

See [the wallet contract and validation guide](../../docs/monad-native-batching.md).
