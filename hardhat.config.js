require('dotenv').config();
require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-web3");
require("hardhat-gas-reporter");
require("hardhat-abi-exporter");
require("@nomiclabs/hardhat-etherscan");

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
        celo: {
            url: `https://forno.celo.org/`,
            accounts: [`0x${process.env.PRIVATE_KEY}`],
        },
        polygon: {
            url: `https://polygon-rpc.com/`,
            accounts: [`0x${process.env.PRIVATE_KEY}`],
        },
        avatest: {
            url: `https://api.avax-test.network/ext/bc/C/rpc`,
            accounts: [`0x${process.env.PRIVATE_KEY}`],
        },
        ava: {
            url: `https://api.avax.network/ext/bc/C/rpc`,
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
