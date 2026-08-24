import os
import json
import numpy as np
import pandas as pd
from flask import Flask, request, jsonify
from flask_cors import CORS
import joblib

app = Flask(__name__)
CORS(app)  # Enable Cross-Origin Resource Sharing

# Global placeholders for model and metrics
MODEL = None
METRICS = None

# Model features in correct order
FEATURE_COLS = [
    'order_amount', 'user_age_days', 'user_total_orders', 'user_total_rtos', 
    'address_length', 'historical_rto_rate', 'is_cod', 'coupon_applied', 
    'address_has_landmark', 'city_tier_3', 'city_tier_2', 'state_high_risk', 
    'email_disposable', 'night_order', 'coupon_abuse_risk'
]

# Resolve paths relative to app.py location
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, 'model.joblib')
METRICS_PATH = os.path.join(BASE_DIR, 'metrics.json')
USERS_PATH = os.path.join(BASE_DIR, 'users.json')

# Initialize users.json if it doesn't exist
if not os.path.exists(USERS_PATH):
    try:
        with open(USERS_PATH, 'w') as f:
            json.dump({"admin": "password123"}, f, indent=2)
        print("Initialized users.json with default admin account.")
    except Exception as e:
        print(f"Error initializing users.json: {e}")


def load_resources():
    global MODEL, METRICS
    
    if os.path.exists(MODEL_PATH):
        try:
            MODEL = joblib.load(MODEL_PATH)
            print("Model loaded successfully.")
        except Exception as e:
            print(f"Error loading model: {e}")
            
    if os.path.exists(METRICS_PATH):
        try:
            with open(METRICS_PATH, 'r') as f:
                METRICS = json.load(f)
            print("Metrics loaded successfully.")
        except Exception as e:
            print(f"Error loading metrics: {e}")

# Call loading resources
load_resources()

def extract_features(data):
    order_amount = float(data.get('order_amount', 2000))
    user_age_days = float(data.get('user_age_days', 30))
    user_total_orders = float(data.get('user_total_orders', 1))
    user_total_rtos = float(data.get('user_total_rtos', 0))
    
    # Dynamically compute address length if raw text is provided
    address_text = data.get('shipping_address', '') or data.get('address', '')
    address_length = len(address_text) if address_text else float(data.get('address_length', 30))
    
    # Compute rate
    historical_rto_rate = user_total_rtos / user_total_orders if user_total_orders > 0 else 0.0
    
    # Categoricals
    is_cod = 1 if data.get('payment_method') == 'COD' else 0
    coupon_applied = 1 if data.get('coupon_applied') else 0
    address_has_landmark = 1 if data.get('address_has_landmark') else 0
    
    city_tier = data.get('city_tier', 'Tier 1')
    city_tier_3 = 1 if city_tier == 'Tier 3' else 0
    city_tier_2 = 1 if city_tier == 'Tier 2' else 0
    
    state = data.get('state', 'Maharashtra')
    high_risk_states = ['Uttar Pradesh', 'Bihar', 'West Bengal']
    state_high_risk = 1 if state in high_risk_states else 0
    
    email = data.get('email', '')
    email_domain = data.get('email_domain', '')
    if email and '@' in email:
        email_domain = email.split('@')[1]
    
    temp_emails = ['mailinator.com', 'tempmail.net']
    email_disposable = 1 if email_domain in temp_emails else 0
    
    time_of_day = data.get('time_of_day', 'afternoon')
    night_order = 1 if time_of_day == 'night' else 0
    
    coupon_abuse_risk = 1 if coupon_applied == 1 and (email_disposable == 1 or user_total_orders == 1) else 0
    
    feature_dict = {
        'order_amount': order_amount,
        'user_age_days': user_age_days,
        'user_total_orders': user_total_orders,
        'user_total_rtos': user_total_rtos,
        'address_length': address_length,
        'historical_rto_rate': historical_rto_rate,
        'is_cod': is_cod,
        'coupon_applied': coupon_applied,
        'address_has_landmark': address_has_landmark,
        'city_tier_3': city_tier_3,
        'city_tier_2': city_tier_2,
        'state_high_risk': state_high_risk,
        'email_disposable': email_disposable,
        'night_order': night_order,
        'coupon_abuse_risk': coupon_abuse_risk
    }
    
    return feature_dict

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'healthy',
        'model_loaded': MODEL is not None,
        'metrics_loaded': METRICS is not None
    })

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    if not data or 'username' not in data or 'password' not in data:
        return jsonify({'error': 'Username and password are required.'}), 400
        
    username = data.get('username')
    password = data.get('password')
    
    if not os.path.exists(USERS_PATH):
        return jsonify({'error': 'User registry file missing on server.'}), 500
        
    try:
        with open(USERS_PATH, 'r') as f:
            users = json.load(f)
            
        if username in users and users[username] == password:
            return jsonify({
                'status': 'success',
                'user': username,
                'token': f'rzp_risk_token_{username}'
            })
        else:
            return jsonify({'error': 'Invalid username or password.'}), 401
    except Exception as e:
        return jsonify({'error': f'Auth server error: {str(e)}'}), 500

