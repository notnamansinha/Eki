// Headroom: ramp to 1.2 times VUS (the expected peak), hold for DURATION, ramp down. See qa/LOAD_DRILLS.md and profiles.mjs.
import { iteration, optionsFor, summaryFor } from './common.js';

export const options = optionsFor('headroom');
export default iteration;
export const handleSummary = summaryFor('headroom');
