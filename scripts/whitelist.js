async function main() {
    const SHOaddress = "";

    const userAddresses = [];
    const allocations = [];
    const options = [];

    const SHO = await ethers.getContractFactory("SHO");
    const sho = await SHO.attach(SHOaddress);

    const tx = await sho.whitelistUsers(
        userAddresses,
        allocations.map(notParsed => ethers.utils.parseUnits(notParsed.toString(), 18)),
        options
    );
    await tx.wait();

    console.log("whitelisting successful");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
    console.error(error);
    process.exit(1);
});
