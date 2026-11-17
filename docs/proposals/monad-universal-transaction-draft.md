Goals:

1. Be able to combine different features of Monad into a Universal Transaction type to avoid combinatorial explosion of transaction type
2. Allow parsing and interpretation of transactions in a forward compatible manner for ease of rollout of various projects: tooling that does not understand a particular feature can still understand the other features in the transaction.

---

`TYPE` = 0x40

## Transaction Format

tx = `TYPE` || rlp ([chain_id, features])

features = [[key, value], [key2, value2], ….]    // keys must be unique and sorted ascending, key is just a single byte.

tx_hash = keccak256(tx)

submitted_tx = `TYPE` || rlp ([chain_id, features, auxiliary_data]) // auxiliary_data (e.g., ciphertext, ZKPs) does not directly feed into tx_hash

auxiliary_data = [[k1, v1], [k2, v2], ….]  // keys must be unique and sorted ascending

`tx` is the object that is stored in the transaction trie and is committed to via the transaction_root in the block header. Some features require certain key-values to be placed beside the transaction in `auxiliary_data` , which by default is empty ( [ ] ) if none of the features require any aux data. 

This MIP will entail maintaining a registry of all the features supported by the universal transaction type over time. The registry is essentially a table that maintains how the value for each feature or key should be interpreted, including the encoding and layout of the value. It also includes maintaining the syntax and semantics of any auxiliary data and receipt data (see below) that is injected by the features, and whether and how a feature can compose with other features in a valid transaction.

The encoding already encodes the length of each (key, value) pair so that downstream parsers can easily skip unrecognized features.

## Receipt Format

receipt    = `TYPE` || rlp([status, cumulative_gas_used, logs_bloom, logs, receipt_extensions])
receipt_extensions = [[key, value], [key2, value2], ...]

The first four fields are present for backward compatibility with existing receipts (e.g., bridge contracts directly reading index 3 for the logs from the receipts). The keys in the receipt_extensions are unique and in ascending order. Note that these keys need not be the same as the transaction’s keys.

Every feature defines its own key-values to be put inside the receipt extensions. Unless explicitly stated, a feature does not contribute any key-value element to the receipt extensions.

### **Signing digests vis-a-vis authentication**

Sender and transaction sponsor need to compute a digest of the ``unsigned'' transaction before adding their signature in order to produce a complete transaction. The corresponding features need to define how this digest must be computed. For example, see below that the ECDSA signature feature defines the digest as similar to the transaction hash, except that the value in signature feature is replaced with 0xc0 (the rlp encoding for empty list).

### **Representing Current fields as features**

A feature, or some values inside a feature, may be encrypted. An encrypted feature or value is absent from the cleartext and is instead supplied (aka injected) by the ciphertext in the encryption feature. Encryptable features and fields are simply marked as encryptable in the registry, shown in the Encryptable column below.

| Feature | Key | Value | Encryptable | Remarks on Semantics |
| --- | --- | --- | --- | --- |
| Account nonce | 0x1 | nonce: `uint64` | No |  |
| Gas Limit | 0x2 | gas_limit: `uint64` | No |  |
| Call | 0x3 | [[DEST, destination: `address`], [VALUE, amount: `uint256`], [DATA, calldata: `bytes`]] | Per field | The value is a key-value map in order to lay out the path for different fields, with keys `DEST = 0x1`, `VALUE = 0x2`, `DATA = 0x3`. An empty destination ([DEST, “”]) denotes contract creation like before. Each of the three key values must be present in the feature’s value in either the sent cleartext or decrypted plaintext. |
| Access List | 0x4 | access_list: `[[address: address, storage_keys: bytes32[]], …]` | Yes | Feature being absent (in both cleartext and decrypted plaintext) means empty access list. |
| Authorization List | 0x5 | [[chain_id: `uint256`, address: `address`, nonce: `uint64`, y_parity: `uint8`, r: `uint256`, s: `uint256`], …] | No | Feature being absent means no delegation changes. |
| Sender ECDSA signature | 0x6 | [y_parity: `uint8`, r: `uint256`, s: `uint256`] | Yes | Digest for signing computed similar to the transaction hash, except that this feature’s value is replaced by 0xc0. 
Encryptable for transactions anonymous (until committed). |
| Inclusion Gas Bid | 0x7 | [max_priority_fee_per_gas: `uint256`, max_fee_per_gas: `uint256` ] | No | EIP-1559 semantics, operating on Gas Limit feature |

