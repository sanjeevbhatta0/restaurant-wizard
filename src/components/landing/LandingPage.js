import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import PricingTiers from './PricingTiers';
import { trackPageView } from '../../services/platformAnalyticsService';
import './LandingPage.css';

const LandingPage = () => {
    const [scrolled, setScrolled] = useState(false);
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [contactForm, setContactForm] = useState({
        name: '',
        email: '',
        restaurant: '',
        message: ''
    });
    const [formSubmitted, setFormSubmitted] = useState(false);
    const navigate = useNavigate();

    // Track page view on mount
    useEffect(() => {
        trackPageView('homepage');
    }, []);

    useEffect(() => {
        const handleScroll = () => {
            setScrolled(window.scrollY > 50);
        };
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    const scrollToSection = (sectionId) => {
        const element = document.getElementById(sectionId);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth' });
        }
        setMobileNavOpen(false);
    };

    const [submitting, setSubmitting] = useState(false);
    const [contactError, setContactError] = useState('');

    const handleContactSubmit = async (e) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            const submitContact = httpsCallable(functions, 'submitContactForm');
            await submitContact(contactForm);
            setContactError('');
            setFormSubmitted(true);
            setContactForm({ name: '', email: '', restaurant: '', message: '' });
            setTimeout(() => setFormSubmitted(false), 5000);
        } catch (error) {
            console.error('Error submitting contact form:', error);
            setContactError('Failed to send message. Please try again or email us at support@kodacarte.com');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="landing-page">
            {/* Navigation */}
            <nav className={`landing-nav ${scrolled ? 'scrolled' : ''}`}>
                <a href="#hero" className="nav-logo" onClick={(e) => { e.preventDefault(); scrollToSection('hero'); }}>
                    <img src="/koda-carte-logo.png" alt="Koda Carte Logo" />
                    <span className="nav-logo-text">Koda Carte</span>
                </a>

                <ul className={`nav-links ${mobileNavOpen ? 'mobile-open' : ''}`}>
                    <li><a href="#hero" onClick={(e) => { e.preventDefault(); scrollToSection('hero'); }}>Meet Koda Carte</a></li>
                    <li><a href="#features" onClick={(e) => { e.preventDefault(); scrollToSection('features'); }}>Features</a></li>
                    <li><a href="#why-we-are" onClick={(e) => { e.preventDefault(); scrollToSection('why-we-are'); }}>Why Us</a></li>
                    <li><a href="#pricing" onClick={(e) => { e.preventDefault(); scrollToSection('pricing'); }}>Pricing</a></li>
                    <li><a href="#customers" onClick={(e) => { e.preventDefault(); scrollToSection('customers'); }}>Customers</a></li>
                    <li><a href="#contact" onClick={(e) => { e.preventDefault(); scrollToSection('contact'); }}>Contact</a></li>
                </ul>

                <div className="nav-right">
                    <Link to="/login" className="nav-login-link">Login</Link>
                    <a href="#pricing" className="nav-cta-btn" onClick={(e) => { e.preventDefault(); scrollToSection('pricing'); }}>
                        Get Started
                    </a>
                </div>

                <button className="mobile-nav-toggle" onClick={() => setMobileNavOpen(!mobileNavOpen)}>
                    <span></span>
                    <span></span>
                    <span></span>
                </button>
            </nav>

            {/* Hero Section */}
            <section className="hero-section" id="hero">
                <div className="hero-content">
                    <div className="hero-text">
                        <div className="hero-badge">✨ Guided by Wisdom, Powered by AI</div>
                        <h1 className="hero-title">
                            Manage Your Restaurant<br />
                            Like a <span>True Leader</span>
                        </h1>
                        <p className="hero-subtitle">
                            Koda Carte brings the wisdom of community and collaboration to modern restaurant management.
                            POS, online ordering, delivery, customer loyalty, AI analytics, and a website for your brand — all in one platform. No hardware lock-in. No hidden fees.
                        </p>
                        <div className="hero-buttons">
                            <a href="#pricing" className="hero-btn-primary" onClick={(e) => { e.preventDefault(); scrollToSection('pricing'); }}>
                                View Our Plans
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M5 12h14M12 5l7 7-7 7" />
                                </svg>
                            </a>
                            <a href="#features" className="hero-btn-secondary" onClick={(e) => { e.preventDefault(); scrollToSection('features'); }}>
                                See All Features
                            </a>
                        </div>
                    </div>

                    <div className="hero-visual">
                        <div className="hero-card">
                            <div className="hero-stats">
                                <div className="stat-item">
                                    <div className="stat-number">All-in-One</div>
                                    <div className="stat-label">POS to Delivery</div>
                                </div>
                                <div className="stat-item">
                                    <div className="stat-number">BYOD</div>
                                    <div className="stat-label">Use Any Device</div>
                                </div>
                                <div className="stat-item">
                                    <div className="stat-number">AI</div>
                                    <div className="stat-label">Powered Platform</div>
                                </div>
                                <div className="stat-item">
                                    <div className="stat-number">$0</div>
                                    <div className="stat-label">To Start Free</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="scroll-indicator">
                    <span>Scroll to explore</span>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 5v14M5 12l7 7 7-7" />
                    </svg>
                </div>
            </section>

            {/* Who We Are Section */}
            <section className="section who-we-are" id="who-we-are">
                <h2 className="section-title">Who <span>We Are</span></h2>
                <p className="section-subtitle">
                    Koda Carte combines the spirit of community with cutting-edge technology to empower restaurant owners everywhere.
                </p>

                <div className="who-grid">
                    <div className="who-card">
                        <div className="who-icon">🤝</div>
                        <h3>Community First</h3>
                        <p>
                            "Koda" means friend in Lakota. We believe in building lasting partnerships with every restaurant we serve,
                            treating your success as our own.
                        </p>
                    </div>

                    <div className="who-card">
                        <div className="who-icon">🔓</div>
                        <h3>No Hardware Lock-in</h3>
                        <p>
                            Use the devices you already own — any tablet, laptop, or phone. We believe you should choose your own hardware, not be forced to rent or buy proprietary equipment.
                        </p>
                    </div>

                    <div className="who-card">
                        <div className="who-icon">⚡</div>
                        <h3>Modern Technology</h3>
                        <p>
                            From AI-powered analytics to DoorDash delivery and customer loyalty programs, we bring the latest innovations to help your restaurant thrive.
                        </p>
                    </div>
                </div>
            </section>

            {/* Features Section */}
            <section className="section section-dark" id="features">
                <div className="section-content">
                    <h2 className="section-title">Everything Your <span>Restaurant Needs</span></h2>
                    <p className="section-subtitle">
                        One platform. Every tool. From the kitchen to the customer's door.
                    </p>

                    <div className="features-showcase">
                        {/* Row 1: Operations */}
                        <div className="feature-group">
                            <div className="feature-group-label">Operations</div>
                            <div className="feature-group-items">
                                <div className="feature-pill"><span className="fp-icon">🖥️</span><span className="fp-text">Point of Sale</span></div>
                                <div className="feature-pill"><span className="fp-icon">👨‍🍳</span><span className="fp-text">Kitchen Display</span></div>
                                <div className="feature-pill"><span className="fp-icon">🍽️</span><span className="fp-text">Table Management</span></div>
                                <div className="feature-pill"><span className="fp-icon">💳</span><span className="fp-text">Payments & Refunds</span></div>
                                <div className="feature-pill"><span className="fp-icon">🧾</span><span className="fp-text">Digital Receipts</span></div>
                            </div>
                            <p className="feature-group-desc">Run your floor with a tablet-friendly POS, real-time kitchen queue, visual table layout, and Stripe-powered payments. Works on any device.</p>
                        </div>

                        {/* Row 2: Online & Delivery */}
                        <div className="feature-group">
                            <div className="feature-group-label">Online & Delivery</div>
                            <div className="feature-group-items">
                                <div className="feature-pill"><span className="fp-icon">🛒</span><span className="fp-text">Online Ordering</span></div>
                                <div className="feature-pill"><span className="fp-icon">🚗</span><span className="fp-text">DoorDash Delivery</span></div>
                                <div className="feature-pill"><span className="fp-icon">👤</span><span className="fp-text">Customer Portal</span></div>
                                <div className="feature-pill"><span className="fp-icon">📱</span><span className="fp-text">Embeddable Widget</span></div>
                            </div>
                            <p className="feature-group-desc">Customers order directly from your website or an embedded widget. White-label DoorDash delivery under your brand, with real-time tracking.</p>
                        </div>

                        {/* Row 3: Growth & Marketing */}
                        <div className="feature-group">
                            <div className="feature-group-label">Growth & Marketing</div>
                            <div className="feature-group-items">
                                <div className="feature-pill"><span className="fp-icon">🌐</span><span className="fp-text">Website Builder</span></div>
                                <div className="feature-pill"><span className="fp-icon">🔗</span><span className="fp-text">Custom Domain</span></div>
                                <div className="feature-pill"><span className="fp-icon">🎁</span><span className="fp-text">Promotions & Rewards</span></div>
                                <div className="feature-pill"><span className="fp-icon">📣</span><span className="fp-text">SEO & Social</span></div>
                            </div>
                            <p className="feature-group-desc">Build your website in minutes, connect your own domain, run loyalty programs, and post to Facebook and Instagram — all from one dashboard.</p>
                        </div>

                        {/* Row 4: Intelligence */}
                        <div className="feature-group">
                            <div className="feature-group-label">Intelligence</div>
                            <div className="feature-group-items">
                                <div className="feature-pill"><span className="fp-icon">📊</span><span className="fp-text">Analytics & AI</span></div>
                                <div className="feature-pill"><span className="fp-icon">🤖</span><span className="fp-text">AI Menu Upload</span></div>
                                <div className="feature-pill"><span className="fp-icon">📍</span><span className="fp-text">Multi-Location</span></div>
                            </div>
                            <p className="feature-group-desc">AI-powered analytics, menu photo upload, and multi-location management. Every location gets its own menu, orders, and insights.</p>
                        </div>
                    </div>

                    {/* BYOD Callout */}
                    <div className="byod-banner">
                        <span className="byod-label">BYOD</span>
                        <span className="byod-text">Bring your own device — any tablet, laptop, or phone. No proprietary hardware. No lock-in.</span>
                    </div>
                </div>
            </section>

            {/* Why Us Section */}
            <section className="section" id="why-we-are">
                <h2 className="section-title">Why <span>Koda Carte</span></h2>
                <p className="section-subtitle">
                    We exist because restaurant owners deserve better tools.
                </p>

                <div className="why-showcase">
                    <div className="why-item">
                        <div className="why-number">01</div>
                        <div className="why-content">
                            <h4>Your brand, not a marketplace</h4>
                            <p>Customers order from your website. Delivery runs under your name. You keep the relationship — and the data.</p>
                        </div>
                    </div>
                    <div className="why-item">
                        <div className="why-number">02</div>
                        <div className="why-content">
                            <h4>Start free, scale infinitely</h4>
                            <p>Free tier with real features. No setup fees, no contracts. Grow from one location to many — upgrade only when you're ready.</p>
                        </div>
                    </div>
                    <div className="why-item">
                        <div className="why-number">03</div>
                        <div className="why-content">
                            <h4>AI that saves you hours</h4>
                            <p>Upload a menu photo and we'll build it. Generate social posts. Get analytics insights. Practical AI, not buzzwords.</p>
                        </div>
                    </div>
                </div>
            </section>

            {/* Pricing Section - Custom width for 5-column grid */}
            <section className="section" id="pricing" style={{ maxWidth: '1600px', paddingLeft: '1rem', paddingRight: '1rem' }}>
                <h2 className="section-title">Our <span>Offerings</span></h2>
                <p className="section-subtitle">
                    Choose the tier that fits your journey. Upgrade anytime as your restaurant grows.
                </p>
                <PricingTiers />
            </section>

            {/* Customers Section */}
            <section className="section section-dark" id="customers">
                <div className="section-content">
                    <h2 className="section-title">Our <span>Customers</span></h2>
                    <p className="section-subtitle">
                        See how top restaurants are transforming their business with Koda Carte.
                    </p>

                    <div className="customer-testimonial" style={{
                        background: 'rgba(255, 255, 255, 0.05)',
                        backdropFilter: 'blur(10px)',
                        padding: '3rem',
                        borderRadius: '24px',
                        maxWidth: '800px',
                        margin: '0 auto',
                        textAlign: 'center',
                        border: '1px solid rgba(255, 255, 255, 0.1)'
                    }}>
                        <div className="customer-logo" style={{ marginBottom: '2rem' }}>
                            <a href="https://thegurkhaskitchen.com/" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                                <img
                                    src="https://static.spotapps.co/website_images/ab_websites/159127_website/logo.png"
                                    alt="The Gurkha Kitchen Logo"
                                    style={{
                                        maxHeight: '100px',
                                        maxWidth: '100%',
                                        filter: 'drop-shadow(0 0 10px rgba(255,255,255,0.2))'
                                    }}
                                />
                                <div>
                                    <h3 style={{
                                        fontFamily: 'serif',
                                        fontSize: '2rem',
                                        color: '#d4956a',
                                        margin: 0,
                                        textShadow: '0 2px 4px rgba(0,0,0,0.3)'
                                    }}>The Gurkha Kitchen</h3>
                                    <div style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.6)', letterSpacing: '2px', marginTop: '0.5rem' }}>BAY AREA, CA</div>
                                </div>
                            </a>
                        </div>

                        <blockquote style={{
                            fontSize: '1.4rem',
                            fontStyle: 'italic',
                            color: 'rgba(255,255,255,0.9)',
                            lineHeight: '1.6',
                            marginBottom: '2rem',
                            position: 'relative'
                        }}>
                            "Koda Carte has brought the latest tech to enhance our business sales and visibility. We highly recommend everyone to try Koda Carte."
                        </blockquote>

                        <div className="customer-rating" style={{ color: '#ffd700', fontSize: '1.5rem', marginBottom: '1.5rem' }}>
                            ★★★★★
                        </div>

                        <a href="https://thegurkhaskitchen.com/" target="_blank" rel="noopener noreferrer" className="hero-btn-secondary">
                            Visit Website
                        </a>
                    </div>
                </div>
            </section>

            {/* Contact Section */}
            <section className="section contact-section" id="contact">
                <h2 className="section-title">Where <span>We Are</span></h2>
                <p className="section-subtitle">
                    Ready to transform your restaurant? Get in touch and let's start your journey together.
                </p>

                <div className="contact-grid">
                    <div className="contact-info">
                        <div className="contact-item">
                            <div className="contact-icon">📍</div>
                            <div>
                                <h4>Our Location</h4>
                                <p>Serving restaurants across the United States<br />Headquarters in the heartland</p>
                            </div>
                        </div>

                        <div className="contact-item">
                            <div className="contact-icon">📧</div>
                            <div>
                                <h4>Email Us</h4>
                                <p>support@kodacarte.com<br />sales@kodacarte.com</p>
                            </div>
                        </div>

                        <div className="contact-item">
                            <div className="contact-icon">📞</div>
                            <div>
                                <h4>Call Us</h4>
                                <p>(937) 361-9400<br />Mon-Fri, 9am-6pm CST</p>
                            </div>
                        </div>

                        <div className="contact-item">
                            <div className="contact-icon">💬</div>
                            <div>
                                <h4>Live Chat</h4>
                                <p>Coming Soon</p>
                            </div>
                        </div>
                    </div>

                    <form className="contact-form" onSubmit={handleContactSubmit}>
                        {contactError && (
                            <div style={{
                                padding: '1rem',
                                background: 'rgba(220, 53, 69, 0.1)',
                                borderRadius: '12px',
                                marginBottom: '1rem',
                                color: '#dc3545',
                                textAlign: 'center'
                            }}>
                                {contactError}
                            </div>
                        )}
                        {formSubmitted && (
                            <div style={{
                                padding: '1rem',
                                background: 'rgba(64, 224, 208, 0.1)',
                                borderRadius: '12px',
                                marginBottom: '1rem',
                                color: '#2a9d8f',
                                textAlign: 'center'
                            }}>
                                Thank you! We'll be in touch soon.
                            </div>
                        )}
                        <div className="form-group">
                            <label>Your Name</label>
                            <input
                                type="text"
                                placeholder="John Doe"
                                value={contactForm.name}
                                onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                                required
                            />
                        </div>
                        <div className="form-group">
                            <label>Email Address</label>
                            <input
                                type="email"
                                placeholder="john@restaurant.com"
                                value={contactForm.email}
                                onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                                required
                            />
                        </div>
                        <div className="form-group">
                            <label>Restaurant Name</label>
                            <input
                                type="text"
                                placeholder="Your Restaurant"
                                value={contactForm.restaurant}
                                onChange={(e) => setContactForm({ ...contactForm, restaurant: e.target.value })}
                            />
                        </div>
                        <div className="form-group">
                            <label>Message</label>
                            <textarea
                                placeholder="Tell us about your restaurant and how we can help..."
                                value={contactForm.message}
                                onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })}
                                required
                            ></textarea>
                        </div>
                        <button type="submit" className="contact-submit" disabled={submitting}>
                            {submitting ? 'Sending...' : 'Send Message'}
                        </button>
                    </form>
                </div>
            </section>

            {/* Footer */}
            <footer className="landing-footer">
                <div className="footer-content">
                    <div className="footer-brand">
                        <div className="footer-logo">
                            <img src="/koda-carte-logo.png" alt="Koda Carte" />
                            <span>Koda Carte</span>
                        </div>
                        <p>
                            Empowering restaurants with the wisdom of community and the power of modern technology.
                            Your trusted partner in restaurant management.
                        </p>
                    </div>

                    <div className="footer-column">
                        <h4>Platform</h4>
                        <ul>
                            <li><a href="#pricing" onClick={(e) => { e.preventDefault(); scrollToSection('pricing'); }}>Pricing</a></li>
                            <li><a href="#who-we-are" onClick={(e) => { e.preventDefault(); scrollToSection('who-we-are'); }}>Features</a></li>
                            <li><Link to="/login">Login</Link></li>
                            <li><Link to="/signup">Sign Up</Link></li>
                        </ul>
                    </div>

                    <div className="footer-column">
                        <h4>Company</h4>
                        <ul>
                            <li><a href="#who-we-are" onClick={(e) => { e.preventDefault(); scrollToSection('who-we-are'); }}>About Us</a></li>
                            <li><a href="#contact" onClick={(e) => { e.preventDefault(); scrollToSection('contact'); }}>Contact</a></li>
                            <li><a href="#why-we-are" onClick={(e) => { e.preventDefault(); scrollToSection('why-we-are'); }}>Our Story</a></li>
                        </ul>
                    </div>

                    <div className="footer-column">
                        <h4>Support</h4>
                        <ul>
                            <li><a href="#contact" onClick={(e) => { e.preventDefault(); scrollToSection('contact'); }}>Help Center</a></li>
                            <li><a href="#contact" onClick={(e) => { e.preventDefault(); scrollToSection('contact'); }}>Documentation</a></li>
                            <li><a href="#contact" onClick={(e) => { e.preventDefault(); scrollToSection('contact'); }}>API</a></li>
                        </ul>
                    </div>
                </div>

                <div className="footer-bottom">
                    <p className="footer-copyright">
                        © {new Date().getFullYear()} Koda Carte. All rights reserved.
                    </p>
                    <div className="footer-legal">
                        <Link to="/privacy-policy">Privacy Policy</Link>
                        <a href="#terms">Terms of Service</a>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default LandingPage;
