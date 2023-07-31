// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import "@openzeppelin/contracts-upgradeable/proxy/ClonesUpgradeable.sol";

import "./SHOVesting.sol";

/**
 * @notice SHOVesting creates new instances of SHOVesting as minimal proxies.
 */
contract SHOVestingFactory {
    struct Parameters {
        IERC20 shoToken;
        uint32[] unlockPercentagesDiff;
        uint32[] unlockPeriodsDiff;
        uint32 baseFeePercentage1;
        address feeCollector;
        uint64 startTime;
    }

    address public implementation;

    event SHOVestingDeployment(
        address deployer,
        address deployedAt,
        Parameters parameters
    );

    constructor() {
        implementation = address(new SHOVesting());
    }

    function deploy(
        Parameters calldata parameters, 
        bytes calldata data
    ) external returns (SHOVesting shoVesting) {
        shoVesting = SHOVesting(ClonesUpgradeable.clone(implementation));
        shoVesting.init(
            parameters.shoToken,
            parameters.unlockPercentagesDiff,
            parameters.unlockPeriodsDiff,
            parameters.baseFeePercentage1,
            parameters.feeCollector,
            parameters.startTime
        );
        shoVesting.transferOwnership(msg.sender);

        emit SHOVestingDeployment(
            msg.sender,
            address(shoVesting),
            parameters
        );
    }
}