<u>**Example for current transactions:**</u>

An account `A`with nonce 7, sending 1 MON to address `B` at 2 gwei priority and 50 gwei max fee, with no calldata. Features are:

```python
Features:
[[0x1, 7]
[0x2, 21000]
[0x3, [[DEST, B], [VALUE, 1000000000000000000], [DATA, ""]]]
[0x6, [y_parity, r, s]]
[0x7, [2000000000, 50000000000]]]
```

The sender first encodes this with `[0x6, 0xc0]` in place of the signature, hashes `TYPE ‖ rlp([143, features])`, signs, and substitutes `[y_parity, r, s]`. The final signed transaction is `TYPE ‖ rlp([143, features])`, and its hash is `keccak256` of these bytes.

## Execution Inputs

The protocol may derive fields or data for a transaction that are not present in the original transaction. For example, for an encrypted transaction, the protocol derives the plaintext values. For an MCP transaction, the protocol derives which proposers included the transaction, or whether a transaction is duplicate of another transaction, etc.

Execution inputs for each transaction are produced by the translation layer, which sits between consensus and execution, and are handed to execution together with the transaction.

`tx_execution_inputs = [[key, value], [key2, value2], …] // keys unique and sorted ascending` 

Furthermore, the protocol may derive block-level data (e.g., block’s decryption key) that is useful for verifying the transactions’ plaintexts.

`execution_inputs = [block_level_input, [execution_input_tx1, execution_input_tx2,...]]` 

Every feature defines which key-values, if any, it contributes to the execution inputs of a transaction. Unless explicitly stated, a feature contributes nothing.

Block header now carries an execution_inputs_root in addition to other existing fields like transactions_root, and receipts_root.

**RPC.** `eth_getTransactionByHash` or potentially a new method returns the transaction as sent by the user (with hash calculated as defined at the top), together with its execution inputs once it has been included. Execution inputs calculated by the consensus+translation layer are verifiable against the transaction contents (e.g., plaintext can be verified against the ciphertext hash using the witness inside execution inputs).

### Consensus Inputs

The proposer uses the auxiliary data to derive ``consensus inputs'' to be placed inside its proposal. For example, ciphertext from auxiliary data forms a consensus input corresponding to the transaction, after the proposer verifies that the hash of the ciphertext matches the value inside the encryption feature. At the proposal-level, consensus input can be computed from auxiliary data of all of the transactions -- for example, proof of validity of PQ signatures that are too long to carry forward in the protocol. In this example, PQ signatures are sent as auxiliary data along with the transactions. 

`tx_consensus_inputs` = [[key, value], [key2, value2], …] // keys unique and sorted ascending

`consensus_inputs` = [block_level_input, [consensus_inputs_tx1, consensus_inputs_tx2, …]]

Features define key-values to be placed inside tx_consensus_inputs (empty array if all features inject nothing into it), and how block level input is calculated.

The consensus proposal header carries a `consensus_inputs_root` committing to the proposal’s consensus inputs. The merged proposal in MCP will have its own consensus_inputs_root in the header to commit to individual proposals’ consensus_inputs_root.

Consensus inputs are not part of `tx_hash` or the transactions trie. An item placed in a transaction’s consensus inputs is bound to the transaction either by a hash in the feature’s value or by a block-level proof that covers it.

Consensus inputs are excluded from execution blocks. A feature that needs an item, or something derived from it, to remain available in the execution block places that in the transaction’s execution inputs (e.g., ciphertext in case the decryption fails and plaintext is not available).

## Exploring compatibility with future features

Some future features are explored below. They are not in their fully final form of course, but the exploration gives an idea of what those features could look like, with care given to the nuances around the transaction lifecycle, interaction with the protocol, and verifiabilty by consumers. 

