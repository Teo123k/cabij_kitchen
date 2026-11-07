/**
 * Cabij SOP Validation Engine
 * Ensures mission-critical steps are performed correctly before state transition.
 */

export const validateStepCompletion = (step, input) => {
    if (!step.mandatory) return { valid: true };

    // Example validations (mocking sensor/input check)
    if (step.type === 'scale' && (!input?.weight || input.weight < step.target * 0.95)) {
        return { valid: false, message: 'Weight mismatch detected. Check scale.' };
    }

    if (step.type === 'temp' && (!input?.temp || input.temp > step.maxTemp)) {
        return { valid: false, message: 'Temperature too high. Cooling required.' };
    }

    if (step.type === 'check' && !input?.confirmed) {
        return { valid: false, message: 'Step must be explicitly verified.' };
    }

    return { valid: true };
};

/**
 * Persists the current session state to Dexie (via op_logs)
 */
export const logStepCompletion = async (db, missionId, stepIndex) => {
    if (!db) return;
    await db.operational_logs.add({
        timestamp: new Date().toISOString(),
        level: 'INFO',
        message: `Step ${stepIndex + 1} complete for Mission ${missionId}`
    });
};
