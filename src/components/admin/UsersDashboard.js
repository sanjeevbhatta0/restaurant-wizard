import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { adminDb } from '../../adminFirebase';

const TIER_COLORS = {
  scout: '#6b7280',
  ally: '#4ade80',
  guide: '#60a5fa',
  chief: '#f59e0b',
  elder: '#a855f7'
};

const TIER_ICONS = {
  scout: '🔍',
  ally: '🌱',
  guide: '🧭',
  chief: '🦅',
  elder: '👑'
};

const TIER_PRICES = {
  scout: { monthly: 0, quarterly: 0, annual: 0 },
  ally: { monthly: 34.80, quarterly: 31.90, annual: 29 },
  guide: { monthly: 70.80, quarterly: 64.90, annual: 59 },
  chief: { monthly: 118.80, quarterly: 108.90, annual: 99 },
  elder: { monthly: 274.80, quarterly: 251.90, annual: 229 }
};

const UsersDashboard = () => {
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterTier, setFilterTier] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    loadRestaurants();
  }, []);

  const loadRestaurants = async () => {
    setLoading(true);
    try {
      const q = query(collection(adminDb, 'restaurants'));
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setRestaurants(data);
    } catch (error) {
      console.error('Error loading restaurants:', error);
    } finally {
      setLoading(false);
    }
  };

  // Compute stats
  const stats = useMemo(() => {
    const totalUsers = restaurants.length;
    const tierCounts = { scout: 0, ally: 0, guide: 0, chief: 0, elder: 0 };
    const statusCounts = { active: 0, inactive: 0, unknown: 0 };
    let totalMonthlyRevenue = 0;

    restaurants.forEach(r => {
      const tier = r.subscription?.tier || 'scout';
      const status = r.subscription?.status || 'unknown';
      const cycle = r.subscription?.billingCycle || 'monthly';
      const locationCount = r.subscription?.locationCount || 1;

      tierCounts[tier] = (tierCounts[tier] || 0) + 1;

      if (status === 'active') statusCounts.active++;
      else if (status === 'inactive' || status === 'cancelled') statusCounts.inactive++;
      else statusCounts.unknown++;

      // Calculate MRR (Monthly Recurring Revenue)
      if (status === 'active' && tier !== 'scout') {
        const tierPrice = TIER_PRICES[tier];
        if (tierPrice) {
          const monthlyPrice = cycle === 'annual' ? tierPrice.annual
            : cycle === 'quarterly' ? tierPrice.quarterly
            : tierPrice.monthly;
          totalMonthlyRevenue += monthlyPrice * locationCount;
        }
      }
    });

    return {
      totalUsers,
      tierCounts,
      statusCounts,
      mrr: totalMonthlyRevenue,
      arr: totalMonthlyRevenue * 12,
      paidUsers: totalUsers - (tierCounts.scout || 0),
      conversionRate: totalUsers > 0 ? ((totalUsers - (tierCounts.scout || 0)) / totalUsers * 100) : 0
    };
  }, [restaurants]);

  // Revenue by tier
  const revenueByTier = useMemo(() => {
    const result = {};
    restaurants.forEach(r => {
      const tier = r.subscription?.tier || 'scout';
      const status = r.subscription?.status || 'unknown';
      const cycle = r.subscription?.billingCycle || 'monthly';
      const locationCount = r.subscription?.locationCount || 1;

      if (!result[tier]) result[tier] = { count: 0, mrr: 0 };
      result[tier].count++;

      if (status === 'active' && tier !== 'scout') {
        const tierPrice = TIER_PRICES[tier];
        if (tierPrice) {
          const monthlyPrice = cycle === 'annual' ? tierPrice.annual
            : cycle === 'quarterly' ? tierPrice.quarterly
            : tierPrice.monthly;
          result[tier].mrr += monthlyPrice * locationCount;
        }
      }
    });
    return result;
  }, [restaurants]);

  // Signup timeline (last 12 months)
  const signupTimeline = useMemo(() => {
    const months = {};
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months[key] = { label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), count: 0 };
    }

    restaurants.forEach(r => {
      if (r.createdAt) {
        const date = new Date(r.createdAt);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (months[key]) months[key].count++;
      }
    });

    return Object.values(months);
  }, [restaurants]);

  // Filtered and sorted restaurants
  const filteredRestaurants = useMemo(() => {
    let filtered = [...restaurants];

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(r =>
        (r.restaurantName || '').toLowerCase().includes(term) ||
        (r.email || '').toLowerCase().includes(term) ||
        (r.username || '').toLowerCase().includes(term)
      );
    }

    if (filterTier !== 'all') {
      filtered = filtered.filter(r => (r.subscription?.tier || 'scout') === filterTier);
    }

    if (filterStatus !== 'all') {
      filtered = filtered.filter(r => (r.subscription?.status || 'unknown') === filterStatus);
    }

    filtered.sort((a, b) => {
      let valA, valB;
      if (sortBy === 'createdAt') {
        valA = a.createdAt || '';
        valB = b.createdAt || '';
      } else if (sortBy === 'name') {
        valA = (a.restaurantName || '').toLowerCase();
        valB = (b.restaurantName || '').toLowerCase();
      } else if (sortBy === 'tier') {
        const tierOrder = { scout: 0, ally: 1, guide: 2, chief: 3, elder: 4 };
        valA = tierOrder[a.subscription?.tier || 'scout'] || 0;
        valB = tierOrder[b.subscription?.tier || 'scout'] || 0;
      } else if (sortBy === 'revenue') {
        const getRevenue = (r) => {
          const tier = r.subscription?.tier || 'scout';
          const cycle = r.subscription?.billingCycle || 'monthly';
          const locs = r.subscription?.locationCount || 1;
          if (tier === 'scout') return 0;
          const price = TIER_PRICES[tier];
          return (cycle === 'annual' ? price.annual : cycle === 'quarterly' ? price.quarterly : price.monthly) * locs;
        };
        valA = getRevenue(a);
        valB = getRevenue(b);
      }

      if (valA < valB) return sortDir === 'asc' ? -1 : 1;
      if (valA > valB) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [restaurants, searchTerm, filterTier, filterStatus, sortBy, sortDir]);

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDir('desc');
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    });
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  // Simple bar chart for signup timeline
  const SignupChart = ({ data }) => {
    const maxCount = Math.max(...data.map(d => d.count), 1);
    return (
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '120px', padding: '0 4px' }}>
        {data.map((month, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '0.65rem', color: 'var(--admin-text-muted)' }}>
              {month.count > 0 ? month.count : ''}
            </span>
            <div
              style={{
                width: '100%',
                maxWidth: '40px',
                height: `${Math.max(4, (month.count / maxCount) * 90)}px`,
                background: month.count > 0 ? 'var(--admin-accent-gradient)' : 'var(--admin-glass)',
                borderRadius: '4px 4px 0 0',
                transition: 'height 0.5s ease'
              }}
            />
            <span style={{ fontSize: '0.6rem', color: 'var(--admin-text-muted)', whiteSpace: 'nowrap' }}>
              {month.label}
            </span>
          </div>
        ))}
      </div>
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
      {/* KPI Cards */}
      <div className="admin-grid admin-grid-4">
        <div className="admin-stat-card">
          <div className="admin-stat-header">
            <div className="admin-stat-icon purple">🏪</div>
          </div>
          <div className="admin-stat-value">{stats.totalUsers}</div>
          <div className="admin-stat-label">Total Restaurants</div>
          <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--admin-text-secondary)' }}>
            {stats.statusCounts.active} active &middot; {stats.statusCounts.inactive} inactive
          </div>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-header">
            <div className="admin-stat-icon green">💰</div>
          </div>
          <div className="admin-stat-value">{formatCurrency(stats.mrr)}</div>
          <div className="admin-stat-label">Monthly Recurring Revenue</div>
          <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--admin-text-secondary)' }}>
            {formatCurrency(stats.arr)} ARR
          </div>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-header">
            <div className="admin-stat-icon cyan">💳</div>
          </div>
          <div className="admin-stat-value">{stats.paidUsers}</div>
          <div className="admin-stat-label">Paid Subscribers</div>
          <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--admin-text-secondary)' }}>
            {stats.conversionRate.toFixed(1)}% conversion rate
          </div>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-header">
            <div className="admin-stat-icon yellow">📊</div>
          </div>
          <div className="admin-stat-value">
            {stats.paidUsers > 0 ? formatCurrency(stats.mrr / stats.paidUsers) : '$0.00'}
          </div>
          <div className="admin-stat-label">Avg Revenue Per User</div>
          <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--admin-text-secondary)' }}>
            Per paying customer
          </div>
        </div>
      </div>

      {/* Tier Distribution + Signup Timeline */}
      <div className="admin-grid admin-grid-2">
        {/* Tier Distribution */}
        <div className="admin-card">
          <div className="admin-card-header">
            <h2 className="admin-card-title">
              <span className="admin-card-title-icon">📋</span>
              Plan Distribution
            </h2>
          </div>
          <div style={{ padding: '1.5rem' }}>
            {['scout', 'ally', 'guide', 'chief', 'elder'].map(tier => {
              const count = stats.tierCounts[tier] || 0;
              const pct = stats.totalUsers > 0 ? (count / stats.totalUsers * 100) : 0;
              const revenue = revenueByTier[tier]?.mrr || 0;

              return (
                <div key={tier} style={{ marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>{TIER_ICONS[tier]}</span>
                      <span style={{ textTransform: 'capitalize', fontWeight: 600 }}>{tier}</span>
                      <span style={{
                        background: `${TIER_COLORS[tier]}20`,
                        color: TIER_COLORS[tier],
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '0.75rem',
                        fontWeight: 600
                      }}>
                        {count} users
                      </span>
                    </div>
                    <span style={{ color: 'var(--admin-text-secondary)', fontSize: '0.85rem' }}>
                      {revenue > 0 ? `${formatCurrency(revenue)}/mo` : 'Free'}
                    </span>
                  </div>
                  <div style={{
                    height: '8px',
                    background: 'var(--admin-bg)',
                    borderRadius: '4px',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${pct}%`,
                      background: TIER_COLORS[tier],
                      borderRadius: '4px',
                      transition: 'width 0.5s ease',
                      minWidth: count > 0 ? '4px' : '0'
                    }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Signup Timeline */}
        <div className="admin-card">
          <div className="admin-card-header">
            <h2 className="admin-card-title">
              <span className="admin-card-title-icon">📈</span>
              Signups (Last 12 Months)
            </h2>
          </div>
          <div style={{ padding: '1.5rem' }}>
            <SignupChart data={signupTimeline} />
          </div>
        </div>
      </div>

      {/* Revenue Breakdown */}
      <div className="admin-card">
        <div className="admin-card-header">
          <h2 className="admin-card-title">
            <span className="admin-card-title-icon">💵</span>
            Revenue Breakdown
          </h2>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Plan</th>
                <th>Subscribers</th>
                <th>MRR (Monthly)</th>
                <th>Quarterly</th>
                <th>Annual (ARR)</th>
                <th>% of Revenue</th>
              </tr>
            </thead>
            <tbody>
              {['ally', 'guide', 'chief', 'elder'].map(tier => {
                const data = revenueByTier[tier] || { count: 0, mrr: 0 };
                const pctRevenue = stats.mrr > 0 ? (data.mrr / stats.mrr * 100) : 0;

                return (
                  <tr key={tier}>
                    <td>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>{TIER_ICONS[tier]}</span>
                        <span style={{ textTransform: 'capitalize', fontWeight: 600 }}>{tier}</span>
                      </span>
                    </td>
                    <td>{data.count}</td>
                    <td style={{ color: 'var(--admin-green)', fontWeight: 600 }}>{formatCurrency(data.mrr)}</td>
                    <td>{formatCurrency(data.mrr * 3)}</td>
                    <td>{formatCurrency(data.mrr * 12)}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{
                          height: '6px',
                          width: '60px',
                          background: 'var(--admin-bg)',
                          borderRadius: '3px',
                          overflow: 'hidden'
                        }}>
                          <div style={{
                            height: '100%',
                            width: `${pctRevenue}%`,
                            background: TIER_COLORS[tier],
                            borderRadius: '3px'
                          }} />
                        </div>
                        <span>{pctRevenue.toFixed(1)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              <tr style={{ fontWeight: 700, borderTop: '2px solid var(--admin-border)' }}>
                <td>Total</td>
                <td>{stats.paidUsers}</td>
                <td style={{ color: 'var(--admin-green)' }}>{formatCurrency(stats.mrr)}</td>
                <td>{formatCurrency(stats.mrr * 3)}</td>
                <td>{formatCurrency(stats.arr)}</td>
                <td>100%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Restaurant List */}
      <div className="admin-card">
        <div className="admin-card-header">
          <h2 className="admin-card-title">
            <span className="admin-card-title-icon">🏪</span>
            All Restaurants ({filteredRestaurants.length})
          </h2>
          <button
            className="admin-btn admin-btn-secondary"
            onClick={loadRestaurants}
            style={{ fontSize: '0.85rem' }}
          >
            🔄 Refresh
          </button>
        </div>

        {/* Filters */}
        <div style={{
          display: 'flex',
          gap: '12px',
          padding: '0 1.5rem 1rem',
          flexWrap: 'wrap',
          alignItems: 'center'
        }}>
          <div style={{ flex: '1 1 200px' }}>
            <input
              type="text"
              placeholder="Search by name, email, or username..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: 'var(--admin-bg)',
                border: '1px solid var(--admin-border)',
                borderRadius: 'var(--admin-radius-sm)',
                color: 'var(--admin-text-primary)',
                fontSize: '0.85rem',
                outline: 'none'
              }}
            />
          </div>
          <select
            value={filterTier}
            onChange={(e) => setFilterTier(e.target.value)}
            style={{
              padding: '8px 12px',
              background: 'var(--admin-bg)',
              border: '1px solid var(--admin-border)',
              borderRadius: 'var(--admin-radius-sm)',
              color: 'var(--admin-text-primary)',
              fontSize: '0.85rem',
              outline: 'none'
            }}
          >
            <option value="all">All Plans</option>
            <option value="scout">Scout</option>
            <option value="ally">Ally</option>
            <option value="guide">Guide</option>
            <option value="chief">Chief</option>
            <option value="elder">Elder</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={{
              padding: '8px 12px',
              background: 'var(--admin-bg)',
              border: '1px solid var(--admin-border)',
              borderRadius: 'var(--admin-radius-sm)',
              color: 'var(--admin-text-primary)',
              fontSize: '0.85rem',
              outline: 'none'
            }}
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th
                  style={{ cursor: 'pointer' }}
                  onClick={() => handleSort('name')}
                >
                  Restaurant {sortBy === 'name' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </th>
                <th>Contact</th>
                <th
                  style={{ cursor: 'pointer' }}
                  onClick={() => handleSort('tier')}
                >
                  Plan {sortBy === 'tier' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </th>
                <th>Billing</th>
                <th>Locations</th>
                <th
                  style={{ cursor: 'pointer' }}
                  onClick={() => handleSort('revenue')}
                >
                  MRR {sortBy === 'revenue' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </th>
                <th>Status</th>
                <th
                  style={{ cursor: 'pointer' }}
                  onClick={() => handleSort('createdAt')}
                >
                  Joined {sortBy === 'createdAt' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredRestaurants.length === 0 ? (
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center', padding: '2rem', color: 'var(--admin-text-muted)' }}>
                    No restaurants found
                  </td>
                </tr>
              ) : (
                filteredRestaurants.map(r => {
                  const tier = r.subscription?.tier || 'scout';
                  const status = r.subscription?.status || 'unknown';
                  const cycle = r.subscription?.billingCycle || 'monthly';
                  const locs = r.subscription?.locationCount || 1;
                  const tierPrice = TIER_PRICES[tier];
                  let mrr = 0;
                  if (tier !== 'scout' && status === 'active' && tierPrice) {
                    mrr = (cycle === 'annual' ? tierPrice.annual : cycle === 'quarterly' ? tierPrice.quarterly : tierPrice.monthly) * locs;
                  }

                  return (
                    <tr key={r.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.restaurantName || 'Unnamed'}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--admin-text-muted)' }}>
                          @{r.username || 'N/A'}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontSize: '0.85rem' }}>{r.email || 'N/A'}</div>
                      </td>
                      <td>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          background: `${TIER_COLORS[tier]}20`,
                          color: TIER_COLORS[tier],
                          padding: '4px 10px',
                          borderRadius: '12px',
                          fontSize: '0.8rem',
                          fontWeight: 600,
                          textTransform: 'capitalize'
                        }}>
                          {TIER_ICONS[tier]} {tier}
                        </span>
                      </td>
                      <td style={{ textTransform: 'capitalize', fontSize: '0.85rem' }}>{cycle}</td>
                      <td>{locs}</td>
                      <td style={{
                        fontWeight: 600,
                        color: mrr > 0 ? 'var(--admin-green)' : 'var(--admin-text-muted)'
                      }}>
                        {mrr > 0 ? formatCurrency(mrr) : 'Free'}
                      </td>
                      <td>
                        <span style={{
                          display: 'inline-block',
                          padding: '3px 10px',
                          borderRadius: '12px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          background: status === 'active' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                          color: status === 'active' ? 'var(--admin-green)' : 'var(--admin-red)'
                        }}>
                          {status === 'active' ? '● Active' : '● Inactive'}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.85rem', color: 'var(--admin-text-secondary)' }}>
                        {formatDate(r.createdAt)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default UsersDashboard;
