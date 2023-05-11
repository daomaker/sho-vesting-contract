const { getGasPrice } = require("./utils.js");

const userAddresses = require("./whitelistAddresses.json");
const allocations = require("./whitelistAllocations.json");
if (userAddresses.length != allocations.length) throw new Error("lengths dont match");

const BATCH_SIZE = 1000;

async function main() {
    const SHOaddress = "0x7fdf19AA8e0821f2ef5EaEA44F73c904722cf674";
    const options = new Array(allocations.length).fill(1);


    const SHO = await ethers.getContractFactory("SHO");
    const sho = await SHO.attach(SHOaddress);

    const shoTokenAddress = await sho.shoToken();
    const ERC20 = await ethers.getContractFactory("ERC20Mock");
    const shoToken = await ERC20.attach(shoTokenAddress);
    const decimals = await shoToken.decimals();

    const batches = Math.ceil(userAddresses.length / BATCH_SIZE);
    for (let i = 14; i < batches; i++) {

        const gasData = await sho.provider.getFeeData()
        const txOptions = {
            maxFeePerGas: gasData.maxFeePerGas,
            maxPriorityFeePerGas: gasData.maxPriorityFeePerGas.mul(3).div(2)
        }

        console.log(`whitelisting batch ${i}`);
        const tx = await sho.whitelistUsers(
            userAddresses.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE),
            allocations.map(notParsed => ethers.utils.parseUnits(notParsed.toFixed(decimals), decimals)).slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE),
            options.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE),
            i == batches - 1,
            txOptions
        );
        await tx.wait();
    }

    console.log("whitelisting successful");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
    console.error(error);
    process.exit(1);
});
