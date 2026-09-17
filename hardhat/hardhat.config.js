import hardhatToolbox from '@nomicfoundation/hardhat-toolbox-mocha-ethers';
import dotenv from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

dotenv.config();

const dot = (k, f) => {
  const p = join(process.cwd(), f);
  if (!existsSync(p)) return undefined;
  const val = readFileSync(p, 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${k}=`));
  return val ? val.slice(k.length + 1).trim() : undefined;
};

// Read from the frontend's env too, so the contract address is configured once.
const frontendEnv = join(process.cwd(), '..', '.env.local');
const rawKey = process.env.PRIVATE_KEY || dot('PRIVATE_KEY', '.env');
// Ignore placeholder values like "your_private_key_here" so config stays valid
// before the operator fills in a real key.
const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/.test(rawKey || '') ? rawKey : undefined;
const ARC_RPC_URL = process.env.ARC_RPC_URL || dot('NEXT_PUBLIC_ARC_RPC_URL', '../.env.local');

/** @type import('hardhat/config').HardhatUserConfig */
export default {
  plugins: [hardhatToolbox],
  solidity: {
    version: '0.8.20',
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    hardhat: { type: 'edr-simulated', chainId: 1337 },
    // A persistent `npx hardhat node` for the local demo: the seed script and
    // the autonomous worker both talk to this one instance, so state survives.
    localhost: {
      type: 'http',
      chainId: 31337,
      url: 'http://127.0.0.1:18545',
    },
    // Arc mainnet — native gas asset is USDC (18 decimals).
    arc: {
      type: 'http',
      chainId: 5042,
      url: ARC_RPC_URL || 'https://rpc.mainnet.arc.io',
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
    // Arc testnet — free USDC from https://faucet.circle.com
    arcTestnet: {
      type: 'http',
      chainId: 5042002,
      url: process.env.ARC_TESTNET_RPC_URL || 'https://rpc.testnet.arc.io',
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
};
