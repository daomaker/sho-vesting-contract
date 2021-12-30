//SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "hardhat/console.sol";

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
        uint120 currentAvailable;
        uint120 currentClaimed;
    }

    mapping(address => User1) public users1;
    mapping(address => User2) public users2;

    IERC20 public immutable shoToken;
    uint64 public immutable startTime;
    uint16 public passedUnlocksCount;
    uint32[] public unlockPercentages;
    uint32[] public unlockPeriods;

    uint120 public globalTotalAllocation1;
    uint120 public globalTotalAllocation2;
    address public immutable feeCollector;
    uint32 public immutable baseFeePercentage;
    uint16 public collectedUnlocksCount;
    uint120[] public extraFees;


    event Whitelist(
        address user,
        uint128 allocation,
        uint8 option
    );

    event UserElimination(
        address user,
        uint16 currentUnlock,
        uint128 unlockedTokens,
        uint32 increasedFeePercentage
    );

    event FeeCollection(
        uint16 currentUnlock,
        uint128 totalFee,
        uint128 baseFee,
        uint128 extraFee
    );

    event Claim2(
        address indexed user,
        uint16 currentUnlock,
        uint120 claimedTokens,
        uint120 baseClaimed,
        uint120 chargedfee
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
     */
    constructor(
        IERC20 _shoToken,
        uint32[] memory _unlockPercentagesDiff,
        uint32[] memory _unlockPeriodsDiff,
        uint32 _baseFeePercentage,
        address _feeCollector,
        uint64 _startTime
    ) {
        require(address(_shoToken) != address(0), "SHO: sho token zero address");
        require(_unlockPercentagesDiff.length > 0, "SHO: 0 unlock percentages");
        require(_unlockPercentagesDiff.length <= 200, "SHO: too many unlock percentages");
        require(_unlockPeriodsDiff.length == _unlockPercentagesDiff.length, "SHO: different array lengths");
        require(_baseFeePercentage <= HUNDRED_PERCENT, "SHO: initial fee percentage higher than 100%");
        require(_feeCollector != address(0), "SHO: fee collector zero address");
        require(_startTime > block.timestamp, "SHO: start time must be in future");

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
        extraFees = new uint120[](_unlockPercentagesDiff.length);
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

        uint120 _globalTotalAllocation1;
        uint120 _globalTotalAllocation2;
        for (uint256 i = 0; i < userAddresses.length; i++) {
            require(options[i] == 1 || options[i] == 2, "SHO: invalid user option");

            if (options[i] == 1) {
                User1 storage user = users1[userAddresses[i]];
                require(user.allocation == 0, "SHO: some users are already whitelisted");
                user.allocation = allocations[i];
                _globalTotalAllocation1 += allocations[i];
            } else if (options[i] == 2) {
                User2 storage user = users2[userAddresses[i]];
                require(user.allocation == 0, "SHO: some users are already whitelisted");
                user.allocation = allocations[i];
                _globalTotalAllocation2 += allocations[i];
            }

            emit Whitelist(
                userAddresses[i],
                allocations[i],
                options[i]
            );
        }
            
        globalTotalAllocation1 = _globalTotalAllocation1;
        globalTotalAllocation2 = _globalTotalAllocation2;
    }
    

    function claimUser2(
        uint120 extraAmountToClaim
    ) external nonReentrant onlyWhitelistedUser2 returns (
        uint120 amountToClaim, 
        uint120 baseClaimAmount, 
        uint120 availableAmount
    ) {
        update();
        User2 memory user = users2[msg.sender];
        require(passedUnlocksCount > 0, "SHO: no unlocks passed");
        uint16 currentUnlock = passedUnlocksCount - 1;

        if (user.claimedUnlocksCount < passedUnlocksCount) {
            amountToClaim = _getClaimableFromPreviousUnlocks(user, currentUnlock);
            _updateUser(user, currentUnlock);
            baseClaimAmount = _getCurrentBaseClaimAmount(user, currentUnlock);
            amountToClaim += baseClaimAmount;
            user.currentClaimed += baseClaimAmount;
        } else {
            require(extraAmountToClaim > 0, "SHO: nothing to claim");
        }

        availableAmount = user.currentAvailable;

        if (extraAmountToClaim > 0) {
            require(extraAmountToClaim <= user.currentAvailable - user.currentClaimed, "SHO: passed extra amount too high");
            amountToClaim += extraAmountToClaim;
            user.currentClaimed += extraAmountToClaim;
            _chargeFee(user, extraAmountToClaim, currentUnlock);
        }

        require(amountToClaim > 0, "SHO: nothing to claim");

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

    function _getClaimableFromPreviousUnlocks(User2 memory user, uint16 currentUnlock) private view returns (uint120 claimableFromPreviousUnlocks) {
        uint32 lastUnlockPercentage = user.claimedUnlocksCount > 1 ? unlockPercentages[user.claimedUnlocksCount - 2] : 0;
        uint32 previousUnlockPercentage = currentUnlock > 0 ? unlockPercentages[currentUnlock - 1] : 0;
        uint120 pastAllocation = user.allocation * (previousUnlockPercentage - lastUnlockPercentage) / HUNDRED_PERCENT;
        pastAllocation -= pastAllocation * baseFeePercentage / HUNDRED_PERCENT;
        pastAllocation -= user.currentClaimed;

        if (user.debt <= pastAllocation) {
            claimableFromPreviousUnlocks = pastAllocation - user.debt;
            user.debt = 0;
        } else {
            user.debt -= pastAllocation;
        }
    }

    function _updateUser(User2 memory user, uint16 currentUnlock) private view {
        uint32 unlockPercentageDiffCurrent = currentUnlock > 0 ?
            unlockPercentages[currentUnlock] - unlockPercentages[currentUnlock - 1] : unlockPercentages[currentUnlock];

        user.currentAvailable = user.allocation * unlockPercentageDiffCurrent / HUNDRED_PERCENT;
        user.currentAvailable -= user.currentAvailable * baseFeePercentage / HUNDRED_PERCENT;

        if (user.currentAvailable >= user.debt) {
            user.currentAvailable -= user.debt;
            user.debt = 0;
        } else {
            user.debt -= user.currentAvailable;
            user.currentAvailable = 0;
        }
        
        user.currentClaimed = 0;
        user.claimedUnlocksCount = passedUnlocksCount;
    }

    function _getCurrentBaseClaimAmount(User2 memory user, uint16 currentUnlock) private view returns (uint120 baseClaimAmount) {
        if (currentUnlock < unlockPeriods.length - 1) {
            baseClaimAmount = user.currentAvailable * baseFeePercentage / HUNDRED_PERCENT;
        } else {
            baseClaimAmount = user.currentAvailable;
        }
    }

    function _chargeFee(User2 memory user, uint120 fee, uint16 currentUnlock) private {
        user.debt += fee;

        while (fee > 0 && currentUnlock < unlockPeriods.length - 1) {
            uint16 nextUnlock = currentUnlock + 1;
            uint120 nextUserAvailable = user.allocation * (unlockPercentages[nextUnlock] - unlockPercentages[currentUnlock]) / HUNDRED_PERCENT;
            nextUserAvailable -= nextUserAvailable * baseFeePercentage / HUNDRED_PERCENT;

            uint120 currentUnlockFee = fee <= nextUserAvailable ? fee : nextUserAvailable;
            extraFees[nextUnlock] += currentUnlockFee;
            fee -= currentUnlockFee;
            currentUnlock++;
        }
    }
    
    /**
        It's important that the fees are collectable not depedning on if users are claiming.
     */ 
    function collectFees() external onlyFeeCollector nonReentrant returns (uint128 baseFee, uint128 extraFee) {
        update();
        require(collectedUnlocksCount < passedUnlocksCount, "SHO: no fees to collect");
        uint16 currentUnlock = passedUnlocksCount - 1;

        uint32 lastUnlockPercentage = collectedUnlocksCount > 0 ? unlockPercentages[collectedUnlocksCount - 1] : 0;
        uint128 globalAllocation2 = globalTotalAllocation2 * (unlockPercentages[currentUnlock] - lastUnlockPercentage) / HUNDRED_PERCENT;
        baseFee = globalAllocation2 * baseFeePercentage / HUNDRED_PERCENT;

        for (uint16 i = collectedUnlocksCount; i <= currentUnlock; i++) {
            extraFee += extraFees[i];
        }

        uint128 totalFee = baseFee + extraFee;

        collectedUnlocksCount = currentUnlock + 1;
        shoToken.safeTransfer(msg.sender, totalFee);
        emit FeeCollection(
            currentUnlock,
            totalFee, 
            baseFee, 
            extraFee
        );
    }

    /**  
        Updates passedUnlocksCount.
    */
    function update() public {
        require(block.timestamp >= startTime, "SHO: before startTime");

        uint256 timeSinceStart = block.timestamp - startTime;
        uint256 maxReleases = unlockPeriods.length;
        uint16 _passedUnlocksCount = passedUnlocksCount;

        while (_passedUnlocksCount < maxReleases && timeSinceStart >= unlockPeriods[_passedUnlocksCount]) {
            _passedUnlocksCount++;
        }

        passedUnlocksCount = _passedUnlocksCount;

        emit Update(_passedUnlocksCount);
    }


    /*function Claim1() onlyWhitelistedUser1 external nonReentrant {
        update();
        User1 memory user = users1[msg.sender];
        require(passedUnlocksCount > 0, "SHO: no unlocks passed");
        uint32 currentUnlock = passedUnlocksCount - 1;
    }*/

    /**
        Increases an option 1 user's next unlock fee to 100%.
        @param userAddresses whitelisted user addresses to eliminate
     */
    /*function eliminateOption1Users(address[] calldata userAddresses) external onlyOwner {
        update();
        require(passedUnlocksCount > 0, "SHO: no unlocks passed");
        uint32 currentUnlock = passedUnlocksCount - 1;
        require(currentUnlock < unlockPeriods.length - 1, "SHO: eliminating in the last unlock");

        for (uint256 i = 0; i < userAddresses.length; i++) {
            address userAddress = userAddresses[i];
            User memory user = users[userAddress];
            require(user.option == 1, "SHO: some user not option 1");
            require(user.feePercentageNextUnlock < HUNDRED_PERCENT, "SHO: some user already eliminated");

            uint128 unlockedTokens = _unlockUserTokens(user);
            uint32 increasedFeePercentage = _updateUserFee(user, HUNDRED_PERCENT);

            users[userAddress] = user;
            emit UserElimination(
                userAddress,
                currentUnlock,
                unlockedTokens,
                increasedFeePercentage
            );
        }
    }*/

    /**
        It's important that the fees are collectable not depedning on if users are claiming, 
        otherwise the fees could be collected when users claim.
     */ 
    /*function collectFees() external onlyFeeCollector nonReentrant returns (uint128 baseFee, uint128 extraFee) {
        update();
        require(collectedUnlocksCount < passedUnlocksCount, "SHO: no fees to collect");
        uint32 currentUnlock = passedUnlocksCount - 1;

        uint32 lastUnlockPercentage = collectedUnlocksCount > 0 ? unlockPercentages[collectedUnlocksCount - 1] : 0;
        uint128 lastExtraFee = collectedUnlocksCount > 0 ? extraFees[collectedUnlocksCount - 1] : 0;

        uint128 globalAllocation = globalTotalAllocation * (unlockPercentages[currentUnlock] - lastUnlockPercentage) / HUNDRED_PERCENT;
        baseFee = globalAllocation * baseFeePercentage / HUNDRED_PERCENT;
        extraFee = extraFees[currentUnlock] - lastExtraFee;
        uint128 totalFee = baseFee + extraFee;

        collectedUnlocksCount = currentUnlock + 1;
        shoToken.safeTransfer(msg.sender, totalFee);
        emit FeeCollection(
            currentUnlock,
            totalFee, 
            baseFee, 
            extraFee
        );
    }*/

    /*
        Users can choose how much they want to claim and depending on that (ratio totalClaimed / totalUnlocked), 
        their fee for the next unlocks increases or not.
        @param amountToClaim needs to be less or equal to the available amount
     */
    /*function claim(
        uint128 amountToClaim
    ) external onlyWhitelisted nonReentrant returns (
        uint128 unlockedTokens,
        uint32 increasedFeePercentage,
        uint128 availableToClaim, 
        uint128 receivedTokens
    ) {
        update();
        User memory user = users[msg.sender];
        require(passedUnlocksCount > 0, "SHO: no unlocks passed");
        require(amountToClaim <= user.allocation, "SHO: amount to claim higher than allocation");
        uint32 currentUnlock = passedUnlocksCount - 1;

        unlockedTokens = _unlockUserTokens(user);

        availableToClaim = user.totalUnlocked - user.totalClaimed;
        require(availableToClaim > 0, "SHO: no tokens to claim");
        
        receivedTokens = amountToClaim > availableToClaim ? availableToClaim : amountToClaim;
        user.totalClaimed += receivedTokens;

        if (user.option == 0) {
            uint32 claimedRatio = uint32(user.totalClaimed * HUNDRED_PERCENT / user.totalUnlocked);
            increasedFeePercentage = _updateUserFee(user, claimedRatio);
        }
        
        users[msg.sender] = user;
        shoToken.safeTransfer(msg.sender, receivedTokens);
        emit Claim(
            msg.sender, 
            currentUnlock, 
            unlockedTokens,
            increasedFeePercentage,
            receivedTokens
        );
    }*/

    

    /*function _updateUserFee(User memory user, uint32 potentiallyNextFeePercentage) private returns (uint32 increasedFeePercentage) {
        uint32 currentUnlock = passedUnlocksCount - 1;

        if (currentUnlock < unlockPeriods.length - 1) {
            if (potentiallyNextFeePercentage > user.feePercentageNextUnlock) {
                increasedFeePercentage = potentiallyNextFeePercentage - user.feePercentageNextUnlock;
                user.feePercentageNextUnlock = potentiallyNextFeePercentage;

                uint128 tokensNextUnlock = user.allocation * (unlockPercentages[currentUnlock + 1] - unlockPercentages[currentUnlock]) / HUNDRED_PERCENT;
                uint128 extraFee = tokensNextUnlock * increasedFeePercentage / HUNDRED_PERCENT;
                extraFees[currentUnlock + 1] += extraFee;
            }
        }
    }*/

    /*function _unlockUserTokens(User memory user) private view returns (uint128 unlockedTokens) {
        uint32 currentUnlock = passedUnlocksCount - 1;

        if (user.unlockedBatchesCount <= currentUnlock) {
            user.feePercentageCurrentUnlock = user.feePercentageNextUnlock;

            uint32 lastUnlockPercentage = user.unlockedBatchesCount > 0 ? unlockPercentages[user.unlockedBatchesCount - 1] : 0;
            unlockedTokens = user.allocation * (unlockPercentages[currentUnlock] - lastUnlockPercentage) / HUNDRED_PERCENT;
            unlockedTokens -= unlockedTokens * user.feePercentageCurrentUnlock / HUNDRED_PERCENT;
            user.totalUnlocked += unlockedTokens;
            user.unlockedBatchesCount = currentUnlock + 1;
        }
    }*/

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