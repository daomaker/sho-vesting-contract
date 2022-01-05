async function main() {
    const shoToken = "";
    const unlockPercentagesDiff = [];
    const unlockPeriodsDiff = [];
    const baseFeePercentage = 0;
    const feeCollector = "";
    const startTime = Math.round(Date.now() / 1000) + 100;
    const burnValley = "";
    const burnPercentage = 0;
    const freeClaimablePercentage = 0;

    const SHO = await ethers.getContractFactory("SHO");
    const sho = await SHO.deploy(
        shoToken,
        unlockPercentagesDiff,
        unlockPeriodsDiff,
        baseFeePercentage,
        feeCollector,
        startTime,
        burnValley,
        burnPercentage,
        freeClaimablePercentage 
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
