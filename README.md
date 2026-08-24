# RazorRisk AI: Indian Merchant RTO & Return Fraud Guard

### A Defense-Only AI Risk Manager to Stop Cash-on-Delivery (COD) Margins Eating Losses

In Indian e-commerce, **Return to Origin (RTO)** is a major profit killer. COD orders account for ~65% of checkouts, but suffer from a 30-40% RTO rate due to courier issues, incomplete addresses, coupon/promo abuse, or buyer regret. 

**RazorRisk AI** is an ML-powered risk engine and real-time dashboard designed to help Razorpay merchants predict, intercept, and optimize RTO risks before shipping.

---

## ⚡ Key Features

1. **AI RTO Risk Classifier (ML Engine)**:
   - Random Forest Classifier trained on simulated Indian e-commerce patterns.
   - Evaluated on a **held-out test set** yielding an **ROC-AUC of 0.88+**.
   - Mapped features: shipping address length, landmark detection, city tier (Tier 1/2/3), state risk profile, buyer order history (past RTO rate), payment details, coupon abuse risk, and midnight checkout signatures.

2. **Interactive Financial ROI Cost-Benefit Optimizer**:
   - A simulator that evaluates precision/recall tradeoffs alongside business costs:
     - **RTO Logistics Cost**: The double-way courier fees.
     - **False Positive Friction Churn**: Profit margin lost from good customers blocked from COD checkout who churn.
   - Dynamic threshold adjustments showing the exact mathematically **optimal threshold** to maximize net merchant savings.

3. **Razorpay Webhook Interceptor & Playground**:
   - Interactive console to simulate Razorpay payment events (`order.created`, `payment.authorized`).
   - Visual speedometer gauge of risk and specific rule alerts.
   - Triggerable mock scenarios: Safe Buyer, Chronic RTOer, Coupon Fraud.

4. **Premium Cyberpunk Glassmorphic Dashboard**:
   - Built with React, TypeScript, and custom CSS.
   - Beautiful custom animated SVG graphs (ROC curve, PR curve, Savings curve).
   - Real-time ticker stream of incoming transactions being evaluated.

---

## 🛠️ Architecture & Setup

The project consists of a Flask Python API serving the ML predictions and a React+Vite web frontend.

### Prerequisites
- Python 3.8+
- Node.js v18+

### 1. Backend Server Setup
From the project root:
```bash
# Install dependencies
pip install -r backend/requirements.txt

# (Optional) Re-train the model & generate the metrics dataset
python backend/train_model.py

# Launch the Flask server (runs on port 5000)
python backend/app.py
```

### 2. Frontend Dashboard Setup
From the project root:
```bash
cd frontend

# Install packages
npm install

# Launch Vite server (runs on port 5173)
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 🔬 Honest Metrics (Held-out Test Set)

Our model achieves the following metrics on the 2,000-order held-out test set:

- **ROC-AUC**: `0.8836`
- **Baseline RTO Incidence**: `42.3%`
- **Primary Feature Drivers**:
  - `is_cod` (COD payment selection): **62.5%**
  - `address_length` (address completeness): **9.6%**
  - `user_age_days` (account duration): **6.6%**
  - `order_amount` (ticket size): **6.4%**

### Business Cost-Benefit Math
When standard merchants run without RTO guards, their baseline losses on 2,000 orders is:
$$\text{Baseline Logistics Loss} = \text{Total Actual RTO} \times C_{RTO}$$
With **RazorRisk AI** enabled, we block/convert high-risk COD orders above threshold $\theta$.
$$\text{Net Savings}(\theta) = \text{True Positives}(\theta) \times C_{RTO} - \text{False Positives}(\theta) \times C_{FP}$$
Where:
- $C_{RTO}$ = courier fees (default ₹150)
- $C_{FP}$ = customer friction cost (average order value $\times$ margin rate $\times$ churn rate)

The system automatically calculates the optimum threshold (typically **~50%** risk threshold) to yield the highest net financial savings.

---

## 🔌 Razorpay Webhook Integration Code

When creating an order via the Razorpay Orders API, attach customer metrics inside the `notes` metadata payload. Your server can register a webhook handler to check order risk:

```javascript
// Webhook Listener Example (Node.js)
app.post('/razorpay-webhook', async (req, res) => {
  const event = req.body;
  
  if (event.event === 'order.created') {
    // Query RazorRisk AI Engine
    const response = await fetch('http://localhost:5000/api/score-order?threshold=50', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payment_method: event.payload.order.entity.method === 'cod' ? 'COD' : 'Prepaid',
        order_amount: event.payload.order.entity.amount / 100,
        user_age_days: event.payload.order.entity.notes.user_age_days,
        user_total_orders: event.payload.order.entity.notes.user_total_orders,
        user_total_rtos: event.payload.order.entity.notes.user_total_rtos,
        state: event.payload.order.entity.notes.state,
        city_tier: event.payload.order.entity.notes.city_tier,
        address_length: event.payload.order.entity.notes.shipping_address.length,
        address_has_landmark: /near|opposite|behind|temple|school/i.test(event.payload.order.entity.notes.shipping_address),
        email: event.payload.order.entity.email,
        time_of_day: event.payload.order.entity.notes.time_of_day,
        coupon_applied: event.payload.order.entity.notes.coupon_applied === 'true'
      })
    });
    
    const assessment = await response.json();
    
    // Intercept Razorpay transaction
    if (assessment.recommendation === 'BLOCK') {
      // Auto-hold or Cancel shipment
      await myCourierAPI.cancelShipment(assessment.order_id);
      await myDatabase.orders.update(assessment.order_id, { status: 'CANCELLED_BY_AI' });
    } else if (assessment.recommendation === 'SMS_VERIFY') {
      // Send a confirmation OTP on WhatsApp before shipping
      await myWhatsAppAPI.sendVerificationCode(event.payload.order.entity.contact);
    }
  }
  res.status(200).send({ status: 'ok' });
});
```

---
*Developed for the Razorpay Buildathon. Built with a focus on defense-only fraud mitigations for e-commerce growth.*
