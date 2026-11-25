// Smoke: SMOKE_VUS constant users for SMOKE_DURATION. See qa/LOAD_DRILLS.md and profiles.mjs.
import { iteration, optionsFor, summaryFor } from './common.js';

export const options = optionsFor('smoke');
export default iteration;
export const handleSummary = summaryFor('smoke');
