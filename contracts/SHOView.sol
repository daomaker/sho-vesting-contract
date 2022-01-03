//SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import "./SHO.sol";
import "hardhat/console.sol";

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

    function getUserInfo(
        SHO shoContract, 
        address userAddress
    ) public view returns (
        uint120 totalUnlocked,
        uint120 totalClaimed,
        uint120 upcomingClaimable,
        uint120 vested,
        uint120 minClaimable,
        uint120 maxClaimable
    ) {
        totalUnlocked = getUserTotalUnlocked(shoContract, userAddress);
        totalClaimed = getUserTotalClaimed(shoContract, userAddress);
        upcomingClaimable = getUserUpcomingClaimable(shoContract, userAddress);
        vested = getUserVested(shoContract, userAddress);
        minClaimable = getUserMinClaimable(shoContract, userAddress);
        maxClaimable = getUserMaxClaimable(shoContract, userAddress);
    }

    function getUserTotalUnlocked(SHO shoContract, address userAddress) public view returns (uint120 totalUnlocked) {
        uint8 userOption = getUserOption(shoContract, userAddress);
        require(userOption != 0);

        uint16 passedUnlocksCount = shoContract.getPassedUnlocksCount();
        if (passedUnlocksCount == 0) return 0;
        uint16 currentUnlock = passedUnlocksCount - 1;

        if (userOption == 1) {
            User1 memory user = _loadUser1(shoContract, userAddress);

            if (user.eliminatedAfterUnlock > 0) {
                currentUnlock = user.eliminatedAfterUnlock - 1;
            }

            totalUnlocked = user.allocation * shoContract.unlockPercentages(currentUnlock) / HUNDRED_PERCENT;
            totalUnlocked = _applyBaseFee(shoContract, totalUnlocked);
        } else if (userOption == 2) {
            User2 memory user = _loadUser2(shoContract, userAddress);

            if (user.claimedUnlocksCount == passedUnlocksCount) {
                totalUnlocked = user.totalUnlocked;
            } else {
                _updateUserCurrent(shoContract, user, currentUnlock);
                totalUnlocked = user.totalUnlocked;
            }
        }
    }

    function getUserTotalClaimed(SHO shoContract, address userAddress) public view returns (uint120 totalClaimed) {
        uint8 userOption = getUserOption(shoContract, userAddress);
        require(userOption != 0);

        uint16 passedUnlocksCount = shoContract.getPassedUnlocksCount();
        if (passedUnlocksCount == 0) return 0;

        if (userOption == 1) {
            User1 memory user = _loadUser1(shoContract, userAddress);
            if (user.claimedUnlocksCount > 0) {
                totalClaimed = user.allocation * shoContract.unlockPercentages(user.claimedUnlocksCount - 1) / HUNDRED_PERCENT;
                totalClaimed = _applyBaseFee(shoContract, totalClaimed);
            } else {
                totalClaimed = 0;
            }
        } else if (userOption == 2) {
            User2 memory user = _loadUser2(shoContract, userAddress);
            totalClaimed = user.totalClaimed;
        }
    }

    function getUserUpcomingClaimable(SHO shoContract, address userAddress) public view returns (uint120 upcomingClaimable) {
        uint8 userOption = getUserOption(shoContract, userAddress);
        require(userOption != 0);

        uint16 passedUnlocksCount = shoContract.getPassedUnlocksCount();
        if (passedUnlocksCount == shoContract.getTotalUnlocksCount()) return 0;
        uint16 currentUnlock = passedUnlocksCount - 1;

        if (userOption == 1) {
            User1 memory user = _loadUser1(shoContract, userAddress);
            if (user.eliminatedAfterUnlock > 0) {
                upcomingClaimable = 0;
            } else {
                upcomingClaimable = user.allocation * (shoContract.unlockPercentages(currentUnlock + 1) - shoContract.unlockPercentages(currentUnlock)) / HUNDRED_PERCENT;
                upcomingClaimable = _applyBaseFee(shoContract, upcomingClaimable);
            }
        } else {
            User2 memory user = _loadUser2(shoContract, userAddress);
            if (user.claimedUnlocksCount < passedUnlocksCount) {
                _updateUserCurrent(shoContract, user, currentUnlock);
            }

            uint120 totalUnlockedPrev = user.totalUnlocked;
            _updateUserCurrent(shoContract, user, currentUnlock + 1);
            return user.totalUnlocked - totalUnlockedPrev;
        }
    }

    function getUserVested(SHO shoContract, address userAddress) public view returns (uint120 vested) {
        uint8 userOption = getUserOption(shoContract, userAddress);
        require(userOption != 0);

        uint16 passedUnlocksCount = shoContract.getPassedUnlocksCount();
        if (passedUnlocksCount == shoContract.getTotalUnlocksCount()) return 0;
        uint16 currentUnlock = passedUnlocksCount - 1;
        
        if (userOption == 1) {
            User1 memory user = _loadUser1(shoContract, userAddress);
            if (user.eliminatedAfterUnlock > 0) {
                vested = 0;
            } else {
                vested = user.allocation * (HUNDRED_PERCENT - shoContract.unlockPercentages(currentUnlock)) / HUNDRED_PERCENT;
                vested = _applyBaseFee(shoContract, vested);
            }
        } else if (userOption == 2) {
            User2 memory user = _loadUser2(shoContract, userAddress);
            if (user.claimedUnlocksCount < passedUnlocksCount) {
                _updateUserCurrent(shoContract, user, currentUnlock);
            }
           
            vested = user.allocation * (HUNDRED_PERCENT - shoContract.unlockPercentages(currentUnlock)) / HUNDRED_PERCENT;
            vested = _applyBaseFee(shoContract, vested);
            if (vested >= user.debt) {
                vested -= user.debt;
            } else {
                vested = 0;
            }
        }
    }

    function getUserMinClaimable(SHO shoContract, address userAddress) public view returns (uint120 minClaimable) {
        uint8 userOption = getUserOption(shoContract, userAddress);
        require(userOption != 0);

        uint16 passedUnlocksCount = shoContract.getPassedUnlocksCount();
        if (passedUnlocksCount == 0) return 0;
        uint16 currentUnlock = passedUnlocksCount - 1;

        if (userOption == 1) {
            User1 memory user = _loadUser1(shoContract, userAddress);
            uint32 lastUnlockPercentage = user.claimedUnlocksCount > 0 ? shoContract.unlockPercentages(user.claimedUnlocksCount - 1) : 0;
            currentUnlock = user.eliminatedAfterUnlock > 0 ? user.eliminatedAfterUnlock - 1 : currentUnlock;
            minClaimable = user.allocation * (shoContract.unlockPercentages(currentUnlock) - lastUnlockPercentage) / HUNDRED_PERCENT;
            minClaimable = _applyBaseFee(shoContract, minClaimable);
        } else if (userOption == 2) {
            User2 memory user = _loadUser2(shoContract, userAddress);
            if (user.claimedUnlocksCount == passedUnlocksCount) {
                minClaimable = 0;
            } else {
                minClaimable = _updateUserCurrent(shoContract, user, currentUnlock);
                minClaimable += _getCurrentBaseClaimAmount(shoContract, user, currentUnlock);
            }
        }
    }

    function getUserMaxClaimable(SHO shoContract, address userAddress) public view returns (uint120 maxClaimable) {
        uint8 userOption = getUserOption(shoContract, userAddress);
        require(userOption != 0);

        uint16 passedUnlocksCount = shoContract.getPassedUnlocksCount();
        if (passedUnlocksCount == 0) return 0;
        uint16 currentUnlock = passedUnlocksCount - 1;

        if (userOption == 1) {
            User1 memory user = _loadUser1(shoContract, userAddress);
            uint32 lastUnlockPercentage = user.claimedUnlocksCount > 0 ? shoContract.unlockPercentages(user.claimedUnlocksCount - 1) : 0;
            currentUnlock = user.eliminatedAfterUnlock > 0 ? user.eliminatedAfterUnlock - 1 : currentUnlock;
            maxClaimable = user.allocation * (shoContract.unlockPercentages(currentUnlock) - lastUnlockPercentage) / HUNDRED_PERCENT;
            maxClaimable = _applyBaseFee(shoContract, maxClaimable);
        } else if (userOption == 2) {
            User2 memory user = _loadUser2(shoContract, userAddress);
            if (user.claimedUnlocksCount == passedUnlocksCount) {
                maxClaimable= user.currentUnlocked - user.currentClaimed;
            } else {
                maxClaimable = _updateUserCurrent(shoContract, user, currentUnlock);
                uint120 baseClaimAmount = _getCurrentBaseClaimAmount(shoContract, user, currentUnlock);
                maxClaimable += baseClaimAmount;
                user.currentClaimed += baseClaimAmount;
                maxClaimable += user.currentUnlocked - user.currentClaimed;
            }
        }
    }

    function _updateUserCurrent(SHO shoContract, User2 memory user, uint16 currentUnlock) private view returns (uint120 claimableFromPreviousUnlocks) {
        claimableFromPreviousUnlocks = _getClaimableFromPreviousUnlocks(shoContract, user, currentUnlock);

        uint120 newUnlocked = claimableFromPreviousUnlocks - (user.currentUnlocked - user.currentClaimed);

        uint32 unlockPercentageDiffCurrent = currentUnlock > 0 ?
            shoContract.unlockPercentages(currentUnlock) - shoContract.unlockPercentages(currentUnlock - 1) : shoContract.unlockPercentages(currentUnlock);

        uint120 currentUnlocked = user.allocation * unlockPercentageDiffCurrent / HUNDRED_PERCENT;
        currentUnlocked = _applyBaseFee(shoContract, currentUnlocked);

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
    }

    function _getClaimableFromPreviousUnlocks(SHO shoContract, User2 memory user, uint16 currentUnlock) private view returns (uint120 claimableFromPreviousUnlocks) {
        uint32 lastUnlockPercentage = user.claimedUnlocksCount > 0 ? shoContract.unlockPercentages(user.claimedUnlocksCount - 1) : 0;
        uint32 previousUnlockPercentage = currentUnlock > 0 ? shoContract.unlockPercentages(currentUnlock - 1) : 0;
        uint120 claimableFromMissedUnlocks = user.allocation * (previousUnlockPercentage - lastUnlockPercentage) / HUNDRED_PERCENT;
        claimableFromMissedUnlocks = _applyBaseFee(shoContract, claimableFromMissedUnlocks);
        
        claimableFromPreviousUnlocks = user.currentUnlocked - user.currentClaimed;
        claimableFromPreviousUnlocks += claimableFromMissedUnlocks;
    }

    function _getCurrentBaseClaimAmount(SHO shoContract, User2 memory user, uint16 currentUnlock) private view returns (uint120 baseClaimAmount) {
        if (currentUnlock < shoContract.getTotalUnlocksCount() - 1) {
            baseClaimAmount = user.currentUnlocked * shoContract.freeClaimablePercentage() / HUNDRED_PERCENT;
        } else {
            baseClaimAmount = user.currentUnlocked;
        }
    }

    function _applyBaseFee(SHO shoContract, uint120 value) private view returns (uint120) {
        return value - value * shoContract.baseFeePercentage() / HUNDRED_PERCENT;
    }
}