@app.route('/api/register', methods=['POST'])
def register():
    data = request.json
    if not data or 'username' not in data or 'password' not in data:
        return jsonify({'error': 'Username and password are required.'}), 400
        
    username = data.get('username').strip()
    password = data.get('password')
    
    if not username:
        return jsonify({'error': 'Username cannot be blank.'}), 400
        
    if len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters long.'}), 400
        
    if not os.path.exists(USERS_PATH):
        return jsonify({'error': 'User registry file missing on server.'}), 500
        
    try:
        # Load existing users
        with open(USERS_PATH, 'r') as f:
            users = json.load(f)
            
        if username in users:
            return jsonify({'error': 'Username already exists.'}), 400
            
        # Register new user
        users[username] = password
        
        # Save updated map
        with open(USERS_PATH, 'w') as f:
            json.dump(users, f, indent=2)
            
        return jsonify({
            'status': 'success',
            'user': username,
            'message': 'Account created successfully!'
        })
    except Exception as e:
        return jsonify({'error': f'Registration failed: {str(e)}'}), 500


@app.route('/api/metrics', methods=['GET'])
def get_metrics():
    global METRICS
    if METRICS is None:
        load_resources()
        
    if METRICS is None:
        return jsonify({'error': 'Metrics not found. Please run model training first.'}), 404
        
    return jsonify(METRICS)

@app.route('/api/score-order', methods=['POST'])
def score_order():
    global MODEL
    if MODEL is None:
        load_resources()
        
    if MODEL is None:
        return jsonify({'error': 'Model not loaded.'}), 500
        
    data = request.json
    if not data:
        return jsonify({'error': 'No input data provided.'}), 400
        
    # Get threshold from headers or query params or payload (default is 50%)
    threshold = float(request.args.get('threshold', 50.0))
    
    try:
        # Extract features in correct order
        features_dict = extract_features(data)
        features_df = pd.DataFrame([features_dict])[FEATURE_COLS]
        
        # Predict probability
        prob = float(MODEL.predict_proba(features_df)[0, 1])
        risk_score = int(prob * 100)
        
        # Address sanity checks (semantic checks for Indian address formats)
        import re
        address_text = data.get('shipping_address', '') or data.get('address', '')
        
        # Check if the address contains a 6-digit Indian PIN code (regex: \b\d{6}\b)
        has_pincode = True
        if address_text:
            has_pincode = bool(re.search(r'\b\d{6}\b', address_text))
            
        # Address score metric:
        addr_score = 0
        if address_text:
            # Length points (max 40)
            if len(address_text) > 40:
                addr_score += 40
            elif len(address_text) > 20:
                addr_score += 20
            # Pincode points (max 40)
            if has_pincode:
                addr_score += 40
            # Landmark points (max 20)
            if data.get('address_has_landmark') or any(k in address_text.lower() for k in ['near', 'opposite', 'behind', 'temple', 'school', 'hospital', 'landmark']):
                addr_score += 20
        else:
            # Baseline if no address provided
            addr_score = 100
            if features_dict['address_length'] < 20:
                addr_score -= 40
            if features_dict['address_has_landmark'] == 0:
                addr_score -= 20
                
        # Determine specific reason codes
        reason_codes = []
        if features_dict['historical_rto_rate'] > 0.3:
            reason_codes.append("Historical RTO Abuse Pattern Detected")
        if features_dict['email_disposable'] == 1:
            reason_codes.append("Temporary/Disposable Email Domain Used")
        if features_dict['address_length'] < 20:
            reason_codes.append("Incomplete/Extremely Short Shipping Address")
        elif features_dict['address_length'] < 35 and features_dict['address_has_landmark'] == 0:
            reason_codes.append("Short address with missing landmark details")
            
        # Boost risk score if PIN code is missing (crucial override)
        if address_text and not has_pincode and data.get('payment_method') == 'COD':
            risk_score += 20
            reason_codes.append("Critical Warning: Shipping Address lacks a valid 6-digit Indian PIN Code")
            
        if features_dict['coupon_abuse_risk'] == 1:
            reason_codes.append("Promo/Coupon Abuse Signature Detected")
        if features_dict['state_high_risk'] == 1 and features_dict['city_tier_3'] == 1:
            reason_codes.append("High Logistics RTO Probability (Tier-3 Rural Node)")
            
        # Clip risk score to maximum of 99%
        risk_score = min(risk_score, 99)
        
        # Determine Recommendation
        # Prepaid is always ALLOW_COD/ALLOW_ORDER
        payment_method = data.get('payment_method', 'COD')
        if payment_method == 'Prepaid':
            recommendation = 'ALLOW_ORDER'
        else:
            # For COD:
            # We check the score against the user's customized threshold
            if risk_score >= threshold:
                if risk_score >= 80:
                    recommendation = 'BLOCK'
                elif risk_score >= 55:
                    recommendation = 'UPSELL_PREPAID'  # Disables COD, prompts user to pay online via Razorpay (with coupon)
                else:
                    recommendation = 'SMS_VERIFY'  # Sends auto Verification code via SMS/WA
            else:
                recommendation = 'ALLOW_COD'
                
        # Return response
        return jsonify({
            'risk_score': risk_score,
            'recommendation': recommendation,
            'reason_codes': reason_codes,
            'features_analyzed': features_dict,
            'address_audit': {
                'length': len(address_text) if address_text else int(features_dict['address_length']),
                'has_pincode': has_pincode,
                'has_landmark': bool(features_dict['address_has_landmark']) or (address_text and any(k in address_text.lower() for k in ['near', 'opposite', 'behind', 'temple', 'school', 'hospital'])),
                'score': addr_score
            }
        })
        
    except Exception as e:
        return jsonify({'error': f'Prediction failed: {str(e)}'}), 500

