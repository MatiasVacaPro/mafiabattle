import fs from "fs";
import path from "path";
import os from "os";

async function loadEvaluate() {
  try {
    const mod = await import("ai");
    return mod.experimental_evaluate;
  } catch (e) {
    const fallbackPath = path.join(os.homedir(), "jev-demo", "node_modules", "ai", "dist", "index.js");
    if (fs.existsSync(fallbackPath)) {
      const mod = await import(fallbackPath);
      return mod.experimental_evaluate;
    }
    throw new Error("Could not find 'ai' package. Ensure npm install ai is run or ~/jev-demo exists.");
  }
}

async function main() {
  const input = fs.readFileSync(0, "utf-8");
  if (!input.trim()) {
    console.error(JSON.stringify({ error: "No input provided" }));
    process.exit(1);
  }

  const { state, questions } = JSON.parse(input);

  // Intentar obtener la API key si no está en el entorno
  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_AI_GATEWAY_KEY) {
    try {
      const { execSync } = await import("child_process");
      const key = execSync(
        "security find-generic-password -s 'Vercel AI Gateway' -a 'vercel-ai-gateway' -w",
        { encoding: "utf-8" }
      ).trim();
      if (key) {
        process.env.AI_GATEWAY_API_KEY = key;
      }
    } catch (e) {
      // Ignorar si no está en keychain
    }
  }

  const evaluate = await loadEvaluate();
  const result = await evaluate({
    model: "typesafe-ai/jev",
    state,
    questions,
  });

  console.log(JSON.stringify(result));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
