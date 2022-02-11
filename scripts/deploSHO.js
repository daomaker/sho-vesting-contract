async function main() {
    const shoToken = "0x18Dbf59AA9a879a16B6c87d6549731d9dD032b7F";
    const unlockPercentagesDiff = [500000, 200000, 100000, 100000, 100000];//new Array(200).fill(5000);
    const unlockPeriodsDiff = [1800, 1800, 1800, 1800, 1800];//[0].concat(new Array(199).fill(1800));
    const baseFeePercentage1 = 200000;
    const baseFeePercentage2 = 300000;
    const feeCollector = "0xcF28556EE95Be8c52AD2f3480149128cCA51daC1";
    const startTime = Math.round(Date.now() / 1000) + 100;
    const burnValley = "0xE23075E033549c930D0B603f7EcF38744aeEDB83";
    const burnPercentage = 500000;
    const freeClaimablePercentage = 300000;

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
    await sho.deployed();

    console.log("SHO deployed at:", sho.address);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
    console.error(error);
    process.exit(1);
});
