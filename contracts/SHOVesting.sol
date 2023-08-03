//SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

contract SHOVesting is Initializable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    uint32 constant internal HUNDRED_PERCENT = 1e6;
    uint32 constant internal REFUND_PERIOD_DURATION = 86400 * 3;

    struct User {
        uint16 claimedUnlocksCount; // How many unlocks user has claimed. 
        uint16 eliminatedAfterUnlock; // At which unlock user has been eliminated.
        uint120 allocation; // How many tokens he can claim in total without including fee.
        bool refunded; // Whether user was refunded.
    }

    struct InitParameters {
        IERC20 shoToken; // The vesting token that whitelisted users can claim.
        uint32[] unlockPercentagesDiff; // Array of unlock percentages as differentials.
        uint32[] unlockPeriodsDiff; // Array of unlock periods as differentials.
        uint32 baseFeePercentage1; // Base fee in percentage for users.
        address feeCollector; // EOA that receives fees.
        uint64 startTime; // When users can start claiming.
        IERC20 refundToken; // Refund token address.
        uint64 refundAfter; // Relative time since start time.
        address refundReceiver; // Address receiving refunded tokens.
        uint120 refundPrice; // Exchange rate between refund token and vesting token.
    }

    mapping(address => User) public users1;

    uint32[] public unlockPercentages;
    uint32[] public unlockPeriods;

    IERC20 public shoToken;
    uint64 public startTime;
    address public feeCollector;
    uint32 public baseFeePercentage1;

    IERC20 refundToken;
    uint64 refundAfter;
    address refundReceiver;
    uint120 refundPrice;

    bool public whitelistingAllowed;
    bool public refundCompleted;
    uint16 public remainingUsersToRefund;

    uint16 passedUnlocksCount;
    uint120 public globalTotalAllocation1;
    uint120 public totalRefundedAllocation;

    uint16 public collectedFeesUnlocksCount;
    uint120 public extraFees1Allocation;
    uint120 public extraFees1AllocationUncollectable;

    event Whitelist(
        address user,
        uint120 allocation
    );

    event Claim(
        address indexed user,
        uint16 currentUnlock,
        uint120 claimedTokens
    );

    event FeeCollection(
        uint16 currentUnlock,
        uint120 totalFee,
        uint120 extraFee
    );

    event UserElimination(
        address user,
        uint16 currentUnlock
    );

    event Update(
        uint16 passedUnlocksCount
    );

    event Refund(
        address user,
        uint refundAmount
    );

    modifier onlyWhitelistedUser(address userAddress) {
        require(users1[userAddress].allocation > 0, "SHOVesting: not whitelisted");
        _;
    }

    /**
     * @notice Initializes contract.
     * @param params InitParameters struct.
     */
    function init(
        InitParameters calldata params
    ) external initializer {
        __ReentrancyGuard_init();
        __Ownable_init();

        require(address(params.shoToken) != address(0), "SHOVesting: sho token zero address");
        require(params.unlockPercentagesDiff.length > 0, "SHOVesting: 0 unlock percentages");
        require(params.unlockPeriodsDiff.length == params.unlockPercentagesDiff.length, "SHOVesting: different array lengths");
        require(params.baseFeePercentage1 <= HUNDRED_PERCENT, "SHOVesting: base fee percentage 1 higher than 100%");
        require(params.feeCollector != address(0), "SHOVesting: fee collector zero address");
        require(params.startTime > block.timestamp, "SHOVesting: start time must be in future");

        uint32[] memory _unlockPercentages = _buildArraySum(params.unlockPercentagesDiff);
        uint32[] memory _unlockPeriods = _buildArraySum(params.unlockPeriodsDiff);
        require(_unlockPercentages[_unlockPercentages.length - 1] == HUNDRED_PERCENT, "SHOVesting: invalid unlock percentages");

        require(params.refundAfter <= 86400 * 31, "SHOVesting: refund after too far");

        shoToken = params.shoToken;
        unlockPercentages = _unlockPercentages;
        unlockPeriods = _unlockPeriods;
        baseFeePercentage1 = params.baseFeePercentage1;
        feeCollector = params.feeCollector;
        startTime = params.startTime;
        refundToken = params.refundToken;
        refundAfter = params.refundAfter;
        refundReceiver = params.refundReceiver;
        refundPrice = params.refundPrice;

        whitelistingAllowed = true;
    }

    /** 
     * @notice Owner whitelists addresses their given allocations.
     * @param userAddresses User addresses to whitelist
     * @param allocations Users allocation
     * @param last Disable Whitelisting after last whitelist
    */
    function whitelistUsers(
        address[] calldata userAddresses,
        uint120[] calldata allocations,
        bool last
    ) external onlyOwner {
        require(whitelistingAllowed, "SHOVesting: whitelisting not allowed anymore");
        require(userAddresses.length != 0, "SHOVesting: zero length array");
        require(userAddresses.length == allocations.length, "SHOVesting: different array lengths");

        uint120 _globalTotalAllocation1;
        uint16 _remainingUsersToRefund;

        for (uint256 i; i < userAddresses.length; i++) {
            address userAddress = userAddresses[i];
            if (userAddress == feeCollector) {
                globalTotalAllocation1 += allocations[i];
                extraFees1Allocation += _applyBaseFee(allocations[i]);
                continue;
            }

            require(users1[userAddress].allocation == 0, "SHOVesting: already whitelisted");

            users1[userAddress].allocation = allocations[i];
            _globalTotalAllocation1 += allocations[i];
            _remainingUsersToRefund++;

            emit Whitelist(userAddresses[i], allocations[i]);
        }
            
        globalTotalAllocation1 += _globalTotalAllocation1;
        remainingUsersToRefund += _remainingUsersToRefund;
        
        if (last) {
            whitelistingAllowed = false;
        }
    }

    /**
     * @notice Whitelisted users can claim their available tokens.
     * @dev There's still the baseFee deducted from their allocation.
     * @param userAddress The user address to claim tokens for.
    */
    function claimUser1(address userAddress) onlyWhitelistedUser(userAddress) public nonReentrant returns (uint120 amountToClaim) {
        update();

        User memory user = users1[userAddress];
        require(passedUnlocksCount > 0, "SHOVesting: no unlocks passed");
        require(user.claimedUnlocksCount < passedUnlocksCount, "SHOVesting: nothing to claim");
        require(!user.refunded, "SHOVesting: refunded");

        uint16 currentUnlock = passedUnlocksCount - 1;
        if (user.eliminatedAfterUnlock > 0) {
            require(user.claimedUnlocksCount < user.eliminatedAfterUnlock, "SHOVesting: nothing to claim");
            currentUnlock = user.eliminatedAfterUnlock - 1;
        }

        uint32 lastUnlockPercentage = user.claimedUnlocksCount > 0 ? unlockPercentages[user.claimedUnlocksCount - 1] : 0;
        amountToClaim = _applyPercentage(user.allocation, unlockPercentages[currentUnlock] - lastUnlockPercentage);
        amountToClaim = _applyBaseFee(amountToClaim);

        if (user.claimedUnlocksCount == 0) {
            remainingUsersToRefund--;
        }

        user.claimedUnlocksCount = currentUnlock + 1;
        users1[userAddress] = user;
        shoToken.safeTransfer(userAddress, amountToClaim);

        emit Claim(userAddress, currentUnlock, amountToClaim);
    }

    /**
     * @notice Sender claims tokens.
     */
    function claimUser1() external returns (uint120 amountToClaim) {
        return claimUser1(msg.sender);
    }

    /**
     * @notice All users that haven't claimed tokens shall get refunded.
     * @dev Anybody can call this function.
     * @param userAddresses User addresses to be refunded (all that haven't claimed).
     */
    function refund(address[] calldata userAddresses) external nonReentrant {
        update();

        uint refundAt = startTime + refundAfter;
        require(refundPrice > 0, "SHOVesting: no refund");
        require(block.timestamp >= refundAt, "SHOVesting: no refund period");
        require(!refundCompleted, "SHOVesting: refund completed");

        for (uint256 i; i < userAddresses.length; i++) {
            address userAddress = userAddresses[i];
            User memory user = users1[userAddress];

            if (
                user.claimedUnlocksCount == 0 &&
                user.eliminatedAfterUnlock == 0 &&
                !user.refunded
            ) {
                totalRefundedAllocation += user.allocation;
                globalTotalAllocation1 -= user.allocation;

                uint refundAmount = getRefundAmount(user.allocation);

                shoToken.transfer(refundReceiver, user.allocation);
                refundToken.transfer(userAddress, refundAmount);

                remainingUsersToRefund--;
                user.refunded = true;
                emit Refund(userAddress, refundAmount);
            }
        }

        if (remainingUsersToRefund == 0) {
            refundCompleted = true;
            refundToken.safeTransfer(refundReceiver, refundToken.balanceOf(address(this)));
        }
    }

    /**
     * @notice Removes all the future allocation of passed user addresses.
     * @dev Users can still claim the unlock they were eliminated in.
     * @param userAddresses Whitelisted user addresses to eliminate
     */
    function eliminateUsers1(address[] calldata userAddresses) external onlyOwner {
        update();
        require(passedUnlocksCount > 0, "SHOVesting: no unlocks passed");
        uint16 currentUnlock = passedUnlocksCount - 1;
        require(currentUnlock < unlockPeriods.length - 1, "SHOVesting: eliminating in the last unlock");
        require(refundCompleted || refundPrice == 0, "SHOVesting: refund period");

        for (uint256 i; i < userAddresses.length; i++) {
            address userAddress = userAddresses[i];
            User memory user = users1[userAddress];
            require(user.allocation > 0, "SHOVesting: not whitelisted");
            require(!user.refunded, "SHOVesting: refunded");
            require(user.eliminatedAfterUnlock == 0, "SHOVesting: already eliminated");

            uint120 userAllocation = _applyBaseFee(user.allocation);
            uint120 uncollectable = _applyPercentage(userAllocation, unlockPercentages[currentUnlock]);

            extraFees1Allocation += userAllocation;
            extraFees1AllocationUncollectable += uncollectable;

            users1[userAddress].eliminatedAfterUnlock = currentUnlock + 1;
            emit UserElimination(userAddress, currentUnlock);
        }
    }

    /**
     * @notice Claims fees from all users.
     * @dev The fees are collectable not depedning on if users are claiming.
     * @dev Anybody can call this but the fees go to the fee collector.
     * @dev If some users get refunded after collecting fees, the fee collector is responsible for rebalancing.
     */ 
    function collectFees() external nonReentrant returns (uint120 baseFee, uint120 extraFee) {
        update();
        require(collectedFeesUnlocksCount < passedUnlocksCount, "SHOVesting: no fees to collect");
        uint16 currentUnlock = passedUnlocksCount - 1;

        uint32 lastUnlockPercentage = collectedFeesUnlocksCount > 0 ? unlockPercentages[collectedFeesUnlocksCount - 1] : 0;
        uint120 globalAllocation1 = _applyPercentage(globalTotalAllocation1, unlockPercentages[currentUnlock] - lastUnlockPercentage);
        baseFee = _applyPercentage(globalAllocation1, baseFeePercentage1);

        uint120 extraFees1AllocationTillNow = _applyPercentage(extraFees1Allocation, unlockPercentages[currentUnlock]);
        extraFee = extraFees1AllocationTillNow - extraFees1AllocationUncollectable;
        extraFees1AllocationUncollectable = extraFees1AllocationTillNow;

        uint120 totalFee = baseFee + extraFee;
        collectedFeesUnlocksCount = currentUnlock + 1;
        shoToken.safeTransfer(feeCollector, totalFee);
        emit FeeCollection(currentUnlock, totalFee, extraFee);
    }

    /**  
     * @notice Updates passedUnlocksCount.
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
        require(block.timestamp >= startTime, "SHOVesting: before startTime");
        uint256 timeSinceStart = block.timestamp - startTime;
        uint256 maxReleases = unlockPeriods.length;
        _passedUnlocksCount = passedUnlocksCount;

        while (_passedUnlocksCount < maxReleases && timeSinceStart >= unlockPeriods[_passedUnlocksCount]) {
            _passedUnlocksCount++;
        }
    }
    
    function getRefundAmount(uint allocation) public view returns (uint refundAmount) {
        return allocation * refundPrice / 10 ** IERC20Metadata(address(shoToken)).decimals();
    }

    function getTotalUnlocksCount() public view returns (uint16 totalUnlocksCount) {
        return uint16(unlockPercentages.length);
    }

    // PRIVATE FUNCTIONS

    function _applyPercentage(uint120 value, uint32 percentage) private pure returns (uint120) {
        return uint120(uint256(value) * percentage / HUNDRED_PERCENT);
    }

    function _applyBaseFee(uint120 value) private view returns (uint120) {
        return value - _applyPercentage(value, baseFeePercentage1);
    }

    function _buildArraySum(uint32[] memory diffArray) internal pure returns (uint32[] memory) {
        uint256 len = diffArray.length;
        uint32[] memory sumArray = new uint32[](len);
        uint32 lastSum = 0;
        for (uint256 i; i < len; i++) {
            if (i > 0) {
                lastSum = sumArray[i - 1];
            }
            sumArray[i] = lastSum + diffArray[i];
        }
        return sumArray;
    }
}