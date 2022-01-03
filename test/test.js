const { expect } = require("chai");
const { time } = require("@openzeppelin/test-helpers");

describe("SHO smart contract", function() {
    let owner, feeCollector, user1, user2, user3, contract, shoToken, shoTokenDecimals, shoTokenBurnable, burnValley, contractView;

    const PRECISION_LOSS = "10000000000000000";
    
    const parseUnits = (value, decimals = shoTokenDecimals) => {
        return ethers.utils.parseUnits(value.toString(), decimals);
    }

    const whitelistUsers = async(whitelist) => {
        const allocations = whitelist.allocations.map((raw) => parseUnits(raw));

        await expect(contract.whitelistUsers([owner.address], [1, 1], [2, 2])).to.be.revertedWith("SHO: different array lengths");
        await expect(contract.whitelistUsers([], [], [])).to.be.revertedWith("SHO: zero length array");
        await expect(contract.whitelistUsers([owner.address], [1], [0])).to.be.revertedWith("SHO: invalid user option");

        contract = contract.connect(user1); 
        await expect(contract.whitelistUsers(whitelist.wallets, allocations, whitelist.options))
            .to.be.revertedWith("Ownable: caller is not the owner");

        contract = contract.connect(owner); 
        await contract.whitelistUsers(whitelist.wallets, allocations, whitelist.options);
        await expect(contract.whitelistUsers(whitelist.wallets, allocations, whitelist.options.map(option => 1)))
            .to.be.revertedWith("SHO: some users are already whitelisted");
        await expect(contract.whitelistUsers(whitelist.wallets, allocations, whitelist.options.map(option => 2)))
            .to.be.revertedWith("SHO: some users are already whitelisted");


        let globalTotalAllocation = 0;
        for (let i = 0; i < whitelist.wallets.length; i++) {
            const userInfo = await contract[`users${whitelist.options[i]}`](whitelist.wallets[i]);
            expect(userInfo.allocation).to.equal(allocations[i]);

            globalTotalAllocation += whitelist.allocations[i];
        }
        
        await shoToken.transfer(contract.address, parseUnits(globalTotalAllocation));
        await expect(contract.whitelistUsers([owner.address], [1], [2]))
            .to.be.revertedWith("SHO: whitelisting too late");

        expect(await contract.globalTotalAllocation()).to.equal(parseUnits(globalTotalAllocation));
    }

    const testConstructorRequireStatements = async(unlockPercentages, unlockPeriods, baseFee, startTime, burnValley, burnPercentage, freeClaimablePercentage) => {
        const Contract = await ethers.getContractFactory("SHO");

        await expect(Contract.deploy(ethers.constants.AddressZero, unlockPercentages, unlockPeriods, baseFee, feeCollector.address, startTime, burnValley, burnPercentage, freeClaimablePercentage))
            .to.be.revertedWith("SHO: sho token zero address");

        await expect(Contract.deploy(shoToken.address, [], unlockPeriods, baseFee, feeCollector.address, startTime, burnValley, burnPercentage, freeClaimablePercentage))
            .to.be.revertedWith("SHO: 0 unlock percentages");

        const unlockPercentagesMany = new Array(201).fill(0);
        await expect(Contract.deploy(shoToken.address, unlockPercentagesMany, unlockPeriods, baseFee, feeCollector.address, startTime, burnValley, burnPercentage, freeClaimablePercentage))
            .to.be.revertedWith("SHO: too many unlock percentages");  

        await expect(Contract.deploy(shoToken.address, unlockPercentages, unlockPeriods.concat(1000), baseFee, feeCollector.address, startTime, burnValley, burnPercentage, freeClaimablePercentage))
            .to.be.revertedWith("SHO: different array lengths"); 
            
        await expect(Contract.deploy(shoToken.address, unlockPercentages, unlockPeriods, 1e6 + 1, feeCollector.address, startTime, burnValley, burnPercentage, freeClaimablePercentage))
            .to.be.revertedWith("SHO: initial fee percentage higher than 100%"); 
        
        await expect(Contract.deploy(shoToken.address, unlockPercentages, unlockPeriods, baseFee, ethers.constants.AddressZero, startTime, burnValley, burnPercentage, freeClaimablePercentage))
            .to.be.revertedWith("SHO: fee collector zero address"); 

        await expect(Contract.deploy(shoToken.address, unlockPercentages, unlockPeriods, baseFee, feeCollector.address, 10000000, burnValley, burnPercentage, freeClaimablePercentage))
            .to.be.revertedWith("SHO: start time must be in future"); 

        await expect(Contract.deploy(shoToken.address, unlockPercentages, unlockPeriods, baseFee, feeCollector.address, startTime, ethers.constants.AddressZero, burnPercentage, freeClaimablePercentage))
            .to.be.revertedWith("SHO: burn valley zero address"); 

        await expect(Contract.deploy(shoToken.address, unlockPercentages, unlockPeriods, baseFee, feeCollector.address, startTime, burnValley, 1000001, freeClaimablePercentage))
            .to.be.revertedWith("SHO: burn percentage higher than 100%"); 

        await expect(Contract.deploy(shoToken.address, unlockPercentages, unlockPeriods, baseFee, feeCollector.address, startTime, burnValley, burnPercentage, 1000001))
            .to.be.revertedWith("SHO: free claimable percentage higher than 100%"); 

        await expect(Contract.deploy(shoToken.address, [100000, 100000], [1, 1], baseFee, feeCollector.address, startTime, burnValley, burnPercentage, freeClaimablePercentage))
            .to.be.revertedWith("SHO: invalid unlock percentages"); 
    }

    const init = async(unlockPercentages, unlockPeriods, baseFee, whitelist, _shoTokenDecimals = 18, _shoTokenBurnable = false) => {
        shoTokenDecimals = _shoTokenDecimals;
        shoTokenBurnable = _shoTokenBurnable;
        const startTime = Number(await time.latest()) + 300;
        const ERC20Mock = await ethers.getContractFactory(shoTokenBurnable ? "ERC20MockBurnable" : "ERC20Mock");
        shoToken = await ERC20Mock.deploy("MOCK1", "MOCK1", owner.address, parseUnits(100000000), shoTokenDecimals);

        const freeClaimablePercentage = baseFee;
        const BurnValley = await ethers.getContractFactory("BurnValley");
        burnValley = await BurnValley.deploy();
        const burnPercentage = 300000;

        await testConstructorRequireStatements(unlockPercentages, unlockPeriods, baseFee, startTime, burnValley.address, burnPercentage, freeClaimablePercentage);

        const Contract = await ethers.getContractFactory("SHO");
        contract = await Contract.deploy(
            shoToken.address,
            unlockPercentages,
            unlockPeriods,
            baseFee,
            feeCollector.address,
            startTime,
            burnValley.address,
            burnPercentage,
            freeClaimablePercentage
        );

        expect(await contract.shoToken()).to.equal(shoToken.address);
        expect(await contract.startTime()).to.equal(startTime);
        expect(await contract.feeCollector()).to.equal(feeCollector.address);
        expect(await contract.baseFeePercentage()).to.equal(baseFee);

        await whitelistUsers(whitelist);

        await expect(contract.update()).to.be.revertedWith("SHO: before startTime");

        await time.increaseTo(startTime);
    }

    const collectFees = async(collectedAll, expectedBaseFee, expectedExtraFee, expectedBurned) => {
        contract = contract.connect(feeCollector);
        if (collectedAll) {
            await expect(contract.collectFees()).to.be.revertedWith("SHO: no fees to collect");
            return;
        }

        expectedBaseFee = parseUnits(expectedBaseFee);
        expectedExtraFee = parseUnits(expectedExtraFee);
        expectedBurned = parseUnits(expectedBurned);

        const result = await contract.callStatic.collectFees();
        expect(result.baseFee).to.closeTo(expectedBaseFee, PRECISION_LOSS);
        expect(result.extraFee).to.closeTo(expectedExtraFee, PRECISION_LOSS);
        expect(result.burned).to.closeTo(expectedBurned, PRECISION_LOSS);

        const feeCollectorBalanceBefore = await shoToken.balanceOf(feeCollector.address);
        const contractBalanceBefore = await shoToken.balanceOf(contract.address);
        const burnValleyBalanceBefore = await shoToken.balanceOf(burnValley.address);
        await contract.collectFees();
        const feeCollectorBalanceAfter = await shoToken.balanceOf(feeCollector.address);
        const contractBalanceAfter = await shoToken.balanceOf(contract.address);
        const burnValleyBalanceAfter = await shoToken.balanceOf(burnValley.address);

        expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(result.baseFee).sub(result.extraFee))
        expect(feeCollectorBalanceAfter).to.equal(feeCollectorBalanceBefore.add(result.baseFee).add(result.extraFee).sub(result.burned));

        if (!shoTokenBurnable) {
            expect(burnValleyBalanceAfter).to.equal(burnValleyBalanceBefore.add(result.burned));
        } else {
            expect(burnValleyBalanceAfter).to.equal(burnValleyBalanceBefore);
        }
    }

    const claim1 = async(
        user,
        nothingToClaim,
        expectedClaimed
    ) => {
        contract = contract.connect(user);

        if (nothingToClaim) {
            await expect(contract.claimUser1()).to.be.revertedWith("SHO: nothing to claim");
            return;
        }

        expectedClaimed = parseUnits(expectedClaimed);

        const amountToClaim = await contract.callStatic.claimUser1();
        expect(amountToClaim).to.closeTo(expectedClaimed, PRECISION_LOSS);

        const userBalanceBefore = await shoToken.balanceOf(user.address);
        const userInfoBefore = await contract.users1(user.address);
        await contract.claimUser1();
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

    const claim2 = async(
        user,
        nothingToClaim,
        extraAmount,
        passedExtraAmountTooHigh,
        expectedClaimed,
        expectedBaseClaimed,
        expectedCurrentUnlocked,
        expectedDebt
    ) => {
        contract = contract.connect(user);

        if (nothingToClaim) {
            await expect(contract.claimUser2(0)).to.be.revertedWith("SHO: nothing to claim");
            return;
        }

        extraAmount = parseUnits(extraAmount);
        if (passedExtraAmountTooHigh) {
            await expect(contract.claimUser2(extraAmount)).to.be.revertedWith("SHO: passed extra amount too high");
            return;
        }

        expectedClaimed = parseUnits(expectedClaimed);
        expectedBaseClaimed = parseUnits(expectedBaseClaimed);
        expectedCurrentUnlocked = parseUnits(expectedCurrentUnlocked);
        expectedDebt = parseUnits(expectedDebt);

        const result = await contract.callStatic.claimUser2(extraAmount);
        expect(result.amountToClaim).to.closeTo(expectedClaimed, PRECISION_LOSS);
        expect(result.baseClaimAmount).to.closeTo(expectedBaseClaimed, PRECISION_LOSS);
        expect(result.currentUnlocked).to.closeTo(expectedCurrentUnlocked, PRECISION_LOSS);

        const userBalanceBefore = await shoToken.balanceOf(user.address);
        const userInfoBefore = await contract.users2(user.address);
        await contract.claimUser2(extraAmount);
        const userBalanceAfter = await shoToken.balanceOf(user.address);
        const userInfoAfter = await contract.users2(user.address);
        const passedUnlocksCount = await contract.getPassedUnlocksCount();
        expect(userBalanceAfter).to.equal(userBalanceBefore.add(result.amountToClaim));

        expect(userInfoBefore.allocation).to.equal(userInfoAfter.allocation);
        expect(userInfoAfter.claimedUnlocksCount).to.equal(passedUnlocksCount);
        expect(userInfoAfter.currentUnlocked).to.equal(result.currentUnlocked);

        if (userInfoBefore.claimedUnlocksCount < userInfoAfter.claimedUnlocksCount) {
            expect(userInfoAfter.currentClaimed).to.equal(result.baseClaimAmount.add(extraAmount));
        } else {
            expect(userInfoAfter.currentClaimed).to.equal(userInfoBefore.currentClaimed.add(extraAmount));
        }

        expect(userInfoAfter.debt).to.closeTo(expectedDebt, PRECISION_LOSS);
    }

    const checkStats2 = async(
        user,
        expectedTotalClaimed,
        expectedTotalUnlocked
    ) => {
        expectedTotalClaimed = parseUnits(expectedTotalClaimed);
        expectedTotalUnlocked = parseUnits(expectedTotalUnlocked);
        const userInfo = await contract.users2(user.address);
        expect(userInfo.totalClaimed).to.closeTo(expectedTotalClaimed, PRECISION_LOSS);
        expect(userInfo.totalUnlocked).to.closeTo(expectedTotalUnlocked, PRECISION_LOSS);
    }

    const eliminate = async(
        user, 
        eliminatedAlready,
        expectedExtraFee1Allocation,
        expectedExtraFee1AllocationUncollectable
    ) => {
        contract = contract.connect(owner);

        if (eliminatedAlready) {
            await expect(contract.eliminateUsers1([user.address])).to.be.revertedWith("SHO: some user already eliminated");
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
        [owner, feeCollector, user1, user2, user3] = await ethers.getSigners();
        const ContractView = await ethers.getContractFactory("SHOView");
        contractView = await ContractView.deploy();
    });

    describe("Full flow test (option 2 users)", async() => {
        before(async() => {
            await init(
                [500000, 300000, 200000],
                [100, 2592000, 2592000],
                300000,
                {
                    wallets: [user1.address, user2.address, user3.address],
                    allocations: [1000, 1000, 2000],
                    options: [2, 2, 2]
                },
                18, true
            );
        });

        it("check reverts", async() => {
            contract = contract.connect(user1);
            await expect(contract.claimUser2(0)).to.be.revertedWith("SHO: no unlocks passed");
            await time.increase(100);

            contract = contract.connect(feeCollector);
            await expect(contract.claimUser2(0)).to.be.revertedWith("SHO: caller is not whitelisted or does not have the correct option");

            contract = contract.connect(user1);
            await expect(contract.claimUser1()).to.be.revertedWith("SHO: caller is not whitelisted or does not have the correct option");
            
            await expect(contract.collectFees()).to.be.revertedWith("SHO: caller is not the fee collector");

            await expect(contractView.getUserInfo(contract.address, owner.address)).to.be.revertedWith("");
        });

        it("check private non-view functions", async() => {
            expect(contract["burn"]).to.equal(undefined);
            expect(contract["chargeFee"]).to.equal(undefined);
            expect(contract["_burn"]).to.equal(undefined);
            expect(contract["_chargeFee"]).to.equal(undefined);
        });
        
        it("first unlock - user 1 claims", async() => {
            await checkUserInfo(user1, 350, 0, 210, 350, 105, 350);
                
            await claim2(user1, false, 0, false, 105, 105, 350, 0);
            await checkUserInfo(user1, 350, 105, 210, 350, 0, 245);
            
            await claim2(user1, true);
            await claim2(user1, false, 350 - 105 + 1, true);
            await claim2(user1, false, 350 - 105, false, 245, 0, 350, 245);
            await checkUserInfo(user1, 350, 350, 0, 105, 0, 0);

            await claim2(user1, true);
            await claim2(user1, false, 1, true);
            await claim2(user1, false, 10000000, true);

            await checkStats2(user1, 350, 350);
        });

        it("first unlock - user 2 claims", async() => {
            await claim2(user2, false, 246, true);
            await claim2(user2, false, 245, false, 350, 105, 350, 245);
            
            await checkStats2(user2, 350, 350);
        });

        it("first unlock - collecting fees", async() => {
            await collectFees(false, 600, 0, 0);
            await collectFees(true);
        });

        it("second unlock - collecting fees", async() => {
            await time.increase(2592000);
            await collectFees(false, 360, 420, 126);
            await collectFees(true);
        });

        it("second unlock - user 2 and 1 has nothing to claim", async() => {
            await checkUserInfo(user1, 350, 350, 105, 105, 0, 0);

            await claim2(user1, true);
            await claim2(user1, true, 100, true);

            await claim2(user2, true);
            await claim2(user2, true, 100, true);

            await checkStats2(user1, 350, 350);
            await checkStats2(user2, 350, 350);
        });

        it("second unlock - user 3 claims", async() => {
            await checkUserInfo(user3, 1120, 0, 280, 280, 826, 1120);

            await claim2(user3, false, 0, false, 700 + 126, 126, 420, 0);
            await checkUserInfo(user3, 1120, 826, 280, 280, 0, 294);
            await claim2(user3, true);

            await checkStats2(user3, 826, 1120);
        });

        it("third unlock - user 1 claims", async() => {
            await time.increase(2592000);

            await checkUserInfo(user1, 455, 350, 0, 0, 105, 105);

            await claim2(user1, false, 1, true);
            await claim2(user1, false, 0, false, 105, 105, 105, 0);
            await checkUserInfo(user1, 455, 455, 0, 0, 0, 0);
            await claim2(user1, true);
            await claim2(user1, false, 1, true);

            await checkStats2(user1, 455, 455);
        });

        it("third unlock - user 2 claims", async() => {
            await claim2(user2, false, 0, false, 105, 105, 105, 0);
            await claim2(user2, true);

            await checkStats2(user2, 455, 455);
        });

        it("third unlock - collecting fees", async() => {
            await collectFees(false, 240, 70, 21);
            await collectFees(true);
        });

        it("third unlock - user 3 claims", async() => {
            await checkUserInfo(user3, 1400, 826, 0, 0, 574, 574)
            await claim2(user3, false, 0, false, 294 + 280, 280, 280, 0);
            await checkUserInfo(user3, 1400, 1400, 0, 0, 0, 0);
            await claim2(user3, true);

            await checkStats2(user3, 1400, 1400);

            const contractBalance = await shoToken.balanceOf(contract.address);
            expect(contractBalance).to.equal(0);
        });
    });

    describe("Full flow test 2 (option 2 users)", async() => {
        before(async() => {
            await init(
                [400000, 300000, 200000, 100000],
                [0, 5184000, 2592000, 2592000],
                300000,
                {
                    wallets: [user1.address, user2.address, user3.address],
                    allocations: [1000, 2000, 3000],
                    options: [2, 2, 2]
                }
            );
        });

        it("first unlock - user 1 claims", async() => {
            await checkUserInfo(user1, 280, 0, 210, 420, 84, 280);
            await claim2(user1, false, 100, false, 184, 84, 280, 100);
            await checkUserInfo(user1, 280, 184, 110, 320, 0, 96);
            await claim2(user1, true);
            await claim2(user1, false, 100, true);

            await checkStats2(user1, 184, 280);
        });

        it("first unlock - user 2 claims", async() => {
            await checkUserInfo(user2, 560, 0, 420, 840, 168, 560);
            await claim2(user2, false, 100, false, 268, 168, 560, 100);
            await checkUserInfo(user2, 560, 268, 320, 740, 0, 292);
            await claim2(user2, false, 100, false, 100, 0, 560, 200);
            await checkUserInfo(user2, 560, 368, 220, 640, 0, 192);
            await claim2(user2, false, 200, true);

            await checkStats2(user2, 368, 560);
        });

        it("second unlock - user 1 claims", async() => {
            await time.increase(5184000);
            
            await checkUserInfo(user1, 390, 184, 140, 210, 61.8, 206);
            await claim2(user1, false, 100, false, 161.8, 61.8, 206, 100);
            await checkUserInfo(user1, 390, 345.8, 40, 110, 0, 44.2);
            await claim2(user1, true);

            await checkStats2(user1, 345.8, 390);
        });

        it("second unlock - user 3 claims", async() => {
            await checkUserInfo(user3, 1470, 0, 420, 630, 1029, 1470);
            await claim2(user3, false, 0, false, 189 + 840, 189, 630, 0);
            await checkUserInfo(user3, 1470, 1029, 420, 630, 0, 441);
            await checkStats2(user3, 189 + 840, 1470);

            await claim2(user3, false, 1000, true);
            await claim2(user3, false, 100, false, 100, 0, 630, 100);
            await checkUserInfo(user3, 1470, 1129, 320, 530, 0, 341);
            await checkStats2(user3, 189 + 840 + 100, 1470);
        });

        it("second unlock - collecting fees", async() => {
            await collectFees(false, 1260, 300, 90);
            await collectFees(true);
        });

        it("third unlock - no activity", async() => {
            await time.increase(2592000);
        });

        it("fourth unlock - collecting fees", async() => {
            await time.increase(2592000);

            await collectFees(false, 540, 200, 60);
            await collectFees(true);
        });

        it("fourth unlock - user 3 claims", async() => {
            await claim2(user3, false, 1, true);
            await checkUserInfo(user3, 2000, 1129, 0, 0, 871, 871);
            await claim2(user3, false, 0, false, 871, 210, 210, 0);
            await checkUserInfo(user3, 2000, 2000, 0, 0, 0, 0);
            await claim2(user3, true);

            await checkStats2(user3, 2000, 2000);
        });

        it("fourth unlock - user 2 claims", async() => {
            await claim2(user2, false, 1, true);
            await checkUserInfo(user2, 1200, 368, 0, 0, 832, 832);
            await claim2(user2, false, 0, false, 832, 140, 140, 0);
            await checkUserInfo(user2, 1200, 1200, 0, 0, 0, 0);
            await claim2(user2, true);

            await checkStats2(user2, 1200, 1200);
        });

        it("fourth unlock - user 1 claims", async() => {
            await claim2(user1, false, 1, true);
            await checkUserInfo(user1, 500, 345.8, 0, 0, 154.2, 154.2);
            await claim2(user1, false, 0, false, 154.2, 70, 70, 0);
            await checkUserInfo(user1, 500, 500, 0, 0, 0, 0);
            await claim2(user1, true); 

            await checkStats2(user1, 500, 500);
            
            const contractBalance = await shoToken.balanceOf(contract.address);
            expect(contractBalance).to.equal(0);
        });
    });

    describe("Special situation (option 2 users)", async() => {
        before(async() => {
            await init(
                [900000, 100000],
                [0, 1000],
                300000,
                {
                    wallets: [user1.address],
                    allocations: [1000],
                    options: [2]
                }
            );
        });

        it("first unlock - user 1 claims all available", async() => {
            await claim2(user1, false, 441, false, 630, 189, 630, 441);
            await claim2(user1, true);
            await claim2(user1, false, 1, true);

            await checkStats2(user1, 630, 630);
        });

        it("second unlock - user 1 has nothing to claim", async() => {
            await time.increase(1000);
            await claim2(user1, true);
            await claim2(user1, false, 1, true);
        });

        it("second unlock - collecting fees", async() => {
            await collectFees(false, 300, 70, 21);
            await collectFees(true);

            const contractBalance = await shoToken.balanceOf(contract.address);
            expect(contractBalance).to.equal(0);
        });
    });

    describe("Special situation (option 2 users)", async() => {
        before(async() => {
            await init(
                [900000, 100000],
                [0, 1000],
                300000,
                {
                    wallets: [user1.address],
                    allocations: [1000000],
                    options: [2]
                }
            );
        });

        it("first unlock - no activity", async() => {
        });

        it("second unlock - user 1 claims", async() => {
            await time.increase(1000);
            await claim2(user1, false, 0, false, 700000, 70000, 70000, 0);
            await checkStats2(user1, 700000, 700000);
        });

        it("second unlock - collecting fees", async() => {
            await collectFees(false, 300000, 0, 0);
            await collectFees(true);
        });
    });

    describe("Full flow test (option 1 users)", async() => {
        before(async() => {
            await init(
                [500000, 300000, 200000],
                [100, 2592000, 2592000],
                300000,
                {
                    wallets: [user1.address, user2.address, user3.address],
                    allocations: [1000, 1000, 2000],
                    options: [1, 1, 1]
                }
            );
        });

        it("check reverts", async() => {
            contract = contract.connect(user1);
            await expect(contract.claimUser1()).to.be.revertedWith("SHO: no unlocks passed");

            contract = contract.connect(owner);
            await expect(contract.eliminateUsers1([user1.address])).to.be.revertedWith("SHO: no unlocks passed");

            await time.increase(100);

            contract = contract.connect(user1);
            await expect(contract.eliminateUsers1([user2.address])).to.be.revertedWith("Ownable: caller is not the owner");

            contract = contract.connect(owner);
            await expect(contract.eliminateUsers1([feeCollector.address, user2.address])).to.be.revertedWith("SHO: some user not option 1");
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
            await expect(contract.eliminateUsers1([user3.address])).to.be.revertedWith("SHO: eliminating in the last unlock");
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
                    allocations: [1000, 1000],
                    options: [1, 1]
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

    describe("Full flow test (mixed options)", async() => {
        before(async() => {
            await init(
                [500000, 300000, 200000],
                [0, 2592000, 2592000],
                300000,
                {
                    wallets: [user1.address, user2.address],
                    allocations: [1000, 1000],
                    options: [2, 1]
                }
            );
        });

        it("first unlock - user 1 claims", async() => {
            await claim2(user1, false, 0, false, 105, 105, 350, 0);
            await claim2(user1, true);
            await claim2(user1, false, 100, false, 100, 0, 350, 100);
            await claim2(user1, false, 146, true);

            await checkStats2(user1, 205, 350);
        });

        it("first unlock - user 2 claims", async() => {
            await claim1(user2, false, 350);
            await claim1(user2, true); 
        });

        it("second unlock - user 1 claims", async() => {
            await time.increase(2592000);
            await claim2(user1, false, 0, false, 108, 63, 210, 0);
            await claim2(user1, true);

            await checkStats2(user1, 313, 460);
        });

        it("second unlock - user 2 is eliminated", async() => {
            await eliminate(user2, false, 700, 560);
            await eliminate(user2, true);
        });

        it("second unlock - collecting fees", async() => {
            await collectFees(false, 480, 100, 30);
            await collectFees(true);
        });

        it("third unlock - user 2 claims", async() => {
            await time.increase(2592000);
            await claim1(user2, false, 210);
            await claim1(user2, true);
        }); 

        it("third unlock - user 1 claims", async() => {
            await claim2(user1, false, 0, false, 287, 140, 140, 0);
            await claim2(user1, true);

            await checkStats2(user1, 600, 600);
        });

        it("third unlock - collecting fees", async() => {
            await collectFees(false, 120, 140, 42);
            await collectFees(true);

            const contractBalance = await shoToken.balanceOf(contract.address);
            expect(contractBalance).to.equal(0);
        });
    });
});