@app.route('/api/simulate-webhook', methods=['POST'])
def simulate_webhook():
    # Receives order details and outputs simulated Razorpay webhook response
    # In Razorpay, we can reject payments, trigger order cancellations, or auto-refund
    # This route returns what Razorpay action should be taken.
    global MODEL
    if MODEL is None:
        load_resources()
        
    data = request.json
    if not data:
        return jsonify({'error': 'No input data.'}), 400
        
    # Standard Razorpay Webhook Event Format
    # we simulate the event payload
    event = data.get('event', 'order.created')
    payload = data.get('payload', {})
    
    # We extract order details from order payload
    order_entity = payload.get('order', {}).get('entity', {})
    notes = order_entity.get('notes', {})
    
    # We reconstruct order info from notes & entity
    payment_method = "COD" if order_entity.get('method') == 'cod' else "Prepaid"
    
    # For a realistic integration, details are stored in metadata notes
    order_data = {
        'order_amount': float(order_entity.get('amount', 250000)) / 100.0, # convert paisa to INR
        'payment_method': payment_method,
        'user_age_days': float(notes.get('user_age_days', 30)),
        'user_total_orders': float(notes.get('user_total_orders', 1)),
        'user_total_rtos': float(notes.get('user_total_rtos', 0)),
        'state': notes.get('state', 'Maharashtra'),
        'city_tier': notes.get('city_tier', 'Tier 1'),
        'address_length': len(notes.get('shipping_address', 'Mumbai, Maharashtra')),
        'address_has_landmark': any(k in notes.get('shipping_address', '').lower() for k in ['near', 'opposite', 'behind', 'landmark', 'temple', 'school']),
        'email': order_entity.get('email', notes.get('email', 'customer@gmail.com')),
        'time_of_day': notes.get('time_of_day', 'afternoon'),
        'coupon_applied': bool(notes.get('coupon_applied', False))
    }
    
    try:
        features_dict = extract_features(order_data)
        features_df = pd.DataFrame([features_dict])[FEATURE_COLS]
        prob = float(MODEL.predict_proba(features_df)[0, 1])
        risk_score = int(prob * 100)
        
        # Action mappings
        action = "none"
        message = "Order accepted."
        
        if payment_method == 'COD':
            if risk_score >= 75:
                action = "cancel_order"
                message = "AI Risk Engine flagged transaction as Extreme RTO Risk (Blocked)."
            elif risk_score >= 50:
                action = "trigger_verification"
                message = "Order held. WhatsApp OTP sent to customer for COD confirmation."
                
        return jsonify({
            'event': event,
            'order_id': order_entity.get('id', 'order_ABC123'),
            'risk_score': risk_score,
            'razorpay_action': action,
            'action_message': message,
            'timestamp': order_entity.get('created_at', 1700000000)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    print("Starting RazorRisk AI Backend Server on port 5000...")
    app.run(host='0.0.0.0', port=5000, debug=True)
