import React from 'react';

const formatReviewDate = (value = '') => {
    const text = String(value || '').trim();
    if (!text) return '';
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return text;
    return date.toLocaleDateString();
};

const ProfileReviewCard = ({
    reviewState = null,
    title = 'Generated profile review',
    compact = false,
    restricted = false,
    className = ''
}) => {
    if (!reviewState?.hasSignals) return null;

    const toneClass = reviewState.tone === 'danger'
        ? 'danger'
        : reviewState.tone === 'good'
            ? 'good'
            : 'warn';

    const cardClassName = [
        'profile-review-card',
        toneClass,
        compact ? 'compact' : '',
        restricted ? 'restricted' : '',
        className
    ].filter(Boolean).join(' ');
    const summaryText = restricted
        ? (reviewState.tone === 'danger'
            ? 'Generated workflow data needs review before live use.'
            : reviewState.issueCount > 0 || reviewState.reviewRequired || reviewState.managerReviewRequired
                ? 'Generated workflow data should be reviewed before use.'
                : 'Generated workflow data is linked.')
        : reviewState.summary;

    return (
        <div className={cardClassName}>
            <div className="row-top">
                <div>
                    <div className="focus-title">{title}</div>
                    {!restricted && reviewState.profileLabels?.length > 0 ? (
                        <div className="profile-review-kicker">{reviewState.profileLabels.join(' + ')}</div>
                    ) : null}
                </div>
                <div className={`badge ${toneClass === 'danger' ? 'red' : toneClass === 'good' ? 'good' : 'gold'}`.trim()}>
                    {reviewState.badge}
                </div>
            </div>

            <div className="focus-copy">{summaryText}</div>

            <div className="profile-review-meta">
                {reviewState.issueCount > 0 ? (
                    <div className="profile-review-pill">{`${reviewState.issueCount} field${reviewState.issueCount === 1 ? '' : 's'} flagged`}</div>
                ) : null}
                {!restricted && reviewState.pendingQueueCount > 0 ? (
                    <div className="profile-review-pill">{`${reviewState.pendingQueueCount} pending review`}</div>
                ) : null}
                {!restricted && reviewState.historyCount > 0 ? (
                    <div className="profile-review-pill">{`${reviewState.historyCount} tracked change${reviewState.historyCount === 1 ? '' : 's'}`}</div>
                ) : null}
                {!restricted && reviewState.validationActors?.[0] ? (
                    <div className="profile-review-pill">{reviewState.validationActors[0]}</div>
                ) : null}
            </div>

            {reviewState.fieldPreview?.length > 0 ? (
                <>
                    <div className="profile-review-section-title">Needs review</div>
                    <div className="profile-review-list">
                        {reviewState.fieldPreview.map((item) => (
                            <div className="profile-review-item" key={`${item.profileLabel}-${item.fieldPath}`}>
                                <div className="profile-review-item-top">
                                    <span>{item.fieldLabel}</span>
                                    {item.scoreLabel ? <span>{item.scoreLabel}</span> : null}
                                </div>
                                {item.reasonText ? (
                                    <div className="profile-review-item-copy">{item.reasonText}</div>
                                ) : null}
                            </div>
                        ))}
                    </div>
                </>
            ) : null}

            {!restricted && reviewState.queuePreview?.length > 0 ? (
                <>
                    <div className="profile-review-section-title">Review queue</div>
                    <div className="profile-review-list">
                        {reviewState.queuePreview.map((item) => (
                            <div className="profile-review-item" key={item.id}>
                                <div className="profile-review-item-top">
                                    <span>{item.fieldLabel}</span>
                                    <span>{item.statusLabel}</span>
                                </div>
                                <div className="profile-review-item-copy">
                                    {[item.reasonText, item.confidenceLabel].filter(Boolean).join(' / ') || 'Waiting for human review.'}
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            ) : null}

            {!restricted && reviewState.historyPreview?.length > 0 ? (
                <>
                    <div className="profile-review-section-title">Recent changes</div>
                    <div className="profile-review-list">
                        {reviewState.historyPreview.map((item) => (
                            <div className="profile-review-item" key={item.id}>
                                <div className="profile-review-item-top">
                                    <span>{item.fieldLabel}</span>
                                    <span>{formatReviewDate(item.createdAt) || 'Tracked'}</span>
                                </div>
                                <div className="profile-review-item-copy">
                                    {[item.changedBy, item.changeReason].filter(Boolean).join(' / ') || 'Chef correction recorded.'}
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            ) : null}
        </div>
    );
};

export default ProfileReviewCard;
