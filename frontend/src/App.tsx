import React, { useState, useEffect, useRef } from 'react';
import './App.css';

// TypeScript interfaces
interface EvaluationPoint {
  threshold: number;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  precision: number;
  recall: number;
  fpr: number;
  net_savings_inr: number;
}

interface Coordinate {
  fpr?: number;
  tpr?: number;
  recall?: number;
  precision?: number;
}

interface SampleOrder {
  user_id: string;
  user_age_days: number;
  user_total_orders: number;
  user_total_rtos: number;
  order_amount: number;
  payment_method: string;
  coupon_applied: boolean;
  state: string;
  city_tier: string;
  address_length: number;
  address_has_landmark: boolean;
  email_domain: string;
  time_of_day: string;
  risk_score: number;
  actual_is_rto: number;
}

interface MetricsData {
  roc_auc: number;
  test_set_size: number;
  total_rto_actual: number;
  avg_order_value: number;
  evaluation_curves: EvaluationPoint[];
  roc_curve: Coordinate[];
  pr_curve: Coordinate[];
  sample_orders: SampleOrder[];
  feature_importances: Record<string, number>;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'playground' | 'integration'>('dashboard');
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [threshold, setThreshold] = useState<number>(50); // percentage 0-100
  const [connectionError, setConnectionError] = useState<string | null>(null);
  
