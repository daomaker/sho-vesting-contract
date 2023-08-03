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
        SHOVesting.InitParameters calldata parameters, 
        bytes calldata data
    ) external returns (SHOVesting shoVesting) {
        shoVesting = SHOVesting(ClonesUpgradeable.clone(implementation));
        shoVesting.init(
            parameters.shoToken,
            parameters.unlockPercentagesDiff,
            parameters.unlockPeriodsDiff,
            parameters.baseFeePercentage1,
            parameters.feeCollector,
            parameters.startTime,
            parameters.refundToken,
            parameters.refundAfter,
            parameters.refundReceiver,
            parameters.refundPrice
        );
        shoVesting.transferOwnership(msg.sender);

        emit SHOVestingDeployment(
            msg.sender,
            address(shoVesting),
            parameters
        );
    }
}