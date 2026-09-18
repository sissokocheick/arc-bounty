# Verifying the contracts on explorer.arc.io

The Arc explorer API sits behind Cloudflare, so verification has to be done by
hand in the UI. Each `.flat.sol` file below is a flattened, self-contained copy
of one contract — paste it into the verifier as a single Solidity file.

## Settings (identical for all three)

| Field | Value |
|---|---|
| Compiler | `0.8.20` |
| Optimization | enabled |
| Optimization runs | `200` |
| **EVM version** | **shanghai** |

These match `hardhat.config.js`. If they differ even slightly the bytecode will
not match and verification will fail.

## Constructor arguments

**AgentVault** `0xEeBD144eeCc4bfa9085bb68F24aF7472DDEA3dDD`
```
0xB0bDA6D2Bb9bBe247de0d600D6bEfcA80De58104
ARC-1
```

**TaskBoard** `0xD956a7B9a5B1a4Dca32eE338b5CA24e186b34dB0`
```
0xcF5d6EEDD31bF38F4A7C0601B71bBbB1F7CCa447
```

**AgentRegistry** `0xcF5d6EEDD31bF38F4A7C0601B71bBbB1F7CCa447`
```
(none — the constructor takes no arguments)
```

The agent EOA was rotated off the deployer after deployment with `setAgent`, so
the constructor argument of AgentVault is the deployer address, not the current
agent (`0x77D98D3DBb4f1E41725C55ab7848d5C7C34Afa4a`).


## On "partial match"

Verifying a flattened file reports *partial match*. This is expected and not a
problem. solc appends a CBOR metadata hash at the end of the bytecode, computed
over the layout of the source files. The contracts were deployed from several
files and are verified as one flattened file, so those hashes cannot be equal;
every byte of executable bytecode matches. Anyone who needs a byte-exact match
can rebuild locally from this repo and compare against `eth_getCode`.

If the explorer instead rejects outright, the cause is one of: the dotenv banner
on line 1 of a flattened file (regenerate with `sed '/^◇/d'`), or the EVM version
being anything other than shanghai.
