import { ethers } from "ethers";

const shoViewAbi = require("../abi/SHOView.json");
const shoVestingAbi = require("../abi/SHO.json");
const shoViewAddress = '0xDDA69d4952B7FA11D0e5464318C88De173433d54';

const GAS_PRICE_MULTIPLIER_2 = 3;
const GAS_PRICE_MULTIPLIER_1 = 2;

function getProviderByChainId(chainId: number) {
    let provider: ethers.providers.Provider; 
    switch (Number(chainId)) {
		case 1:
			provider = new ethers.providers.InfuraProvider(Number(chainId), process.env.INFURA_KEY);
			break;
		case 42: // kovan
			provider = new ethers.providers.InfuraProvider(Number(chainId), process.env.INFURA_KEY);
			break;
		case 56: // bsc
			provider = new ethers.providers.JsonRpcProvider('https://bsc-dataseed.binance.org/');
			break;
		case 137: // polygon
			provider = new ethers.providers.JsonRpcProvider('https://rpc-mainnet.maticvigil.com/');
			break;
		default:
			throw new Error('passed chain id not supported');
	}
    return provider;
}

interface VestingContract {
    _id: string,
    vesting_smart_contract_address: string,
    chain_id: string
}

export default class SHOVestingBot {
    async main(): Promise<void> {
        const vestingContracts = await this.getAllVestingAddresses();

        for (const vestingContract of vestingContracts) {
            await this.eliminate(vestingContract);
        }
    }

    async getAllVestingAddresses(): Promise<VestingContract[]> {
        console.log(this.constructor.name, this.getAllVestingAddresses.name, "into:", `getting all vesting addresses`);

        return [
            {
                _id: "",
                vesting_smart_contract_address: "0x45d92fcf54f174406daf9a93faa39fd24a5f8373",
                chain_id: "42"
            }
        ];
    }

    async getAddressesToEliminate(offeringId: string): Promise<string[]> {
        console.log(this.constructor.name, this.getAddressesToEliminate.name, "into:", `getting addresses to eliminate with offeringId ${offeringId}`);
        
        const addressesToEliminate = [
            "0x42f15e6B4BD6f996b13e681d99ccc5b7A902BFdF",
            "0xf8f26151c9f445407eeA10E5DcA1C7e12a6194eE"
        ];
            
        return addressesToEliminate;
    }

    async eliminate(vestingContract: VestingContract): Promise<void> {
        const addressesToEliminate = await this.getAddressesToEliminate(vestingContract._id);
        const provider = getProviderByChainId(Number(vestingContract.chain_id));
        const shoView = new ethers.Contract(shoViewAddress, shoViewAbi, provider);
        const options = await shoView.getUserOptions(vestingContract.vesting_smart_contract_address, addressesToEliminate);
        const eliminated = await shoView.areEliminated(vestingContract.vesting_smart_contract_address, addressesToEliminate);
        const newAddressesToEliminate = addressesToEliminate.filter((obj: string, i: number) => options[i] === 1 && eliminated[i] === 0);

        if (newAddressesToEliminate.length === 0) {
            return;
        }

        const signer = new ethers.Wallet("", provider);
        const shoVestingContract = new ethers.Contract(vestingContract.vesting_smart_contract_address, shoVestingAbi, signer);
        const gasPrice = await this.getGasPrice(provider);

        try {
            console.log(this.constructor.name, this.eliminate.name, "into:", `eliminating ${newAddressesToEliminate.length} / ` +
                `${addressesToEliminate.length} addresses in ${vestingContract.vesting_smart_contract_address}`);
            const tx = await shoVestingContract.eliminateUsers1(newAddressesToEliminate, gasPrice);
            console.log(this.constructor.name, this.eliminate.name, "info:", `tx hash: ${tx.hash}`);
            await tx.wait();
            console.log(this.constructor.name, this.eliminate.name, "info:", `successfully eliminated`);
        } catch (e: any) {
            console.log(this.constructor.name, this.eliminate.name, "error:", e.message);
        }
    }

    async getGasPrice(provider: ethers.providers.Provider): Promise<any> {
        const feeData = await provider.getFeeData();
        if (feeData.maxPriorityFeePerGas && feeData.maxFeePerGas) {
            const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas.mul(GAS_PRICE_MULTIPLIER_2);
            const maxFeePerGas = feeData.maxFeePerGas.gt(maxPriorityFeePerGas) ? feeData.maxFeePerGas : maxPriorityFeePerGas;

            return {
                maxFeePerGas,
                maxPriorityFeePerGas
            }
        } else if (feeData.gasPrice) {
            return {
                gasPrice: feeData.gasPrice.mul(GAS_PRICE_MULTIPLIER_1)
            }
        }
    }
}

const bot = new SHOVestingBot();
bot.main();