import os
import json
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import roc_curve, precision_recall_curve, confusion_matrix, roc_auc_score
import joblib

# Set random seed for reproducibility
np.random.seed(42)

def generate_synthetic_data(num_samples=10000):
    print(f"Generating {num_samples} synthetic Indian e-commerce orders...")
    
    # 1. Base User profiles (simulating recurring users vs new users)
    # We will generate profiles and map each order to a profile
    num_profiles = int(num_samples * 0.6)  # 60% unique users
    user_ids = [f"usr_{i:05d}" for i in range(num_profiles)]
    
    user_age_days = np.random.exponential(scale=180, size=num_profiles).astype(int) + 1
    user_total_orders = np.random.poisson(lam=2, size=num_profiles) + 1
    
    # Generate RTO rates for users: some are chronic RTOers, some are normal
    user_rto_rate = np.random.choice([0.0, 0.1, 0.4, 0.8], p=[0.7, 0.2, 0.07, 0.03], size=num_profiles)
    user_total_rtos = np.round(user_total_orders * user_rto_rate).astype(int)
    # Clamp total rtos
    user_total_rtos = np.minimum(user_total_rtos, user_total_orders - 1)
    # For user_total_orders == 1, total_rtos must be 0 (since their first order is the one we are creating now)
    user_total_rtos[user_total_orders == 1] = 0
    
    # Create profile dataframe
    profiles_df = pd.DataFrame({
        'user_id': user_ids,
        'user_age_days': user_age_days,
        'user_total_orders': user_total_orders,
        'user_total_rtos': user_total_rtos
    })
    
    # Assign profiles to orders
    order_users = np.random.choice(user_ids, size=num_samples)
    orders_df = pd.merge(pd.DataFrame({'user_id': order_users}), profiles_df, on='user_id')
    
    # 2. Add Order particulars
    # Order values in INR (normally distributed with average 2500, minimum 300)
    orders_df['order_amount'] = np.clip(np.random.normal(2500, 1800, size=num_samples), 300, 25000).astype(int)
    
    # Payment Method (COD is dominant in India, ~60-70% for some verticals)
    orders_df['payment_method'] = np.random.choice(['COD', 'Prepaid'], p=[0.65, 0.35], size=num_samples)
    
    # Coupon applied
    orders_df['coupon_applied'] = np.random.choice([0, 1], p=[0.6, 0.4], size=num_samples)
    
    # 3. Location profile (Indian states & Tier levels)
    states = ['Maharashtra', 'Delhi', 'Karnataka', 'Tamil Nadu', 'Uttar Pradesh', 'Bihar', 'West Bengal', 'Haryana', 'Gujarat', 'Rajasthan']
    state_weights = [0.20, 0.15, 0.15, 0.10, 0.12, 0.08, 0.08, 0.04, 0.05, 0.03]
    orders_df['state'] = np.random.choice(states, p=state_weights, size=num_samples)
    
    orders_df['city_tier'] = np.random.choice(['Tier 1', 'Tier 2', 'Tier 3'], p=[0.45, 0.35, 0.20], size=num_samples)
    
    # Address parameters (Very important indicator in India: incomplete/short addresses lead to RTO)
    # Address length in characters
    orders_df['address_length'] = np.clip(np.random.normal(45, 20, size=num_samples), 5, 200).astype(int)
    
    # Address has landmarks
    orders_df['address_has_landmark'] = np.random.choice([0, 1], p=[0.35, 0.65], size=num_samples)
    
    # 4. Device and profile anomalies
    email_domains = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'mailinator.com', 'tempmail.net']
    orders_df['email_domain'] = np.random.choice(email_domains, p=[0.75, 0.13, 0.05, 0.04, 0.015, 0.015], size=num_samples)
    
    orders_df['time_of_day'] = np.random.choice(['morning', 'afternoon', 'evening', 'night'], p=[0.25, 0.30, 0.30, 0.15], size=num_samples)
    
    # 5. Model the RTO Probability (True logic)
    # Calculate base log odds
    log_odds = -2.8
    
    # Add weights for RTO risk factors
    # 1. COD has a massive weight since prepaid is rarely RTO
    log_odds += (orders_df['payment_method'] == 'COD').astype(int) * 2.2
    
    # 2. Address length is short (less than 25 chars means high RTO chance)
    log_odds += (orders_df['address_length'] < 20).astype(int) * 1.8
    log_odds += ((orders_df['address_length'] >= 20) & (orders_df['address_length'] < 35)).astype(int) * 0.8
    
    # 3. No landmark increases risk
    log_odds += (orders_df['address_has_landmark'] == 0).astype(int) * 0.7
    
    # 4. State risk profile
    high_risk_states = ['Uttar Pradesh', 'Bihar', 'West Bengal']
    log_odds += orders_df['state'].isin(high_risk_states).astype(int) * 0.6
    
    # 5. City tier risk
    log_odds += (orders_df['city_tier'] == 'Tier 3').astype(int) * 0.8
    log_odds += (orders_df['city_tier'] == 'Tier 2').astype(int) * 0.3
    
    # 6. Email anomaly (disposable domains)
    temp_emails = ['mailinator.com', 'tempmail.net']
    log_odds += orders_df['email_domain'].isin(temp_emails).astype(int) * 2.0
    
    # 7. Customer history risk
    hist_rto_rate = orders_df['user_total_rtos'] / orders_df['user_total_orders']
    log_odds += hist_rto_rate * 3.5
    
    # 8. Impulse buying / late night ordering
    log_odds += (orders_df['time_of_day'] == 'night').astype(int) * 0.5
    
    # 9. Coupon abuse (coupon applied + disposable email or new user)
    coupon_abuse = (orders_df['coupon_applied'] == 1) & (orders_df['email_domain'].isin(temp_emails) | (orders_df['user_total_orders'] == 1))
    log_odds += coupon_abuse.astype(int) * 1.5
    
    # Calculate probability
    prob = 1.0 / (1.0 + np.exp(-log_odds))
    
    # Scale down risk massively if prepaid (prepaid orders are rarely returned-to-origin, ~1-2% baseline)
    prob = np.where(orders_df['payment_method'] == 'Prepaid', np.clip(prob * 0.05, 0, 0.02), prob)
    
    # Generate actual label
    orders_df['is_rto'] = np.random.binomial(1, prob)
    
    return orders_df

