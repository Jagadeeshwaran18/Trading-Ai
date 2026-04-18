import schedule
import time
import sys
from api_client import AlphaVantageClient
from ai_engine import TradingAI
from logger import ExcelLogger
import config

def trading_job(client, ai, logger):
    print(f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] Starting trading cycle for {config.TARGET_SYMBOL}...")
    
    try:
        # 1. Fetch Spot Price
        print("Fetching spot price...")
        spot_price = client.get_spot_price(config.TARGET_SYMBOL)
        if spot_price is None:
            print("Error: Could not fetch spot price. Skipping cycle.")
            return

        # 2. Fetch Historical Data (for RSI/MA)
        print("Fetching historical data...")
        hist_data = client.get_intraday_data(config.TARGET_SYMBOL)

        # 3. Fetch Options Chain
        print("Fetching options chain...")
        options_chain = client.get_options_chain(config.TARGET_SYMBOL)

        # 4. Generate Signals
        print("Analyzing data and generating signals...")
        signals = ai.generate_signals(spot_price, options_chain, hist_data)

        # 5. Log to Excel
        if signals:
            logger.log_signals(signals)
        else:
            print("No significant signals generated this cycle.")

    except Exception as e:
        print(f"Critical error during trading cycle: {e}")

def main():
    print("---------------------------------------------------------")
    print("   AI STOCK OPTION TRADING ASSISTANT INITIALIZED         ")
    print(f"   Target: {config.TARGET_SYMBOL} | Interval: {config.INTERVAL_MINUTES} min")
    print("---------------------------------------------------------")

    # Initialize Components
    client = AlphaVantageClient()
    ai = TradingAI(config)
    logger = ExcelLogger(config.CSV_FILENAME)

    # Validate API Key (Optional but recommended)
    if config.ALPHA_VANTAGE_API_KEY == "YOUR_API_KEY_HERE":
        print("WARNING: Default API key detected. Please update config.py with your Alpha Vantage Key.")
        # sys.exit(1) # Uncomment to force exit

    # Run immediately on start
    trading_job(client, ai, logger)

    # Schedule regular tasks
    schedule.every(config.INTERVAL_MINUTES).minutes.do(trading_job, client, ai, logger)

    print(f"Scheduler active. Running every {config.INTERVAL_MINUTES} minutes. Press Ctrl+C to stop.")
    
    while True:
        try:
            schedule.run_pending()
            time.sleep(1)
        except KeyboardInterrupt:
            print("\nShutting down Trading Assistant...")
            break

if __name__ == "__main__":
    main()
