// Spike: 0 to SPIKE_VUS in 10 s, held for SPIKE_HOLD. See qa/LOAD_DRILLS.md and profiles.mjs.
import { iteration, optionsFor, summaryFor } from './common.js';

export const options = optionsFor('spike');
export default iteration;
export const handleSummary = summaryFor('spike');
