//SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import "./SHOVesting.sol";

contract SHOView {
    uint32 constant HUNDRED_PERCENT = 1e6;

    function _loadUser1(SHOVesting shoContract, address userAddress) private view returns (SHOVesting.User memory user) {
        (
            uint16 claimedUnlocksCount,
            uint16 eliminatedAfterUnlock,
            uint120 allocation,
            bool refunded
        ) = shoContract.users1(userAddress);

        user.claimedUnlocksCount = claimedUnlocksCount;
        user.eliminatedAfterUnlock = eliminatedAfterUnlock;
        user.allocation = allocation;
        user.refunded = refunded;
    }

    function getUserOption(SHOVesting shoContract, address userAddress) public view returns (uint8 userOption) {
        if (_loadUser1(shoContract, userAddress).allocation > 0) {
            userOption = 1;
        }
    }

    function getUserOptions(SHOVesting shoContract, address[] calldata userAddresses) public view returns (uint8[] memory userOptions) {
        userOptions = new uint8[](userAddresses.length);
        for (uint256 i = 0; i < userAddresses.length; i++) {
            userOptions[i] = getUserOption(shoContract, userAddresses[i]);
        }
    }

    function areEliminated(SHOVesting shoContract, address[] calldata userAddresses) public view returns (uint16[] memory eliminated) {
        eliminated = new uint16[](userAddresses.length);
        for (uint256 i = 0; i < userAddresses.length; i++) {
            (, uint16 eliminatedAfterUnlock,,) = shoContract.users1(userAddresses[i]);
            eliminated[i] = eliminatedAfterUnlock;
        }
    }
    
    function areRefunded(SHOVesting shoContract, address[] calldata userAddresses) public view returns (bool[] memory refunded) {
        refunded = new bool[](userAddresses.length);
        for (uint256 i = 0; i < userAddresses.length; i++) {
            (,,, bool _refunded) = shoContract.users1(userAddresses[i]);
            refunded[i] = _refunded;
        }
    }

    function getPassedUnlocksCount(SHOVesting shoContract) public view returns (uint16 passedUnlocksCount) {
        if (shoContract.startTime() <= block.timestamp) {
            passedUnlocksCount = shoContract.getPassedUnlocksCount();
        }
    }

    function getUserInfo(
        SHOVesting shoContract, 
        address userAddress
    ) public view returns (
        uint120 totalUnlocked,
        uint120 totalClaimed,
        uint120 upcomingClaimable,
        uint120 vested,
        uint120 minClaimable,
        uint120 maxClaimable,
        uint64 nextUnlockTimestamp
    ) {
        totalUnlocked = getUserTotalUnlocked(shoContract, userAddress);
        totalClaimed = getUserTotalClaimed(shoContract, userAddress);
        upcomingClaimable = getUserUpcomingClaimable(shoContract, userAddress);
        vested = getUserVested(shoContract, userAddress);
        minClaimable = getUserMinClaimable(shoContract, userAddress);
        maxClaimable = getUserMaxClaimable(shoContract, userAddress);

        uint16 passedUnlocksCount = getPassedUnlocksCount(shoContract);
        if (passedUnlocksCount < shoContract.getTotalUnlocksCount()) {
            nextUnlockTimestamp = shoContract.startTime() + shoContract.unlockPeriods(passedUnlocksCount);
        }
    }

    function getUserTotalUnlocked(SHOVesting shoContract, address userAddress) public view returns (uint120 totalUnlocked) {
        uint8 userOption = getUserOption(shoContract, userAddress);
        require(userOption != 0);

        uint16 passedUnlocksCount = getPassedUnlocksCount(shoContract);
        if (passedUnlocksCount == 0) return 0;
        uint16 currentUnlock = passedUnlocksCount - 1;

        SHOVesting.User memory user = _loadUser1(shoContract, userAddress);

        if (user.eliminatedAfterUnlock > 0) {
            currentUnlock = user.eliminatedAfterUnlock - 1;
        }

        totalUnlocked = _applyPercentage(user.allocation, shoContract.unlockPercentages(currentUnlock));
        totalUnlocked = _applyBaseFee(shoContract, totalUnlocked);
    }

    function getUserTotalClaimed(SHOVesting shoContract, address userAddress) public view returns (uint120 totalClaimed) {
        uint8 userOption = getUserOption(shoContract, userAddress);
        require(userOption != 0);

        uint16 passedUnlocksCount = getPassedUnlocksCount(shoContract);
        if (passedUnlocksCount == 0) return 0;

        SHOVesting.User memory user = _loadUser1(shoContract, userAddress);
        if (user.claimedUnlocksCount > 0) {
            totalClaimed = _applyPercentage(user.allocation, shoContract.unlockPercentages(user.claimedUnlocksCount - 1));
            totalClaimed = _applyBaseFee(shoContract, totalClaimed);
        } else {
            totalClaimed = 0;
        }
    }

    function getUserUpcomingClaimable(SHOVesting shoContract, address userAddress) public view returns (uint120 upcomingClaimable) {
        uint8 userOption = getUserOption(shoContract, userAddress);
        require(userOption != 0);

        uint16 passedUnlocksCount = getPassedUnlocksCount(shoContract);
        if (passedUnlocksCount == shoContract.getTotalUnlocksCount()) return 0;
        uint32 currentUnlockPercentage = passedUnlocksCount > 0 ? shoContract.unlockPercentages(passedUnlocksCount - 1) : 0;

        SHOVesting.User memory user = _loadUser1(shoContract, userAddress);
        if (user.eliminatedAfterUnlock > 0) {
            upcomingClaimable = 0;
        } else {
            upcomingClaimable = _applyPercentage(user.allocation, shoContract.unlockPercentages(passedUnlocksCount) - currentUnlockPercentage);
            upcomingClaimable = _applyBaseFee(shoContract, upcomingClaimable);
        }
    }

    function getUserVested(SHOVesting shoContract, address userAddress) public view returns (uint120 vested) {
        uint8 userOption = getUserOption(shoContract, userAddress);
        require(userOption != 0);

        uint16 passedUnlocksCount = getPassedUnlocksCount(shoContract);
        if (passedUnlocksCount == shoContract.getTotalUnlocksCount()) return 0;
        uint32 currentUnlockPercentage = passedUnlocksCount > 0 ? shoContract.unlockPercentages(passedUnlocksCount - 1) : 0;
        
        SHOVesting.User memory user = _loadUser1(shoContract, userAddress);
        if (user.eliminatedAfterUnlock > 0) {
            vested = 0;
        } else {
            vested = _applyPercentage(user.allocation, HUNDRED_PERCENT - currentUnlockPercentage);
            vested = _applyBaseFee(shoContract, vested);
        }
    }

    function getUserMinClaimable(SHOVesting shoContract, address userAddress) public view returns (uint120 minClaimable) {
        uint8 userOption = getUserOption(shoContract, userAddress);
        require(userOption != 0);

        uint16 passedUnlocksCount = getPassedUnlocksCount(shoContract);
        if (passedUnlocksCount == 0) return 0;
        uint16 currentUnlock = passedUnlocksCount - 1;

        SHOVesting.User memory user = _loadUser1(shoContract, userAddress);
        uint32 lastUnlockPercentage = user.claimedUnlocksCount > 0 ? shoContract.unlockPercentages(user.claimedUnlocksCount - 1) : 0;
        currentUnlock = user.eliminatedAfterUnlock > 0 ? user.eliminatedAfterUnlock - 1 : currentUnlock;
        minClaimable = _applyPercentage(user.allocation, shoContract.unlockPercentages(currentUnlock) - lastUnlockPercentage);
        minClaimable = _applyBaseFee(shoContract, minClaimable);
    }

    function getUserMaxClaimable(SHOVesting shoContract, address userAddress) public view returns (uint120 maxClaimable) {
        uint8 userOption = getUserOption(shoContract, userAddress);
        require(userOption != 0);

        uint16 passedUnlocksCount = getPassedUnlocksCount(shoContract);
        if (passedUnlocksCount == 0) return 0;
        uint16 currentUnlock = passedUnlocksCount - 1;

        SHOVesting.User memory user = _loadUser1(shoContract, userAddress);
        uint32 lastUnlockPercentage = user.claimedUnlocksCount > 0 ? shoContract.unlockPercentages(user.claimedUnlocksCount - 1) : 0;
        currentUnlock = user.eliminatedAfterUnlock > 0 ? user.eliminatedAfterUnlock - 1 : currentUnlock;
        maxClaimable = _applyPercentage(user.allocation, shoContract.unlockPercentages(currentUnlock) - lastUnlockPercentage);
        maxClaimable = _applyBaseFee(shoContract, maxClaimable);
    }

    function _applyBaseFee(SHOVesting shoContract, uint120 value) private view returns (uint120) {
        return value - _applyPercentage(value, shoContract.baseFeePercentage1());
    }

    function _applyPercentage(uint120 value, uint32 percentage) private pure returns (uint120) {
        return uint120(uint256(value) * percentage / HUNDRED_PERCENT);
    }
}