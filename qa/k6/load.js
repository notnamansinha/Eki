// Load: ramp to VUS, hold for DURATION, ramp down (the expected peak). See qa/LOAD_DRILLS.md and profiles.mjs.
import { iteration, optionsFor, summaryFor } from './common.js';

export const options = optionsFor('load');
export default iteration;
export const handleSummary = summaryFor('load');
