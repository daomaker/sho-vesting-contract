// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol';

contract ERC20MockBurnable is ERC20Burnable {
    uint8 _decimals = 18;

    constructor(
        string memory name,
        string memory symbol,
        address initialAccount,
        uint256 initialBalance,
        uint8 __decimals
    ) payable ERC20(name, symbol) {
        _mint(initialAccount, initialBalance);
        _decimals = __decimals;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }
}