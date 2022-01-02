//SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import "./SHO.sol";

contract SHOView {
    uint32 constant HUNDRED_PERCENT = 1e6;

    struct User1 {
        uint16 claimedUnlocksCount;
        uint16 eliminatedAfterUnlock;
        uint120 allocation;
    }

    struct User2 {
        uint120 allocation;
        uint120 debt;

        uint16 claimedUnlocksCount;
        uint120 currentUnlocked;
        uint120 currentClaimed;

        uint120 totalUnlocked;
        uint120 totalClaimed;
    }

    function _loadUser1(SHO shoContract, address userAddress) private view returns (User1 memory user) {
        (
            uint16 claimedUnlocksCount,
            uint16 eliminatedAfterUnlock,
            uint120 allocation
        ) = shoContract.users1(userAddress);

        user.claimedUnlocksCount = claimedUnlocksCount;
        user.eliminatedAfterUnlock = eliminatedAfterUnlock;
        user.allocation = allocation;
    }

    function _loadUser2(SHO shoContract, address userAddress) private view returns (User2 memory user) {
        (
            uint120 allocation,
            uint120 debt,
            uint16 claimedUnlocksCount,
            uint120 currentUnlocked,
            uint120 currentClaimed,
            uint120 totalUnlocked,
            uint120 totalClaimed
        ) = shoContract.users2(userAddress);

        user.allocation = allocation;
        user.debt = debt;
        user.claimedUnlocksCount = claimedUnlocksCount;
        user.currentUnlocked = currentUnlocked;
        user.currentClaimed = currentClaimed;
        user.totalUnlocked = totalUnlocked;
        user.totalClaimed = totalClaimed;
    }

    function getUserOption(SHO shoContract, address userAddress) public view returns (uint8 userOption) {
        if (_loadUser1(shoContract, userAddress).allocation > 0) {
            userOption = 1;
        } else {
            if (_loadUser2(shoContract, userAddress).allocation > 0) {
                userOption = 2;
            }
        }
    }

    function getUserTotalUnlocked(SHO shoContract, address userAddress) public view returns (uint120 totalUnlocked) {
        uint8 userOption = getUserOption(shoContract, userAddress);
        require(userOption != 0);

        if (userOption == 1) {
            totalUnlocked = _getUser1TotalUnlocked(shoContract, userAddress);
        } else if (userOption == 2) {
            totalUnlocked = _getUser2TotalUnlocked(shoContract, userAddress);
        }

    }

    function _getUser1TotalUnlocked(SHO shoContract, address userAddress) private view returns (uint120 totalUnlocked) {
    }

    function _getUser2TotalUnlocked(SHO shoContract, address userAddress) private view returns (uint120 totalUnlocked) {
        uint16 passedUnlocksCount = shoContract.getPassedUnlocksCount();
        if (passedUnlocksCount == 0) return 0;

        User2 memory user = _loadUser2(shoContract, userAddress);
        
        if (user.claimedUnlocksCount == passedUnlocksCount) {
            totalUnlocked = user.totalUnlocked;
        } else {

        }
    }

    /*function _updateUserCurrent(User2 memory user, uint16 currentUnlock) private view returns (uint120 claimableFromPreviousUnlocks) {
        claimableFromPreviousUnlocks = _getClaimableFromPreviousUnlocks(user, currentUnlock);

        uint120 newUnlocked = claimableFromPreviousUnlocks - (user.currentUnlocked - user.currentClaimed);

        uint32 unlockPercentageDiffCurrent = currentUnlock > 0 ?
            unlockPercentages[currentUnlock] - unlockPercentages[currentUnlock - 1] : unlockPercentages[currentUnlock];

        uint120 currentUnlocked = user.allocation * unlockPercentageDiffCurrent / HUNDRED_PERCENT;
        currentUnlocked = _applyBaseFee(currentUnlocked);

        newUnlocked += currentUnlocked;
        if (newUnlocked >= user.debt) {
            newUnlocked -= user.debt;
        } else {
            newUnlocked = 0;
        }

        if (claimableFromPreviousUnlocks >= user.debt) {
            claimableFromPreviousUnlocks -= user.debt;
            user.debt = 0;
        } else {
            user.debt -= claimableFromPreviousUnlocks;
            claimableFromPreviousUnlocks = 0;
        }

        if (currentUnlocked >= user.debt) {
            currentUnlocked -= user.debt;
            user.debt = 0;
        } else {
            user.debt -= currentUnlocked;
            currentUnlocked = 0;
        }
        
        user.totalUnlocked += newUnlocked;
        user.currentUnlocked = currentUnlocked;
        user.currentClaimed = 0;
        user.claimedUnlocksCount = currentUnlock + 1;
    }*/

    function _getClaimableFromPreviousUnlocks(User2 memory user, uint16 currentUnlock) private view returns (uint120 claimableFromPreviousUnlocks) {
        uint32 lastUnlockPercentage = user.claimedUnlocksCount > 0 ? unlockPercentages[user.claimedUnlocksCount - 1] : 0;
        uint32 previousUnlockPercentage = currentUnlock > 0 ? unlockPercentages[currentUnlock - 1] : 0;
        uint120 claimableFromMissedUnlocks = user.allocation * (previousUnlockPercentage - lastUnlockPercentage) / HUNDRED_PERCENT;
        claimableFromMissedUnlocks = _applyBaseFee(claimableFromMissedUnlocks);
        
        claimableFromPreviousUnlocks = user.currentUnlocked - user.currentClaimed;
        claimableFromPreviousUnlocks += claimableFromMissedUnlocks;
    }

    function _getCurrentBaseClaimAmount(SHO shoContract, User2 memory user, uint16 currentUnlock) private view returns (uint120 baseClaimAmount) {
        if (currentUnlock < unlockPeriods.length - 1) {
            baseClaimAmount = user.currentUnlocked * freeClaimablePercentage / HUNDRED_PERCENT;
        } else {
            baseClaimAmount = user.currentUnlocked;
        }
    }

    function _applyBaseFee(SHO shoContract, uint120 value) private view returns (uint120) {
        return value - value * shoContract.baseFeePercentage() / HUNDRED_PERCENT;
    }
}