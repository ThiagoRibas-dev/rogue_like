import { $ } from "bun";

async function runPipeline() {
  console.log("=========================================");
  console.log("  Megacampaign Data Ingestion Pipeline");
  console.log("=========================================\n");

  try {
    console.log("--> [1/4] Parsing NetHack data...");
    await $`bun run scripts/data_importers/parse_nethack.ts`;
    
    console.log("\n--> [2/4] Parsing Incursion data...");
    await $`bun run scripts/data_importers/parse_incursion.ts`;
    
    console.log("\n--> [3/4] Compiling Megacampaign JSON...");
    await $`bun run scripts/data_importers/compile_megacampaign.ts`;
    
    console.log("\n--> [4/4] Validating against Zod schemas...");
    await $`bun run scripts/run-validator.ts megacampaign`;
    
    console.log("\n=========================================");
    console.log("  Pipeline completed successfully!       ");
    console.log("=========================================");
  } catch (err) {
    console.error("\n[!] Pipeline failed:", err);
    process.exit(1);
  }
}

runPipeline();
