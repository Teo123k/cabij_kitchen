import React from 'react';
import { ShieldCheck, Wifi, WifiOff, ArrowLeft } from 'lucide-react';
import RecipeMetaPanel from './RecipeMetaPanel';
import {
    OFFLINE_QUEUE_STATUS_LABELS,
    OFFLINE_STATE,
} from '../config/constants';

export const DashboardTopStatusChips = ({
    offlineState,
    connectionState,
}) => {
    const online = connectionState === OFFLINE_STATE.ONLINE && offlineState?.source === 'online';
    const statusItems = [
        {
            label: online ? 'Online' : 'Offline',
            value: online ? '1' : '0',
            icon: online ? Wifi : WifiOff,
            tone: online ? 'status-green' : 'status-red',
        },
    ];

    return (
        <div className="queue-mini-bar" aria-label="System status">
            {statusItems.map(({ label, value, icon: Icon, tone }) => (
                <span key={label} className={`queue-mini-chip ${tone}`}>
                    <Icon size={12} aria-hidden="true" />
                    <span>{label}</span>
                    <span className="queue-mini-value">{value}</span>
                </span>
            ))}
        </div>
    );
};

const groupEntries = (entries = []) => {
    const grouped = {};
    (Array.isArray(entries) ? entries : []).forEach((entry) => {
        const status = entry?.status || OFFLINE_STATE.PENDING;
        if (!grouped[status]) grouped[status] = [];
        grouped[status].push(entry);
    });
    return grouped;
};

