async function main() {
    const BurnValley = await ethers.getContractFactory("BurnValley");
    const burnValley = await BurnValley.deploy();
    await burnValley.deployed();

    console.log("Burn valley deployed at:", burnValley.address);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
    console.error(error);
    process.exit(1);
});
