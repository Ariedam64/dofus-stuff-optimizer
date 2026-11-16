const config = require("./config");
const CommandLine = require("./cli/CommandLine");

async function main() {
    await new CommandLine({ config }).run(process.argv.slice(2));
}

main().catch((error) => {
    console.error("❌", error.message);
    process.exitCode = 1;
});
