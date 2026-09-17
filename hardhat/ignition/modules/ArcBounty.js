import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const USDC = 10n ** 18n;
// Funded from the seed script, not here, so the deploy never fails on a
// thinly-funded deployer wallet.
const VAULT_FUND = process.env.VAULT_FUND ? BigInt(process.env.VAULT_FUND) * USDC : 0n;

export default buildModule("AgentlyModule", (m) => {
  const registry = m.contract("AgentRegistry");
  const board = m.contract("TaskBoard", [registry]);
  // Deployer is both vault owner and agent EOA at first — rotate the agent key
  // to a separate wallet from the UI before going live.
  const vault = m.contract("AgentVault", [m.getAccount(0), "ARC-1"], {
    value: VAULT_FUND,
  });

  m.call(registry, "setAuthority", [board]);

  return { registry, board, vault };
});
