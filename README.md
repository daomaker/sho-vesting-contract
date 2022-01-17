# Overview
The smart contract will be used for both Public and DAO SHOs on DAO Maker. Winners are whitelisted and can claim based on the defined vesting schedule. The vesting schedule has X unlocks, where each unlock has a given unlock time and unlock percentage.

Winners of the Public SHOs can choose between option 1 and 2. 
- If they choose option 1, they need to buy some DAO tokens in a given period and can't sell it, otherwise their allocaiton from future unlocks will be removed. The removed allocation is claimable by the *fee collector.
- If they choose option 2, they don't need to have any DAO. However, they can't claim full unlocks for free, they can claim only a defined percentage of the current unlock. Claiming more than the defined percentage causes a fee. The fee is applied in the first upcoming unlocks.