  // Authentication states
  const [user, setUser] = useState<string | null>(() => localStorage.getItem('rzp_risk_user'));
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loginSuccessMsg, setLoginSuccessMsg] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const handleAuthSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!usernameInput || !passwordInput) {
      setLoginError('Both username and password are required.');
      return;
    }
    
    if (isRegistering && passwordInput !== confirmPasswordInput) {
      setLoginError('Passwords do not match.');
      return;
    }

    setLoginLoading(true);
    setLoginError('');
    setLoginSuccessMsg('');

    const endpoint = isRegistering ? 'register' : 'login';

    fetch(`http://localhost:5000/api/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: usernameInput, password: passwordInput })
    })
      .then(res => {
        if (!res.ok) {
          return res.json().then(errData => {
            throw new Error(errData.error || 'Authentication failed');
          });
        }
        return res.json();
      })
      .then(data => {
        setLoginLoading(false);
        if (isRegistering) {
          setLoginSuccessMsg('Account created successfully! Please sign in using your credentials.');
          setIsRegistering(false); // Switch back to sign in
          setPasswordInput('');
          setConfirmPasswordInput('');
        } else {
          localStorage.setItem('rzp_risk_user', data.user);
          localStorage.setItem('rzp_risk_token', data.token);
          setUser(data.user);
        }
      })
      .catch(err => {
        console.error("Authentication request failed:", err);
        setLoginError(err.message || 'Connection failed: Unable to connect to the backend server.');
        setLoginLoading(false);
      });
  };

  const handleLogout = () => {
    localStorage.removeItem('rzp_risk_user');
    localStorage.removeItem('rzp_risk_token');
    setUser(null);
    setUsernameInput('');
    setPasswordInput('');
    setConfirmPasswordInput('');
    setLoginSuccessMsg('');
    setLoginError('');
  };

  // Financial simulation parameters (Indian Rupees - INR)
  const [shippingCost, setShippingCost] = useState<number>(150); // Shipping cost per RTO

  const [marginRate, setMarginRate] = useState<number>(35); // Gross profit margin %
  const [churnProbability, setChurnProbability] = useState<number>(40); // Customer churn % if COD blocked
  
  // Webhook Playground states
  const [playgroundLoading, setPlaygroundLoading] = useState(false);
  const [playgroundResult, setPlaygroundResult] = useState<any>(null);
  const [webhookInput, setWebhookInput] = useState({
    payment_method: 'COD',
    order_amount: 1850,
    user_age_days: 14,
    user_total_orders: 1,
    user_total_rtos: 0,
    state: 'Uttar Pradesh',
    city_tier: 'Tier 3',
    shipping_address: 'Village Ramnagar, Tier-3 node', // short address, missing pincode!
    address_has_landmark: false,
    email: 'user123@mailinator.com',
    time_of_day: 'night',
    coupon_applied: true
  });

  // Live order stream feed
  const [liveFeed, setLiveFeed] = useState<any[]>([]);
  const simulatedIndex = useRef(0);

  // Fetch metrics on mount
  useEffect(() => {
    fetch('http://localhost:5000/api/metrics')
      .then(res => {
        if (!res.ok) throw new Error("Failed to fetch metrics");
        return res.json();
      })
      .then(data => {
        setMetrics(data);
        setConnectionError(null);
        // Initialize live feed with first 5 sample orders
        if (data.sample_orders && data.sample_orders.length > 0) {
          const initialFeed = data.sample_orders.slice(0, 6).map((order: SampleOrder) => {
            const decision = getDecisionForScore(order.risk_score, 50, order.payment_method);
            return { ...order, decision, timestamp: new Date(Date.now() - Math.random() * 60000) };
          });
          setLiveFeed(initialFeed);
          simulatedIndex.current = 6;
        }
      })
      .catch(err => {
        console.error("Backend offline:", err);
        setConnectionError("Connection failed: Unable to connect to the backend server. Please verify the Flask server is running on port 5000.");
      });
  }, []);

  // Live streaming simulation
  useEffect(() => {
    if (!metrics || metrics.sample_orders.length === 0) return;
    
    const interval = setInterval(() => {
      const sample = metrics.sample_orders[simulatedIndex.current % metrics.sample_orders.length];
      simulatedIndex.current += 1;
      
      const newOrder = {
        ...sample,
        user_id: `usr_${Math.floor(Math.random() * 90000 + 10000)}`,
        timestamp: new Date(),
        decision: getDecisionForScore(sample.risk_score, threshold, sample.payment_method)
      };
      
      setLiveFeed(prev => [newOrder, ...prev.slice(0, 14)]);
    }, 4500);

    return () => clearInterval(interval);
  }, [metrics, threshold]);

  // Recalculate decision labels based on current threshold
  const getDecisionForScore = (score: number, t: number, paymentMethod: string) => {
    if (paymentMethod === 'Prepaid') return 'ALLOW_ORDER';
    if (score >= t) {
      if (score >= 80) return 'BLOCK';
      if (score >= 55) return 'UPSELL_PREPAID';
      return 'SMS_VERIFY';
    }
    return 'ALLOW_COD';
  };

  const getDecisionBadgeClass = (decision: string) => {
    switch (decision) {
      case 'ALLOW_ORDER':
      case 'ALLOW_COD': return 'badge-success';
      case 'SMS_VERIFY': return 'badge-warning';
      case 'UPSELL_PREPAID': return 'badge-orange';
      case 'BLOCK': return 'badge-danger';
      default: return 'badge-neutral';
    }
  };

  const getDecisionText = (decision: string) => {
    switch (decision) {
      case 'ALLOW_ORDER': return 'Prepaid Approved';
      case 'ALLOW_COD': return 'COD Approved';
      case 'SMS_VERIFY': return 'Verification Held';
      case 'UPSELL_PREPAID': return 'Prepaid Prompt';
      case 'BLOCK': return 'COD Suspended';
      default: return decision;
    }
  };

  // Run mock webhook check
  const handleWebhookSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPlaygroundLoading(true);
    
    fetch(`http://localhost:5000/api/score-order?threshold=${threshold}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhookInput)
    })
      .then(res => res.json())
      .then(data => {
        setPlaygroundResult(data);
        setPlaygroundLoading(false);
        
        // Push result to live feed too
        const mockToFeed = {
          user_id: `usr_${Math.floor(Math.random() * 90000 + 10000)}`,
          user_age_days: webhookInput.user_age_days,
          user_total_orders: webhookInput.user_total_orders,
          user_total_rtos: webhookInput.user_total_rtos,
          order_amount: webhookInput.order_amount,
          payment_method: webhookInput.payment_method,
          coupon_applied: webhookInput.coupon_applied,
          state: webhookInput.state,
          city_tier: webhookInput.city_tier,
          address_length: webhookInput.shipping_address.length,
          address_has_landmark: webhookInput.address_has_landmark || /near|opposite|behind|landmark|temple|school/i.test(webhookInput.shipping_address),
          email_domain: webhookInput.email.includes('@') ? webhookInput.email.split('@')[1] : webhookInput.email,
          time_of_day: webhookInput.time_of_day,
          risk_score: data.risk_score,
          actual_is_rto: Math.random() < (data.risk_score / 100) ? 1 : 0,
          decision: data.recommendation,
          timestamp: new Date()
        };
        setLiveFeed(prev => [mockToFeed, ...prev.slice(0, 14)]);
      })
      .catch(err => {
        console.error("Playground scoring failed:", err);
        setPlaygroundResult(null);
        alert("Risk evaluation failed: Could not establish a connection to the backend server.");
        setPlaygroundLoading(false);
      });
  };

  const populateQuickScenario = (type: string) => {
    switch (type) {
      case 'safe':
        setWebhookInput({
          payment_method: 'Prepaid',
          order_amount: 3200,
          user_age_days: 280,
          user_total_orders: 8,
          user_total_rtos: 0,
          state: 'Maharashtra',
          city_tier: 'Tier 1',
          shipping_address: 'Flat 402, Block A, Prestige Heights, Bangalore, 560001',
          address_has_landmark: true,
          email: 'vikas.sharma@gmail.com',
          time_of_day: 'afternoon',
          coupon_applied: false
        });
        break;
      case 'rto_abuser':
        setWebhookInput({
          payment_method: 'COD',
          order_amount: 4500,
          user_age_days: 45,
          user_total_orders: 3,
          user_total_rtos: 2, // 66% RTO rate
          state: 'Bihar',
          city_tier: 'Tier 2',
          shipping_address: 'Near Kali Mandir, Main Road, Patna, Bihar, 800001',
          address_has_landmark: true,
          email: 'rajesh99@yahoo.com',
          time_of_day: 'evening',
          coupon_applied: true
        });
        break;
      case 'promo_fraud':
        setWebhookInput({
          payment_method: 'COD',
          order_amount: 1200,
          user_age_days: 1, // brand new
          user_total_orders: 1,
          user_total_rtos: 0,
          state: 'Uttar Pradesh',
          city_tier: 'Tier 3',
          shipping_address: 'Village Ramnagar, Tier-3 node', // short address, missing pincode!
          address_has_landmark: false,
          email: 'junkmail123@mailinator.com',
          time_of_day: 'night',
          coupon_applied: true
        });
        break;
      default:
        break;
    }
  };

  // If connection fails, render connection error page
  if (connectionError) {
    return (
      <div className="login-view-wrapper">
        <div className="login-card animate-fade-in text-center" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          <div className="login-header-box">
            <span className="login-logo" style={{ textShadow: 'none' }}>⚠️</span>
            <h2 className="login-title">Connection Error</h2>
            <p className="login-subtitle" style={{ color: 'var(--accent-rose)', marginTop: '8px', marginBottom: '24px' }}>
              {connectionError}
            </p>
          </div>
          <button 
            type="button" 
            className="btn btn-primary btn-block"
            onClick={() => window.location.reload()}
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  // If not logged in, render login page
  if (!user) {
    return (
      <div className="login-view-wrapper">
        <div className="login-card animate-fade-in">
          <div className="login-header-box">
            <span className="login-logo">⚡</span>
            <h2 className="login-title">RazorRisk AI</h2>
            <p className="login-subtitle">
              {isRegistering ? 'Create your merchant dashboard account' : 'Sign in to merchant risk dashboard'}
            </p>
          </div>

          <div className="login-tabs">
            <button 
              type="button" 
              className={`login-tab-btn ${!isRegistering ? 'active' : ''}`}
              onClick={() => { setIsRegistering(false); setLoginError(''); setLoginSuccessMsg(''); }}
            >
              Sign In
            </button>
            <button 
              type="button" 
              className={`login-tab-btn ${isRegistering ? 'active' : ''}`}
              onClick={() => { setIsRegistering(true); setLoginError(''); setLoginSuccessMsg(''); }}
            >
              Create Account
            </button>
          </div>

          {loginError && (
            <div className="login-error-banner animate-fade-in">
              {loginError}
            </div>
          )}

          {loginSuccessMsg && (
            <div className="login-success-banner animate-fade-in">
              {loginSuccessMsg}
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="login-form-fields">
            <div className="form-group">
              <label>Username</label>
              <input 
                type="text" 
                placeholder="Enter username" 
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                disabled={loginLoading}
                required
              />
            </div>

            <div className="form-group">
              <label>Password</label>
              <input 
                type="password" 
                placeholder="Enter password" 
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                disabled={loginLoading}
                required
              />
            </div>

            {isRegistering && (
              <div className="form-group animate-fade-in">
                <label>Confirm Password</label>
                <input 
                  type="password" 
                  placeholder="Confirm password" 
                  value={confirmPasswordInput}
                  onChange={(e) => setConfirmPasswordInput(e.target.value)}
                  disabled={loginLoading}
                  required
                />
              </div>
            )}

            <button 
              type="submit" 
              className={`btn btn-primary btn-block ${loginLoading ? 'loading' : ''}`}
              disabled={loginLoading}
            >
              {loginLoading ? 'Processing...' : (isRegistering ? 'Register Account' : 'Sign In')}
            </button>
          </form>

          <div className="login-info-footer">
            <span>Accounts are securely managed by the server in <code>users.json</code>.</span>
          </div>
        </div>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="loader-container">
        <div className="custom-loader"></div>
        <p>Loading AI Risk Engine Metrics...</p>
      </div>
    );
  }


  // Calculate dynamic financials & ML stats based on current threshold
  // We locate the curve entry closest to the selected threshold
  const selectedIdx = Math.min(Math.max(Math.round(threshold), 0), 100);
  const rawCurvePoint = metrics.evaluation_curves[selectedIdx] || metrics.evaluation_curves[50];
  
  // Calculate dynamic costs
  // Let's compute actual financial savings based on user adjustable parameters
  const tpCount = rawCurvePoint.tp;
  const fpCount = rawCurvePoint.fp;
  const fnCount = rawCurvePoint.fn;
  const tnCount = rawCurvePoint.tn;
  
  // Churn Cost per False Positive = Order Value * Churn Prob % * Margin Rate %
  const dynamicAvgAOV = metrics.avg_order_value;
  const dynamicFP_Cost = dynamicAvgAOV * (marginRate / 100) * (churnProbability / 100);
  
  // Savings = TPs flagged * shipping cost (saved RTO) - FPs flagged * customer friction cost
  const dynamicNetSavings = (tpCount * shippingCost) - (fpCount * dynamicFP_Cost);
  
  // Maximum possible losses (if we allowed all COD to go through without AI, i.e. threshold = 1.0)
  // Everything that is RTO (TP + FN) causes an RTO shipping cost loss
  const totalRTOs = metrics.total_rto_actual;
  const baselineLoss = totalRTOs * shippingCost;
  
  // Loss with AI running = FNs missed * shipping cost + FPs flagged * customer friction cost
  const aiLoss = (fnCount * shippingCost) + (fpCount * dynamicFP_Cost);
  
  // Percentage of losses prevented
  const lossReductionRate = baselineLoss > 0 ? ((baselineLoss - aiLoss) / baselineLoss) * 100 : 0;

  // Let's scale up these numbers to a standard scale (e.g. 5,000 monthly orders)
  // to give a realistic ROI estimate. Test set is 2,000 orders.
  const scaleFactor = 5000 / metrics.test_set_size;
  const scaledSavings = dynamicNetSavings * scaleFactor;
  const scaledBaselineLoss = baselineLoss * scaleFactor;
  const scaledAILoss = aiLoss * scaleFactor;

  // Find the optimal threshold based on current slider values
  let optimalThreshold = 50;
  let maxSavings = -99999999;
  metrics.evaluation_curves.forEach((pt) => {
    const ptSavings = (pt.tp * shippingCost) - (pt.fp * dynamicFP_Cost);
    if (ptSavings > maxSavings) {
      maxSavings = ptSavings;
      optimalThreshold = Math.round(pt.threshold * 100);
    }
  });

  // Format currency
  const formatINR = (value: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(value);
  };

  return (
    <div className="app-container">
      {/* Navbar */}
      <header className="main-header">
        <div className="logo-container">
          <div className="logo-icon">⚡</div>
          <div className="logo-text">
            <span className="brand-primary">Razor</span>
            <span className="brand-secondary">Risk AI</span>
          </div>
          <span className="api-badge">v1.2.0-beta</span>
        </div>
        
        <nav className="nav-tabs">
          <button 
            className={`nav-link ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            📊 Analytics & Optimizer
          </button>
          <button 
            className={`nav-link ${activeTab === 'playground' ? 'active' : ''}`}
            onClick={() => setActiveTab('playground')}
          >
            🔌 Webhook Playground
          </button>
          <button 
            className={`nav-link ${activeTab === 'integration' ? 'active' : ''}`}
            onClick={() => setActiveTab('integration')}
          >
            ⚙️ Developer Integration
          </button>
        </nav>

        <div className="logout-box">
          <div className="header-status">
            <span className="status-dot pulsing"></span>
            <span className="status-text">Server Online</span>
          </div>
          <span className="user-badge">👤 {user}</span>
          <button className="btn btn-sm btn-danger-outline" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      {/* Main Body */}
      <main className="main-content">
        
        {activeTab === 'dashboard' && (
          <div className="dashboard-view animate-fade-in">
            {/* KPI Cards Grid */}
            <section className="kpi-grid">
              <div className="kpi-card shadow-glow">
                <span className="kpi-label">Held-out Model ROC-AUC</span>
                <span className="kpi-value cyan-glow">{(metrics.roc_auc * 100).toFixed(1)}%</span>
                <span className="kpi-desc">Discrimination power on test set ({metrics.test_set_size} orders)</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">Optimal Threshold Target</span>
                <span className="kpi-value emerald-glow">{optimalThreshold}%</span>
                <span className="kpi-desc">Threshold yielding max net profit under current costs</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">Projected Monthly Savings</span>
                <span className="kpi-value pink-glow">{formatINR(scaledSavings)}</span>
                <span className="kpi-desc">Based on {formatINR(scaledBaselineLoss)} baseline RTO risk</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">Risk Reduction Rate</span>
                <span className="kpi-value amber-glow">{lossReductionRate > 0 ? lossReductionRate.toFixed(1) : 0}%</span>
                <span className="kpi-desc">Of baseline RTO losses successfully saved/neutralized</span>
              </div>
            </section>

            {/* Config & Split Screen */}
            <div className="grid-split">
              {/* Cost Simulator Control Panel */}
              <div className="control-panel panel-glass">
                <h3 className="section-title">💲 Risk Parameters & Cost Simulator</h3>
                <p className="panel-desc">Tune your specific transaction metrics to calculate optimal machine learning decision thresholds.</p>
                
                <div className="param-group">
                  <div className="param-header">
                    <label>RTO Return Shipping Loss Cost</label>
                    <span className="param-indicator">{formatINR(shippingCost)}</span>
                  </div>
                  <input 
                    type="range" 
                    min="50" 
                    max="500" 
                    step="10" 
                    value={shippingCost} 
                    onChange={(e) => setShippingCost(Number(e.target.value))} 
                    className="slider"
                  />
                  <span className="param-help">Two-way courier charges + warehouse processing fees</span>
                </div>

                <div className="param-group">
                  <div className="param-header">
                    <label>Product Gross Profit Margin (%)</label>
                    <span className="param-indicator">{marginRate}%</span>
                  </div>
                  <input 
                    type="range" 
                    min="10" 
                    max="80" 
                    step="5" 
                    value={marginRate} 
                    onChange={(e) => setMarginRate(Number(e.target.value))} 
                    className="slider"
                  />
                  <span className="param-help">Gross profit margin of your average order (excluding logistics)</span>
                </div>

                <div className="param-group">
                  <div className="param-header">
                    <label>COD Block Churn Penalty (%)</label>
                    <span className="param-indicator">{churnProbability}%</span>
                  </div>
                  <input 
                    type="range" 
                    min="5" 
                    max="90" 
                    step="5" 
                    value={churnProbability} 
                    onChange={(e) => setChurnProbability(Number(e.target.value))} 
                    className="slider"
                  />
                  <span className="param-help">Probability that a good customer churns when COD is disabled</span>
                </div>
                
                <div className="divider"></div>

                <div className="param-group highlight-group">
                  <div className="param-header">
                    <label className="bold-label">Decision Risk Threshold</label>
                    <span className="param-indicator threshold-badge">{threshold}%</span>
                  </div>
                  <input 
                    type="range" 
                    min="1" 
                    max="99" 
                    step="1" 
                    value={threshold} 
                    onChange={(e) => setThreshold(Number(e.target.value))} 
                    className="slider slider-primary"
                  />
                  <span className="param-help">Block or verify COD orders when risk score is greater than this value.</span>
                </div>
                
                <div className="optimal-trigger-box">
                  <span className="text-secondary text-sm">Optimal threshold for your numbers is <strong>{optimalThreshold}%</strong></span>
                  <button 
                    className="btn btn-sm btn-outline" 
                    onClick={() => setThreshold(optimalThreshold)}
                  >
                    Set Optimal
                  </button>
                </div>
              </div>

              {/* Confusion Matrix & Metrics */}
              <div className="results-panel panel-glass">
                <h3 className="section-title">📊 ML Metrics & Confusion Matrix</h3>
                <p className="panel-desc">Held-out validation stats calculated for threshold set to <strong>{threshold}%</strong></p>
                
                <div className="stats-box">
                  <div className="stat-item">
                    <span className="stat-lbl">Model Precision</span>
                    <span className="stat-val">{(rawCurvePoint.precision * 100).toFixed(1)}%</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-lbl">Model Recall</span>
                    <span className="stat-val">{(rawCurvePoint.recall * 100).toFixed(1)}%</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-lbl">False Positive Rate</span>
                    <span className="stat-val">{(rawCurvePoint.fpr * 100).toFixed(1)}%</span>
                  </div>
                </div>

                <h4 className="matrix-title">Confusion Matrix (Held-out validation subset)</h4>
                <div className="confusion-matrix">
                  <div className="matrix-cell label-cell diagonal-col">Actual \ Pred</div>
                  <div className="matrix-cell label-cell">Allowed COD (No Risk)</div>
                  <div className="matrix-cell label-cell">Flagged COD (Risk)</div>

                  <div className="matrix-cell label-cell">Good Order (Delivered)</div>
                  <div className="matrix-cell content-cell tn-cell">
                    <span className="matrix-count">{tnCount}</span>
                    <span className="matrix-label">True Negative (Success)</span>
                  </div>
                  <div className="matrix-cell content-cell fp-cell">
                    <span className="matrix-count">{fpCount}</span>
                    <span className="matrix-label">False Positive (Friction Cost)</span>
                  </div>

                  <div className="matrix-cell label-cell">RTO Order (Lost Money)</div>
                  <div className="matrix-cell content-cell fn-cell">
                    <span className="matrix-count">{fnCount}</span>
                    <span className="matrix-label">False Negative (Missed RTO)</span>
                  </div>
                  <div className="matrix-cell content-cell tp-cell">
                    <span className="matrix-count">{tpCount}</span>
                    <span className="matrix-label">True Positive (RTO Blocked)</span>
                  </div>
                </div>
                
                <div className="matrix-legend">
                  <div className="legend-item"><span className="legend-dot tn-dot"></span> TN: Standard checkout, normal delivery.</div>
                  <div className="legend-item"><span className="legend-dot fp-dot"></span> FP: Blocked a good buyer, lost potential margin of {formatINR(dynamicFP_Cost)} per churn.</div>
                  <div className="legend-item"><span className="legend-dot fn-dot"></span> FN: Missed high-risk RTO order, lost courier shipping fees of {formatINR(shippingCost)}.</div>
                  <div className="legend-item"><span className="legend-dot tp-dot"></span> TP: Blocked or converted high-risk buyer, saved logistics fees of {formatINR(shippingCost)}.</div>
                </div>
              </div>
            </div>

            {/* Custom SVG Charts Carousel */}
            <h3 className="section-title chart-section-title">📈 Visualizing AI Classifier Performance</h3>
            <section className="charts-container">
              {/* ROC Curve */}
              <div className="chart-card panel-glass">
                <h4>ROC Curve (FPR vs TPR)</h4>
                <div className="svg-container">
                  <svg width="240" height="240" viewBox="0 0 100 100">
                    {/* Grid lines */}
                    <line x1="0" y1="25" x2="100" y2="25" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                    <line x1="0" y1="50" x2="100" y2="50" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                    <line x1="0" y1="75" x2="100" y2="75" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                    <line x1="25" y1="0" x2="25" y2="100" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                    <line x1="50" y1="0" x2="50" y2="100" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                    <line x1="75" y1="0" x2="75" y2="100" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                    
                    {/* Random Guessing Line */}
                    <line x1="0" y1="100" x2="100" y2="0" stroke="rgba(255,255,255,0.15)" strokeWidth="0.8" strokeDasharray="3" />
                    
                    {/* ROC Curve Path */}
                    {metrics.roc_curve && (
                      <path
                        d={`M ${metrics.roc_curve.map(pt => `${pt.fpr! * 100} ${100 - pt.tpr! * 100}`).join(' L ')}`}
                        fill="none"
                        stroke="var(--accent-cyan)"
                        strokeWidth="1.5"
                      />
                    )}
                    
                    {/* Operating Point */}
                    <circle
                      cx={rawCurvePoint.fpr * 100}
                      cy={100 - rawCurvePoint.recall * 100} // TPR is Recall
                      r="3.5"
                      fill="var(--accent-cyan)"
                      className="pulsing-dot"
                    />
                  </svg>
                  <div className="axis-label x-axis">False Positive Rate (FPR)</div>
                  <div className="axis-label y-axis">True Positive Rate (TPR)</div>
                </div>
                <div className="chart-footer">
                  <span>ROC-AUC: <strong>{metrics.roc_auc.toFixed(3)}</strong></span>
                  <span>FPR: <strong>{rawCurvePoint.fpr.toFixed(2)}</strong>, TPR: <strong>{rawCurvePoint.recall.toFixed(2)}</strong></span>
                </div>
              </div>

              {/* Precision-Recall Curve */}
              <div className="chart-card panel-glass">
                <h4>Precision-Recall Curve</h4>
                <div className="svg-container">
                  <svg width="240" height="240" viewBox="0 0 100 100">
                    <line x1="0" y1="25" x2="100" y2="25" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                    <line x1="0" y1="50" x2="100" y2="50" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                    <line x1="0" y1="75" x2="100" y2="75" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                    <line x1="25" y1="0" x2="25" y2="100" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                    <line x1="50" y1="0" x2="50" y2="100" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                    <line x1="75" y1="0" x2="75" y2="100" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                    
                    {/* PR Curve Path */}
                    {metrics.pr_curve && (
                      <path
                        d={`M ${metrics.pr_curve.map(pt => `${pt.recall! * 100} ${100 - pt.precision! * 100}`).join(' L ')}`}
                        fill="none"
                        stroke="var(--accent-emerald)"
                        strokeWidth="1.5"
                      />
                    )}
                    
                    {/* Operating Point */}
                    <circle
                      cx={rawCurvePoint.recall * 100}
                      cy={100 - rawCurvePoint.precision * 100}
                      r="3.5"
                      fill="var(--accent-emerald)"
                      className="pulsing-dot"
                    />
                  </svg>
                  <div className="axis-label x-axis">Recall (Sensitivity)</div>
                  <div className="axis-label y-axis">Precision (PPV)</div>
                </div>
                <div className="chart-footer">
                  <span>Target Recall: <strong>{(rawCurvePoint.recall * 100).toFixed(0)}%</strong></span>
                  <span>Precision: <strong>{(rawCurvePoint.precision * 100).toFixed(0)}%</strong></span>
                </div>
              </div>

              {/* Profit Curve */}
              <div className="chart-card panel-glass">
                <h4>Net Business Savings (INR)</h4>
                <div className="svg-container">
                  {(() => {
                    // Let's compute profit points dynamically for the SVG line
                    const points = metrics.evaluation_curves.map((pt, i) => {
                      const savings = (pt.tp * shippingCost) - (pt.fp * dynamicFP_Cost);
                      return { x: i, y: savings };
                    });
                    
                    // Find min/max for scaling
                    const yVals = points.map(p => p.y);
                    const maxY = Math.max(...yVals, 1000);
                    const minY = Math.min(...yVals, -1000);
                    const rangeY = maxY - minY || 1;
                    
                    const svgPoints = points.map(pt => {
                      const scaledX = pt.x; // 0 to 100
                      const scaledY = 100 - (((pt.y - minY) / rangeY) * 100);
                      return `${scaledX} ${scaledY}`;
                    });
                    
                    const currentY = 100 - (((dynamicNetSavings - minY) / rangeY) * 100);
                    
                    return (
                      <svg width="240" height="240" viewBox="0 0 100 100">
                        <line x1="0" y1="25" x2="100" y2="25" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                        <line x1="0" y1="50" x2="100" y2="50" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                        <line x1="0" y1="75" x2="100" y2="75" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                        <line x1="25" y1="0" x2="25" y2="100" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                        <line x1="50" y1="0" x2="50" y2="100" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                        <line x1="75" y1="0" x2="75" y2="100" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                        
                        {/* Zero Line */}
                        {minY < 0 && (
                          <line
                            x1="0"
                            y1={100 - (((0 - minY) / rangeY) * 100)}
                            x2="100"
                            y2={100 - (((0 - minY) / rangeY) * 100)}
                            stroke="rgba(255, 42, 95, 0.3)"
                            strokeWidth="0.8"
                            strokeDasharray="2"
                          />
                        )}
                        
                        {/* Savings Curve Path */}
                        <path
                          d={`M ${svgPoints.join(' L ')}`}
                          fill="none"
                          stroke="var(--accent-rose)"
                          strokeWidth="1.5"
                        />
                        
                        {/* Threshold vertical line indicator */}
                        <line
                          x1={threshold}
                          y1="0"
                          x2={threshold}
                          y2="100"
                          stroke="rgba(255,255,255,0.25)"
                          strokeWidth="0.8"
                          strokeDasharray="2"
                        />
                        
                        {/* Operating Point */}
                        <circle
                          cx={threshold}
                          cy={currentY}
                          r="3.5"
                          fill="var(--accent-rose)"
                          className="pulsing-dot"
                        />
                      </svg>
                    );
                  })()}
                  <div className="axis-label x-axis">Threshold (%)</div>
                  <div className="axis-label y-axis">Savings (INR)</div>
                </div>
                <div className="chart-footer">
                  <span>Current Savings: <strong>{formatINR(dynamicNetSavings)}</strong></span>
                  <span>Threshold: <strong>{threshold}%</strong></span>
                </div>
              </div>
            </section>

            {/* Live Transaction Stream Monitor */}
            <section className="live-stream-section panel-glass">
              <div className="live-header">
                <div className="live-title-box">
                  <span className="live-indicator pulsing-red"></span>
                  <h4>Real-time Order Risk Monitor</h4>
                </div>
                <div className="live-summary">
                  <span>Evaluation Rate: <strong>~12 orders/min</strong></span>
                  <span className="separator">|</span>
                  <span>COD Block Threshold: <strong>{threshold}%</strong></span>
                </div>
              </div>

              <div className="live-table-container">
                <table className="live-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>User ID</th>
                      <th>Order Value</th>
                      <th>Method</th>
                      <th>State / Tier</th>
                      <th>Address Verification</th>
                      <th>Risk Score</th>
                      <th>AI Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {liveFeed.map((order, i) => (
                      <tr key={order.user_id + '-' + i} className="live-row">
                        <td className="time-col">
                          {new Date(order.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </td>
                        <td className="mono-col">{order.user_id}</td>
                        <td className="bold-col">{formatINR(order.order_amount)}</td>
                        <td>
                          <span className={`method-badge ${order.payment_method === 'Prepaid' ? 'prepaid' : 'cod'}`}>
                            {order.payment_method}
                          </span>
                        </td>
                        <td className="state-col">
                          {order.state} <span className="tier-tag">{order.city_tier}</span>
                        </td>
                        <td className="addr-col">
                          <span className="addr-length">{order.address_length} chars</span>
                          {order.address_has_landmark ? (
                            <span className="landmark-tag green">Landmark ✅</span>
                          ) : (
                            <span className="landmark-tag gray">No Landmark ❌</span>
                          )}
                        </td>
                        <td>
                          <div className="risk-container">
                            <span className={`risk-number ${order.risk_score >= 70 ? 'high' : order.risk_score >= 40 ? 'medium' : 'low'}`}>
                              {order.risk_score}%
                            </span>
                            <div className="risk-bar-outer">
                              <div 
                                className={`risk-bar-inner ${order.risk_score >= 70 ? 'high' : order.risk_score >= 40 ? 'medium' : 'low'}`}
                                style={{ width: `${order.risk_score}%` }}
                              ></div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={`decision-badge ${getDecisionBadgeClass(order.decision)}`}>
                            {getDecisionText(order.decision)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {activeTab === 'playground' && (
          <div className="playground-view animate-fade-in panel-glass">
            <h2 className="section-title">🔌 Webhook Simulation & Testing Playground</h2>
            <p className="panel-desc">
              Simulate Razorpay payment webhooks or API checkout order payloads. Test edge cases, fraudulent addresses, or promo abusers to inspect AI recommendations.
            </p>
            
            <div className="playground-split">
              {/* Form Input Section */}
              <form onSubmit={handleWebhookSubmit} className="playground-form">
                <div className="scenario-bar">
                  <span className="text-secondary text-sm">Quick Scenario Defaults:</span>
                  <button type="button" className="scenario-btn btn-safe" onClick={() => populateQuickScenario('safe')}>
                    ✅ Trusted Buyer (Prepaid)
                  </button>
                  <button type="button" className="scenario-btn btn-warn" onClick={() => populateQuickScenario('rto_abuser')}>
                    ⚠️ RTO Abuser (COD)
                  </button>
                  <button type="button" className="scenario-btn btn-danger" onClick={() => populateQuickScenario('promo_fraud')}>
                    🚨 Promo / Short Addr Fraud
                  </button>
                </div>

                <div className="form-grid">
                  <div className="form-group">
                    <label>Payment Method</label>
                    <select 
                      value={webhookInput.payment_method} 
                      onChange={(e) => setWebhookInput({...webhookInput, payment_method: e.target.value})}
                    >
                      <option value="COD">COD (Cash on Delivery)</option>
                      <option value="Prepaid">Prepaid (Credit Card/UPI)</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Order Amount (INR)</label>
                    <input 
                      type="number" 
                      value={webhookInput.order_amount} 
                      onChange={(e) => setWebhookInput({...webhookInput, order_amount: Number(e.target.value)})}
                    />
                  </div>

                  <div className="form-group">
                    <label>Customer Account Age (Days)</label>
                    <input 
                      type="number" 
                      value={webhookInput.user_age_days} 
                      onChange={(e) => setWebhookInput({...webhookInput, user_age_days: Number(e.target.value)})}
                    />
                  </div>

                  <div className="form-group">
                    <label>Total Account Orders (Lifetime)</label>
                    <input 
                      type="number" 
                      value={webhookInput.user_total_orders} 
                      onChange={(e) => setWebhookInput({...webhookInput, user_total_orders: Number(e.target.value)})}
                    />
                  </div>

                  <div className="form-group">
                    <label>Total Past RTO Returns</label>
                    <input 
                      type="number" 
                      value={webhookInput.user_total_rtos} 
                      onChange={(e) => setWebhookInput({...webhookInput, user_total_rtos: Number(e.target.value)})}
                    />
                  </div>

                  <div className="form-group">
                    <label>Destination State</label>
                    <select 
                      value={webhookInput.state} 
                      onChange={(e) => setWebhookInput({...webhookInput, state: e.target.value})}
                    >
                      <option value="Maharashtra">Maharashtra (Low RTO)</option>
                      <option value="Delhi">Delhi (Low RTO)</option>
                      <option value="Karnataka">Karnataka (Low RTO)</option>
                      <option value="Uttar Pradesh">Uttar Pradesh (High RTO)</option>
                      <option value="Bihar">Bihar (High RTO)</option>
                      <option value="West Bengal">West Bengal (High RTO)</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label>City Tier</label>
                    <select 
                      value={webhookInput.city_tier} 
                      onChange={(e) => setWebhookInput({...webhookInput, city_tier: e.target.value})}
                    >
                      <option value="Tier 1">Tier 1 (Metro)</option>
                      <option value="Tier 2">Tier 2 (Urban/Town)</option>
                      <option value="Tier 3">Tier 3 (Rural Node)</option>
                    </select>
                  </div>

                  <div className="form-group full-width-group">
                    <label>Shipping Address</label>
                    <textarea 
                      rows={2}
                      placeholder="e.g. Near Kali Mandir, Patna, Bihar, 800001"
                      value={webhookInput.shipping_address} 
                      onChange={(e) => setWebhookInput({...webhookInput, shipping_address: e.target.value})}
                      required
                    />
                  </div>

                  <div className="form-group checkbox-group">
                    <label className="checkbox-lbl">
                      <input 
                        type="checkbox" 
                        checked={webhookInput.address_has_landmark} 
                        onChange={(e) => setWebhookInput({...webhookInput, address_has_landmark: e.target.checked})}
                      />
                      Address has landmarks (e.g., Near, Behind)
                    </label>
                  </div>

                  <div className="form-group">
                    <label>Customer Email Domain / Address</label>
                    <input 
                      type="text" 
                      value={webhookInput.email} 
                      onChange={(e) => setWebhookInput({...webhookInput, email: e.target.value})}
                    />
                  </div>

                  <div className="form-group">
                    <label>Purchase Time of Day</label>
                    <select 
                      value={webhookInput.time_of_day} 
                      onChange={(e) => setWebhookInput({...webhookInput, time_of_day: e.target.value})}
                    >
                      <option value="morning">Morning</option>
                      <option value="afternoon">Afternoon</option>
                      <option value="evening">Evening</option>
                      <option value="night">Night (11 PM - 4 AM)</option>
                    </select>
                  </div>

                  <div className="form-group checkbox-group">
                    <label className="checkbox-lbl">
                      <input 
                        type="checkbox" 
                        checked={webhookInput.coupon_applied} 
                        onChange={(e) => setWebhookInput({...webhookInput, coupon_applied: e.target.checked})}
                      />
                      Coupon Code Applied
                    </label>
                  </div>
                </div>

                <button 
                  type="submit" 
                  className={`btn btn-primary btn-block ${playgroundLoading ? 'loading' : ''}`}
                  disabled={playgroundLoading}
                >
                  {playgroundLoading ? 'Evaluating with AI Engine...' : '⚡ Trigger Risk Assessment'}
                </button>
              </form>

              {/* Evaluation Results Section */}
              <div className="playground-results-panel">
                <h4>AI Engine Analysis Output</h4>
                {playgroundResult ? (
                  <div className="result-response-box">
                    
                    {/* Glowing Speedometer Ring */}
                    <div className="risk-meter-container">
                      <div className="speedometer">
                        <svg className="speedo-svg" viewBox="0 0 100 50">
                          {/* Speedometer Track */}
                          <path 
                            d="M 10 50 A 40 40 0 0 1 90 50" 
                            fill="none" 
                            stroke="rgba(255,255,255,0.06)" 
                            strokeWidth="8"
                            strokeLinecap="round"
                          />
                          {/* Speedometer Value Fill */}
                          <path 
                            d="M 10 50 A 40 40 0 0 1 90 50" 
                            fill="none" 
                            stroke={playgroundResult.risk_score >= 70 ? 'var(--accent-rose)' : playgroundResult.risk_score >= 40 ? 'var(--accent-amber)' : 'var(--accent-emerald)'}
                            strokeWidth="8"
                            strokeLinecap="round"
                            strokeDasharray="126" // Half circumference of circle (pi * r) = pi * 40 approx 125.6
                            strokeDashoffset={126 - (126 * playgroundResult.risk_score) / 100}
                            style={{ transition: 'stroke-dashoffset 0.8s ease-in-out' }}
                          />
                        </svg>
                        <div className="speedo-details">
                          <span className="speedo-value">{playgroundResult.risk_score}%</span>
                          <span className="speedo-label">RTO RISK</span>
                        </div>
                      </div>
                    </div>

                    {/* Recommendation Banner */}
                    <div className={`recommendation-banner banner-${playgroundResult.recommendation}`}>
                      <div className="banner-title">
                        {playgroundResult.recommendation === 'ALLOW_ORDER' && '✅ PREPAID APPROVED'}
                        {playgroundResult.recommendation === 'ALLOW_COD' && '✅ COD APPROVED'}
                        {playgroundResult.recommendation === 'SMS_VERIFY' && '💬 OUT-OF-BAND VERIFICATION REQUIRED'}
                        {playgroundResult.recommendation === 'UPSELL_PREPAID' && '💳 COERCE ONLINE PRE-PAYMENT'}
                        {playgroundResult.recommendation === 'BLOCK' && '🚫 SUSPEND ORDER / BLOCK COD'}
                      </div>
                      <div className="banner-desc">
                        {playgroundResult.recommendation === 'ALLOW_ORDER' && 'Standard prepaid order. Process shipping normally.'}
                        {playgroundResult.recommendation === 'ALLOW_COD' && 'Customer and address verified. Order safe to ship via COD.'}
                        {playgroundResult.recommendation === 'SMS_VERIFY' && 'Risk is marginal. Trigger automated SMS/WhatsApp verification. Hold order pending confirmation.'}
                        {playgroundResult.recommendation === 'UPSELL_PREPAID' && 'High RTO Risk. Disable COD checkout option. Prompt user to pay online via Razorpay with a ₹50 discount.'}
                        {playgroundResult.recommendation === 'BLOCK' && 'Violates safety policies (suspicious address, coupon abuse, or chronic RTOer). Disable COD completely.'}
                      </div>
                    </div>

                    {/* Address Audit Scorecard */}
                    {playgroundResult.address_audit && (
                      <div className="address-audit-card animate-fade-in">
                        <h5>Address Quality Audit Parser:</h5>
                        <div className="audit-metrics">
                          <div className="audit-score-circle">
                            <span className="audit-score-num">{playgroundResult.address_audit.score}</span>
                            <span className="audit-score-lbl">Quality Score</span>
                          </div>
                          <div className="audit-details-list">
                            <div className="audit-detail-item">
                              <span>PIN Code Status:</span>
                              <strong>
                                {playgroundResult.address_audit.has_pincode ? (
                                  <span className="text-success">✅ Verified (6-Digit)</span>
                                ) : (
                                  <span className="text-danger">❌ Missing / Invalid PIN</span>
                                )}
                              </strong>
                            </div>
                            <div className="audit-detail-item">
                              <span>Landmark Keywords:</span>
                              <strong>
                                {playgroundResult.address_audit.has_landmark ? (
                                  <span className="text-success">✅ Found</span>
                                ) : (
                                  <span className="text-muted">⚠️ Missing landmark details</span>
                                )}
                              </strong>
                            </div>
                            <div className="audit-detail-item">
                              <span>Character Length:</span>
                              <strong>{playgroundResult.address_audit.length} characters</strong>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Dynamic WhatsApp Verification / Upsell Sandbox */}
                    {playgroundResult.recommendation === 'SMS_VERIFY' && (
                      <div className="whatsapp-mock-container animate-fade-in">
                        <div className="whatsapp-header">
                          <div className="wa-brand-box">
                            <span className="wa-dot"></span>
                            <span className="wa-title">WhatsApp Verification Queue</span>
                          </div>
                          <span className="wa-status">Hold Active</span>
                        </div>
                        <div className="whatsapp-bubble">
                          <p className="wa-sender">RazorRisk Verification Engine</p>
                          <p className="wa-text">
                            Hey there! We received your order for <strong>{formatINR(webhookInput.order_amount)}</strong>. To verify your cash delivery (COD) order, please click below to confirm:
                            <br/>
                            <a href="#" className="wa-link-btn" onClick={(e) => e.preventDefault()}>Verify COD Order</a>
                          </p>
                        </div>
                      </div>
                    )}

                    {playgroundResult.recommendation === 'UPSELL_PREPAID' && (
                      <div className="whatsapp-mock-container animate-fade-in">
                        <div className="whatsapp-header">
                          <div className="wa-brand-box">
                            <span className="wa-dot"></span>
                            <span className="wa-title">Razorpay Prepaid Upsell Hack</span>
                          </div>
                          <span className="wa-status">COD Disabled</span>
                        </div>
                        <div className="whatsapp-bubble">
                          <p className="wa-sender">RazorRisk Conversion System</p>
                          <p className="wa-text">
                            Hey there! Save ₹50 on your order! Pay online now via secure Razorpay checkout to get a 5% discount and instant shipment verification:
                            <br/>
                            <a href="#" className="wa-link-btn" onClick={(e) => e.preventDefault()}>Pay Online (Get ₹50 Off)</a>
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Reason Codes */}
                    <div className="reasons-card">
                      <h5>Risk Rule Audits Triggered:</h5>
                      {playgroundResult.reason_codes && playgroundResult.reason_codes.length > 0 ? (
                        <ul className="reasons-list">
                          {playgroundResult.reason_codes.map((reason: string, i: number) => (
                            <li key={i} className="reason-item">⚠️ {reason}</li>
                          ))}
                        </ul>
                      ) : (
                        <div className="empty-reasons">✅ No critical anomalies detected. Safe buyer signature.</div>
                      )}
                    </div>

                    {/* Feature Vector JSON details */}
                    <div className="json-details-box">
                      <h5>Feature Vector Mapped:</h5>
                      <pre className="json-output">
                        {JSON.stringify(playgroundResult.features_analyzed, null, 2)}
                      </pre>
                    </div>

                  </div>
                ) : (
                  <div className="empty-playground">
                    <div className="empty-playground-icon">⚙️</div>
                    <p>Enter payment parameters on the left and click **Trigger Risk Assessment** to run the classifier.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'integration' && (
          <div className="integration-view animate-fade-in panel-glass">
            <h2 className="section-title">🔌 Razorpay Webhook Integration Guide</h2>
            <p className="panel-desc">
              Connect the **RazorRisk AI Engine** to your live Razorpay account to automate risk management. Intercept orders at checkout and toggle payment methods dynamically.
            </p>

            <div className="timeline">
              <div className="timeline-item">
                <div className="timeline-number">1</div>
                <div className="timeline-content">
                  <h4>Register Webhook Endpoint in Razorpay</h4>
                  <p>
                    Log in to your Razorpay Dashboard, navigate to **Settings** → **Webhooks** → **Add New Webhook**, and enter your risk server endpoint:
                  </p>
                  <div className="url-box">
                    <code>https://risk-api.yourmerchant.com/api/simulate-webhook</code>
                  </div>
                  <p className="text-sm text-secondary">
                    Select the event: <strong>order.created</strong> or <strong>payment.authorized</strong>.
                  </p>
                </div>
              </div>

              <div className="timeline-item">
                <div className="timeline-number">2</div>
                <div className="timeline-content">
                  <h4>Send Checkout Metadata (Notes)</h4>
                  <p>
                    When creating the order on your server using the Razorpay Orders API, append customer account metrics in the <code>notes</code> parameter. This supplies the AI engine with historical user parameters:
                  </p>
                  <pre className="code-block">
{`const Razorpay = require('razorpay');
const rzp = new Razorpay({ key_id: 'KEY_ID', key_secret: 'KEY_SECRET' });

// Create Order API Payload
rzp.orders.create({
  amount: 250000, // INR 2500 in paisa
  currency: "INR",
  receipt: "receipt#1",
  payment_capture: 1,
  notes: {
    user_age_days: 140,
    user_total_orders: 5,
    user_total_rtos: 0,
    state: "Karnataka",
    city_tier: "Tier 1",
    shipping_address: "Flat 402, Block A, Prestige Heights, Bangalore, 560001",
    coupon_applied: "true",
    time_of_day: "evening"
  }
});`}
                  </pre>
                </div>
              </div>

              <div className="timeline-item">
                <div className="timeline-number">3</div>
                <div className="timeline-content">
                  <h4>Handle AI Risk Webhook Actions</h4>
                  <p>
                    Upon order creation, Razorpay triggers the webhook. Your backend intercepts the webhook event, receives the AI Risk verdict, and halts/cancels/verifies COD orders automatically:
                  </p>
                  <pre className="code-block">
{`// Your Webhook Listener endpoint
app.post('/razorpay-webhook', async (req, res) => {
  const event = req.body;
  
  if (event.event === 'order.created') {
    // 1. Forward details to RazorRisk AI Server
    const response = await fetch('https://risk-api.yourmerchant.com/api/simulate-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event)
    });
    
    const assessment = await response.json();
    
    // 2. Action based on AI Decision
    if (assessment.razorpay_action === 'cancel_order') {
      // Auto cancel order in your DB, inform courier, and refund if necessary
      await db.orders.update(assessment.order_id, { status: 'CANCELLED_RISK' });
      await sendWhatsAppAlert(event.payload.order.entity.email, "Order cancelled due to safety flag.");
      console.log(\`[Blocked] Order \${assessment.order_id} rejected.\`);
    } else if (assessment.razorpay_action === 'trigger_verification') {
      // Hold shipment. Trigger Whatsapp double-verification code
      await db.orders.update(assessment.order_id, { status: 'PENDING_OTP' });
      await sendWhatsAppVerificationOTP(event.payload.order.entity.contact);
      console.log(\`[Held] Verification triggered for Order \${assessment.order_id}.\`);
    }
  }
  
  res.status(200).send({ status: 'ok' });
});`}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )}

      </main>
      
      {/* Footer */}
      <footer className="main-footer">
        <p>© 2026 RazorRisk AI • Strictly Defense-Only ML Engine for Indian BFSI & Merchant Safeguards.</p>
        <p className="text-xs text-muted">A Razorpay Buildathon Submission.</p>
      </footer>
    </div>
  );
}


