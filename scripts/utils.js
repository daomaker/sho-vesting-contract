async function getGasPrice() {
    const multipliers = {
        1: 5,
        42: 1,
        56: 2,
        137: 5,
        42220: 5
    }
    const feeData = await ethers.provider.getFeeData();
    const chainId = (await ethers.provider.getNetwork()).chainId;

    if (feeData.maxPriorityFeePerGas) {
        const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas.mul(multipliers[chainId]);
        const maxFeePerGas = feeData.maxFeePerGas.gt(maxPriorityFeePerGas) ? feeData.maxFeePerGas : maxPriorityFeePerGas;

        return {
            maxFeePerGas,
            maxPriorityFeePerGas
        }
    } else {
        return { gasPrice: feeData.gasPrice.mul(multipliers[chainId]) };
    }
}

module.exports = {
    getGasPrice
}