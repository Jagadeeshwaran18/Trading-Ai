import pandas as pd
import numpy as np
from greeks import black_scholes_greeks, estimate_iv
from datetime import datetime
from fvg_engine import FVGEngine

class TradingAI:
    def __init__(self, config):
        self.config = config
        self.position_state = {} # Tracks {symbol: {'high': price, 'low': price, 'initial_sl': price}}
        self.fvg_engine = FVGEngine()

    def calculate_rsi(self, data, window=14):
        """Standard RSI calculation."""
        delta = data['close'].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=window).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=window).mean()
        rs = gain / loss
        return 100 - (100 / (1 + rs))

    def calculate_atr(self, data, window=14):
        """Average True Range calculation."""
        if data.empty or len(data) < window:
            return 0
            
        high = data['high']
        low = data['low']
        prev_close = data['close'].shift(1)
        
        tr1 = high - low
        tr2 = abs(high - prev_close)
        tr3 = abs(low - prev_close)
        
        tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
        atr = tr.rolling(window=window).mean()
        return atr.iloc[-1]

    def _get_targets(self, spot_price, action, atr):
        """Calculates dynamic SL and TP based on ATR."""
        atr_risk = atr * self.config.ATR_MULTIPLIER
        
        if action == "BUY":
            sl = spot_price - atr_risk
            tp = spot_price + (atr_risk * self.config.RISK_REWARD_RATIO)
            return {
                "stop_loss": round(sl, 2),
                "target": round(tp, 2),
                "trailing_stoploss": round(sl, 2), # Initial TSL is the same as SL
                "trailing_target": round(tp, 2)
            }
        elif action == "SELL":
            sl = spot_price + atr_risk
            tp = spot_price - (atr_risk * self.config.RISK_REWARD_RATIO)
            return {
                "stop_loss": round(sl, 2),
                "target": round(tp, 2),
                "trailing_stoploss": round(sl, 2),
                "trailing_target": round(tp, 2)
            }
        else:
            return {
                "stop_loss": round(spot_price, 2),
                "target": round(spot_price, 2),
                "trailing_stoploss": round(spot_price, 2),
                "trailing_target": round(spot_price, 2)
            }

    def generate_signals(self, symbol, spot_price, options_chain, historical_data):
        """
        Analyzes options and market context to generate signals.
        Returns a list of significant signals.
        """
        signals = []
        
        # 1. Market Context (RSI/MA)
        atr = self.calculate_atr(historical_data, self.config.ATR_PERIOD)
        
        fvg_buy_signal = False
        fvg_sell_signal = False
        
        if not historical_data.empty:
            historical_data['rsi'] = self.calculate_rsi(historical_data, self.config.RSI_PERIOD)
            historical_data['ma'] = historical_data['close'].rolling(window=self.config.MA_WINDOW).mean()
            
            latest_rsi = historical_data['rsi'].iloc[-1]
            latest_ma = historical_data['ma'].iloc[-1]
            trend = "BULLISH" if spot_price > latest_ma else "BEARISH"
            
            # Calculate FVGs
            fvgs = self.fvg_engine.detect_fvgs(historical_data)
            active_bullish = [f for f in fvgs if not f['filled'] and f['type'] == 'bullish']
            active_bearish = [f for f in fvgs if not f['filled'] and f['type'] == 'bearish']
            
            # Check if current price is in or near an active FVG zone
            for f in active_bullish:
                if f['bottom'] * 0.995 <= spot_price <= f['top'] * 1.005:
                    fvg_buy_signal = True
                    break
            for f in active_bearish:
                if f['bottom'] * 0.995 <= spot_price <= f['top'] * 1.005:
                    fvg_sell_signal = True
                    break
        else:
            latest_rsi = 50
            trend = "NEUTRAL"

        # Determine log trend string with FVG context
        fvg_suffix = " (FVG Buy)" if fvg_buy_signal else (" (FVG Sell)" if fvg_sell_signal else "")
        log_trend = trend + fvg_suffix

        # 2. Process Options Chain
        # If no options, still log the spot analysis
        if options_chain is None or options_chain.empty:
            spot_action = "HOLD"
            spot_confidence = 0
            
            # Simple Spot AI Logic
            if trend == "BULLISH" and latest_rsi < 65:
                spot_action = "BUY"
                spot_confidence = 100 - latest_rsi
            elif trend == "BEARISH" and latest_rsi > 35:
                spot_action = "SELL"
                spot_confidence = latest_rsi
            elif latest_rsi > 75:
                spot_action = "SELL"
                spot_confidence = 80
            elif latest_rsi < 25:
                spot_action = "BUY"
                spot_confidence = 80

            # Incorporate FVG logic
            if fvg_buy_signal and trend == "BULLISH":
                if spot_action == "BUY":
                    spot_confidence = min(98.0, spot_confidence + 15.0)
                elif spot_action == "HOLD":
                    spot_action = "BUY"
                    spot_confidence = 70.0
            elif fvg_sell_signal and trend == "BEARISH":
                if spot_action == "SELL":
                    spot_confidence = min(98.0, spot_confidence + 15.0)
                elif spot_action == "HOLD":
                    spot_action = "SELL"
                    spot_confidence = 70.0

            targets = self._get_targets(spot_price, spot_action, atr)
            
            # --- Trailing Stop Loss logic ---
            if spot_action != "HOLD":
                state_key = f"{symbol}_SPOT"
                if state_key not in self.position_state:
                    self.position_state[state_key] = {'high': spot_price, 'low': spot_price, 'atr': atr}
                
                self.position_state[state_key]['high'] = max(self.position_state[state_key]['high'], spot_price)
                self.position_state[state_key]['low'] = min(self.position_state[state_key]['low'], spot_price)
                
                if spot_action == "BUY":
                    new_tsl = self.position_state[state_key]['high'] - (atr * self.config.ATR_MULTIPLIER)
                    targets['trailing_stoploss'] = round(max(targets['trailing_stoploss'], new_tsl), 2)
                elif spot_action == "SELL":
                    new_tsl = self.position_state[state_key]['low'] + (atr * self.config.ATR_MULTIPLIER)
                    targets['trailing_stoploss'] = round(min(targets['trailing_stoploss'], new_tsl), 2)
            signals.append({
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "symbol": symbol,
                "option_type": "SPOT",
                "strike": 0,
                "expiry": "N/A",
                "spot": spot_price,
                "delta": 0,
                "gamma": 0,
                "theta": 0,
                "iv": 0,
                "rsi": round(latest_rsi, 2),
                "trend": trend,
                "action": spot_action,
                "confidence": round(spot_confidence, 1),
                "stop_loss": targets["stop_loss"],
                "target": targets["target"],
                "trailing_stoploss": targets["trailing_stoploss"],
                "trailing_target": targets["trailing_target"]
            })
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
                    if fvg_buy_signal:
                        confidence = min(98.0, confidence + 10.0)
                elif trend == "BEARISH" or latest_rsi > 75:
                    signal_type = "SELL"
            
            elif option_type == 'put':
                if trend == "BEARISH" and latest_rsi > 35 and abs(greeks['delta']) > self.config.DELTA_THRESHOLD:
                    signal_type = "BUY"
                    confidence = (abs(greeks['delta']) * 100)
                    if fvg_sell_signal:
                        confidence = min(98.0, confidence + 10.0)
                elif trend == "BULLISH" or latest_rsi < 25:
                    signal_type = "SELL"

            # Always add to log so the user can see everything in Excel
            targets = self._get_targets(spot_price, signal_type, atr)
            
            # --- Trailing Stop Loss logic for Options ---
            if signal_type != "HOLD":
                state_key = f"{symbol}_{option_type.upper()}_{strike}"
                if state_key not in self.position_state:
                    self.position_state[state_key] = {'high': spot_price, 'low': spot_price, 'atr': atr}
                
                self.position_state[state_key]['high'] = max(self.position_state[state_key]['high'], spot_price)
                self.position_state[state_key]['low'] = min(self.position_state[state_key]['low'], spot_price)
                
                if signal_type == "BUY":
                    new_tsl = self.position_state[state_key]['high'] - (atr * self.config.ATR_MULTIPLIER)
                    targets['trailing_stoploss'] = round(max(targets['trailing_stoploss'], new_tsl), 2)
                elif signal_type == "SELL":
                    new_tsl = self.position_state[state_key]['low'] + (atr * self.config.ATR_MULTIPLIER)
                    targets['trailing_stoploss'] = round(min(targets['trailing_stoploss'], new_tsl), 2)
            signals.append({
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "symbol": symbol,
                "option_type": option_type.upper(),
                "strike": strike,
                "expiry": expiry_str,
                "spot": spot_price,
                "delta": round(greeks['delta'], 3),
                "gamma": round(greeks['gamma'], 4),
                "theta": round(greeks['theta'], 4),
                "iv": round(iv, 4),
                "rsi": round(latest_rsi, 2),
                "trend": log_trend,
                "action": signal_type,
                "confidence": round(confidence, 1),
                "stop_loss": targets["stop_loss"],
                "target": targets["target"],
                "trailing_stoploss": targets["trailing_stoploss"],
                "trailing_target": targets["trailing_target"]
            })

        # Return only the single best signal to keep logs clean
        if signals:
            best_signal = sorted(signals, key=lambda x: (x['confidence'], -abs(x['spot'] - x['strike'])), reverse=True)[0]
            return [best_signal]
            
        return signals

    def calculate_allocation(self, action, confidence, rsi, trend):
        """
        Dynamic investment recommendation logic based on real-time technical indicators.
        Suggests optimal portfolio allocations.
        """
        if action == "BUY":
            base_alloc = 10
            if rsi < 30:
                base_alloc += 10 # Heavily oversold, increase allocation
            elif rsi < 40:
                base_alloc += 5
            
            if trend == "BULLISH":
                base_alloc += 5 # Trend confirmation
                
            conf_bonus = int(confidence / 10)
            total_alloc = min(40, base_alloc + conf_bonus)
            return f"invest {total_alloc}% now"
            
        elif action == "SELL":
            base_alloc = 10
            if rsi > 70:
                base_alloc += 10 # Heavily overbought, reduce allocation more
            elif rsi > 60:
                base_alloc += 5
                
            if trend == "BEARISH":
                base_alloc += 5 # Trend confirmation
                
            conf_bonus = int(confidence / 10)
            total_alloc = min(40, base_alloc + conf_bonus)
            return f"reduce by {total_alloc}%"
            
        else:
            return "maintain current allocation"

