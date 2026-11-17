# Monad development SDK

`viem-2.57.18.tgz` is the built Viem fork at
[`40e3a58c1c8c9c0326558eee8991992173059ea4`](https://github.com/haythemsellami/viem/commit/40e3a58c1c8c9c0326558eee8991992173059ea4),
used through the `viem-monad` dependency alias. Existing `viem@2.47.6`
imports and the published SimpleKeyring dependency remain unchanged.

SHA-256:

```text
80e63d42b3a25f8f308820a544dbe14d9335e9f965eea8a55a14131ab1442c8c
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
