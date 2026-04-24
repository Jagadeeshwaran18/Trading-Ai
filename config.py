# Configuration for Trading AI Assistant

# API Settings
ALPHA_VANTAGE_API_KEY = "DVG3P73P244R3LC5"
BASE_URL = "https://www.alphavantage.co/query"

# Trading Parameters
WATCHLIST = ["SPY", "^NSEI", "^NSEBANK", "BTC-USD", "ETH-USD"]  # Stocks, Indices, and Crypto
INTERVAL_MINUTES = 3
RISK_FREE_RATE = 0.05  # Approximate risk-free rate (5%)

# Analysis Settings
# Range for calculating RSI
RSI_PERIOD = 14
# Moving average window
MA_WINDOW = 20

# AI Signal Thresholds (Example values)
DELTA_THRESHOLD = 0.4  # Minimum delta for a 'Strong' signal
THETA_DECAY_LIMIT = -0.05  # Maximum acceptable theta decay per day

# Logging Settings
CSV_FILENAME = "trading_signals_log.csv"
