async function main() {
    const SHO = await ethers.getContractFactory("SHOView");
    const sho = await SHO.deploy();
    await sho.deployed();

    console.log("SHOView deployed at:", sho.address);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
    console.error(error);
    process.exit(1);
});
