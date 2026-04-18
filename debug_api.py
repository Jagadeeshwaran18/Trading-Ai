from api_client import AlphaVantageClient
import config

client = AlphaVantageClient()
print(f"Testing API for {config.TARGET_SYMBOL}...")
spot = client.get_spot_price(config.TARGET_SYMBOL)
print(f"Spot Price: {spot}")

chart = client.get_options_chain(config.TARGET_SYMBOL)
print(f"Options Chain Rows: {len(chart)}")
if len(chart) == 0:
    print("WARNING: Options chain is empty. This could be due to your API key tier or market data availability.")
else:
    print(chart.head())
