/**
 * Cabij OS Task Scheduler
 * Handles priority calculation for the Execution Dashboard.
 */

export const PRIORITY_WEIGHTS = {
    DUE_SOON: 0.5,
    STATION_LOAD: 0.3,
    INGREDIENT_AVAILABILITY: 0.2
};

export const getTaskPriorityScore = (task) => {
    let score = 0;
    
    // 1. Time Pressure (0-100)
    const now = new Date();
    const due = new Date(task.dueDate);
    const diffHours = (due - now) / (1000 * 60 * 60);
    
    if (diffHours < 1) score += 100 * PRIORITY_WEIGHTS.DUE_SOON;
    else if (diffHours < 4) score += 50 * PRIORITY_WEIGHTS.DUE_SOON;

    // 2. Criticality (Manual Setting)
    if (task.priority === 'CRITICAL') score += 40;
    else if (task.priority === 'HIGH') score += 20;

    // 3. Status adjustment
    if (task.status === 'BLOCKED') score = 0; // Blocked tasks go to the bottom

    return Math.min(score, 100);
};

export const sortTasksByExecutionPriority = (tasks) => {
    return [...tasks].sort((a, b) => {
        const scoreA = getTaskPriorityScore(a);
        const scoreB = getTaskPriorityScore(b);
        return scoreB - scoreA;
    });
};
