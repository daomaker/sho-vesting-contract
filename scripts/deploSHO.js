const { getGasPrice } = require("./utils.js");

async function main() {
    const shoToken = "0x18Dbf59AA9a879a16B6c87d6549731d9dD032b7F";
    const feeCollector = "0xcF28556EE95Be8c52AD2f3480149128cCA51daC1";
    const unlockPercentagesDiff = new Array(100).fill(10000);
    const unlockPeriodsDiff = [0].concat(new Array(99).fill(1800));
    const startTime = Math.round(Date.now() / 1000) + 100;

    const baseFeePercentage1 = 200000;
    const baseFeePercentage2 = 300000;
    const burnValley = "0xb956f28f02ACE969A3e77667E3F5Ee3089B2B06f";
    const burnPercentage = 0;
    const freeClaimablePercentage = 300000;

    const gasPrice = await getGasPrice();
    const SHO = await ethers.getContractFactory("SHO");
    const sho = await SHO.deploy(
        shoToken,
        unlockPercentagesDiff,
        unlockPeriodsDiff,
        baseFeePercentage1,
        baseFeePercentage2,
        feeCollector,
        startTime,
        burnValley,
        burnPercentage,
        freeClaimablePercentage,
        gasPrice
    );
    await sho.deployed();

    console.log("SHO deployed at:", sho.address);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
    console.error(error);
    process.exit(1);
});
