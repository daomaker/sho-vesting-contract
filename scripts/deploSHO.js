const { getGasPrice } = require("./utils.js");

async function main() {
    const shoToken = "0xc97d6C52F3ADD91Fa1c5287a453d7444aECBca83";//"0x02c3296C6eb50249f290AE596F2bE9454bFfadaB";
    const feeCollector = "0x9Bb4B952D576Dcc7f58797C909b0f4e8c14aE51D";//"0x9Bb4B952D576Dcc7f58797C909b0f4e8c14aE51D"
    /*const unlockPercentagesDiff = new Array(100).fill(10000);
    const unlockPeriodsDiff = [0].concat(new Array(99).fill(3600));
    const startTime = Math.round(Date.now() / 1000) + 100;*/

    const unlockPercentagesDiff = [350000, 928] 
    const unlockPeriodsDiff = [0, 2678400]
    const startTime = 1678961400

    const days = 700
    const dailyPercentage = 928

    let dailySum = 0
    for (let i = 0; i < days; i++) {
        unlockPercentagesDiff.push(dailyPercentage)
        unlockPeriodsDiff.push(86400)
        dailySum += dailyPercentage
    }


    unlockPercentagesDiff[unlockPercentagesDiff.length - 1] = 650000 - dailySum

    const baseFeePercentage1 = 0;
    const baseFeePercentage2 = 0;
    const burnValley = "0x000000000000000000000000000000000000dead";
    const burnPercentage = 0;
    const freeClaimablePercentage = 1000000;

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
        freeClaimablePercentage
    );
    await sho.deployed()

    console.log("SHO deployed at:", sho.address);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
    console.error(error);
    process.exit(1);
});
