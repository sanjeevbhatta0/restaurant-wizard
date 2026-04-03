import React, { useState, useEffect } from 'react';
import { getAnalytics, getRestaurantStats } from '../../services/adminConfigService';

const MetricsDashboard = () => {
    const [analytics, setAnalytics] = useState([]);
    const [restaurantStats, setRestaurantStats] = useState({ totalCount: 0, tierCounts: {} });
    const [loading, setLoading] = useState(true);
    const [timeRange, setTimeRange] = useState(30);

    useEffect(() => {
        loadData();
    }, [timeRange]);

    const loadData = async () => {
        setLoading(true);
        const [analyticsData, stats] = await Promise.all([
            getAnalytics(timeRange),
            getRestaurantStats()
        ]);
        setAnalytics(analyticsData);
        setRestaurantStats(stats);
        setLoading(false);
    };

    // Calculate summary stats
    const getSummaryStats = () => {
        if (!analytics || analytics.length === 0) {
            return { pageViews: 0, signups: 0, activeUsers: 0, orders: 0, avgActiveUsers: 0 };
        }

        const totals = analytics.reduce((acc, day) => ({
            pageViews: acc.pageViews + (day.pageViews?.total || 0),
            signups: acc.signups + (day.signups || 0),
            activeUsers: acc.activeUsers + (day.activeUsers || 0),
            orders: acc.orders + (day.orders || 0)
        }), { pageViews: 0, signups: 0, activeUsers: 0, orders: 0 });

        return {
            ...totals,
            avgActiveUsers: analytics.length > 0 ? Math.round(totals.activeUsers / analytics.length) : 0
        };
    };

    // Calculate trend (compare first half to second half)
    const getTrend = (key) => {
        if (analytics.length < 4) return 0;

        const mid = Math.floor(analytics.length / 2);
        const firstHalf = analytics.slice(0, mid);
        const secondHalf = analytics.slice(mid);

        const firstSum = firstHalf.reduce((sum, day) => sum + (key === 'pageViews' ? (day.pageViews?.total || 0) : (day[key] || 0)), 0);
        const secondSum = secondHalf.reduce((sum, day) => sum + (key === 'pageViews' ? (day.pageViews?.total || 0) : (day[key] || 0)), 0);

        if (firstSum === 0 && secondSum === 0) return 0;
        if (firstSum === 0) return 100;
        return Math.round(((secondSum - firstSum) / firstSum) * 100);
    };

    const stats = getSummaryStats();
    const hasAnyData = stats.pageViews > 0 || stats.signups > 0 || stats.activeUsers > 0 || stats.orders > 0;

    // Simple sparkline component
    const Sparkline = ({ data, color, height = 50 }) => {
        if (!data || data.length === 0) return null;

        const max = Math.max(...data);
        const min = Math.min(...data);
        const range = max - min || 1;

        const points = data.map((value, index) => {
            const x = (index / (data.length - 1)) * 100;
            const y = height - ((value - min) / range) * height;
            return `${x},${y}`;
        }).join(' ');

        return (
            <svg width="100%" height={height} style={{ overflow: 'visible' }}>
                <polyline
                    points={points}
                    fill="none"
                    stroke={color}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
                <polyline
                    points={`0,${height} ${points} 100,${height}`}
                    fill={`${color}20`}
                    stroke="none"
                />
            </svg>
        );
    };

    if (loading) {
        return (
            <div className="admin-loading">
                <div className="admin-spinner"></div>
            </div>
        );
    }

    return (
        <div className="metrics-dashboard">
            {/* Time Range Selector */}
            <div className="admin-card">
                <div className="admin-card-header">
                    <h2 className="admin-card-title">
                        <span className="admin-card-title-icon">📊</span>
                        Analytics Overview
                    </h2>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        {[7, 30, 90].map(days => (
                            <button
                                key={days}
                                className={`admin-btn ${timeRange === days ? 'admin-btn-primary' : 'admin-btn-secondary'}`}
                                onClick={() => setTimeRange(days)}
                            >
                                {days} days
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Summary Stats */}
            <div className="admin-grid admin-grid-4">
                <div className="admin-stat-card">
                    <div className="admin-stat-header">
                        <div className="admin-stat-icon purple">👁️</div>
                        <div className={`admin-stat-trend ${getTrend('pageViews') >= 0 ? 'up' : 'down'}`}>
                            {getTrend('pageViews') >= 0 ? '↑' : '↓'} {Math.abs(getTrend('pageViews'))}%
                        </div>
                    </div>
                    <div className="admin-stat-value">{stats.pageViews.toLocaleString()}</div>
                    <div className="admin-stat-label">Total Page Views</div>
                    <div style={{ marginTop: '1rem' }}>
                        <Sparkline
                            data={analytics.map(d => d.pageViews?.total || 0)}
                            color="#a855f7"
                        />
                    </div>
                </div>

                <div className="admin-stat-card">
                    <div className="admin-stat-header">
                        <div className="admin-stat-icon cyan">📝</div>
                        <div className={`admin-stat-trend ${getTrend('signups') >= 0 ? 'up' : 'down'}`}>
                            {getTrend('signups') >= 0 ? '↑' : '↓'} {Math.abs(getTrend('signups'))}%
                        </div>
                    </div>
                    <div className="admin-stat-value">{stats.signups.toLocaleString()}</div>
                    <div className="admin-stat-label">New Signups ({timeRange}d)</div>
                    <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--admin-text-secondary)' }}>
                        {restaurantStats.totalCount} total restaurants
                    </div>
                    <div style={{ marginTop: '0.5rem' }}>
                        <Sparkline
                            data={analytics.map(d => d.signups || 0)}
                            color="#22d3ee"
                        />
                    </div>
                </div>

                <div className="admin-stat-card">
                    <div className="admin-stat-header">
                        <div className="admin-stat-icon green">👥</div>
                        <div className={`admin-stat-trend ${getTrend('activeUsers') >= 0 ? 'up' : 'down'}`}>
                            {getTrend('activeUsers') >= 0 ? '↑' : '↓'} {Math.abs(getTrend('activeUsers'))}%
                        </div>
                    </div>
                    <div className="admin-stat-value">{stats.avgActiveUsers.toLocaleString()}</div>
                    <div className="admin-stat-label">Avg. Active Users/Day</div>
                    <div style={{ marginTop: '1rem' }}>
                        <Sparkline
                            data={analytics.map(d => d.activeUsers || 0)}
                            color="#22c55e"
                        />
                    </div>
                </div>

                <div className="admin-stat-card">
                    <div className="admin-stat-header">
                        <div className="admin-stat-icon yellow">📦</div>
                        <div className={`admin-stat-trend ${getTrend('orders') >= 0 ? 'up' : 'down'}`}>
                            {getTrend('orders') >= 0 ? '↑' : '↓'} {Math.abs(getTrend('orders'))}%
                        </div>
                    </div>
                    <div className="admin-stat-value">{stats.orders.toLocaleString()}</div>
                    <div className="admin-stat-label">Total Orders ({timeRange}d)</div>
                    <div style={{ marginTop: '1rem' }}>
                        <Sparkline
                            data={analytics.map(d => d.orders || 0)}
                            color="#fbbf24"
                        />
                    </div>
                </div>
            </div>

            {/* Page Views Breakdown + Conversion Funnel */}
            <div className="admin-grid admin-grid-2">
                <div className="admin-card">
                    <div className="admin-card-header">
                        <h2 className="admin-card-title">
                            <span className="admin-card-title-icon">📈</span>
                            Page Views Breakdown
                        </h2>
                    </div>

                    <div className="admin-chart-container">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', height: '100%', justifyContent: 'center' }}>
                            {['homepage', 'pricing', 'signup'].map(page => {
                                const total = analytics.reduce((sum, d) => sum + (d.pageViews?.[page] || 0), 0);
                                const percentage = stats.pageViews > 0 ? (total / stats.pageViews * 100) : 0;

                                return (
                                    <div key={page}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                            <span style={{ textTransform: 'capitalize' }}>{page}</span>
                                            <span>{total.toLocaleString()} ({percentage.toFixed(1)}%)</span>
                                        </div>
                                        <div style={{
                                            height: '8px',
                                            background: 'var(--admin-bg)',
                                            borderRadius: '4px',
                                            overflow: 'hidden'
                                        }}>
                                            <div style={{
                                                height: '100%',
                                                width: `${percentage}%`,
                                                background: page === 'homepage' ? '#a855f7' :
                                                    page === 'pricing' ? '#22d3ee' : '#22c55e',
                                                borderRadius: '4px',
                                                transition: 'width 0.5s ease'
                                            }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div className="admin-card">
                    <div className="admin-card-header">
                        <h2 className="admin-card-title">
                            <span className="admin-card-title-icon">🎯</span>
                            Conversion Funnel
                        </h2>
                    </div>

                    <div className="admin-chart-container">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', height: '100%', justifyContent: 'center' }}>
                            {[
                                { label: 'Homepage Views', value: analytics.reduce((s, d) => s + (d.pageViews?.homepage || 0), 0), color: '#a855f7' },
                                { label: 'Pricing Page Views', value: analytics.reduce((s, d) => s + (d.pageViews?.pricing || 0), 0), color: '#6366f1' },
                                { label: 'Signup Page Views', value: analytics.reduce((s, d) => s + (d.pageViews?.signup || 0), 0), color: '#22d3ee' },
                                { label: 'Completed Signups', value: stats.signups, color: '#22c55e' }
                            ].map((stage, index, arr) => {
                                const maxValue = arr[0].value || 1;
                                const percentage = (stage.value / maxValue * 100);

                                return (
                                    <div key={stage.label}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                            <span>{stage.label}</span>
                                            <span>{stage.value.toLocaleString()}</span>
                                        </div>
                                        <div style={{
                                            height: '24px',
                                            background: 'var(--admin-bg)',
                                            borderRadius: '4px',
                                            overflow: 'hidden'
                                        }}>
                                            <div style={{
                                                height: '100%',
                                                width: `${percentage}%`,
                                                background: stage.color,
                                                borderRadius: '4px',
                                                transition: 'width 0.5s ease',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'flex-end',
                                                paddingRight: '8px',
                                                color: 'white',
                                                fontSize: '0.75rem',
                                                fontWeight: 600,
                                                minWidth: stage.value > 0 ? '30px' : '0'
                                            }}>
                                                {stage.value > 0 ? `${percentage.toFixed(0)}%` : ''}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>

            {/* Restaurant Tier Overview */}
            <div className="admin-card">
                <div className="admin-card-header">
                    <h2 className="admin-card-title">
                        <span className="admin-card-title-icon">🏪</span>
                        Restaurant Overview
                    </h2>
                </div>
                <div style={{ padding: '1rem 1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    {['scout', 'ally', 'guide', 'chief', 'elder'].map(tier => {
                        const count = restaurantStats.tierCounts?.[tier] || 0;
                        const colors = { scout: '#6b7280', ally: '#4ade80', guide: '#60a5fa', chief: '#f59e0b', elder: '#a855f7' };
                        const icons = { scout: '🔍', ally: '🌱', guide: '🧭', chief: '🦅', elder: '👑' };
                        return (
                            <div key={tier} style={{
                                flex: '1 1 120px',
                                background: `${colors[tier]}10`,
                                border: `1px solid ${colors[tier]}30`,
                                borderRadius: 'var(--admin-radius-sm)',
                                padding: '1rem',
                                textAlign: 'center'
                            }}>
                                <div style={{ fontSize: '1.5rem', marginBottom: '4px' }}>{icons[tier]}</div>
                                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: colors[tier] }}>{count}</div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--admin-text-secondary)', textTransform: 'capitalize' }}>{tier}</div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Daily Breakdown Table */}
            <div className="admin-card">
                <div className="admin-card-header">
                    <h2 className="admin-card-title">
                        <span className="admin-card-title-icon">📅</span>
                        Daily Breakdown
                    </h2>
                </div>

                <div style={{ overflowX: 'auto' }}>
                    <table className="admin-table">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Page Views</th>
                                <th>Signups</th>
                                <th>Active Users</th>
                                <th>Orders</th>
                                <th>Conversion Rate</th>
                            </tr>
                        </thead>
                        <tbody>
                            {analytics.slice(-10).reverse().map(day => {
                                const conversionRate = day.pageViews?.total > 0
                                    ? ((day.signups / day.pageViews.total) * 100).toFixed(2)
                                    : '0.00';

                                return (
                                    <tr key={day.date}>
                                        <td>{new Date(day.date).toLocaleDateString('en-US', {
                                            weekday: 'short',
                                            month: 'short',
                                            day: 'numeric'
                                        })}</td>
                                        <td>{(day.pageViews?.total || 0).toLocaleString()}</td>
                                        <td>{(day.signups || 0).toLocaleString()}</td>
                                        <td>{(day.activeUsers || 0).toLocaleString()}</td>
                                        <td>{(day.orders || 0).toLocaleString()}</td>
                                        <td>
                                            <span style={{
                                                color: parseFloat(conversionRate) > 2 ? 'var(--admin-green)' :
                                                    parseFloat(conversionRate) > 1 ? 'var(--admin-yellow)' : 'var(--admin-text-muted)'
                                            }}>
                                                {conversionRate}%
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Info note */}
            {!hasAnyData && (
                <div className="admin-card" style={{
                    background: 'rgba(34, 211, 238, 0.08)',
                    borderColor: 'rgba(34, 211, 238, 0.2)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '0.5rem' }}>
                        <span style={{ fontSize: '1.5rem' }}>ℹ️</span>
                        <div>
                            <strong style={{ display: 'block', marginBottom: '4px' }}>No Analytics Data Yet</strong>
                            <p style={{ margin: 0, color: 'var(--admin-text-secondary)' }}>
                                Analytics events (page views, signups, orders) will appear here as users interact with the platform.
                                Data is collected in real-time through the landing page, signup flow, and order processing.
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MetricsDashboard;