### <u>Batch Calls</u>

Introduce a new feature for an array of calls. Its value is simply the list of calls as defined above, with the three key-values inside each call: [[[DEST, destination: `address`], [VALUE, amount: `uint256`], [DATA, calldata: `bytes`]], …].

The fields of each call are individually encryptable, and a whole call may be encrypted as well.

The single call feature must be absent when the batch calls feature is present.

### <u>Fee Sponsorship</u>

Introduce a new feature carrying the sponsor’s address and signature. The value is [payer: `address`, y_parity: `uint8`, r: `uint256`, s: `uint256`].

The payer must be different from the sender. 

The digest for sender’s signature has an empty value of 0xc0 for this feature, so that the sender only commits to its transaction getting sponsored, rather than sponsor’s choice of payer address and signature. 

This can be combined with another feature that introduces [valid_after, valid_before] window for validity of the transaction, so that the sponsor knows the sponsorship ends at a particular time. 

### <u>Encrypted Transactions</u>

The feature value is [epoch: `uint64`, ciphertext_hash: `bytes32`]. This feature also injects  a key-value in auxiliary data as well as transaction’s consensus inputs, with the value being the ciphertext (must be the preimage of ciphertext_hash).

Ciphertext is produced under a particular epoch’s encryption key, and decrypts to one entry per feature that is encrypted or has fields that were encrypted. 

decrypted plaintext = `rlp([[feature_key, feature_value], [feature2_key, feature2_value], …])`

A feature that is completely encrypted (i.e., ACCESS_LIST, SENDER_ECDSA_SIGNATURE, ORDERING_BID, FLEX_AUTH, SENDER, APES) must not be present in the transaction cleartext if it is present in the decrypted plaintext.

For features (CALL and CALLS) where some fields may be present in cleartext and other fields encrypted, the registry should specify how decrypted values for such features should be interpreted and injected appropriately. The interpretation for CALL and CALLS feature is given below.

For CALL, the decrypted value is the list of key-values missing from the cleartext call.

For CALLS, the value inside encryption is [ call_fields, new_calls ], where call_fields first supplies the encrypted fields in the transaction’s calls, and new_calls then injects calls at specified indices.

`[call_fields= [[j, [[field, value], …]], …], new_calls= [[i, call], …]]`

applied in that order: `call_fields` first fills in the missing fields of the cleartext calls, with `j` being the call’s index in the cleartext list sent; `new_calls` then inserts whole calls, with `i` denoting the index at which the call is inserted (e.g., if the cleartext calls are [call1, call2] and new_calls is [[ 1, new_call1 ] , [3, new_call2] ], then the complete batch calls list is [ call1, new_call1, call2, new_call2]).

Composition rules that involve injectable features (ordering bid being present whenever MCP is present, CALL and CALLS being mutually exclusive, the sender feature being present whenever flex auth is present, etc.) are checked on the transaction after injection.

For example, here is a transaction for the following scenario where a DEX swap is fee-sponsored:

Account `A` swaps on a DEX whose operator sponsors its users’ fees. The transaction approves the router `R` on token `T` and then calls `R` to swap, sending some MON along with the swap. The sponsor only pays for transactions that interact with `T` and `R`, so the destinations for the calls are sent as plaintext; the amounts and calldata, which reveal the trade, are encrypted.

```python
Features:
[[0x1, 7]
[0x2, 300000]
[0x6, [y_parity, r, s]]
[0x7, [2000000000, 50000000000]]
[CALLS, [ [[DEST, T]],     # approve token T
          [[DEST, R]]      # swap on router R
        ] ]
[SPONSOR, [S, y_parity', r', s']]
[ENCRYPTED_TX, [41, ciphertext_hash]]]

Auxiliary data
[[ CIPHERTEXT_AUX, ciphertext ]] where 
plaintext=rlp([[CALLS, [[[0, [[VALUE, 0], [DATA, approve_calldata]]], # call_fields for cleartext call 0
              [1, [[VALUE, swap_amount], [DATA, swap_calldata]]]],   # call_fields for cleartext call 1
              []]]])                                       # no new_calls
```

