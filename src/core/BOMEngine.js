import { calculateBOM as siblingModelCalculateBOM } from '../utils/BOMEngine.js';

/**
 * Canonical BOM entrypoint for core modules.
 * This keeps compatibility with the sibling `cabij_sop_app` engine contract.
 */
export const calculateBOM = (recipes, scales = {}, portionsPerBatch = 6, settings = {}) => (
    siblingModelCalculateBOM(recipes, scales, portionsPerBatch, settings)
);

export default calculateBOM;
