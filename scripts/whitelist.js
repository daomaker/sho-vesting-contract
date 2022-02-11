async function main() {
    const SHOaddress = "0xD6a7D1751080CCe5e5c6A9D43be85fD4494c5D4E";

    const userAddresses = [
        "0x8097A41aE28a1aE6e333A8dEfC9d59E35a5f8945", 
        "0xcF28556EE95Be8c52AD2f3480149128cCA51daC1", 
        "0x4B70495947bF0205aAf88BD7f6CdF3244E4Cb204", 
        "0x7441a118396e62407246320C071c6F8A03b17A39", 
        "0x8C6A5CB55ae6EADBa4d66A60cF89C30cB8a870f1"
    ];
    const allocations = [10000, 10000, 10000, 10000, 10000];
    const options = [1, 1, 1, 1, 1];

    const SHO = await ethers.getContractFactory("SHO");
    const sho = await SHO.attach(SHOaddress);

    const tx = await sho.whitelistUsers(
        userAddresses,
        allocations.map(notParsed => ethers.utils.parseUnits(notParsed.toString(), 18)),
        options,
        false
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
