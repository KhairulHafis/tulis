import { runMeasurement } from "./harness.ts";
import { findMeasurement } from "./measurements.ts";

const name = process.argv[2];
const measurement = name === undefined ? undefined : findMeasurement(name);

if (measurement === undefined) {
  console.error("Unknown or missing measurement name");
  process.exitCode = 1;
} else {
  try {
    const result = await runMeasurement(measurement);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`Measurement failed: ${message}`);
    process.exitCode = 1;
  }
}
