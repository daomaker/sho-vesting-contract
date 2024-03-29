//SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

contract SHOVesting is Initializable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    uint32 constant internal HUNDRED_PERCENT = 1e6;

    struct User {
        uint16 claimedUnlocksCount;
        uint16 eliminatedAfterUnlock;
        uint120 allocation;
    }

    mapping(address => User) public users1;

    uint32[] public unlockPercentages;
    uint32[] public unlockPeriods;

    IERC20 public shoToken;
    uint64 public startTime;
    address public feeCollector;
    uint32 public baseFeePercentage1;
    bool public whitelistingAllowed;

    uint16 passedUnlocksCount;
    uint120 public globalTotalAllocation1;

    uint16 public collectedFeesUnlocksCount;
    uint120 public extraFees1Allocation;
    uint120 public extraFees1AllocationUncollectable;

    event Whitelist (
        address user,
        uint120 allocation
    );

    event Claim (
        address indexed user,
        uint16 currentUnlock,
        uint120 claimedTokens
    );

    event FeeCollection (
        uint16 currentUnlock,
        uint120 totalFee,
        uint120 extraFee
    );

    event UserElimination (
        address user,
        uint16 currentUnlock
    );

    event Update (
        uint16 passedUnlocksCount
    );

    modifier onlyWhitelistedUser(address userAddress) {
        require(users1[userAddress].allocation > 0, "SHOVesting: not whitelisted");
        _;
    }

    /**
     * @notice Initializes contract.
     * @param _shoToken The vesting token that whitelisted users can claim.
     * @param _unlockPercentagesDiff Array of unlock percentages as differentials
     * @param _unlockPeriodsDiff Array of unlock periods as differentials.
     * @param _baseFeePercentage1 Base fee in percentage for users.
     * @param _feeCollector EOA that receives fees.
     * @param _startTime When users can start claiming.
     */
    function init(
        IERC20 _shoToken,
        uint32[] memory _unlockPercentagesDiff,
        uint32[] memory _unlockPeriodsDiff,
        uint32 _baseFeePercentage1,
        address _feeCollector,
        uint64 _startTime
    ) external initializer {
        __ReentrancyGuard_init();
        __Ownable_init();

        require(address(_shoToken) != address(0), "SHOVesting: sho token zero address");
        require(_unlockPercentagesDiff.length > 0, "SHOVesting: 0 unlock percentages");
        require(_unlockPeriodsDiff.length == _unlockPercentagesDiff.length, "SHOVesting: different array lengths");
        require(_baseFeePercentage1 <= HUNDRED_PERCENT, "SHOVesting: base fee percentage 1 higher than 100%");
        require(_feeCollector != address(0), "SHOVesting: fee collector zero address");
        require(_startTime > block.timestamp, "SHOVesting: start time must be in future");

        uint32[] memory _unlockPercentages = _buildArraySum(_unlockPercentagesDiff);
        uint32[] memory _unlockPeriods = _buildArraySum(_unlockPeriodsDiff);
        require(_unlockPercentages[_unlockPercentages.length - 1] == HUNDRED_PERCENT, "SHOVesting: invalid unlock percentages");

        shoToken = _shoToken;
        unlockPercentages = _unlockPercentages;
        unlockPeriods = _unlockPeriods;
        baseFeePercentage1 = _baseFeePercentage1;
        feeCollector = _feeCollector;
        startTime = _startTime;

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
        uint120 _globalTotalAllocation2;
        for (uint256 i = 0; i < userAddresses.length; i++) {
            address userAddress = userAddresses[i];
            if (userAddress == feeCollector) {
                globalTotalAllocation1 += allocations[i];
                extraFees1Allocation += _applyBaseFee(allocations[i]);
                continue;
            }

            require(users1[userAddress].allocation == 0, "SHOVesting: some users are already whitelisted");

            users1[userAddress].allocation = allocations[i];
            _globalTotalAllocation1 += allocations[i];

            emit Whitelist(
                userAddresses[i],
                allocations[i]
            );
        }
            
        globalTotalAllocation1 += _globalTotalAllocation1;
        
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

        uint16 currentUnlock = passedUnlocksCount - 1;
        if (user.eliminatedAfterUnlock > 0) {
            require(user.claimedUnlocksCount < user.eliminatedAfterUnlock, "SHOVesting: nothing to claim");
            currentUnlock = user.eliminatedAfterUnlock - 1;
        }

        uint32 lastUnlockPercentage = user.claimedUnlocksCount > 0 ? unlockPercentages[user.claimedUnlocksCount - 1] : 0;
        amountToClaim = _applyPercentage(user.allocation, unlockPercentages[currentUnlock] - lastUnlockPercentage);
        amountToClaim = _applyBaseFee(amountToClaim);

        user.claimedUnlocksCount = currentUnlock + 1;
        users1[userAddress] = user;
        shoToken.safeTransfer(userAddress, amountToClaim);

        emit Claim(userAddress, currentUnlock, amountToClaim);
    }

    function claimUser1() external returns (uint120 amountToClaim) {
        return claimUser1(msg.sender);
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

        for (uint256 i = 0; i < userAddresses.length; i++) {
            address userAddress = userAddresses[i];
            User memory user = users1[userAddress];
            require(user.allocation > 0, "SHOVesting: some user not option 1");
            require(user.eliminatedAfterUnlock == 0, "SHOVesting: some user already eliminated");

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
        emit FeeCollection(
            currentUnlock,
            totalFee,
            extraFee
        );
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
        for (uint256 i = 0; i < len; i++) {
            if (i > 0) {
                lastSum = sumArray[i - 1];
            }
            sumArray[i] = lastSum + diffArray[i];
        }
        return sumArray;
    }
}