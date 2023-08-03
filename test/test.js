const { expect } = require("chai");
const { time } = require("@openzeppelin/test-helpers");

describe("SHO smart contract", function() {
    let owner, feeCollector, refundReceiver, user1, user2, user3, contract, shoToken, shoTokenDecimals, shoTokenBurnable, contractView;

    const PRECISION_LOSS = "10000000000000000";
    
    const parseUnits = (value, decimals = shoTokenDecimals) => {
        return ethers.utils.parseUnits(value.toString(), decimals);
    }

    const whitelistUsers = async(whitelist, splitWhitelisting = false) => {
        const allocations = whitelist.allocations.map((raw) => parseUnits(raw));

        await expect(contract.whitelistUsers([owner.address], [1, 1], true)).to.be.revertedWith("SHOVesting: different array lengths");
        await expect(contract.whitelistUsers([], [], true)).to.be.revertedWith("SHOVesting: zero length array");

        contract = contract.connect(user1); 
        await expect(contract.whitelistUsers(whitelist.wallets, allocations, true))
            .to.be.revertedWith("Ownable: caller is not the owner");

        contract = contract.connect(owner); 

        if (splitWhitelisting) {
            const len = whitelist.wallets.length;
            await contract.whitelistUsers(whitelist.wallets.slice(0, 1), allocations.slice(0, 1), false);

            await expect(contract.whitelistUsers(whitelist.wallets, allocations, false))
                .to.be.revertedWith("SHOVesting: some users are already whitelisted");
            await expect(contract.whitelistUsers(whitelist.wallets, allocations, false))
                .to.be.revertedWith("SHOVesting: some users are already whitelisted");

            await contract.whitelistUsers(whitelist.wallets.slice(1, len), allocations.slice(1, len), true);
        } else {
            await contract.whitelistUsers(whitelist.wallets, allocations, true);
        }

        let globalTotalAllocation1 = 0;
        for (let i = 0; i < whitelist.wallets.length; i++) {
            const userInfo = await contract.users1(whitelist.wallets[i]);
            if (whitelist.wallets[i].toLowerCase() != feeCollector.address.toLowerCase()) {
                expect(userInfo.allocation).to.equal(allocations[i]);
            }

            globalTotalAllocation1 += whitelist.allocations[i];
        }
        
        await shoToken.transfer(contract.address, parseUnits(globalTotalAllocation1));
        await expect(contract.whitelistUsers([owner.address], [1], false))
            .to.be.revertedWith("SHOVesting: whitelisting not allowed anymore");

        expect(await contract.globalTotalAllocation1()).to.equal(parseUnits(globalTotalAllocation1));
    }

    const init = async(unlockPercentages, unlockPeriods, baseFee1, whitelist, _shoTokenDecimals = 18, _shoTokenBurnable = false, splitWhitelisting = false, shiftToStartTime = true) => {
        shoTokenDecimals = _shoTokenDecimals;
        shoTokenBurnable = _shoTokenBurnable;
        const startTime = Number(await time.latest()) + 300;
        const ERC20Mock = await ethers.getContractFactory(shoTokenBurnable ? "ERC20MockBurnable" : "ERC20Mock");
        shoToken = await ERC20Mock.deploy("MOCK1", "MOCK1", owner.address, parseUnits(100000000), shoTokenDecimals);
        
        const Factory = await ethers.getContractFactory("SHOVestingFactory");
        const factory = await Factory.deploy();

        const params = {
            shoToken: shoToken.address,
            unlockPercentagesDiff: unlockPercentages,
            unlockPeriodsDiff: unlockPeriods,
            baseFeePercentage1: baseFee1,
            feeCollector: feeCollector.address,
            startTime: startTime,
            refundToken: refundReceiver.address,
            refundAfter: 0,
            refundReceiver: refundReceiver.address,
            refundPrice: 0
        }

        const Contract = await ethers.getContractFactory("SHOVesting");
        contract = await Contract.attach(await factory.callStatic.deploy(params, "0x"));
        await factory.deploy(params, "0x");

        await expect(contract.init(params)).to.be.revertedWith("Initializable");

        expect(await contract.shoToken()).to.equal(shoToken.address);
        expect(await contract.startTime()).to.equal(startTime);
        expect(await contract.feeCollector()).to.equal(feeCollector.address);
        expect(await contract.baseFeePercentage1()).to.equal(baseFee1);

        await whitelistUsers(whitelist, splitWhitelisting);

        await expect(contract.update()).to.be.revertedWith("SHOVesting: before startTime");

        if (shiftToStartTime) {
            await time.increaseTo(startTime);
        }
    }

    const collectFees = async(collectedAll, expectedBaseFee, expectedExtraFee, notFeeCollector) => {
        contract = contract.connect(notFeeCollector ? user1 : feeCollector);
        if (collectedAll) {
            await expect(contract.collectFees()).to.be.revertedWith("SHOVesting: no fees to collect");
            return;
        }

        expectedBaseFee = parseUnits(expectedBaseFee);
        expectedExtraFee = parseUnits(expectedExtraFee);

        const result = await contract.callStatic.collectFees();
        expect(result.baseFee).to.closeTo(expectedBaseFee, PRECISION_LOSS);
        expect(result.extraFee).to.closeTo(expectedExtraFee, PRECISION_LOSS);

        const feeCollectorBalanceBefore = await shoToken.balanceOf(feeCollector.address);
        const contractBalanceBefore = await shoToken.balanceOf(contract.address);
        await contract.collectFees();
        const feeCollectorBalanceAfter = await shoToken.balanceOf(feeCollector.address);
        const contractBalanceAfter = await shoToken.balanceOf(contract.address);

        expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(result.baseFee).sub(result.extraFee))
        expect(feeCollectorBalanceAfter).to.equal(feeCollectorBalanceBefore.add(result.baseFee).add(result.extraFee));
    }

    const claim1 = async(
        user,
        nothingToClaim,
        expectedClaimed
    ) => {
        contract = contract.connect(user);

        if (nothingToClaim) {
            await expect(contract.functions["claimUser1()"]()).to.be.revertedWith("SHOVesting: nothing to claim");
            return;
        }

        expectedClaimed = parseUnits(expectedClaimed);

        const amountToClaim = await contract.callStatic["claimUser1()"]();
        expect(amountToClaim).to.closeTo(expectedClaimed, PRECISION_LOSS);

        const userBalanceBefore = await shoToken.balanceOf(user.address);
        const userInfoBefore = await contract.users1(user.address);
        await contract.functions["claimUser1()"]();
        const userBalanceAfter = await shoToken.balanceOf(user.address);
        const userInfoAfter = await contract.users1(user.address);
        const passedUnlocksCount = await contract.getPassedUnlocksCount();
        expect(userBalanceAfter).to.equal(userBalanceBefore.add(amountToClaim));

        expect(userInfoBefore.allocation).to.equal(userInfoAfter.allocation);
        if (userInfoAfter.eliminatedAfterUnlock == 0) {
            expect(userInfoAfter.claimedUnlocksCount).to.equal(passedUnlocksCount);
        } else {
            expect(userInfoAfter.claimedUnlocksCount).to.equal(userInfoAfter.eliminatedAfterUnlock);
        }
    }

    const eliminate = async(
        user, 
        eliminatedAlready,
        expectedExtraFee1Allocation,
        expectedExtraFee1AllocationUncollectable
    ) => {
        contract = contract.connect(owner);

        if (eliminatedAlready) {
            await expect(contract.eliminateUsers1([user.address])).to.be.revertedWith("SHOVesting: some user already eliminated");
            return;
        }

        expectedExtraFee1Allocation = parseUnits(expectedExtraFee1Allocation);
        expectedExtraFee1AllocationUncollectable = parseUnits(expectedExtraFee1AllocationUncollectable);

        const contractBalanceBefore = await shoToken.balanceOf(contract.address);
        const userInfoBefore = await contract.users1(user.address);
        const extraFees1AllocationBefore = await contract.extraFees1Allocation();
        const extraFees1AllocationUncollectableBefore = await contract.extraFees1AllocationUncollectable();
        await contract.eliminateUsers1([user.address]);
        const contractBalanceAfter = await shoToken.balanceOf(contract.address);
        const userInfoAfter = await contract.users1(user.address);
        const passedUnlocksCount = await contract.getPassedUnlocksCount();
        const extraFees1AllocationAfter = await contract.extraFees1Allocation();
        const extraFees1AllocationUncollectableAfter = await contract.extraFees1AllocationUncollectable();
        expect(contractBalanceAfter).to.equal(contractBalanceBefore);

        expect(userInfoBefore.allocation).to.equal(userInfoAfter.allocation);
        expect(userInfoBefore.claimedUnlocksCount).to.equal(userInfoAfter.claimedUnlocksCount);
        expect(userInfoAfter.eliminatedAfterUnlock).to.equal(passedUnlocksCount);
        expect(extraFees1AllocationAfter.sub(extraFees1AllocationBefore)).to.closeTo(expectedExtraFee1Allocation, PRECISION_LOSS);
        expect(extraFees1AllocationUncollectableAfter.sub(extraFees1AllocationUncollectableBefore)).to.closeTo(expectedExtraFee1AllocationUncollectable, PRECISION_LOSS);
    }

    const checkUserInfo = async(
        user,
        expectedTotalUnlocked,
        expectedTotalClaimed,
        expectedUpcomingClaimable,
        expectedVested,
        expectedMinClaimable,
        expectedMaxClaimable
    ) => {
        expectedTotalUnlocked = parseUnits(expectedTotalUnlocked);
        expectedTotalClaimed = parseUnits(expectedTotalClaimed);
        expectedUpcomingClaimable = parseUnits(expectedUpcomingClaimable);
        expectedVested = parseUnits(expectedVested);
        expectedMinClaimable = parseUnits(expectedMinClaimable);
        expectedMaxClaimable = parseUnits(expectedMaxClaimable);

        const res = await contractView.getUserInfo(contract.address, user.address);
        expect(res.totalUnlocked).to.closeTo(expectedTotalUnlocked, PRECISION_LOSS);
        expect(res.totalClaimed).to.closeTo(expectedTotalClaimed, PRECISION_LOSS);
        expect(res.upcomingClaimable).to.closeTo(expectedUpcomingClaimable, PRECISION_LOSS);
        expect(res.vested).to.closeTo(expectedVested, PRECISION_LOSS);
        expect(res.minClaimable).to.closeTo(expectedMinClaimable, PRECISION_LOSS);
        expect(res.maxClaimable).to.closeTo(expectedMaxClaimable, PRECISION_LOSS);
    }

    before(async () => {
        [owner, feeCollector, refundReceiver, user1, user2, user3] = await ethers.getSigners();
        const ContractView = await ethers.getContractFactory("SHOView");
        contractView = await ContractView.deploy();
    });

    describe("Full flow test (option 1 users)", async() => {
        before(async() => {
            await init(
                [500000, 300000, 200000],
                [100, 2592000, 2592000],
                300000,
                {
                    wallets: [user1.address, user2.address, user3.address],
                    allocations: [1000, 1000, 2000]
                }
            );
        });

        it("check reverts", async() => {
            contract = contract.connect(user1);
            await expect(contract.functions["claimUser1()"]()).to.be.revertedWith("SHOVesting: no unlocks passed");

            contract = contract.connect(owner);
            await expect(contract.eliminateUsers1([user1.address])).to.be.revertedWith("SHOVesting: no unlocks passed");

            await checkUserInfo(user1, 0, 0, 350, 700, 0, 0);
            await checkUserInfo(user3, 0, 0, 700, 1400, 0, 0);

            await time.increase(100);

            contract = contract.connect(user1);
            await expect(contract.eliminateUsers1([user2.address])).to.be.revertedWith("Ownable: caller is not the owner");

            contract = contract.connect(owner);
            await expect(contract.eliminateUsers1([feeCollector.address, user2.address])).to.be.revertedWith("SHOVesting: some user not option 1");
        });

        it("first unlock - user 1 claims", async() => {
            await checkUserInfo(user1, 350, 0, 210, 350, 350, 350);
            await claim1(user1, false, 350);
            await checkUserInfo(user1, 350, 350, 210, 350, 0, 0);
            await claim1(user1, true);
        });

        it("first unlock - user 1 is eliminated", async() => {
            await eliminate(user1, false, 700, 350);
            await checkUserInfo(user1, 350, 350, 0, 0, 0, 0);
            await eliminate(user1, true);
        });

        it("first unlock - collecting fees", async() => {
            await collectFees(false, 600, 0, 0);
        });

        it("first unlock - user 2 is eliminated", async() => {
            await eliminate(user2, false, 700, 350);
            await checkUserInfo(user2, 350, 0, 0, 0, 350, 350);
            await eliminate(user2, true);
        });

        it("first unlock - user 2 claims", async() => {
            await claim1(user2, false, 350);
            await checkUserInfo(user2, 350, 350, 0, 0, 0, 0);
            await claim1(user2, true);
        });

        it("second unlock - user 1 and 2 have nothing to claim", async() => {
            await time.increase(2592000);
            await claim1(user1, true);
            await claim1(user2, true);
            await eliminate(user1, true);
            await eliminate(user2, true);
            await checkUserInfo(user2, 350, 350, 0, 0, 0, 0);
        });

        it("second unlock - user 3 claims", async() => {
            await claim1(user3, false, 1120);
            await checkUserInfo(user3, 1120, 1120, 280, 280, 0, 0);
            await claim1(user3, true);
        });

        it("third unlock - collecting fees", async() => {
            await time.increase(2592000);
            await collectFees(false, 600, 700, 210);
            await collectFees(true);
        });
        
        it("third unlock - user 3 cant be eliminated", async() => {
            contract = contract.connect(owner);
            await expect(contract.eliminateUsers1([user3.address])).to.be.revertedWith("SHOVesting: eliminating in the last unlock");
        });

        it("third unlock - user 3 claims", async() => {
            await checkUserInfo(user3, 1400, 1120, 0, 0, 280, 280);
            await claim1(user3, false, 280);
            await checkUserInfo(user3, 1400, 1400, 0, 0, 0, 0);
            await claim1(user3, true);

            await checkUserInfo(user2, 350, 350, 0, 0, 0, 0);

            const contractBalance = await shoToken.balanceOf(contract.address);
            expect(contractBalance).to.equal(0);
        });
    });

    describe("Full flow test 2 (option 1 users)", async() => {
        before(async() => {
            await init(
                [300000, 300000, 200000, 200000],
                [0, 2592000, 2592000, 2592000],
                300000,
                {
                    wallets: [user1.address, user2.address],
                    allocations: [1000, 1000]
                }
            );
        });

        it("first unlock - no activity", async() => {

        });

        it("second unlock - user 1 is eliminated", async() => {
            await time.increase(2592000);
            await checkUserInfo(user1, 420, 0, 140, 280, 420, 420);
            await eliminate(user1, false, 700, 420);
            await checkUserInfo(user1, 420, 0, 0, 0, 420, 420);
            await eliminate(user1, true);
        });

        it("third unlock - user 1 claims", async() => {
            await time.increase(2592000);
            await claim1(user1, false, 420);
            await checkUserInfo(user1, 420, 420, 0, 0, 0, 0);
            await claim1(user1, true);
        });

        it("third unlock - user 2 is eliminated", async() => {
            await checkUserInfo(user2, 560, 0, 140, 140, 560, 560);
            await eliminate(user2, false, 700, 560);
            await checkUserInfo(user2, 560, 0, 0, 0, 560, 560);
            await eliminate(user2, true);

            const eliminated = await contractView.areEliminated(contract.address, [user1.address, user2.address]);
            expect(eliminated[0]).to.equal(2);
            expect(eliminated[1]).to.equal(3);
        });

        it("fourth unlock - user 1 has nothing to claim", async() => {
            await time.increase(2592000);
            await checkUserInfo(user1, 420, 420, 0, 0, 0, 0);
            await claim1(user1, true);
        });

        it("fourth unlock - user 2 claims", async() => {
            await checkUserInfo(user2, 560, 0, 0, 0, 560, 560);
            await claim1(user2, false, 560);
            await checkUserInfo(user2, 560, 560, 0, 0, 0, 0);
            await claim1(user2, true);
        });

        it("fourth unlock - collecting fees", async() => {
            await collectFees(false, 600, 420, 126);
            await collectFees(true);

            const contractBalance = await shoToken.balanceOf(contract.address);
            expect(contractBalance).to.equal(0);
        });
    });

    describe("Fee collector whitelisted", async() => {
        before(async() => {
            await init(
                [500000, 300000, 200000],
                [0, 2592000, 2592000],
                200000,
                {
                    wallets: [user1.address, feeCollector.address],
                    allocations: [1000, 2000]
                },
                18,
                false,
                true,
                true
            );
        });

        it("first unlock - user 1 claims", async() => {
            await claim1(user1, false, 400);
            await collectFees(false, 300, 800, 0, false);
            await collectFees(true);
            await eliminate(user1, false, 800, 400);
        });

        it("second unlock - collecting fees", async() => {
            await time.increase(2592000);
            await claim1(user1, true);
            await collectFees(false, 180, 720, 0, true);
        });

        it("third unlock - collecting fees", async() => {
            await time.increase(2592000);
            await claim1(user1, true);
            await collectFees(false, 120, 480, 0, true);
            await collectFees(true);
        });
    });
});