The feature contributes one key-value to the execution inputs of the transaction. The value is [decrypted: `bool`, plaintext= [[feature_key, feature_value], …], witness: `bytes`].

Decryption outputs, for each transaction, the plaintext values and the 16-byte seed from which the encryption randomness was derived. From the plaintext and the seed the ciphertext can be re-created and checked against `ciphertext_hash`, so the decryption remains verifiable after the ciphertext has been discarded from the consensus inputs. On failure, `decrypted` is false, `plaintext` is empty, and `witness` carries the ciphertext.

### <u>MCP</u>

Introduce two new features:

The first one is the Ordering bid with value `uint256`. Note that the ordering bid can be encrypted.

The second feature has other inclusion-level values for MCP such as proposer_indices: `bytes` to denote the bitmask for eligible proposers that can include this transaction.

The ordering bid must be present whenever the MCP feature is present.

A transaction appears once per (translated) block even if multiple proposers include it. The feature contributes one key-value to the execution inputs, with value being [inclusions: `uint8[]`, skip_reason: `uint8`]. `inclusions` lists the proposer indices that included the transaction in this block. `skip_reason` , for instance, could carry information such as skipped because its nonce was consumed by another transaction of the same sender. `inclusions` is useful to determine the inclusion fee charged to the user, and the payout to the respective proposers.

### <u>Flexible Authentication</u>

Introduces three new features: 

The first feature is the flexible auth feature that has the value [authenticators= [[id: `uint8`, proof: `bytes`], …], init_config= [genesis_config: `bytes`, pop_entries= [[id: `uint8`, proof: `bytes`], …]]]. The flexible auth feature is mutually exclusive with the sender’s ECDSA signature feature.

The second feature is the sender feature, that basically specifies the sender address, as sender address is decoupled from authentication. It must be present whenever the flexible auth feature is present. If the sender feature and ecdsa signature features are both present, sender must be the `ecrecover` output of the ecdsa signature data. 

Both the flexible auth feature and the sender feature are encryptable.

The third feature is for authorization list that can carry flexible auth data and authority address instead of the fixed ECDSA signatures. This feature is mutually exclusive with the legacy authorization list. 

### <u>Separate Storage Charge (SSC)</u>

Introduces one new feature with value [max_storage_creation: `uint32` , max_net_storage_creation: `uint32`]. 

If the feature is absent, only gas bounds the storage creation. If present, it is an additional constraint on the storage creation.

This feature also additionally adds a receipt extension to denote how much storage was actually created. So far, in the examples explored, this feature is the only one that benefits from a new receipt field.

### <u>Application Preferred Execution Sequencing</u>

Introduces a feature carrying the transaction’s declaration of the applications it may interact with. The value is interaction_list: `[[app: address, methods= [[selector: bytes4, param: uint96], …]], …]`. This feature is encryptable.

If the feature is absent (in both cleartext and decrypted plaintext), the transaction is a ``wildcard transaction'' , i.e., it may interact with any application.

If the feature is present with an empty list, the transaction declares that it touches no opinionated application.

### <u>Scheduled Transactions</u>

Introduce a feature with value [causal_link: `bytes32`, schedule_id: `uint64`], where  `causal_link` is the hash of the transaction that scheduled it and `schedule_id` is the callback handle returned by `schedule()`.

Authentication features like Sender ECDSA signature and flex auth feature must be absent. Additionally, the following features must be absent: nonce, Inclusion gas bid, fee sponsorship, ORDERING_BID, MCP, and both authorization lists. The sender feature must be present and has the value of the ``owner'' address, the account that made the `schedule()` call. The gas limit feature must be present as well.

### <u>Anonymous Transactions</u>

Introduce a new feature that represents anonymous gas token utxo to pay for the transaction fees.

The Sender and signature-related features (ecdsa and flex auth) become optional, and encryptable if these features are present but encrypted in case anonymity is only until decryption.

Nonce feature is absent.

