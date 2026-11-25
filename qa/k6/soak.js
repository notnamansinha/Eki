// Soak: SOAK_VUS constant users for SOAK_DURATION. See qa/LOAD_DRILLS.md and profiles.mjs.
import { iteration, optionsFor, summaryFor } from './common.js';

export const options = optionsFor('soak');
export default iteration;
export const handleSummary = summaryFor('soak');
