import React, { useState, useEffect } from 'react';
import { useAdmin } from '../../contexts/AdminContext';

const PublishScheduler = ({ onClose, showToast }) => {
    const { schedulePublish, scheduledChanges, cancelScheduled } = useAdmin();
    const [scheduledDate, setScheduledDate] = useState('');
    const [scheduledTime, setScheduledTime] = useState('');
    const [loading, setLoading] = useState(false);

    // Set default to tomorrow at 11 PM CST
    useEffect(() => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(23, 0, 0, 0);

        setScheduledDate(tomorrow.toISOString().split('T')[0]);
        setScheduledTime('23:00');
    }, []);

    const handleSchedule = async () => {
        if (!scheduledDate || !scheduledTime) {
            showToast('Please select date and time', 'error');
            return;
        }

        const scheduledFor = new Date(`${scheduledDate}T${scheduledTime}`);

        if (scheduledFor <= new Date()) {
            showToast('Scheduled time must be in the future', 'error');
            return;
        }

        setLoading(true);
        const result = await schedulePublish(scheduledFor.toISOString());
        setLoading(false);

        if (result.success) {
            showToast('Changes scheduled successfully!', 'success');
            onClose();
        } else {
            showToast('Failed to schedule: ' + result.error, 'error');
        }
    };

    const handleCancelScheduled = async (changeId) => {
        const result = await cancelScheduled(changeId);
        if (result.success) {
            showToast('Scheduled change cancelled', 'info');
        } else {
            showToast('Failed to cancel: ' + result.error, 'error');
        }
    };

    const formatScheduledDate = (timestamp) => {
        if (!timestamp) return 'Unknown';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            timeZoneName: 'short'
        });
    };

    return (
        <div className="admin-modal-overlay" onClick={onClose}>
            <div className="admin-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
                <div className="admin-modal-header">
                    <h3 className="admin-modal-title">📅 Schedule Publish</h3>
                    <button className="admin-modal-close" onClick={onClose}>×</button>
                </div>

                <div className="admin-modal-body">
                    {/* Schedule Form */}
                    <div style={{
                        background: 'var(--admin-bg-tertiary)',
                        borderRadius: 'var(--admin-radius)',
                        padding: '1.5rem',
                        marginBottom: '1.5rem'
                    }}>
                        <h4 style={{ margin: '0 0 1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span>🕐</span> Schedule New Publish
                        </h4>

                        <div className="admin-grid admin-grid-2">
                            <div className="admin-form-group">
                                <label className="admin-label">Date</label>
                                <input
                                    type="date"
                                    className="admin-input"
                                    value={scheduledDate}
                                    onChange={(e) => setScheduledDate(e.target.value)}
                                    min={new Date().toISOString().split('T')[0]}
                                />
                            </div>

                            <div className="admin-form-group">
                                <label className="admin-label">Time (Local)</label>
                                <input
                                    type="time"
                                    className="admin-input"
                                    value={scheduledTime}
                                    onChange={(e) => setScheduledTime(e.target.value)}
                                />
                            </div>
                        </div>

                        <div style={{
                            background: 'rgba(168, 85, 247, 0.1)',
                            borderRadius: 'var(--admin-radius-sm)',
                            padding: '12px',
                            marginTop: '1rem',
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '10px'
                        }}>
                            <span>💡</span>
                            <div>
                                <strong style={{ display: 'block', marginBottom: '4px' }}>Tip</strong>
                                <span style={{ color: 'var(--admin-text-secondary)', fontSize: '0.9rem' }}>
                                    Your current draft configuration will be saved and published at the scheduled time.
                                    A cloud function will automatically execute the publish.
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Pending Scheduled Changes */}
                    {scheduledChanges.length > 0 && (
                        <div>
                            <h4 style={{ margin: '0 0 1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span>📋</span> Pending Scheduled Changes
                            </h4>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                {scheduledChanges.map(change => (
                                    <div
                                        key={change.id}
                                        style={{
                                            background: 'var(--admin-bg-tertiary)',
                                            border: '1px solid var(--admin-border)',
                                            borderRadius: 'var(--admin-radius-sm)',
                                            padding: '1rem',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between'
                                        }}
                                    >
                                        <div>
                                            <div style={{ fontWeight: 600 }}>
                                                {formatScheduledDate(change.scheduledFor)}
                                            </div>
                                            <div style={{ fontSize: '0.85rem', color: 'var(--admin-text-muted)' }}>
                                                Created: {formatScheduledDate(change.createdAt)}
                                            </div>
                                        </div>
                                        <button
                                            className="admin-btn admin-btn-ghost"
                                            onClick={() => handleCancelScheduled(change.id)}
                                            style={{ color: 'var(--admin-red)' }}
                                        >
                                            ❌ Cancel
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {scheduledChanges.length === 0 && (
                        <div style={{
                            textAlign: 'center',
                            padding: '2rem',
                            color: 'var(--admin-text-muted)'
                        }}>
                            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📭</div>
                            <p>No pending scheduled changes</p>
                        </div>
                    )}
                </div>

                <div className="admin-modal-footer">
                    <button className="admin-btn admin-btn-secondary" onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        className="admin-btn admin-btn-primary"
                        onClick={handleSchedule}
                        disabled={loading}
                    >
                        {loading ? '⏳ Scheduling...' : '📅 Schedule Publish'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PublishScheduler;
