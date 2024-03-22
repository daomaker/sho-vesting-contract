require('dotenv').config();
require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-web3");
require("hardhat-gas-reporter");
require("hardhat-abi-exporter");
require("@nomiclabs/hardhat-etherscan");
require("solidity-coverage");

module.exports = {
    solidity: {
        version: "0.8.4",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200
            }
        }
    },
    networks: {
        kovan: {
            url: `https://kovan.infura.io/v3/${process.env.INFURA_KEY}`,
            accounts: [`0x${process.env.PRIVATE_KEY}`],
        },
        mainnet: {
            url: `https://mainnet.infura.io/v3/${process.env.INFURA_KEY}`,
            accounts: [`0x${process.env.PRIVATE_KEY}`],
        },
        bsc: {
            url: `https://rpc.ankr.com/bsc`,
            accounts: [`0x${process.env.PRIVATE_KEY}`],
        },
        step: {
            url: `https://rpc.step.network`,
            accounts: [`0x${process.env.PRIVATE_KEY}`],
        },
        arb: {
            url: `https://arbitrum-mainnet.infura.io`,
            accounts: [`0x${process.env.PRIVATE_KEY}`],
        },
        polygon: {
            url: `https://rpc.ankr.com/polygon`,
            accounts: [`0x${process.env.PRIVATE_KEY}`]
        },
        kava: {
            url: `https://evm.kava-rpc.com`,
            accounts: [`0x${process.env.PRIVATE_KEY}`]
        },
        linea: {
            url: `https://rpc.linea.build`,
            accounts: [`0x${process.env.PRIVATE_KEY}`]
        },
        ava: {
            url: `https://api.avax.network/ext/bc/C/rpc`,
            accounts: [`0x${process.env.PRIVATE_KEY}`]
        },
        zkSync: {
            url: `https://mainnet.era.zksync.io`,
            accounts: [`0x${process.env.PRIVATE_KEY}`]
        }
    },
    abiExporter: {
        path: './abi',
        clear: true,
        flat: true,
    },
    etherscan: {
        apiKey: process.env.ETHERSCAN_KEY
    }
};
