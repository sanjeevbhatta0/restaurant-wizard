import React, { useState, useEffect, useCallback } from 'react';
import { Card, Button, Spinner, Alert, Badge, Row, Col, Form, ProgressBar } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { useMenu } from '../contexts/MenuContext';
import { collection, query, orderBy, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import analyticsAIService from '../services/analyticsAIService';
import './AIAnalytics.css';

const AIAnalytics = () => {
    const [selectedTier, setSelectedTier] = useState('tier1');
    const [loading, setLoading] = useState({});
    const [insights, setInsights] = useState({});
    const [error, setError] = useState('');
    const [orderData, setOrderData] = useState(null);
    const [menuData, setMenuData] = useState(null);
    const [chatQuestion, setChatQuestion] = useState('');
    const [chatHistory, setChatHistory] = useState([]);
    const { currentUser } = useAuth();
    const { categories } = useMenu();

    // Prepare order data for AI
    const prepareOrderData = useCallback(async () => {
        if (!currentUser) return null;

        try {
            const ordersRef = collection(db, `restaurants/${currentUser.uid}/orders`);
            const q = query(ordersRef, orderBy('createdAt', 'desc'));
            const snapshot = await getDocs(q);

            const orders = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            // Calculate summary statistics
            const totalRevenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);
            const avgOrderValue = orders.length > 0 ? totalRevenue / orders.length : 0;

            // Count items
            const itemCounts = {};
            orders.forEach(order => {
                if (order.items) {
                    order.items.forEach(item => {
                        const name = item.name || 'Unknown';
                        itemCounts[name] = (itemCounts[name] || 0) + (item.quantity || 1);
                    });
                }
            });

            const topItems = Object.entries(itemCounts)
                .map(([name, count]) => ({ name, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 10);

            // Orders by day of week
            const ordersByDay = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 };
            const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

            // Orders by hour
            const ordersByHour = {};
            for (let i = 0; i < 24; i++) {
                ordersByHour[i] = 0;
            }

            orders.forEach(order => {
                const date = order.createdAt?.toDate ? order.createdAt.toDate() : new Date(order.createdAt);
                if (date) {
                    ordersByDay[days[date.getDay()]]++;
                    ordersByHour[date.getHours()]++;
                }
            });

            return {
                totalOrders: orders.length,
                totalRevenue,
                avgOrderValue,
                topItems,
                ordersByDay,
                ordersByHour,
                trend: orders.length > 10 ? 'stable' : 'growing'
            };
        } catch (err) {
            console.error('Error preparing order data:', err);
            return null;
        }
    }, [currentUser]);

    // Prepare menu data for AI
    const prepareMenuData = useCallback(() => {
        if (!categories || categories.length === 0) return null;

        let allItems = [];
        categories.forEach(cat => {
            if (cat.items) {
                allItems = [...allItems, ...cat.items];
            }
        });

        const prices = allItems.map(i => i.price || 0).filter(p => p > 0);
        const discountedItems = allItems.filter(i => i.discount && i.discount > 0).length;

        return {
            categoryCount: categories.length,
            itemCount: allItems.length,
            minPrice: prices.length > 0 ? Math.min(...prices) : 0,
            maxPrice: prices.length > 0 ? Math.max(...prices) : 0,
            avgPrice: prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0,
            discountedItems
        };
    }, [categories]);

    // Load data on mount
    useEffect(() => {
        const loadData = async () => {
            const orders = await prepareOrderData();
            const menu = prepareMenuData();
            setOrderData(orders);
            setMenuData(menu);
        };
        loadData();
    }, [prepareOrderData, prepareMenuData]);

    // Fetch insight by type
    const fetchInsight = async (tier, analysisType) => {
        const key = `${tier}_${analysisType}`;
        setLoading(prev => ({ ...prev, [key]: true }));
        setError('');

        try {
            const result = await analyticsAIService.getAnalytics(
                tier,
                analysisType,
                orderData,
                menuData
            );

            if (result.success) {
                setInsights(prev => ({ ...prev, [key]: result.data }));
            }
        } catch (err) {
            console.error('Error fetching insight:', err);
            setError(`Failed to load ${analysisType}: ${err.message}`);
        } finally {
            setLoading(prev => ({ ...prev, [key]: false }));
        }
    };

    // Handle AI chat
    const handleAskAI = async () => {
        if (!chatQuestion.trim()) return;

        const userQuestion = chatQuestion;
        setChatHistory(prev => [...prev, { role: 'user', content: userQuestion }]);
        setChatQuestion('');
        setLoading(prev => ({ ...prev, aiChat: true }));

        try {
            const result = await analyticsAIService.askAI(userQuestion, orderData, menuData);
            if (result.success && result.data) {
                setChatHistory(prev => [...prev, {
                    role: 'assistant',
                    content: result.data.response,
                    followUps: result.data.followUpQuestions
                }]);
            }
        } catch (err) {
            setChatHistory(prev => [...prev, {
                role: 'assistant',
                content: 'Sorry, I encountered an error. Please try again.'
            }]);
        } finally {
            setLoading(prev => ({ ...prev, aiChat: false }));
        }
    };

    // Render insight card with loading state
    const renderInsightCard = (tier, analysisType, title, icon, renderContent) => {
        const key = `${tier}_${analysisType}`;
        const isLoading = loading[key];
        const data = insights[key];

        return (
            <Card className="mb-4 ai-insight-card">
                <Card.Header className="d-flex justify-content-between align-items-center">
                    <h5 className="mb-0">
                        <i className={`bi ${icon} me-2`}></i>
                        {title}
                    </h5>
                    <Button
                        variant="outline-primary"
                        size="sm"
                        onClick={() => fetchInsight(tier, analysisType)}
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <><Spinner animation="border" size="sm" /> Analyzing...</>
                        ) : data ? (
                            <><i className="bi bi-arrow-clockwise"></i> Refresh</>
                        ) : (
                            <><i className="bi bi-magic"></i> Generate</>
                        )}
                    </Button>
                </Card.Header>
                <Card.Body>
                    {isLoading ? (
                        <div className="text-center py-4">
                            <Spinner animation="border" variant="primary" />
                            <p className="mt-2 text-muted">AI is analyzing your data...</p>
                        </div>
                    ) : data ? (
                        renderContent(data)
                    ) : (
                        <div className="text-center py-4 text-muted">
                            <i className="bi bi-robot" style={{ fontSize: '2rem' }}></i>
                            <p className="mt-2">Click "Generate" to get AI insights</p>
                        </div>
                    )}
                </Card.Body>
            </Card>
        );
    };

    // Tier 1: Essential Insights
    const renderTier1 = () => (
        <>
            {renderInsightCard(1, 'businessSummary', 'Business Summary', 'bi-graph-up', (data) => (
                <div>
                    <h4 className="text-primary mb-3">{data.headline}</h4>
                    <p className="lead">{data.summary}</p>

                    {data.keyMetrics && (
                        <Row className="mt-3">
                            {data.keyMetrics.map((metric, i) => (
                                <Col md={4} key={i} className="mb-2">
                                    <Card className="bg-light">
                                        <Card.Body className="p-2 text-center">
                                            <small className="text-muted">{metric.label}</small>
                                            <h5 className="mb-0">{metric.value}</h5>
                                            <Badge bg={metric.trend === 'up' ? 'success' : metric.trend === 'down' ? 'danger' : 'secondary'}>
                                                {metric.trend}
                                            </Badge>
                                        </Card.Body>
                                    </Card>
                                </Col>
                            ))}
                        </Row>
                    )}

                    {data.topInsight && (
                        <Alert variant="info" className="mt-3 mb-0">
                            <i className="bi bi-lightbulb me-2"></i>
                            <strong>Key Insight:</strong> {data.topInsight}
                        </Alert>
                    )}
                </div>
            ))}

            {renderInsightCard(1, 'salesPrediction', 'Sales Prediction', 'bi-calendar-check', (data) => (
                <div>
                    {data.prediction && (
                        <>
                            <div className="d-flex justify-content-between align-items-center mb-3">
                                <div>
                                    <small className="text-muted">Predicted Next Week Revenue</small>
                                    <h3 className="text-success mb-0">${data.prediction.nextWeekRevenue?.toFixed(2)}</h3>
                                </div>
                                <div className="text-end">
                                    <Badge bg="success" className="me-1">Peak: {data.prediction.peakDay}</Badge>
                                    <Badge bg="warning">Slow: {data.prediction.slowestDay}</Badge>
                                </div>
                            </div>

                            {data.prediction.dailyBreakdown && (
                                <div className="mb-3">
                                    {data.prediction.dailyBreakdown.map((day, i) => (
                                        <div key={i} className="d-flex align-items-center mb-1">
                                            <span style={{ width: '80px' }}>{day.day}</span>
                                            <ProgressBar
                                                now={(day.predicted / data.prediction.nextWeekRevenue) * 100 * 7}
                                                className="flex-grow-1 me-2"
                                                variant={day.confidence === 'high' ? 'success' : day.confidence === 'medium' ? 'warning' : 'secondary'}
                                            />
                                            <span style={{ width: '60px' }}>${day.predicted}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}

                    <p className="text-muted small">{data.methodology}</p>

                    {data.recommendations && (
                        <Alert variant="success" className="mb-0">
                            <strong>Recommendations:</strong>
                            <ul className="mb-0 mt-1">
                                {data.recommendations.map((rec, i) => (
                                    <li key={i}>{rec}</li>
                                ))}
                            </ul>
                        </Alert>
                    )}
                </div>
            ))}

            {renderInsightCard(1, 'anomalyAlerts', 'Anomaly Alerts', 'bi-exclamation-triangle', (data) => (
                <div>
                    <div className="d-flex align-items-center mb-3">
                        <div className="me-3">
                            <div className="health-score" style={{
                                width: '80px',
                                height: '80px',
                                borderRadius: '50%',
                                background: data.healthScore >= 80 ? '#28a745' : data.healthScore >= 60 ? '#ffc107' : '#dc3545',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'white',
                                fontWeight: 'bold',
                                fontSize: '1.5rem'
                            }}>
                                {data.healthScore}
                            </div>
                        </div>
                        <div>
                            <h5 className="mb-1">Health Score</h5>
                            <p className="mb-0">{data.healthDescription}</p>
                        </div>
                    </div>

                    {data.alerts && data.alerts.length > 0 ? (
                        data.alerts.map((alert, i) => (
                            <Alert
                                key={i}
                                variant={alert.severity === 'high' ? 'danger' : alert.severity === 'medium' ? 'warning' : 'info'}
                                className="mb-2"
                            >
                                <Alert.Heading className="h6">{alert.title}</Alert.Heading>
                                <p className="mb-1">{alert.description}</p>
                                <small><strong>Action:</strong> {alert.recommendation}</small>
                            </Alert>
                        ))
                    ) : (
                        <Alert variant="success">
                            <i className="bi bi-check-circle me-2"></i>
                            No anomalies detected. Your business is running smoothly!
                        </Alert>
                    )}
                </div>
            ))}
        </>
    );

    // Tier 2: Differentiation
    const renderTier2 = () => (
        <>
            {renderInsightCard(2, 'menuOptimization', 'Menu Optimization', 'bi-clipboard-data', (data) => (
                <div>
                    <div className="d-flex align-items-center mb-3">
                        <Badge bg="primary" className="me-2" style={{ fontSize: '1.2rem', padding: '10px 15px' }}>
                            Menu Score: {data.menuHealthScore}/100
                        </Badge>
                    </div>

                    {data.stars && data.stars.length > 0 && (
                        <div className="mb-3">
                            <h6><i className="bi bi-star-fill text-warning me-1"></i> Top Performers</h6>
                            <div className="d-flex flex-wrap gap-1">
                                {data.stars.map((item, i) => (
                                    <Badge key={i} bg="success">{item}</Badge>
                                ))}
                            </div>
                        </div>
                    )}

                    {data.recommendations && data.recommendations.map((rec, i) => (
                        <Card key={i} className={`mb-2 border-${rec.priority === 'high' ? 'danger' : rec.priority === 'medium' ? 'warning' : 'secondary'}`}>
                            <Card.Body className="p-2">
                                <div className="d-flex justify-content-between">
                                    <strong>{rec.item}</strong>
                                    <Badge bg={rec.type === 'promote' ? 'success' : rec.type === 'remove' ? 'danger' : 'warning'}>
                                        {rec.type}
                                    </Badge>
                                </div>
                                <small className="text-muted">{rec.reason}</small>
                                <br />
                                <small className="text-success">{rec.expectedImpact}</small>
                            </Card.Body>
                        </Card>
                    ))}

                    {data.quickWins && (
                        <Alert variant="success" className="mt-3 mb-0">
                            <strong>Quick Wins:</strong>
                            <ul className="mb-0">
                                {data.quickWins.map((win, i) => <li key={i}>{win}</li>)}
                            </ul>
                        </Alert>
                    )}
                </div>
            ))}

            {renderInsightCard(2, 'staffInsights', 'Staff & Peak Hours', 'bi-people', (data) => (
                <div>
                    <Row>
                        <Col md={6}>
                            <h6 className="text-success"><i className="bi bi-graph-up-arrow me-1"></i> Peak Hours</h6>
                            {data.peakHours?.map((peak, i) => (
                                <Badge key={i} bg="success" className="me-1 mb-1">{peak.hour}</Badge>
                            ))}
                        </Col>
                        <Col md={6}>
                            <h6 className="text-warning"><i className="bi bi-graph-down-arrow me-1"></i> Slow Periods</h6>
                            {data.slowPeriods?.map((slow, i) => (
                                <Badge key={i} bg="secondary" className="me-1 mb-1">{slow.hour}</Badge>
                            ))}
                        </Col>
                    </Row>

                    {data.optimalSchedule && (
                        <Card className="mt-3 bg-light">
                            <Card.Body>
                                <h6>Recommended Scheduling</h6>
                                <p className="mb-1"><strong>Weekdays:</strong> {data.optimalSchedule.weekday}</p>
                                <p className="mb-0"><strong>Weekends:</strong> {data.optimalSchedule.weekend}</p>
                            </Card.Body>
                        </Card>
                    )}

                    {data.efficiencyTips && (
                        <Alert variant="info" className="mt-3 mb-0">
                            <strong>Efficiency Tips:</strong>
                            <ul className="mb-0">
                                {data.efficiencyTips.map((tip, i) => <li key={i}>{tip}</li>)}
                            </ul>
                        </Alert>
                    )}
                </div>
            ))}

            {renderInsightCard(2, 'orderCombos', 'Popular Combos', 'bi-basket', (data) => (
                <div>
                    {data.popularCombos?.map((combo, i) => (
                        <Card key={i} className="mb-2">
                            <Card.Body className="p-2">
                                <div className="d-flex flex-wrap gap-1 mb-1">
                                    {combo.items.map((item, j) => (
                                        <Badge key={j} bg="primary">{item}</Badge>
                                    ))}
                                </div>
                                <small className="text-muted">Ordered together {combo.frequency}</small>
                                <br />
                                <small className="text-success">{combo.suggestion}</small>
                            </Card.Body>
                        </Card>
                    ))}

                    {data.bundleOpportunities && (
                        <Alert variant="success" className="mt-3">
                            <strong><i className="bi bi-lightbulb me-1"></i> Bundle Opportunities:</strong>
                            {data.bundleOpportunities.map((bundle, i) => (
                                <div key={i} className="mt-2">
                                    <strong>{bundle.name}</strong> - ${bundle.suggestedPrice}
                                    <br />
                                    <small>{bundle.items.join(' + ')}</small>
                                    <br />
                                    <small className="text-success">Expected uplift: {bundle.expectedUplift}</small>
                                </div>
                            ))}
                        </Alert>
                    )}
                </div>
            ))}
        </>
    );

    // Tier 3: Premium
    const renderTier3 = () => (
        <>
            {renderInsightCard(3, 'marketPosition', 'Market Position', 'bi-trophy', (data) => (
                <div>
                    <div className="text-center mb-3">
                        <h4>
                            <Badge bg={data.pricePosition === 'premium' ? 'primary' : data.pricePosition === 'budget' ? 'success' : 'info'}
                                style={{ fontSize: '1.2rem' }}>
                                {data.pricePosition?.toUpperCase()} POSITIONING
                            </Badge>
                        </h4>
                    </div>

                    {data.insights?.map((insight, i) => (
                        <Card key={i} className="mb-2 bg-light">
                            <Card.Body className="p-2">
                                <strong>{insight.category}</strong>
                                <p className="mb-1 small">{insight.assessment}</p>
                                <small className="text-primary">{insight.recommendation}</small>
                            </Card.Body>
                        </Card>
                    ))}

                    {data.competitiveAdvantages && (
                        <Alert variant="success" className="mt-3">
                            <strong>Your Competitive Advantages:</strong>
                            <ul className="mb-0">
                                {data.competitiveAdvantages.map((adv, i) => <li key={i}>{adv}</li>)}
                            </ul>
                        </Alert>
                    )}

                    <p className="mt-3 mb-0"><strong>Strategy:</strong> {data.pricingStrategy}</p>
                </div>
            ))}

            {/* AI Chat */}
            <Card className="mb-4 ai-insight-card">
                <Card.Header>
                    <h5 className="mb-0">
                        <i className="bi bi-chat-dots me-2"></i>
                        Ask AI Anything
                    </h5>
                </Card.Header>
                <Card.Body>
                    <div className="chat-history mb-3" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                        {chatHistory.length === 0 ? (
                            <div className="text-center text-muted py-3">
                                <i className="bi bi-robot" style={{ fontSize: '2rem' }}></i>
                                <p>Ask me anything about your restaurant data!</p>
                                <small>Example: "What's my best selling day?" or "How can I increase sales?"</small>
                            </div>
                        ) : (
                            chatHistory.map((msg, i) => (
                                <div key={i} className={`chat-message ${msg.role} mb-2`}>
                                    <div className={`p-2 rounded ${msg.role === 'user' ? 'bg-primary text-white ms-5' : 'bg-light me-5'}`}>
                                        {msg.content}
                                    </div>
                                    {msg.followUps && (
                                        <div className="mt-1 ms-2">
                                            {msg.followUps.map((q, j) => (
                                                <Button
                                                    key={j}
                                                    variant="outline-secondary"
                                                    size="sm"
                                                    className="me-1 mb-1"
                                                    onClick={() => setChatQuestion(q)}
                                                >
                                                    {q}
                                                </Button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                        {loading.aiChat && (
                            <div className="text-center">
                                <Spinner animation="border" size="sm" /> AI is thinking...
                            </div>
                        )}
                    </div>

                    <Form onSubmit={(e) => { e.preventDefault(); handleAskAI(); }}>
                        <div className="d-flex gap-2">
                            <Form.Control
                                type="text"
                                value={chatQuestion}
                                onChange={(e) => setChatQuestion(e.target.value)}
                                placeholder="Ask about your business..."
                                disabled={loading.aiChat}
                            />
                            <Button type="submit" disabled={loading.aiChat || !chatQuestion.trim()}>
                                <i className="bi bi-send"></i>
                            </Button>
                        </div>
                    </Form>
                </Card.Body>
            </Card>

            {renderInsightCard(3, 'weeklyReport', 'Weekly Report', 'bi-file-text', (data) => (
                <div>
                    <h4>{data.reportTitle}</h4>
                    <small className="text-muted">{data.period}</small>

                    <Alert variant="primary" className="mt-3">
                        <strong>Executive Summary:</strong> {data.executiveSummary}
                    </Alert>

                    {data.sections?.map((section, i) => (
                        <Card key={i} className="mb-2">
                            <Card.Header className="py-2">
                                <strong>{section.title}</strong>
                                {section.highlight && <Badge bg="info" className="ms-2">{section.highlight}</Badge>}
                            </Card.Header>
                            <Card.Body className="py-2">
                                {section.content}
                            </Card.Body>
                        </Card>
                    ))}

                    {data.actionItems && (
                        <div className="mt-3">
                            <h6>Action Items</h6>
                            {data.actionItems.map((action, i) => (
                                <div key={i} className="d-flex align-items-center mb-1">
                                    <Badge bg={action.priority === 'high' ? 'danger' : action.priority === 'medium' ? 'warning' : 'secondary'} className="me-2">
                                        {action.priority}
                                    </Badge>
                                    <span>{action.task}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {data.nextWeekFocus && (
                        <Alert variant="success" className="mt-3 mb-0">
                            <strong>Next Week Focus:</strong> {data.nextWeekFocus}
                        </Alert>
                    )}
                </div>
            ))}
        </>
    );

    return (
        <div className="ai-analytics-container">
            {error && (
                <Alert variant="danger" onClose={() => setError('')} dismissible>
                    {error}
                </Alert>
            )}

            {/* Tier Tab Navigation */}
            <Card className="mb-4">
                <Card.Header
                    className="p-0"
                    style={{
                        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                        borderBottom: 'none'
                    }}
                >
                    <div className="d-flex justify-content-center gap-2 p-3">
                        <Button
                            variant={selectedTier === 'tier1' ? 'light' : 'outline-light'}
                            onClick={() => setSelectedTier('tier1')}
                            className="px-4 py-2"
                            style={{
                                borderRadius: '50px',
                                fontWeight: selectedTier === 'tier1' ? '600' : '400',
                                color: selectedTier === 'tier1' ? '#667eea' : 'white'
                            }}
                        >
                            <i className="bi bi-lightning-charge me-2"></i>
                            Essential
                        </Button>
                        <Button
                            variant={selectedTier === 'tier2' ? 'light' : 'outline-light'}
                            onClick={() => setSelectedTier('tier2')}
                            className="px-4 py-2"
                            style={{
                                borderRadius: '50px',
                                fontWeight: selectedTier === 'tier2' ? '600' : '400',
                                color: selectedTier === 'tier2' ? '#667eea' : 'white'
                            }}
                        >
                            <i className="bi bi-star me-2"></i>
                            Differentiation
                        </Button>
                        <Button
                            variant={selectedTier === 'tier3' ? 'light' : 'outline-light'}
                            onClick={() => setSelectedTier('tier3')}
                            className="px-4 py-2"
                            style={{
                                borderRadius: '50px',
                                fontWeight: selectedTier === 'tier3' ? '600' : '400',
                                color: selectedTier === 'tier3' ? '#667eea' : 'white'
                            }}
                        >
                            <i className="bi bi-gem me-2"></i>
                            Premium
                        </Button>
                    </div>
                </Card.Header>
            </Card>

            {/* Tier Content */}
            {selectedTier === 'tier1' && renderTier1()}
            {selectedTier === 'tier2' && renderTier2()}
            {selectedTier === 'tier3' && renderTier3()}
        </div>
    );
};

export default AIAnalytics;