export const DashboardManagerQueuePage = ({
    queueSummary,
    queueEntries,
    offlineState,
    connectionState,
    syncNotice,
    operationalObservabilityItems = [],
    userRole,
    canApproveSync,
    onApproveQueue,
    onBackToRecipe,
    selectedQueueEntry,
    selectedQueueEntryId,
    onSelectQueueEntry,
    activeRecipe,
    formatQuantity,
    portionMode,
    onPortionModeToggle,
    currentYieldValue,
    currentPortionCount,
    portionsPerBatch,
    getPortionSize,
    setDailyProduction,
    dailyProduction,
    nextActionSummary,
    bomInsight,
    onOptimizeYield,
    onResetActive,
    onDefaultAll,
    panelId,
    panelLabelId,
}) => {
    const hasQueue = Boolean(queueSummary?.hasQueue);
    const approvedCount = queueSummary?.approved || 0;
    const approvalRequiredCount = (queueSummary?.approval_required || 0) + (queueSummary?.local || 0) + (queueSummary?.pending || 0) + (queueSummary?.failed || 0);
    const canUseManagerApproval = Boolean(canApproveSync);
    const needsApproval = hasQueue && (
        (queueSummary?.pending || 0) > 0 ||
        (queueSummary?.local || 0) > 0 ||
        (queueSummary?.approval_required || 0) > 0 ||
        (queueSummary?.failed || 0) > 0
    );
    const sourceLabel = offlineState?.source === 'offline-cache'
        ? 'Offline cache ready'
        : offlineState?.source === 'missing-cache'
            ? 'Cache missing'
            : 'Live data active';

    const queueTone = hasQueue
        ? 'queue-shell-active'
        : offlineState?.source === 'missing-cache'
            ? 'queue-shell-error'
            : 'queue-shell-neutral';

    const groupedEntries = groupEntries(queueEntries);
    const hasSelectedQueueEntry = Boolean(selectedQueueEntry);
    const shouldRenderSelectedRecipePanel = hasSelectedQueueEntry && Boolean(activeRecipe);
    const orderedGroups = [
        OFFLINE_STATE.LOCAL,
        OFFLINE_STATE.PENDING,
        OFFLINE_STATE.APPROVAL_REQUIRED,
        OFFLINE_STATE.APPROVED,
        OFFLINE_STATE.SYNCED,
        OFFLINE_STATE.FAILED,
        OFFLINE_STATE.BLOCKED,
        OFFLINE_STATE.CONFLICT,
    ]
        .map((state) => [state, groupedEntries[state] || []])
        .filter(([, entries]) => entries.length > 0);
    const showQueueRail = hasQueue && orderedGroups.length > 0;
    const isEmptyQueueState = !hasQueue;

    return (
        <section
            className={`queue-shell ${queueTone} manager-page-shell page-view`}
            id={panelId}
            role="tabpanel"
            aria-labelledby={panelLabelId}
            tabIndex={-1}
        >
            <div className="queue-summary-row manager-head">
                <div className="queue-summary-copy">
                    <div className="queue-kicker">Approvals</div>
                    <div className="queue-summary-title">
                        {hasQueue
                            ? `${queueSummary.total} local recipe edit${queueSummary.total === 1 ? '' : 's'} waiting for review.`
                            : offlineState?.source === 'missing-cache'
                                ? 'This device does not have a hydrated offline recipe cache yet.'
                                : 'No recipe changes are waiting for approval.'
                        }
                    </div>
                    <div className="queue-pill-row">
                        <span className={`queue-pill ${approvedCount > 0 ? 'status-green' : 'status-neutral'}`}>
                            Approved: {approvedCount}
                        </span>
                    <span className={`queue-pill ${approvalRequiredCount > 0 ? 'status-blue' : 'status-neutral'}`}>
                        Need manager action: {approvalRequiredCount}
                    </span>
                    {!canUseManagerApproval && (
                        <span className="queue-pill status-red">Staff workspace is read-only</span>
                    )}
                    </div>
                    <div className="queue-source">{sourceLabel}</div>
                </div>
                <div className="queue-action-row">
                    <button type="button" onClick={onBackToRecipe} className="hybrid-button">
                        <ArrowLeft size={14} />
                        Back to recipe
                    </button>
                </div>
            </div>

            <div className={`manager-layout ${isEmptyQueueState ? 'single-column' : ''}`.trim()}>
                <div className="manager-review">
                    {selectedQueueEntry && (
                            <div className="manager-selected">
                                <div className="manager-selected-kicker">Selected Queue Item</div>
                                <div
                                    className="manager-selected-title"
                                    title={selectedQueueEntry?.recipe?.name || 'Queued Recipe'}
                                >
                                    {selectedQueueEntry?.recipe?.name || 'Queued Recipe'}
                                </div>
                            <div className="manager-selected-meta">
                                <span>{OFFLINE_QUEUE_STATUS_LABELS[selectedQueueEntry?.status] || selectedQueueEntry?.status || 'Queued'}</span>
                                <span>{selectedQueueEntry?.reason || 'review in progress'}</span>
                            </div>
                        </div>
                    )}

                    {shouldRenderSelectedRecipePanel ? (
                        <RecipeMetaPanel
                            activeRecipe={activeRecipe}
                            selectedId={selectedQueueEntry?.id || selectedQueueEntryId}
                            selectedQueueEntry={selectedQueueEntry}
                            currentYieldValue={currentYieldValue}
                            currentPortionCount={currentPortionCount}
                            portionsPerBatch={portionsPerBatch}
                            getPortionSize={getPortionSize}
                            setDailyProduction={setDailyProduction}
                            dailyProduction={dailyProduction}
                            formatQuantity={formatQuantity}
                            portionMode={portionMode}
                            onPortionModeToggle={onPortionModeToggle}
                            onDefaultAll={onDefaultAll}
                            onOptimizeYield={onOptimizeYield}
                            onResetActive={onResetActive}
                            nextActionSummary={nextActionSummary}
                            bomInsight={bomInsight}
                            className="manager-recipe-panel"
                        />
                    ) : (
                        <div className={`manager-empty ${isEmptyQueueState ? 'manager-empty-primary' : ''}`.trim()}>
                            {hasQueue
                                ? 'Select a queued recipe on the right to review it here.'
                                : 'No recipe changes are waiting for approval yet.'}
                        </div>
                    )}

                    {hasQueue && (
                        <div className="manager-actions">
                        {canUseManagerApproval ? (
                            <button
                                type="button"
                                onClick={onApproveQueue}
                                disabled={!needsApproval}
                                className="queue-approve-button"
                                title={needsApproval ? 'Approve manager queue for sync review' : 'No items require approval right now'}
                            >
                                <ShieldCheck size={14} />
                                Review & approve
                            </button>
                        ) : (
                            <div className={`queue-notice status-red`}>
                                Staff access is read-only. Ask a manager or owner to review pending recipe changes.
                            </div>
                        )}
                    </div>
                    )}

                    {operationalObservabilityItems.length > 0 && (
                        <div className="manager-observability-stack" aria-label="Operational observability">
                            {operationalObservabilityItems.map((item) => (
                                <article
                                    key={item.key}
                                    className={`operational-observability-card ${item.tone || 'warning'}`}
                                >
                                    <div className="operational-observability-kicker">Operational signal</div>
                                    <div className="operational-observability-title">{item.title}</div>
                                    <div className="operational-observability-body">{item.body}</div>
                                    {item.action ? (
                                        <div className="operational-observability-action">{item.action}</div>
                                    ) : null}
                                </article>
                            ))}
                        </div>
                    )}

                    {syncNotice?.message && (
                        <div className={`queue-notice ${syncNotice.tone || 'info'}`}>
                            {syncNotice.message}
                        </div>
                    )}
                </div>

                {showQueueRail && (
                <aside className="manager-rail">
                    <div className="manager-queue-list">
                        {Object.keys(groupedEntries).length === 0 ? (
                            <div className="manager-empty queue-empty">
                                No queued recipes yet.
                            </div>
                        ) : (
                            orderedGroups.map(([status, entries]) => (
                                <section key={status} className="manager-queue-group">
                                    <div className="manager-queue-group-head">
                                        <span>{OFFLINE_QUEUE_STATUS_LABELS[status] || status}</span>
                                        <span>{entries.length}</span>
                                    </div>
                                    <div className="manager-queue-group-body">
                                        {entries.map((entry) => {
                                            const queueRecipeName = entry?.recipe?.name || 'Queued Recipe';
                                            const queueItemStatus = OFFLINE_QUEUE_STATUS_LABELS[entry?.status] || entry?.status || 'queued';
                                            const queueItemReason = entry?.reason || 'queued';
                                            return (
                                                <button
                                                    key={entry.id}
                                                    type="button"
                                                    onClick={() => onSelectQueueEntry(entry.id)}
                                                    className={`manager-queue-item ${selectedQueueEntry?.id === entry.id ? 'active' : ''}`}
                                                    aria-current={selectedQueueEntry?.id === entry.id}
                                                    aria-label={`Review queued recipe ${queueRecipeName} (${queueItemStatus})`}
                                                    title={queueItemReason}
                                                >
                                                    <div className="manager-queue-item-title">
                                                        {queueRecipeName}
                                                    </div>
                                                    <div className="manager-queue-item-meta">
                                                        <span>{queueItemStatus}</span>
                                                        <span title={queueItemReason}>{queueItemReason}</span>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </section>
                            ))
                        )}
                    </div>
                </aside>
                )}
            </div>
        </section>
    );
};
