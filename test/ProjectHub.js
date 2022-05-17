const { solidity } = require("ethereum-waffle");
const chai = require("chai");
const { expect, assert } = require("chai");
const { ethers } = require("hardhat");
const { BigNumber } = ethers;

chai.use(solidity);

let projectHub;
let testToken;
let testToken2;
let owner;
let user1;
let user2;
let zeroAddress ="0x0000000000000000000000000000000000000000";
let snapshot_id;

beforeEach(async () => {
  [owner, user1, user2] = await ethers.getSigners();
  const ProjectHub = await ethers.getContractFactory("ProjectHub");
  projectHub = await ProjectHub.deploy();
  const TestToken = await ethers.getContractFactory("TestToken");
  testToken = await TestToken.deploy();
  const TestToken2 = await ethers.getContractFactory("TestToken2");
  testToken2 = await TestToken2.deploy();

  await projectHub.createProject("Cosmos", zeroAddress, ethers.utils.parseEther("100"), testToken.address, ethers.utils.parseEther("1000"));
  snapshot_id = await ethers.provider.send("evm_snapshot", []);
});

afterEach(async () => {
    await ethers.provider.send("evm_revert", [snapshot_id]);
});

describe("ProjectHub contract", function () {

  it('admin creates an project', async () => {
      await projectHub.createProject("Axelar", zeroAddress, ethers.utils.parseEther("100"), testToken.address, ethers.utils.parseEther("1000"));
      const project = await projectHub.projects(1);
      assert.equal(project.name, "Axelar");
      assert.deepEqual(project.hardCap, ethers.utils.parseEther("100"));
  });

  it('admin creates an allowance successfully', async () => {
      await projectHub.createAllowance(0, user1.address, ethers.utils.parseEther("50"));
      const allowance = await projectHub.allowances(1);
      assert.deepEqual(allowance.maxAmount, ethers.utils.parseEther("50"));
      assert.equal(allowance.amountFilled, 0);
  });

  it('admin creates an allowance unsuccessfully - zero amount allowed', async () => {
      await expect(projectHub.createAllowance(0, user1.address, 0)).to.be.revertedWith("Increase allowance");
  });

  it('admin creates an allowance unsuccessfully - twice for the same address', async () => {
      await projectHub.createAllowance(0, user1.address, ethers.utils.parseEther("50"));
      await expect(projectHub.createAllowance(0, user1.address, ethers.utils.parseEther("10"))).to.be.revertedWith("Already has allowance");
  });

  it('user funds project successfully', async () => {
      await projectHub.createAllowance(0, user1.address, ethers.utils.parseEther("50"));
      await projectHub.connect(user1).investInProject(0, 0, {value: ethers.utils.parseEther("20")});
      const allowance = await projectHub.allowances(1);
      assert.deepEqual(allowance.maxAmount, ethers.utils.parseEther("50"));
      assert.deepEqual(allowance.amountFilled, ethers.utils.parseEther("20"));
  });

  it('user funds project unsuccessfully - exceeded allowance', async () => {
      await projectHub.createAllowance(0, user1.address, ethers.utils.parseEther("50"));
      await expect(projectHub.connect(user1).investInProject(0, 0, {value: ethers.utils.parseEther("500")})).to.be.revertedWith("Allowance exceeded");
  });

  it('user funds project unsuccessfully - exceeded allowance ERC20', async () => {
      await projectHub.createProject("Agoric", testToken.address, ethers.utils.parseEther("200"), testToken2.address, ethers.utils.parseEther("1000"));
      await projectHub.createAllowance(1, user1.address, ethers.utils.parseEther("50"));
      await expect(projectHub.connect(user1).investInProject(1, ethers.utils.parseEther("500"))).to.be.revertedWith("Allowance exceeded");
  });

  it('user funds project unsuccessfully - sending ether with ERC20', async () => {
      await projectHub.createProject("Agoric", testToken.address, ethers.utils.parseEther("200"), testToken2.address, ethers.utils.parseEther("1000"));
      await projectHub.createAllowance(1, user1.address, ethers.utils.parseEther("50"));
      await expect(projectHub.connect(user1).investInProject(1, ethers.utils.parseEther("50"), {value: 1})).to.be.reverted;
  });

  it('user funds project unsuccessfully - no allowance', async () => {
      await expect(projectHub.connect(user1).investInProject(0, 0, {value: ethers.utils.parseEther("50")})).to.be.revertedWith("No allowance");
  });

  it('admin prematurely ends project - withdraws investments', async () => {
      const beforeBalance = await ethers.provider.getBalance(owner.address);
      await projectHub.createAllowance(0, user1.address, ethers.utils.parseEther("50"));
      await projectHub.connect(user1).investInProject(0, 0, {value: ethers.utils.parseEther("20")});
      let project =  await projectHub.projects(0);
      const tokensToDistribute = project.payoutTokenAmount;
      await projectHub.endPrematurely(0);
      project = await projectHub.projects(0);
      const tokensToDistributeAfter = project.payoutTokenAmount;
      assert.isBelow(tokensToDistributeAfter, tokensToDistribute);
      assert.deepEqual(project.hardCap, ethers.utils.parseEther("20"));
      await expect(projectHub.withdrawInvestments(0)).to.be.revertedWith("No distribution tokens");
      await testToken.mint(projectHub.address, project.payoutTokenAmount);
      assert.deepEqual(await testToken.balanceOf(projectHub.address), ethers.utils.parseEther("200"));
      await projectHub.withdrawInvestments(0);
      const afterBalance = await ethers.provider.getBalance(owner.address);
      expect(afterBalance.sub(beforeBalance)).to.be.closeTo(ethers.utils.parseEther("20"),ethers.utils.parseEther("0.1"));
  });

  it('User sends over funding goal', async () => {
      await projectHub.createAllowance(0, user1.address, ethers.utils.parseEther("5000"));
      await expect(projectHub.connect(user1).investInProject(0, 0, {value: ethers.utils.parseEther("5000")})).to.be.revertedWith("Funding goal exceeded");
  });

  it('admin ends prematurely unsuccessfully - already cancelled', async () => {
      await projectHub.cancelProject(0);
      await expect(projectHub.endPrematurely(0)).to.be.revertedWith("Project cancelled or filled");
  });

    it('admin cancels unsuccessfully - already cancelled', async () => {
      await projectHub.cancelProject(0);
      await expect(projectHub.cancelProject(0)).to.be.revertedWith("Project not active");
  });

  it('administrator ends prematurely unsuccessfully - already filled', async () => {
      await projectHub.createAllowance(0, user1.address, ethers.utils.parseEther("100"));
      await projectHub.connect(user1).investInProject(0, 0, {value: ethers.utils.parseEther("100")});
      await expect(projectHub.endPrematurely(0)).to.be.revertedWith("Project cancelled or filled");
  });

  it('admin withdraws investments successfully', async () => {
      const beforeBalance = await ethers.provider.getBalance(owner.address);
      await projectHub.createAllowance(0, user1.address, ethers.utils.parseEther("100"));
      await projectHub.connect(user1).investInProject(0, 0, {value: ethers.utils.parseEther("100")});
      const project = await projectHub.projects(0);
      await testToken.mint(projectHub.address, project.payoutTokenAmount);
      assert.deepEqual(await testToken.balanceOf(projectHub.address), ethers.utils.parseEther("1000"));
      await projectHub.withdrawInvestments(0);
      const afterBalance = await ethers.provider.getBalance(owner.address);
      expect(afterBalance.sub(beforeBalance)).to.be.closeTo(ethers.utils.parseEther("100"),ethers.utils.parseEther("0.1"));
  });

    it('admin withdraws investments successfully - ERC20.', async () => {
      await projectHub.createProject("Agoric", testToken.address, ethers.utils.parseEther("100"), testToken2.address, ethers.utils.parseEther("1000"));
      await projectHub.createAllowance(1, user1.address, ethers.utils.parseEther("100"));
      await testToken.mint(user1.address, ethers.utils.parseEther("100"));
      await testToken2.mint(projectHub.address, ethers.utils.parseEther("1000"));
      await testToken.connect(user1).approve(projectHub.address, ethers.utils.parseEther("100"));
      await projectHub.connect(user1).investInProject(1, ethers.utils.parseEther("100"));
      const balanceBefore = await testToken.balanceOf(owner.address);
      await projectHub.withdrawInvestments(1);
      const balanceAfter = await testToken.balanceOf(owner.address)
      const difference = balanceAfter.sub(balanceBefore);
      expect(difference).to.be.closeTo(ethers.utils.parseEther("100"),ethers.utils.parseEther("0.1"));
  });

  it('admin withdraws investments - ERC20. unsuccessfully - funding goal not met', async () => {
      await projectHub.createProject("Agoric", testToken.address, ethers.utils.parseEther("200"), testToken2.address, ethers.utils.parseEther("1000"));
      await projectHub.createAllowance(1, user1.address, ethers.utils.parseEther("100"));
      await testToken.mint(user1.address, ethers.utils.parseEther("100"));
      await testToken2.mint(projectHub.address, ethers.utils.parseEther("1000"));
      await testToken.connect(user1).approve(projectHub.address, ethers.utils.parseEther("100"));
      await projectHub.connect(user1).investInProject(1, ethers.utils.parseEther("100"));
      await expect(projectHub.withdrawInvestments(1)).to.be.revertedWith("Project not ready");
  });

  it('admin withdraw investments - user collects reward', async () => {
      await projectHub.createProject("Agoric", testToken.address, ethers.utils.parseEther("100"), testToken2.address, ethers.utils.parseEther("1000"));
      await projectHub.createAllowance(1, user1.address, ethers.utils.parseEther("100"));
      await testToken.mint(user1.address, ethers.utils.parseEther("100"));
      await testToken2.mint(projectHub.address, ethers.utils.parseEther("1000"));
      await testToken.connect(user1).approve(projectHub.address, ethers.utils.parseEther("100"));
      await projectHub.connect(user1).investInProject(1, ethers.utils.parseEther("100"));
      await projectHub.withdrawInvestments(1);
      await expect(projectHub.connect(user1).getReward(1)).to.emit(projectHub, 'RewardCollected').withArgs(1 , user1.address, ethers.utils.parseEther("1000"));
      assert.deepEqual(await testToken2.balanceOf(user1.address), ethers.utils.parseEther("1000"));
});
  it('user cannot collect reward multiple times', async () => {
      await projectHub.createProject("Agoric", testToken.address, ethers.utils.parseEther("100"), testToken2.address, ethers.utils.parseEther("1000"));
      await projectHub.createAllowance(1, user1.address, ethers.utils.parseEther("100"));
      await testToken.mint(user1.address, ethers.utils.parseEther("100"));
      await testToken2.mint(projectHub.address, ethers.utils.parseEther("1000"));
      await testToken.connect(user1).approve(projectHub.address, ethers.utils.parseEther("100"));
      await projectHub.connect(user1).investInProject(1, ethers.utils.parseEther("100"));
      await projectHub.withdrawInvestments(1);
      await expect(projectHub.connect(user1).getReward(1)).to.emit(projectHub, 'RewardCollected').withArgs(1 , user1.address, ethers.utils.parseEther("1000"));
      await expect(projectHub.connect(user1).getReward(1)).to.be.revertedWith("Reward cashed out");
  });

  it("user is not rewarded when they haven't invested", async () => {
      await projectHub.createProject("Agoric", testToken.address, ethers.utils.parseEther("100"), testToken2.address, ethers.utils.parseEther("1000"));
      await projectHub.createAllowance(1, user1.address, ethers.utils.parseEther("100"));
      await testToken.mint(user1.address, ethers.utils.parseEther("100"));
      await testToken2.mint(projectHub.address, ethers.utils.parseEther("1000"));
      await testToken.connect(user1).approve(projectHub.address, ethers.utils.parseEther("100"));
      await projectHub.connect(user1).investInProject(1, ethers.utils.parseEther("100"));
      await projectHub.withdrawInvestments(1);
      await expect(projectHub.connect(user1).getReward(1)).to.emit(projectHub, 'RewardCollected').withArgs(1 , user1.address, ethers.utils.parseEther("1000"));
      await expect(projectHub.connect(user2).getReward(1)).to.be.revertedWith("No Allowance");
  });

  it('admin cancels investment', async () => {
      await projectHub.createProject("Agoric", zeroAddress, ethers.utils.parseEther("200"), testToken.address, ethers.utils.parseEther("1000"));
      await projectHub.createAllowance(1, user1.address, ethers.utils.parseEther("100"));
      await projectHub.connect(user1).investInProject(1, 0, {value: ethers.utils.parseEther("100")});
      await expect(projectHub.cancelProject(1)).to.emit(projectHub, 'ProjectCancelled').withArgs(1);
      await projectHub.connect(user1).getRefund(1);

  });

  it('user gets a refund after project cancellation', async () => {
      await projectHub.createProject("Agoric", zeroAddress, ethers.utils.parseEther("200"), testToken.address, ethers.utils.parseEther("1000"));
      await projectHub.createAllowance(1, user1.address, ethers.utils.parseEther("100"));
      await projectHub.connect(user1).investInProject(1, 0, {value: ethers.utils.parseEther("100")});
      await expect(projectHub.cancelProject(1)).to.emit(projectHub, 'ProjectCancelled').withArgs(1);
      await expect(projectHub.connect(user1).getRefund(1)).to.emit(projectHub, 'UserRefunded').withArgs(1, user1.address, ethers.utils.parseEther("100"));
      expect(await ethers.provider.getBalance(user1.address)).to.be.closeTo(ethers.utils.parseEther("10000"),ethers.utils.parseEther("0.1"));
  });

  it('getBalance', async () => {
      await testToken.mint(user1.address, ethers.utils.parseEther("100"));
      await testToken2.mint(user2.address,  ethers.utils.parseEther("300"));
      const balance = await projectHub.connect(user1).getBalance(user2.address, testToken2.address);
      const balance2 = await projectHub.connect(user2).getBalance(user1.address, testToken.address);
      assert.deepEqual(balance, ethers.utils.parseEther("300"));
      assert.deepEqual(balance2, ethers.utils.parseEther("100"));
  });
  it('getAllowance', async () => {
      await projectHub.createProject("Agoric", zeroAddress, ethers.utils.parseEther("200"), testToken.address, ethers.utils.parseEther("1000"));
      await projectHub.createAllowance(1, user1.address, ethers.utils.parseEther("100"));
      let allowance = await projectHub.connect(user2).getAllowance(user1.address, 1);
      assert.deepEqual(allowance.maxAmount, ethers.utils.parseEther("100"));
      allowance = await projectHub.connect(user1).getAllowance(user2.address, 1);
      assert.deepEqual(allowance.maxAmount, ethers.utils.parseEther("0"));
  });
});
