// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import "@openzeppelin/contracts-upgradeable/proxy/ClonesUpgradeable.sol";

import "./SHOVesting.sol";

/**
 * @notice SHOVesting creates new instances of SHOVesting as minimal proxies.
 */
contract SHOVestingFactory {
    address public implementation;

    event SHOVestingDeployment(
        address deployer,
        address deployedAt,
        SHOVesting.InitParameters parameters
    );

    constructor() {
        implementation = address(new SHOVesting());
    }

    function deploy(
        SHOVesting.InitParameters calldata params, 
        bytes calldata data
    ) external returns (SHOVesting shoVesting) {
        shoVesting = SHOVesting(ClonesUpgradeable.clone(implementation));
        shoVesting.init(params);
        shoVesting.transferOwnership(msg.sender);

        emit SHOVestingDeployment(
            msg.sender,
            address(shoVesting),
            params
        );
    }
}