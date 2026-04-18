import math
from scipy.stats import norm

def black_scholes_greeks(S, K, T, r, sigma, option_type='call'):
    """
    Calculates Delta, Gamma, Theta, and Vega for an option.
    S: Underlying price
    K: Strike price
    T: Time to expiration (in years)
    r: Risk-free rate
    sigma: Implied Volatility
    """
    if T <= 0:
        return {'delta': 0, 'gamma': 0, 'theta': 0, 'vega': 0}

    d1 = (math.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)

    if option_type == 'call':
        delta = norm.cdf(d1)
        theta = (- (S * sigma * norm.pdf(d1)) / (2 * math.sqrt(T)) 
                 - r * K * math.exp(-r * T) * norm.cdf(d2))
    else:
        delta = norm.cdf(d1) - 1
        theta = (- (S * sigma * norm.pdf(d1)) / (2 * math.sqrt(T)) 
                 + r * K * math.exp(-r * T) * norm.cdf(-d2))

    gamma = norm.pdf(d1) / (S * sigma * math.sqrt(T))
    vega = S * norm.pdf(d1) * math.sqrt(T)

    return {
        'delta': delta,
        'gamma': gamma,
        'theta': theta / 365,  # Daily theta
        'vega': vega / 100     # Vega for 1% change
    }

def estimate_iv(price, S, K, T, r, option_type='call'):
    """
    Simplified IV estimation using a Newton-Raphson-like iterative approach.
    In a real system, you'd use a more robust solver or get it from the API.
    """
    sigma = 0.5  # Initial guess
    for i in range(20):
        g = black_scholes_greeks(S, K, T, r, sigma, option_type)
        v = g['vega'] * 100
        if v == 0: break
        
        # Black-Scholes price logic
        d1 = (math.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * math.sqrt(T))
        d2 = d1 - sigma * math.sqrt(T)
        if option_type == 'call':
            current_price = S * norm.cdf(d1) - K * math.exp(-r * T) * norm.cdf(d2)
        else:
            current_price = K * math.exp(-r * T) * norm.cdf(-d2) - S * norm.cdf(-d1)
            
        diff = price - current_price
        if abs(diff) < 1e-4:
            return sigma
        sigma = sigma + diff / v
        
    return sigma if sigma > 0 else 0.2  # Default to 20% if calculation fails