## Summarizing the new features

| Feature | Key | Value | Encryptable |
| --- | --- | --- | --- |
| Batch Calls | `CALLS` | [[[DEST, destination: `address`], [VALUE, amount: `uint256`], [DATA, calldata: `bytes`]], …] | Per call, and per field within a call |
| Fee Sponsorship | `SPONSOR` | [payer: `address`, y_parity: `uint8`, r: `uint256`, s: `uint256`] | No |
| Encrypted Transactions | `ENCRYPTED_TX` | [epoch: `uint64`, ciphertext_hash: `bytes32`] | No |
| Ordering bid | `ORDERING_BID`  | ordering_bid: `uint256` | Yes |
| MCP | `MCP` | proposer_indices: `bytes` | No |
| Flexible Auth | `FLEX_AUTH`  | [authenticators= [[id: `uint8`, proof: `bytes`], …], init_config= [genesis_config: `bytes`, pop_entries= [[id: `uint8`, proof: `bytes`], …]]] | Yes |
| Sender | `SENDER`  | sender: `address` | Yes |
| Authorization List with Flexible Auth | `AUTH_LIST_FLEX` | [[chain_id: `uint256`, address: `address`, nonce: `uint64`, authenticators= [[id: `uint8`, proof: `bytes`], …]], …] | No |
| Separate Storage Charge | `SSC` | [max_storage_creation: `uint32`, max_net_storage_creation: `uint32`] | No |
| APES | `APES` | interaction_list: `[[app: address, methods= [[selector: bytes4, param: uint96], …]], …]` | Yes |
| Scheduled | `SCHEDULED` | [causal_link: `bytes32`, schedule_id: `uint64`] | No |

## Composability Examples

### Sending Encrypted Transaction to Multiple Concurrent Proposers

Account `A` submits a swap through router `R`, hiding the entire call and the ordering bid, and restricts inclusion to proposers 0 and 2.

```python
Features:
[[0x1, 42]
[0x2, 250000]
[0x6, [y_parity, r, s]]
[0x7, [2000000000, 50000000000]]
[ENCRYPTED_TX, [41, ciphertext_hash]]
[MCP, 0b101]]

Auxiliary data:
[[ CIPHERTEXT_AUX, ciphertext ]] where
plaintext=rlp([[0x3, [[DEST, R], [VALUE, 0], [DATA, swap_calldata]]], [ORDERING_BID, ordering_bid]])
```

### Everything-in-one example 1

Passkey account `P`, sponsored by `S`. The swap is injected between two approvals that are present in cleartext; the access list and the ordering bid are hidden.

```python
Features:
[[0x1, 3]
[0x2, 350000]
[0x7, [1000000000, 30000000000]]
[CALLS, [ [[DEST, T], [VALUE, 0], [DATA, approve_calldata]],     # approve token T
          [[DEST, U], [VALUE, 0], [DATA, approve_calldata2]]     # approve token U
        ] ]
[SPONSOR, [S, y_parity', r', s']]
[ENCRYPTED_TX, [41, ciphertext_hash]]
[MCP, 0b1111]
[FLEX_AUTH, [[[1, passkey_proof]], [0x80, []]]]
[SENDER, P]]

Auxiliary data:
[[ CIPHERTEXT_AUX, ciphertext ]] where
plaintext=rlp([[0x4, access_list],
               [CALLS, [[],                                                             # no call_fields
                        [[1, [[DEST, R], [VALUE, swap_amount], [DATA, swap_calldata]]]]]],  # new_calls: swap at index 1
               [ORDERING_BID, ordering_bid]])      
```

After decryption the batch is: approve `T`, swap on `R`, approve `U`.

---

END

---

# Alternative design: Placeholders for encrypted values

Above design injects the encrypted features (both key and value absent from cleartext). Alternate design is to instead have placeholders for encrypted values, as follows:

