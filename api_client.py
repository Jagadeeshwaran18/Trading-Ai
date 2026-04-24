import yfinance as yf
import pandas as pd
import logging
from config import ALPHA_VANTAGE_API_KEY, BASE_URL

# Suppress yfinance delisted/no price data warnings for missing intraday Indian indices
logging.getLogger('yfinance').setLevel(logging.CRITICAL)

class AlphaVantageClient:
    def __init__(self, api_key=ALPHA_VANTAGE_API_KEY):
        self.api_key = api_key
        self.base_url = BASE_URL

    def get_spot_price(self, symbol):
        """Fetches the latest price using yfinance (more reliable for free tier)."""
        ticker = yf.Ticker(symbol)
        try:
            return ticker.fast_info['last_price']
        except Exception:
            return None

    def get_options_chain(self, symbol):
        """Fetches the latest options chain using yfinance."""
        ticker = yf.Ticker(symbol)
        try:
            # Get the nearest expiration date
            expirations = ticker.options
            if not expirations:
                return pd.DataFrame()
            
            # Fetch calls and puts for the nearest expiry
            opt = ticker.option_chain(expirations[0])
            calls = opt.calls.copy()
            puts = opt.puts.copy()
            
            calls['type'] = 'call'
            puts['type'] = 'put'
            
            # Combine into a single chain
            chain = pd.concat([calls, puts])
            chain['expiration'] = expirations[0]
            
            # Rename columns to match our expected format in ai_engine.py
            # strike, lastPrice, impliedVolatility are already in yfinance columns
            return chain
        except Exception:
            return pd.DataFrame()

    def get_intraday_data(self, symbol, interval="5m"):
        """Fetches historical data using yfinance."""
        ticker = yf.Ticker(symbol)
        try:
            df = ticker.history(period="5d", interval=interval)
            if df.empty:
                # Fallback to daily data if intraday fails (common for Indian Indices on free yfinance)
                df = ticker.history(period="1mo", interval="1d")
            df.columns = [c.lower() for c in df.columns]
            return df
        except Exception:
            return pd.DataFrame()
