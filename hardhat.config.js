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
            url: `https://bsc-dataseed.binance.org/`,
            accounts: [`0x${process.env.PRIVATE_KEY}`],
        },
        step: {
            url: `https://rpc.step.network`,
            accounts: [`0x${process.env.PRIVATE_KEY}`],
        },
        arb: {
            url: `https://arbitrum-mainnet.infura.io`,
            accounts: [`0x${process.env.PRIVATE_KEY}`],
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
