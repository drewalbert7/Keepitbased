#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * One-shot §11 news ingestion (Polygon → research_artifacts).
 * If ENABLE_RESEARCH_INGESTION is unset, defaults to true for this process only.
 */
if (!process.env.ENABLE_RESEARCH_INGESTION) {
  process.env.ENABLE_RESEARCH_INGESTION = 'true';
}

const path = require('path');
const backendRoot = path.join(__dirname, '..', 'backend');
require(path.join(backendRoot, 'config'));
const { initializeDatabase } = require(path.join(backendRoot, 'models', 'database'));
const { runResearchIngestionTick } = require(path.join(
  backendRoot,
  'services',
  'researchIngestionWorker'
));

async function main() {
  await initializeDatabase();
  const result = await runResearchIngestionTick();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