The motivation for the injection-based design above is that existence of combinations of features and fields, even if encrypted, can leak information that leads to profiling of the activity / fingerprinting of the sender. Hiding even the existence of keys from cleartext entails that an adversary cannot tell an absent feature from an encrypted one (assuming sufficient padding in ciphertext) or the existence of specific calls in the case of batch calls (one of the calls inside the batch call can be encrypted and its existence is not known until decryption).

We define an `Encryptable<T>` template type that features can use to indicate that a certain field could be potentially encrypted. The field is either `[v]` to denote that the value `v` of type `T` is present in plaintext, or it is an empty list (`[]` ) as a placeholder to denote that the value is encrypted and supplied as part of the ciphertext in the encryption feature.

Note that every value of encryptable type has 1 byte of overhead due to this wrapping (irrespective of whether the value is encrypted or plaintext).

The encryptable features and fields are wrapped accordingly. The call becomes [destination: `Encryptable<address>`, amount: `Encryptable<uint256>`, calldata: `Encryptable<bytes>`]; like before, empty destination ([””]) denotes contract creation, and [] denotes encrypted dest. Batch calls is a list of such calls. The values of ACCESS_LIST, SENDER_ECDSA_SIGNATURE, ORDERING_BID, FLEX_AUTH, SENDER and APES are wrapped as `Encryptable<…>` ; e.g., for the access list, [ ] denotes an encrypted access list and [ [ ] ] denotes an empty access list.

Ciphertext must decrypt to the RLP encoding of an array of exactly the plaintext values of the encrypted fields in order. In more words, plaintext = `rlp([v_1, v_2, v_3, ..., v_n])` , where there are exactly `n` encrypted fields appearing in the transaction (`Encryptable<T>` type with value `[])` . The first value corresponds to the first encrypted field in the transaction, with type given by the respective template parameter `T` , the second value corresponds to the second encrypted field and so on…

The encrypted transaction feature’s execution input value becomes [decrypted: `bool`, plaintext_values= [v_1, v_2, …, v_n], witness: `bytes`].

### Examples Revisited

Example1. The sponsored DEX swap. 

```python
Features:
[[0x1, 7]
[0x2, 300000]
[0x6, [y_parity, r, s]]
[0x7, [2000000000, 50000000000]]
[CALLS, [[[T], [0], []],        # approve token T
         [[R], [], []]]]        # swap call on router R
[SPONSOR, [S, y_parity', r', s']]
[ENCRYPTED_TX, [41, ciphertext_hash]]]

Auxiliary data:
[[ CIPHERTEXT_AUX, ciphertext ]]   # encryption of rlp([approve_calldata, swap_amount, swap_calldata])
```

Example2. Sending an encrypted transaction to multiple concurrent proposers with the calldata and the ordering bid hidden.

```python
Features:
[[0x1, 42]
[0x2, 250000]
[0x3, [[R], [0], []]]
[0x6, [y_parity, r, s]]
[0x7, [2000000000, 50000000000]]
[ENCRYPTED_TX, [41, ciphertext_hash]]
[ORDERING_BID, []]
[MCP, 0b101]]

Auxiliary data:
[[ CIPHERTEXT_AUX, ciphertext ]]   # encryption of rlp([swap_calldata, ordering_bid])
```

Example3. Everything-in-one. Passkey account `P`, sponsored by `S`, sends an encrypted batch of calls with a hidden ordering bid, eligible for any proposer.

```python
Features:
[[0x1, 3]
[0x2, 350000]
[0x7, [1000000000, 30000000000]]
[CALLS, [[[T], [0], []],        # approve call, with calldata encrypted
         [[R], [], []]]]        # swap call with amount of MON and calldata encrypted
[SPONSOR, [S, y_parity', r', s']]
[ENCRYPTED_TX, [41, ciphertext_hash]]
[ORDERING_BID, []]              # ordering bid encrypted
[MCP, 0b1111]
[FLEX_AUTH, [[[[1, passkey_proof]], [0x80, []]]]]
[SENDER, [P]]]

Auxiliary data:
[[ CIPHERTEXT_AUX, ciphertext ]]   # encryption of rlp([approve_calldata, swap_amount, swap_calldata, ordering_bid])
```

---

---

Questions? Contact: Kushal