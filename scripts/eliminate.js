require("dotenv").config();
const ethers = require("ethers");
const shoViewAbi = require("../abi/SHOView.json");
const shoVestingAbi = require("../abi/SHO.json");

async function main() {
    const chainId = 42;
    const shoViewAddress = '0xEbac6d3D4527B164BCd3865D215A7c02A9f4c771';
    
    let provider; 
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

    const vestingContractAddresses = [
        "0x4ee492722c42029d076bc7038a03b58687a79f69"
    ];

    for (const shoContractAddress of vestingContractAddresses) {
        const addressesToEliminate = [
            "0x0dee0995229aecf7311bdea6eb501b648ce6527f",
            "0xb4ebd77aa6ca5a58b0e9b766fc334537f5a2c878"
        ];

        const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

        const shoView = new ethers.Contract(shoViewAddress, shoViewAbi, provider);
        const eliminated = await shoView.areEliminated(shoContractAddress, addressesToEliminate);
        const newAddressesToEliminate = addressesToEliminate.filter((obj, i) => eliminated[i] == 0);

        const shoVestingContract = new ethers.Contract(shoContractAddress, shoVestingAbi, signer);

        try {
            const tx = await shoVestingContract.eliminateUsers1(newAddressesToEliminate);
            await tx.wait();
        } catch (e) {
            console.log(e.message);
        }
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
    console.error(error);
    process.exit(1);
});
