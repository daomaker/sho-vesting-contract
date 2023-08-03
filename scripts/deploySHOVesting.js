async function main() {
    const shoToken = "";
    const feeCollector = "";
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

    const params = {
        shoToken: shoToken,
        unlockPercentagesDiff: unlockPercentagesDiff,
        unlockPeriodsDiff: unlockPeriodsDiff,
        baseFeePercentage1: baseFeePercentage1,
        feeCollector: feeCollector,
        startTime: startTime,
        refundToken: ethers.constants.AddressZero,
        refundReceiver: ethers.constants.AddressZero,
        refundAfter: 0,
        refundPrice:0
    }

    const SHOVesting = await ethers.getContractFactory("SHOVesting");
    const shoVesting = await SHOVesting.deploy();
    await shoVesting.deployed();
    await shoVesting.init({params});

    console.log("SHOVesting deployed at:", shoVesting.address);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
    console.error(error);
    process.exit(1);
});
