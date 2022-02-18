const { getGasPrice } = require("./utils.js");

const userAddresses = require("./whitelistAddresses.json");
const allocations = require("./whitelistAllocations.json");
if (userAddresses.length != allocations.length) throw new Error("lengths dont match");

const BATCH_SIZE = 200;

async function main() {
    const SHOaddress = "0xa16a894B670fFB7054eF7b968F06dA70553fCc1d";
    const options = new Array(allocations.length).fill(1);

    const SHO = await ethers.getContractFactory("SHO");
    const sho = await SHO.attach(SHOaddress);

    const shoTokenAddress = await sho.shoToken();
    const ERC20 = await ethers.getContractFactory("ERC20Mock");
    const shoToken = await ERC20.attach(shoTokenAddress);
    const decimals = await shoToken.decimals();

    const batches = Math.ceil(userAddresses.length / BATCH_SIZE);
    for (let i = 0; i < batches; i++) {
        console.log(`whitelisting batch ${i}`);
        const gasPrice = await getGasPrice();
        const tx = await sho.whitelistUsers(
            userAddresses.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE),
            allocations.map(notParsed => ethers.utils.parseUnits(notParsed.toFixed(decimals), decimals)).slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE),
            options.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE),
            i == batches - 1,
            gasPrice
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
