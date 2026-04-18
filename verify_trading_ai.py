import unittest
import pandas as pd
from greeks import black_scholes_greeks
from ai_engine import TradingAI
import config

class TestTradingAssistant(unittest.TestCase):
    def test_greeks_calculation(self):
        """Test Black-Scholes Greeks with known values."""
        # S=100, K=100, T=0.25 (3mo), r=0.05, sigma=0.2
        # Expected Call Delta: ~0.57, Gamma: ~0.04
        g = black_scholes_greeks(100, 100, 0.25, 0.05, 0.2, 'call')
        self.assertAlmostEqual(g['delta'], 0.57, places=2)
        self.assertGreater(g['gamma'], 0)
        self.assertLess(g['theta'], 0)

    def test_signal_generation_logic(self):
        """Test AI signal generation with mock data."""
        ai = TradingAI(config)
        spot_price = 100
        
        # Mock options chain (Call)
        options_chain = pd.DataFrame([{
            'strike': 100,
            'expiration': '2026-12-31',
            'type': 'call',
            'lastPrice': 5.0,
            'impliedVolatility': 0.2
        }])
        
        # Mock historical data (Balanced trend)
        # We need at least 20 points for MA_WINDOW and 15 for RSI_PERIOD
        hist_data = pd.DataFrame({
            'close': [95, 96, 97, 98, 99, 100, 99, 98, 97, 96, 95, 96, 97, 98, 99, 
                      98, 97, 96, 95, 96, 97, 98, 99, 98, 97, 96, 95, 96, 97, 98]
        })
        
        signals = ai.generate_signals(spot_price, options_chain, hist_data)
        
        # We expect a BUY signal because spot(100) > MA(~98) and RSI will be moderate
        self.assertTrue(any(s['action'] == 'BUY' for s in signals))

if __name__ == "__main__":
    unittest.main()
