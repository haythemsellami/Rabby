# Monad development SDK

`viem-2.57.18-5ed1f42cf495.tgz` is the built Viem fork at
[`5ed1f42cf49503712145d50d3c39ba7aaa579786`](https://github.com/haythemsellami/viem/commit/5ed1f42cf49503712145d50d3c39ba7aaa579786),
used through the `viem-monad` dependency alias. Existing `viem@2.47.6`
imports and the published SimpleKeyring dependency remain unchanged.

SHA-256:

```text
6a03a07d47225eff5a3081f851c5cb78a6d6002f0f490f9315d21dc51692ca6e
```

The archive contains the source, CommonJS/ESM builds, declarations, and upstream
license from Viem's `src` package. It was produced with `npm pack --ignore-scripts`
in the fork's `src` directory after the CJS, ESM, and declaration builds passed.
To regenerate, check out the exact revision, run `pnpm build`, and run
`npm pack --ignore-scripts --pack-destination /path/to/Rabby/vendor` from `src`.
Verify the archive and regenerate the Yarn lockfile when intentionally updating it.

The exact `ox@0.14.65` dependency has a version-scoped exception to Rabby's
15-day release-age gate in `.yarnrc.yml`. Dependency install scripts remain disabled.
This artifact is for the opt-in development integration; it is not a published
Viem release or evidence of network activation.

This revision adds CALLS `0x08`, atomic batch signing and the RPC execution-view
formatters. The wallet uses `data` in complete signing requests; the SDK formats
node simulation requests with `input`. Transaction queries are execution views,
so they must not be used to reconstruct a request for signing.
