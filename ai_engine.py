import pandas as pd
import numpy as np
from greeks import black_scholes_greeks, estimate_iv
from datetime import datetime

class TradingAI:
    def __init__(self, config):
        self.config = config

    def calculate_rsi(self, data, window=14):
        """Standard RSI calculation."""
        delta = data['close'].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=window).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=window).mean()
        rs = gain / loss
        return 100 - (100 / (1 + rs))

    def generate_signals(self, spot_price, options_chain, historical_data):
        """
        Analyzes options and market context to generate signals.
        Returns a list of significant signals.
        """
        signals = []
        
        # 1. Market Context (RSI/MA)
        if not historical_data.empty:
            historical_data['rsi'] = self.calculate_rsi(historical_data, self.config.RSI_PERIOD)
            historical_data['ma'] = historical_data['close'].rolling(window=self.config.MA_WINDOW).mean()
            
            latest_rsi = historical_data['rsi'].iloc[-1]
            latest_ma = historical_data['ma'].iloc[-1]
            trend = "BULLISH" if spot_price > latest_ma else "BEARISH"
        else:
            latest_rsi = 50
            trend = "NEUTRAL"

        # 2. Process Options Chain
        # We look for liquid, near-the-money options
        if options_chain.empty:
            return signals

        # Filter for relevant strikes (e.g., within 5% of spot)
        options_chain['strike'] = options_chain['strike'].astype(float)
        relevant_options = options_chain[
            (options_chain['strike'] >= spot_price * 0.95) & 
            (options_chain['strike'] <= spot_price * 1.05)
        ].copy()

        for _, row in relevant_options.iterrows():
            # Basic data
            strike = float(row['strike'])
            expiry_str = row['expiration']
            option_type = row['type'].lower()
            premium = float(row.get('lastPrice', 0))
            
            # Time to expiry in years
            expiry_date = datetime.strptime(expiry_str, '%Y-%m-%d')
            days_to_expiry = (expiry_date - datetime.now()).days
            T = max(days_to_expiry / 365, 0.001)

            # Get IV and Greeks
            iv = float(row.get('impliedVolatility', 0))
            if iv == 0:
                iv = estimate_iv(premium, spot_price, strike, T, self.config.RISK_FREE_RATE, option_type)

            greeks = black_scholes_greeks(spot_price, strike, T, self.config.RISK_FREE_RATE, iv, option_type)
            
            # --- AI Signal Logic (Heuristic Decision Engine) ---
            # Strong Buy Call: Upward trend + RSI < 70 + Delta > 0.5 + Theta acceptable
            # Strong Buy Put: Downward trend + RSI > 30 + Delta < -0.5 + Theta acceptable
            
            signal_type = "HOLD"
            confidence = 0
            
            if option_type == 'call':
                if trend == "BULLISH" and latest_rsi < 65 and greeks['delta'] > self.config.DELTA_THRESHOLD:
                    signal_type = "BUY"
                    confidence = (greeks['delta'] * 100)
                elif trend == "BEARISH" or latest_rsi > 75:
                    signal_type = "SELL"
            
            elif option_type == 'put':
                if trend == "BEARISH" and latest_rsi > 35 and abs(greeks['delta']) > self.config.DELTA_THRESHOLD:
                    signal_type = "BUY"
                    confidence = (abs(greeks['delta']) * 100)
                elif trend == "BULLISH" or latest_rsi < 25:
                    signal_type = "SELL"

            # Always add to log so the user can see everything in Excel
            signals.append({
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "symbol": self.config.TARGET_SYMBOL,
                "option_type": option_type.upper(),
                "strike": strike,
                "expiry": expiry_str,
                "spot": spot_price,
                "delta": round(greeks['delta'], 3),
                "gamma": round(greeks['gamma'], 4),
                "theta": round(greeks['theta'], 4),
                "iv": round(iv, 4),
                "rsi": round(latest_rsi, 2),
                "trend": trend,
                "action": signal_type,
                "confidence": round(confidence, 1)
            })

        return signals
