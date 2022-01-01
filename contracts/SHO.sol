//SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract SHO is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

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

    mapping(address => User1) public users1;
    mapping(address => User2) public users2;

    IERC20 public immutable shoToken;
    uint64 public immutable startTime;
    address public immutable feeCollector;
    uint32 public immutable baseFeePercentage;
    uint32 public immutable freeClaimablePercentage;
    address public immutable burnValley;
    uint32 public immutable burnPercentage;

    uint32[] public unlockPercentages;
    uint32[] public unlockPeriods;
    uint120[] public extraFees2;

    uint120 public globalTotalAllocation;
    uint16 passedUnlocksCount;

    uint16 public collectedFeesUnlocksCount;
    uint120 public extraFees1Allocation;
    uint120 public extraFees1AllocationUncollectable;

    event Whitelist (
        address user,
        uint120 allocation,
        uint8 option
    );

    event Claim1 (
        address indexed user,
        uint16 currentUnlock,
        uint120 claimedTokens
    );

    event Claim2 (
        address indexed user,
        uint16 currentUnlock,
        uint120 claimedTokens,
        uint120 baseClaimed,
        uint120 chargedfee
    );

    event FeeCollection (
        uint16 currentUnlock,
        uint120 totalFee,
        uint120 extraFee,
        uint120 burned
    );

    event UserElimination (
        address user,
        uint16 currentUnlock
    );

    event Update (
        uint16 passedUnlocksCount
    );

    modifier onlyFeeCollector() {
        require(feeCollector == msg.sender, "SHO: caller is not the fee collector");
        _;
    }

    modifier onlyWhitelistedUser1() {
        require(users1[msg.sender].allocation > 0, "SHO: caller is not whitelisted or does not have the correct option");
        _;
    }

    modifier onlyWhitelistedUser2() {
        require(users2[msg.sender].allocation > 0, "SHO: caller is not whitelisted or does not have the correct option");
        _;
    }

    /**
        @param _shoToken token that whitelisted users claim
        @param _unlockPercentagesDiff array of unlock percentages as differentials
            (how much of total user's whitelisted allocation can a user claim per unlock) 
        @param _unlockPeriodsDiff array of unlock periods as differentials
            (when unlocks happen from startTime)
        @param _baseFeePercentage base fee in percentage 
        @param _feeCollector EOA that can collect fees
        @param _startTime when users can start claiming
        @param _burnValley burned tokens are sent to this address if the SHO token is not burnable
        @param _burnPercentage burn percentage of extra fees
        @param _freeClaimablePercentage how much can users of type 2 claim in the current unlock without a fee
     */
    constructor(
        IERC20 _shoToken,
        uint32[] memory _unlockPercentagesDiff,
        uint32[] memory _unlockPeriodsDiff,
        uint32 _baseFeePercentage,
        address _feeCollector,
        uint64 _startTime,
        address _burnValley,
        uint32 _burnPercentage,
        uint32 _freeClaimablePercentage
    ) {
        require(address(_shoToken) != address(0), "SHO: sho token zero address");
        require(_unlockPercentagesDiff.length > 0, "SHO: 0 unlock percentages");
        require(_unlockPercentagesDiff.length <= 200, "SHO: too many unlock percentages");
        require(_unlockPeriodsDiff.length == _unlockPercentagesDiff.length, "SHO: different array lengths");
        require(_baseFeePercentage <= HUNDRED_PERCENT, "SHO: initial fee percentage higher than 100%");
        require(_feeCollector != address(0), "SHO: fee collector zero address");
        require(_startTime > block.timestamp, "SHO: start time must be in future");
        require(_burnValley != address(0), "SHO: burn valley zero address");
        require(_burnPercentage <= HUNDRED_PERCENT, "SHO: burn percentage higher than 100%");
        require(_freeClaimablePercentage <= HUNDRED_PERCENT, "SHO: free claimable percentage higher than 100%");

        // build arrays of sums for easier calculations
        uint32[] memory _unlockPercentages = _buildArraySum(_unlockPercentagesDiff);
        uint32[] memory _unlockPeriods = _buildArraySum(_unlockPeriodsDiff);
        require(_unlockPercentages[_unlockPercentages.length - 1] == HUNDRED_PERCENT, "SHO: invalid unlock percentages");

        shoToken = _shoToken;
        unlockPercentages = _unlockPercentages;
        unlockPeriods = _unlockPeriods;
        baseFeePercentage = _baseFeePercentage;
        feeCollector = _feeCollector;
        startTime = _startTime;
        burnValley = _burnValley;
        burnPercentage = _burnPercentage;
        freeClaimablePercentage = _freeClaimablePercentage;
        extraFees2 = new uint120[](_unlockPercentagesDiff.length);
    }

    /** 
        Whitelisting shall be allowed only until the SHO token is received for security reasons.
        @param userAddresses addresses to whitelist
        @param allocations users total allocation
        @param options user types
    */
    function whitelistUsers(
        address[] calldata userAddresses,
        uint120[] calldata allocations,
        uint8[] calldata options
    ) external onlyOwner {
        require(shoToken.balanceOf(address(this)) == 0, "SHO: whitelisting too late");
        require(userAddresses.length != 0, "SHO: zero length array");
        require(userAddresses.length == allocations.length, "SHO: different array lengths");
        require(userAddresses.length == options.length, "SHO: different array lengths");

        uint120 _globalTotalAllocation;
        for (uint256 i = 0; i < userAddresses.length; i++) {
            address userAddress = userAddresses[i];
            require(options[i] == 1 || options[i] == 2, "SHO: invalid user option");
            require(users1[userAddress].allocation == 0, "SHO: some users are already whitelisted");
            require(users2[userAddress].allocation == 0, "SHO: some users are already whitelisted");

            if (options[i] == 1) {
                users1[userAddress].allocation = allocations[i];
            } else if (options[i] == 2) {
                users2[userAddress].allocation = allocations[i];
            }
            _globalTotalAllocation += allocations[i];

            emit Whitelist(
                userAddresses[i],
                allocations[i],
                options[i]
            );
        }
            
        globalTotalAllocation = _globalTotalAllocation;
    }

    /**
        Users type 1 claims all the available amount without increasing the fee.
        (there's still the baseFee deducted from their allocation).
    */
    function claimUser1() onlyWhitelistedUser1 external nonReentrant returns (uint120 amountToClaim) {
        update();
        User1 memory user = users1[msg.sender];
        require(passedUnlocksCount > 0, "SHO: no unlocks passed");
        require(user.claimedUnlocksCount < passedUnlocksCount, "SHO: nothing to claim");

        uint16 currentUnlock = passedUnlocksCount - 1;
        if (user.eliminatedAfterUnlock > 0) {
            require(user.claimedUnlocksCount < user.eliminatedAfterUnlock, "SHO: nothing to claim");
            currentUnlock = user.eliminatedAfterUnlock - 1;
        }

        uint32 lastUnlockPercentage = user.claimedUnlocksCount > 0 ? unlockPercentages[user.claimedUnlocksCount - 1] : 0;
        amountToClaim = user.allocation * (unlockPercentages[currentUnlock] - lastUnlockPercentage) / HUNDRED_PERCENT;
        amountToClaim = _applyBaseFee(amountToClaim);

        user.claimedUnlocksCount = currentUnlock + 1;
        users1[msg.sender] = user;
        shoToken.safeTransfer(msg.sender, amountToClaim);
        emit Claim1(
            msg.sender, 
            currentUnlock,
            amountToClaim
        );
    }

    /**
        Removes all the future allocation of passed user type 1 addresses.
        They can still claim the unlock they were eliminated in.
        @param userAddresses whitelisted user addresses to eliminate
     */
    function eliminateUsers1(address[] calldata userAddresses) external onlyOwner {
        update();
        require(passedUnlocksCount > 0, "SHO: no unlocks passed");
        uint16 currentUnlock = passedUnlocksCount - 1;
        require(currentUnlock < unlockPeriods.length - 1, "SHO: eliminating in the last unlock");

        for (uint256 i = 0; i < userAddresses.length; i++) {
            address userAddress = userAddresses[i];
            User1 memory user = users1[userAddress];
            require(user.allocation > 0, "SHO: some user not option 1");
            require(user.eliminatedAfterUnlock == 0, "SHO: some user already eliminated");

            uint120 userAllocation = _applyBaseFee(user.allocation);
            uint120 uncollectable = userAllocation * unlockPercentages[currentUnlock] / HUNDRED_PERCENT;

            extraFees1Allocation += userAllocation;
            extraFees1AllocationUncollectable += uncollectable;

            users1[userAddress].eliminatedAfterUnlock = currentUnlock + 1;
            emit UserElimination(
                userAddress,
                currentUnlock
            );
        }
    }
    
    /**
        User type 2 claims all the remaining amount of previous unlocks and can claim up to baseFeePercentage of the current unlock tokens without causing a fee.
        @param extraAmountToClaim the extra amount is also equal to the charged fee (user claims 100 more the first unlock, can claim 200 less the second unlock)
    */
    function claimUser2(
        uint120 extraAmountToClaim
    ) external nonReentrant onlyWhitelistedUser2 returns (
        uint120 amountToClaim, 
        uint120 baseClaimAmount, 
        uint120 currentUnlocked
    ) {
        update();
        User2 memory user = users2[msg.sender];
        require(passedUnlocksCount > 0, "SHO: no unlocks passed");
        uint16 currentUnlock = passedUnlocksCount - 1;

        if (user.claimedUnlocksCount < passedUnlocksCount) {
            amountToClaim = _updateUserCurrent(user, currentUnlock);
            baseClaimAmount = _getCurrentBaseClaimAmount(user, currentUnlock);
            amountToClaim += baseClaimAmount;
            user.currentClaimed += baseClaimAmount;
        } else {
            require(extraAmountToClaim > 0, "SHO: nothing to claim");
        }

        currentUnlocked = user.currentUnlocked;

        if (extraAmountToClaim > 0) {
            require(extraAmountToClaim <= user.currentUnlocked - user.currentClaimed, "SHO: passed extra amount too high");
            amountToClaim += extraAmountToClaim;
            user.currentClaimed += extraAmountToClaim;
            _chargeFee(user, extraAmountToClaim, currentUnlock);
        }

        require(amountToClaim > 0, "SHO: nothing to claim");

        user.totalClaimed += amountToClaim;
        users2[msg.sender] = user;
        shoToken.safeTransfer(msg.sender, amountToClaim);
        emit Claim2(
            msg.sender, 
            currentUnlock,
            amountToClaim,
            baseClaimAmount,
            extraAmountToClaim
        );
    }

    /**
        It's important that the fees are collectable not depedning on if users are claiming.
     */ 
    function collectFees() external onlyFeeCollector nonReentrant returns (uint120 baseFee, uint120 extraFee, uint120 burned) {
        update();
        require(collectedFeesUnlocksCount < passedUnlocksCount, "SHO: no fees to collect");
        uint16 currentUnlock = passedUnlocksCount - 1;

        // base fee from users type 1 and 2
        uint32 lastUnlockPercentage = collectedFeesUnlocksCount > 0 ? unlockPercentages[collectedFeesUnlocksCount - 1] : 0;
        uint120 globalAllocation = globalTotalAllocation * (unlockPercentages[currentUnlock] - lastUnlockPercentage) / HUNDRED_PERCENT;
        baseFee = globalAllocation * baseFeePercentage / HUNDRED_PERCENT;

        // extra fees from users type 2
        uint120 extraFee2;
        for (uint16 i = collectedFeesUnlocksCount; i <= currentUnlock; i++) {
            extraFee2 += extraFees2[i];
        }

        // extra fees from users type 1
        uint120 extraFees1AllocationTillNow = extraFees1Allocation * unlockPercentages[currentUnlock] / HUNDRED_PERCENT;
        uint120 extraFee1 = extraFees1AllocationTillNow - extraFees1AllocationUncollectable;
        extraFees1AllocationUncollectable = extraFees1AllocationTillNow;

        extraFee = extraFee1 + extraFee2;
        uint120 totalFee = baseFee + extraFee;
        burned = _burn(extraFee);
        collectedFeesUnlocksCount = currentUnlock + 1;
        shoToken.safeTransfer(msg.sender, totalFee - burned);
        emit FeeCollection(
            currentUnlock,
            totalFee,
            extraFee,
            burned
        );
    }

    /**  
        Updates passedUnlocksCount.
    */
    function update() public {
        uint16 _passedUnlocksCount = getPassedUnlocksCount();
        if (_passedUnlocksCount > passedUnlocksCount) {
            passedUnlocksCount = _passedUnlocksCount;
            emit Update(_passedUnlocksCount);
        }
    }

    // PUBLIC VIEW FUNCTIONS

    function getPassedUnlocksCount() public view returns (uint16 _passedUnlocksCount) {
        require(block.timestamp >= startTime, "SHO: before startTime");
        uint256 timeSinceStart = block.timestamp - startTime;
        uint256 maxReleases = unlockPeriods.length;
        _passedUnlocksCount = passedUnlocksCount;

        while (_passedUnlocksCount < maxReleases && timeSinceStart >= unlockPeriods[_passedUnlocksCount]) {
            _passedUnlocksCount++;
        }
    }

    // PRIVATE FUNCTIONS

    function _burn(uint120 amount) private returns (uint120 burned) {
        burned = amount * burnPercentage / HUNDRED_PERCENT;
        if (burned == 0) return 0;

        (bool success,) = address(shoToken).call(abi.encodeWithSignature("burn(uint256)", burned));
        if (!success) {
            shoToken.safeTransfer(burnValley, burned);
        }
    }

    function _updateUserCurrent(User2 memory user, uint16 currentUnlock) private view returns (uint120 claimableFromPreviousUnlocks) {
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
        user.claimedUnlocksCount = passedUnlocksCount;
    }

    function _getClaimableFromPreviousUnlocks(User2 memory user, uint16 currentUnlock) private view returns (uint120 claimableFromPreviousUnlocks) {
        uint32 lastUnlockPercentage = user.claimedUnlocksCount > 0 ? unlockPercentages[user.claimedUnlocksCount - 1] : 0;
        uint32 previousUnlockPercentage = currentUnlock > 0 ? unlockPercentages[currentUnlock - 1] : 0;
        uint120 claimableFromMissedUnlocks = user.allocation * (previousUnlockPercentage - lastUnlockPercentage) / HUNDRED_PERCENT;
        claimableFromMissedUnlocks = _applyBaseFee(claimableFromMissedUnlocks);
        
        claimableFromPreviousUnlocks = user.currentUnlocked - user.currentClaimed;
        claimableFromPreviousUnlocks += claimableFromMissedUnlocks;
    }

    function _getCurrentBaseClaimAmount(User2 memory user, uint16 currentUnlock) private view returns (uint120 baseClaimAmount) {
        if (currentUnlock < unlockPeriods.length - 1) {
            baseClaimAmount = user.currentUnlocked * freeClaimablePercentage / HUNDRED_PERCENT;
        } else {
            baseClaimAmount = user.currentUnlocked;
        }
    }

    function _chargeFee(User2 memory user, uint120 fee, uint16 currentUnlock) private {
        user.debt += fee;

        while (fee > 0 && currentUnlock < unlockPeriods.length - 1) {
            uint16 nextUnlock = currentUnlock + 1;
            uint120 nextUserAvailable = user.allocation * (unlockPercentages[nextUnlock] - unlockPercentages[currentUnlock]) / HUNDRED_PERCENT;
            nextUserAvailable = _applyBaseFee(nextUserAvailable);

            uint120 currentUnlockFee = fee <= nextUserAvailable ? fee : nextUserAvailable;
            extraFees2[nextUnlock] += currentUnlockFee;
            fee -= currentUnlockFee;
            currentUnlock++;
        }
    }

    function _applyBaseFee(uint120 value) private view returns (uint120) {
        return value - value * baseFeePercentage / HUNDRED_PERCENT;
    }

    function _buildArraySum(uint32[] memory diffArray) internal pure returns (uint32[] memory) {
        uint256 len = diffArray.length;
        uint32[] memory sumArray = new uint32[](len);
        uint32 lastSum = 0;
        for (uint256 i = 0; i < len; i++) {
            if (i > 0) {
                lastSum = sumArray[i - 1];
            }
            sumArray[i] = lastSum + diffArray[i];
        }
        return sumArray;
    }
}