import SimpleKeyring from '@rabby-wallet/eth-simple-keyring';
import HdKeyring from '@rabby-wallet/eth-hd-keyring';
import { privateKeyToAccount } from 'viem-monad/accounts';
import { bytesToHex } from 'viem-monad';
import { Transaction } from 'viem-monad/monad';
import {
  isMonadTransaction,
  prepareMonadFields,
  monadEnvelope,
  MonadSigningResult,
} from '@/utils/monad';

async function signMonad(
  keyring: SimpleKeyring,
  address: string,
  tx: unknown,
  opts: any
): Promise<MonadSigningResult> {
  const approved = prepareMonadFields(tx);
  const account = privateKeyToAccount(
    bytesToHex(keyring.getPrivateKeyFor(address, opts))
  );
  if (
    account.address.toLowerCase() !== approved.from ||
    address.toLowerCase() !== approved.from
  ) {
    throw new Error('Monad sender does not match the selected keyring account');
  }
  return {
    kind: 'monad',
    canonicalSerializedTransaction: await Transaction.sign({
      account,
      transaction: monadEnvelope(approved),
    }),
  };
}

export class PrivateKeyKeyring extends SimpleKeyring {
  signingDiagnosticsProvider = 'private_key';

  constructor(privateKeys?: string[]) {
    super(privateKeys);
  }

  getAccounts(): Promise<string[]> {
    return super.getAccounts();
  }

  signTransaction(address, tx, opts = {}) {
    return isMonadTransaction(tx)
      ? signMonad(this, address, tx, opts)
      : super.signTransaction(address, tx, opts);
  }
}

export class MnemonicKeyring extends HdKeyring {
  signingDiagnosticsProvider = 'mnemonic';

  signTransaction(address, tx, opts = {}) {
    return isMonadTransaction(tx)
      ? signMonad(this, address, tx, opts)
      : SimpleKeyring.prototype.signTransaction.call(this, address, tx, opts);
  }
}
