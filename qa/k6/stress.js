// Stress: three steps to STRESS_VUS, each held for STEP. See qa/LOAD_DRILLS.md and profiles.mjs.
import { iteration, optionsFor, summaryFor } from './common.js';

export const options = optionsFor('stress');
export default iteration;
export const handleSummary = summaryFor('stress');
