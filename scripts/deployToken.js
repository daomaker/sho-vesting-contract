async function main() {
    const name = "TEST";
    const symbol = "TEST";
    const initialBalance = 100000000;
    const decimals = 18;

    const Token = await ethers.getContractFactory("ERC20MockBurnable");
    const token = await Token.deploy(
        name,
        symbol,
        Token.signer.address,
        ethers.utils.parseUnits(initialBalance.toString(), decimals),
        decimals
    );
    await token.deployed();

    console.log(`${symbol} deployed at:`, token.address);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
    console.error(error);
    process.exit(1);
});