def preprocess_features(df):
    processed = pd.DataFrame()
    
    # Numeric features
    processed['order_amount'] = df['order_amount']
    processed['user_age_days'] = df['user_age_days']
    processed['user_total_orders'] = df['user_total_orders']
    processed['user_total_rtos'] = df['user_total_rtos']
    processed['address_length'] = df['address_length']
    
    # Computed numeric features
    processed['historical_rto_rate'] = df['user_total_rtos'] / df['user_total_orders']
    
    # Categorical mapped binary features
    processed['is_cod'] = (df['payment_method'] == 'COD').astype(int)
    processed['coupon_applied'] = df['coupon_applied'].astype(int)
    processed['address_has_landmark'] = df['address_has_landmark'].astype(int)
    
    # City Tiers
    processed['city_tier_3'] = (df['city_tier'] == 'Tier 3').astype(int)
    processed['city_tier_2'] = (df['city_tier'] == 'Tier 2').astype(int)
    
    # State Risk Groups
    high_risk_states = ['Uttar Pradesh', 'Bihar', 'West Bengal']
    processed['state_high_risk'] = df['state'].isin(high_risk_states).astype(int)
    
    # Email anomaly
    temp_emails = ['mailinator.com', 'tempmail.net']
    processed['email_disposable'] = df['email_domain'].isin(temp_emails).astype(int)
    
    # Time factors
    processed['night_order'] = (df['time_of_day'] == 'night').astype(int)
    
    # Interactive features
    processed['coupon_abuse_risk'] = (df['coupon_applied'] == 1) & (df['email_domain'].isin(temp_emails) | (df['user_total_orders'] == 1))
    processed['coupon_abuse_risk'] = processed['coupon_abuse_risk'].astype(int)
    
    return processed

