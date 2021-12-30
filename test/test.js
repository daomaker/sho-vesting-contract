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


        let globalTotalAllocation1 = 0;
        let globalTotalAllocation2 = 0;
        for (let i = 0; i < whitelist.wallets.length; i++) {
            const userInfo = await contract[`users${whitelist.options[i]}`](whitelist.wallets[i]);
            expect(userInfo.allocation).to.equal(allocations[i]);

            if (whitelist.options[i] == 1) {
                globalTotalAllocation1 += whitelist.allocations[i];
            } else {
                globalTotalAllocation2 += whitelist.allocations[i];
            }
        }
        
        await shoToken.transfer(contract.address, parseUnits(globalTotalAllocation1));
        await shoToken.transfer(contract.address, parseUnits(globalTotalAllocation2));
        await expect(contract.whitelistUsers([owner.address], [1], [2]))
            .to.be.revertedWith("SHO: whitelisting too late");

        expect(await contract.globalTotalAllocation1()).to.equal(parseUnits(globalTotalAllocation1));
        expect(await contract.globalTotalAllocation2()).to.equal(parseUnits(globalTotalAllocation2));
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
        eliminatedAlready
    ) => {
        contract = contract.connect(owner);

        if (eliminatedAlready) {
            await expect(contract.eliminateOption1Users([user.address])).to.be.revertedWith("SHO: some user already eliminated");
            return;
        }

        const contractBalanceBefore = await shoToken.balanceOf(contract.address);
        const userInfoBefore = await contract.users(user.address);
        await contract.eliminateOption1Users([user.address]);
        const contractBalanceAfter = await shoToken.balanceOf(contract.address);
        const userInfoAfter = await contract.users(user.address);
        expect(contractBalanceAfter).to.equal(contractBalanceBefore);

        expect(userInfoBefore.allocation).to.equal(userInfoAfter.allocation);
        expect(userInfoAfter.feePercentageCurrentUnlock).to.equal(userInfoBefore.feePercentageCurrentUnlock);
        expect(userInfoAfter.feePercentageNextUnlock).to.equal(1e6);
        expect(userInfoAfter.totalClaimed).to.equal(userInfoBefore.totalClaimed);
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

            /*contract = contract.connect(owner);
            await expect(contract.eliminateOption1Users([user1.address])).to.be.revertedWith("SHO: no unlocks passed");

            await time.increase(100);

            contract = contract.connect(user1);
            await expect(contract.eliminateOption1Users([user2.address])).to.be.revertedWith("Ownable: caller is not the owner");

            contract = contract.connect(owner);
            await expect(contract.eliminateOption1Users([user3.address])).to.be.revertedWith("SHO: some user not option 1");
            await expect(contract.eliminateOption1Users([feeCollector.address, user2.address])).to.be.revertedWith("SHO: some user not option 1");*/
        });
        
        it("first unlock - user 1 claims", async() => {
            await claim2(user1, false, 0, false, 105, 105, 350, 0);
            await claim2(user1, true);
            await claim2(user1, false, 350 - 105 + 1, true);
            await claim2(user1, false, 350 - 105, false, 245, 0, 350, 245);
            await claim2(user1, true);
            await claim2(user1, true, 100);
        });

        it("first unlock - user 1 claims", async() => {
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

        it("second unlock - user 2 has nothing to claim", async() => {
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
});