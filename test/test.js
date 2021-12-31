const { expect } = require("chai");
const { time } = require("@openzeppelin/test-helpers");

describe("SHO smart contract", function() {
    let owner, feeCollector, user1, user2, user3, contract, shoToken, shoTokenDecimals;

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
        await expect(contract.whitelistUsers(whitelist.wallets, allocations, whitelist.options))
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

    const testConstructorRequireStatements = async(unlockPercentages, unlockPeriods, baseFee, startTime) => {
        const Contract = await ethers.getContractFactory("SHO");

        await expect(Contract.deploy(ethers.constants.AddressZero, unlockPercentages, unlockPeriods, baseFee, feeCollector.address, startTime))
            .to.be.revertedWith("SHO: sho token zero address");

        await expect(Contract.deploy(shoToken.address, [], unlockPeriods, baseFee, feeCollector.address, startTime))
            .to.be.revertedWith("SHO: 0 unlock percentages");

        const unlockPercentagesMany = new Array(201).fill(0);
        await expect(Contract.deploy(shoToken.address, unlockPercentagesMany, unlockPeriods, baseFee, feeCollector.address, startTime))
            .to.be.revertedWith("SHO: too many unlock percentages");  

        await expect(Contract.deploy(shoToken.address, unlockPercentages, unlockPeriods.concat(1000), baseFee, feeCollector.address, startTime))
            .to.be.revertedWith("SHO: different array lengths"); 
            
        await expect(Contract.deploy(shoToken.address, unlockPercentages, unlockPeriods, 1e6 + 1, feeCollector.address, startTime))
            .to.be.revertedWith("SHO: initial fee percentage higher than 100%"); 
        
        await expect(Contract.deploy(shoToken.address, unlockPercentages, unlockPeriods, baseFee, ethers.constants.AddressZero, startTime))
            .to.be.revertedWith("SHO: fee collector zero address"); 

        await expect(Contract.deploy(shoToken.address, unlockPercentages, unlockPeriods, baseFee, feeCollector.address, 10000000))
            .to.be.revertedWith("SHO: start time must be in future"); 

        await expect(Contract.deploy(shoToken.address, [100000, 100000], [1, 1], baseFee, feeCollector.address, startTime))
            .to.be.revertedWith("SHO: invalid unlock percentages"); 
    }

    const init = async(unlockPercentages, unlockPeriods, baseFee, whitelist, shoTokenDecimals = 18) => {
        const startTime = Number(await time.latest()) + 300;
        const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
        shoToken = await ERC20Mock.deploy("MOCK1", "MOCK1", owner.address, parseUnits(100000000), shoTokenDecimals);

        await testConstructorRequireStatements(unlockPercentages, unlockPeriods, baseFee, startTime);

        const Contract = await ethers.getContractFactory("SHO");
        contract = await Contract.deploy(
            shoToken.address,
            unlockPercentages,
            unlockPeriods,
            baseFee,
            feeCollector.address,
            startTime
        );

        expect(await contract.shoToken()).to.equal(shoToken.address);
        expect(await contract.startTime()).to.equal(startTime);
        expect(await contract.feeCollector()).to.equal(feeCollector.address);
        expect(await contract.baseFeePercentage()).to.equal(baseFee);
        expect(await contract.passedUnlocksCount()).to.equal(0);

        await whitelistUsers(whitelist);

        await expect(contract.update()).to.be.revertedWith("SHO: before startTime");

        await time.increaseTo(startTime);
    }

    const collectFees = async(collectedAll, expectedBaseFee, expectedExtraFee) => {
        contract = contract.connect(feeCollector);
        if (collectedAll) {
            await expect(contract.collectFees()).to.be.revertedWith("SHO: no fees to collect");
            return;
        }

        expectedBaseFee = parseUnits(expectedBaseFee);
        expectedExtraFee = parseUnits(expectedExtraFee);

        const result = await contract.callStatic.collectFees();
        expect(result.baseFee).to.closeTo(expectedBaseFee, PRECISION_LOSS);
        expect(result.extraFee).to.closeTo(expectedExtraFee, PRECISION_LOSS);

        const collectorBalanceBefore = await shoToken.balanceOf(feeCollector.address);
        await contract.collectFees();
        const collectorBalanceAfter = await shoToken.balanceOf(feeCollector.address);
        expect(collectorBalanceAfter).to.equal(collectorBalanceBefore.add(result.baseFee).add(result.extraFee));
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
        const passedUnlocksCount = await contract.passedUnlocksCount();
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
        expectedAvailable,
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
        expectedAvailable = parseUnits(expectedAvailable);
        expectedDebt = parseUnits(expectedDebt);

        const result = await contract.callStatic.claimUser2(extraAmount);
        expect(result.amountToClaim).to.closeTo(expectedClaimed, PRECISION_LOSS);
        expect(result.baseClaimAmount).to.closeTo(expectedBaseClaimed, PRECISION_LOSS);
        expect(result.availableAmount).to.closeTo(expectedAvailable, PRECISION_LOSS);

        const userBalanceBefore = await shoToken.balanceOf(user.address);
        const userInfoBefore = await contract.users2(user.address);
        await contract.claimUser2(extraAmount);
        const userBalanceAfter = await shoToken.balanceOf(user.address);
        const userInfoAfter = await contract.users2(user.address);
        const passedUnlocksCount = await contract.passedUnlocksCount();
        expect(userBalanceAfter).to.equal(userBalanceBefore.add(result.amountToClaim));

        expect(userInfoBefore.allocation).to.equal(userInfoAfter.allocation);
        expect(userInfoAfter.claimedUnlocksCount).to.equal(passedUnlocksCount);
        expect(userInfoAfter.currentAvailable).to.equal(result.availableAmount);

        if (userInfoBefore.claimedUnlocksCount < userInfoAfter.claimedUnlocksCount) {
            expect(userInfoAfter.currentClaimed).to.equal(result.baseClaimAmount.add(extraAmount));
        } else {
            expect(userInfoAfter.currentClaimed).to.equal(userInfoBefore.currentClaimed.add(extraAmount));
        }

        expect(userInfoAfter.debt).to.closeTo(expectedDebt, PRECISION_LOSS);
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
        const passedUnlocksCount = await contract.passedUnlocksCount();
        const extraFees1AllocationAfter = await contract.extraFees1Allocation();
        const extraFees1AllocationUncollectableAfter = await contract.extraFees1AllocationUncollectable();
        expect(contractBalanceAfter).to.equal(contractBalanceBefore);

        expect(userInfoBefore.allocation).to.equal(userInfoAfter.allocation);
        expect(userInfoBefore.claimedUnlocksCount).to.equal(userInfoAfter.claimedUnlocksCount);
        expect(userInfoAfter.eliminatedAfterUnlock).to.equal(passedUnlocksCount);
        expect(extraFees1AllocationAfter.sub(extraFees1AllocationBefore)).to.closeTo(expectedExtraFee1Allocation, PRECISION_LOSS);
        expect(extraFees1AllocationUncollectableAfter.sub(extraFees1AllocationUncollectableBefore)).to.closeTo(expectedExtraFee1AllocationUncollectable, PRECISION_LOSS);
    }

    before(async () => {
        [owner, feeCollector, user1, user2, user3] = await ethers.getSigners();
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
                }
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
        });
        
        it("first unlock - user 1 claims", async() => {
            await claim2(user1, false, 0, false, 105, 105, 350, 0);
            await claim2(user1, true);
            await claim2(user1, false, 350 - 105 + 1, true);
            await claim2(user1, false, 350 - 105, false, 245, 0, 350, 245);
            await claim2(user1, true);
            await claim2(user1, true, 100);
        });

        it("first unlock - user 2 claims", async() => {
            await claim2(user2, false, 245, false, 350, 105, 350, 245);
        });

        it("first unlock - collecting fees", async() => {
            await collectFees(false, 600, 0);
            await collectFees(true);
        });

        it("second unlock - collecting fees", async() => {
            await time.increase(2592000);
            await collectFees(false, 360, 420);
            await collectFees(true);
        });

        it("second unlock - user 2 and 1 has nothing to claim", async() => {
            await claim2(user1, true);
            await claim2(user1, true, 100, true);

            await claim2(user2, true);
            await claim2(user2, true, 100, true);
        });

        it("second unlock - user 3 claims", async() => {
            await claim2(user3, false, 0, false, 700 + 126, 126, 420, 0);
            await claim2(user3, true);
        });

        it("third unlock - user 1 claims", async() => {
            await time.increase(2592000);

            await claim2(user1, false, 1, true);
            await claim2(user1, false, 0, false, 105, 105, 105, 0);
            await claim2(user1, true);
            await claim2(user1, false, 1, true);
        });

        it("third unlock - user 2 claims", async() => {
            await claim2(user2, false, 0, false, 105, 105, 105, 0);
            await claim2(user2, true);
        });

        it("third unlock - collecting fees", async() => {
            await collectFees(false, 240, 70);
            await collectFees(true);
        });

        it("third unlock - user 3 claims", async() => {
            await claim2(user3, false, 0, false, 294 + 280, 280, 280, 0);
            await claim2(user3, true);

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
        });

        it("second unlock - user 1 has nothing to claim", async() => {
            await time.increase(1000);
            await claim2(user1, true);
        });

        it("second unlock - collecting fees", async() => {
            await collectFees(false, 300, 70);
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
                    allocations: [1000],
                    options: [2]
                }
            );
        });

        it("first unlock - no activity", async() => {
        });

        it("second unlock - user 1 claims", async() => {
            await time.increase(1000);
            await claim2(user1, false, 0, false, 700, 70, 70, 0);
        });

        it("second unlock - collecting fees", async() => {
            await collectFees(false, 300, 0);
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
            await claim1(user1, false, 350);
            await claim1(user1, true);
        });

        it("first unlock - user 1 is eliminated", async() => {
            await eliminate(user1, false, 700, 350);
            await eliminate(user1, true);
        });

        it("first unlock - collecting fees", async() => {
            await collectFees(false, 600, 0);
        });

        it("first unlock - user 2 is eliminated", async() => {
            await eliminate(user2, false, 700, 350);
            await eliminate(user2, true);
        });

        it("first unlock - user 2 claims", async() => {
            await claim1(user2, false, 350);
            await claim1(user2, true);
        });

        it("second unlock - user 1 and 2 have nothing to claim", async() => {
            await time.increase(2592000);
            await claim1(user1, true);
            await claim1(user2, true);
            await eliminate(user1, true);
            await eliminate(user2, true);
        });

        it("second unlock - user 3 claims", async() => {
            await claim1(user3, false, 1120);
            await claim1(user3, true);
        });

        it("third unlock - collecting fees", async() => {
            await time.increase(2592000);
            await collectFees(false, 600, 700);
            await collectFees(true);
        });
        
        it("third unlock - user 3 cant be eliminated", async() => {
            contract = contract.connect(owner);
            await expect(contract.eliminateUsers1([user3.address])).to.be.revertedWith("SHO: eliminating in the last unlock");
        });

        it("third unlock - user 3 claims", async() => {
            await claim1(user3, false, 280);
            await claim1(user3, true);

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
            await eliminate(user1, false, 700, 420);
            await eliminate(user1, true);
        });

        it("third unlock - user 1 claims", async() => {
            await time.increase(2592000);
            await claim1(user1, false, 420);
            await claim1(user1, true);
        });

        it("third unlock - user 2 is eliminated", async() => {
            await eliminate(user2, false, 700, 560);
            await eliminate(user2, true);
        });

        it("fourth unlock - user 1 has nothing to claim", async() => {
            await time.increase(2592000);
            await claim1(user1, true);
        });

        it("fourth unlock - user 2 claims", async() => {
            await claim1(user2, false, 560);
            await claim1(user2, true);
        });

        it("fourth unlock - collecting fees", async() => {
            await collectFees(false, 600, 420);
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
        });

        it("first unlock - user 2 claims", async() => {
            await claim1(user2, false, 350);
            await claim1(user2, true); 
        });

        it("second unlock - user 1 claims", async() => {
            await time.increase(2592000);
            await claim2(user1, false, 0, false, 108, 63, 210, 0);
            await claim2(user1, true);
        });

        it("second unlock - user 2 is eliminated", async() => {
            await eliminate(user2, false, 700, 560);
            await eliminate(user2, true);
        });

        it("second unlock - collecting fees", async() => {
            await collectFees(false, 480, 100);
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
        });

        it("third unlock - collecting fees", async() => {
            await collectFees(false, 120, 140);
            await collectFees(true);

            const contractBalance = await shoToken.balanceOf(contract.address);
            expect(contractBalance).to.equal(0);
        });
    });
});