def train_and_evaluate():
    # 1. Generate Dataset
    data = generate_synthetic_data(10000)
    
    # 2. Extract features and target
    X = preprocess_features(data)
    y = data['is_rto']
    
    print("\nDataset Class Distribution:")
    print(y.value_counts(normalize=True))
    
    # 3. Train-Test Split (Held-out Test set)
    X_train, X_test, y_train, y_test, raw_train, raw_test = train_test_split(
        X, y, data, test_size=0.20, random_state=42, stratify=y
    )
    
    # 4. Train Random Forest Classifier
    print("\nTraining Random Forest Classifier...")
    model = RandomForestClassifier(n_estimators=150, max_depth=12, random_state=42, n_jobs=-1)
    model.fit(X_train, y_train)
    
    # Save the model
    os.makedirs('backend', exist_ok=True)
    model_path = 'backend/model.joblib'
    joblib.dump(model, model_path)
    print(f"Model saved to {model_path}")
    
    # 5. Evaluate on Held-out Test Set
    y_probs = model.predict_proba(X_test)[:, 1]
    roc_auc = roc_auc_score(y_test, y_probs)
    print(f"Held-out Test Set ROC-AUC: {roc_auc:.4f}")
    
    # Calculate Precision, Recall, Confusion Matrix at multiple thresholds
    thresholds = np.linspace(0.0, 1.0, 101)
    evaluation_curves = []
    
    # Financial metrics defaults
    c_rto = 150.0  # RTO cost in INR (shipping/processing)
    # AOV is average order amount of actual test set (approx 2500)
    avg_order_value = raw_test['order_amount'].mean()
    # Assume profit margin is 35% of order value -> 875 INR
    # Assume 40% of good customers churn if COD is blocked -> FP cost = 0.40 * 875 = 350 INR
    c_fp = 0.40 * (avg_order_value * 0.35)
    
    # Calculate metrics at each threshold
    for t in thresholds:
        y_pred = (y_probs >= t).astype(int)
        tn, fp, fn, tp = confusion_matrix(y_test, y_pred).ravel()
        
        precision = float(tp / (tp + fp)) if (tp + fp) > 0 else 1.0
        recall = float(tp / (tp + fn)) if (tp + fn) > 0 else 0.0
        fpr = float(fp / (fp + tn)) if (fp + tn) > 0 else 0.0
        
        # Financial impact
        # We save RTO cost on True Positives (we blocked them, saving c_rto)
        # We lose c_fp on False Positives (we blocked good buyers, losing LTV margin)
        # We lose c_rto on False Negatives (we missed fraud, paying RTO cost)
        total_savings = (tp * c_rto) - (fp * c_fp)
        
        evaluation_curves.append({
            'threshold': float(t),
            'tp': int(tp),
            'fp': int(fp),
            'tn': int(tn),
            'fn': int(fn),
            'precision': precision,
            'recall': recall,
            'fpr': fpr,
            'net_savings_inr': total_savings
        })
        
    # Generate ROC points
    fpr_roc, tpr_roc, _ = roc_curve(y_test, y_probs)
    roc_points = [{'fpr': float(f), 'tpr': float(t)} for f, t in zip(fpr_roc, tpr_roc)]
    
    # Generate PR points
    precision_pr, recall_pr, _ = precision_recall_curve(y_test, y_probs)
    pr_points = [{'recall': float(r), 'precision': float(p)} for r, p in zip(recall_pr, precision_pr)]
    
    # Save test set data structure for stream simulator (so the frontend can read actual test set items)
    # We will sample 150 random examples from test set to stream in frontend
    test_stream_data = []
    sample_indices = np.random.choice(raw_test.index, size=150, replace=False)
    for idx in sample_indices:
        row = raw_test.loc[idx]
        features = X_test.loc[idx].to_dict()
        prob_val = float(y_probs[np.where(X_test.index == idx)[0][0]])
        test_stream_data.append({
            'user_id': str(row['user_id']),
            'user_age_days': int(row['user_age_days']),
            'user_total_orders': int(row['user_total_orders']),
            'user_total_rtos': int(row['user_total_rtos']),
            'order_amount': int(row['order_amount']),
            'payment_method': str(row['payment_method']),
            'coupon_applied': bool(row['coupon_applied']),
            'state': str(row['state']),
            'city_tier': str(row['city_tier']),
            'address_length': int(row['address_length']),
            'address_has_landmark': bool(row['address_has_landmark']),
            'email_domain': str(row['email_domain']),
            'time_of_day': str(row['time_of_day']),
            'risk_score': int(prob_val * 100),
            'actual_is_rto': int(row['is_rto'])
        })
        
    # Combine all metadata and metrics
    output_metrics = {
        'roc_auc': float(roc_auc),
        'test_set_size': int(len(y_test)),
        'total_rto_actual': int(y_test.sum()),
        'avg_order_value': float(avg_order_value),
        'evaluation_curves': evaluation_curves,
        'roc_curve': roc_points,
        'pr_curve': pr_points,
        'sample_orders': test_stream_data,
        'feature_importances': {
            feature: float(importance) 
            for feature, importance in zip(X.columns, model.feature_importances_)
        }
    }
    
    metrics_path = 'backend/metrics.json'
    with open(metrics_path, 'w') as f:
        json.dump(output_metrics, f, indent=2)
    print(f"Metrics saved to {metrics_path}")
    print("Feature Importances:")
    for f, imp in sorted(output_metrics['feature_importances'].items(), key=lambda x: x[1], reverse=True):
        print(f" - {f}: {imp:.4f}")

if __name__ == '__main__':
    train_and_evaluate()
