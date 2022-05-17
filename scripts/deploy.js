async function main() {
  // We get the contract to deploy
  const ProjectHub = await ethers.getContractFactory("ProjectHub");
  const projectHub = await ProjectHub.deploy();

  await projectHub.deployed();

  console.log("ProjectHub deployed to:", projectHub.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });