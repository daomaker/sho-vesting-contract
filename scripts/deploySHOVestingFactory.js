async function main() {
    const SHOVestingFactory = await ethers.getContractFactory("SHOVestingFactory");
    const shoVestingFactory = await SHOVestingFactory.deploy();
    await shoVestingFactory.deployed();

    console.log("SHOVestingFactory deployed at:", shoVestingFactory.address);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
    console.error(error);
    process.exit(1);
});
