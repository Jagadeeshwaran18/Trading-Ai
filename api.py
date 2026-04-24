from fastapi import FastAPI, BackgroundTasks
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
import os
from pydantic import BaseModel
from typing import Optional

import io
import asyncio
import pandas as pd
import yfinance as yf
from datetime import datetime, timedelta
import config
from api_client import AlphaVantageClient
from ai_engine import TradingAI
from logger import ExcelLogger
import time
import threading
from contextlib import asynccontextmanager

def trading_loop():
    """Background task that runs the trading analysis loop in a dedicated thread."""
    time.sleep(2)  # Give the web server 2 seconds to boot before heavily fetching data
    while True:
        print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Starting dynamic trading cycle...", flush=True)
        for symbol in config.WATCHLIST:
            try:
                spot_price = client.get_spot_price(symbol)
                if spot_price:
                    hist_data = client.get_intraday_data(symbol)
                    options_chain = client.get_options_chain(symbol)
                    signals = ai.generate_signals(symbol, spot_price, options_chain, hist_data)
                    
                    if signals:
                        logger.log_signals(signals)
            except Exception as e:
                print(f"Background error for {symbol}: {e}", flush=True)
        
        # Wait for the next interval
        time.sleep(config.INTERVAL_MINUTES * 60)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start the trading loop in a dedicated background thread
    thread = threading.Thread(target=trading_loop, daemon=True)
    thread.start()
    yield
    # Thread will terminate automatically when the server stops because it's a daemon


app = FastAPI(title="Advanced Trading AI Dashboard", lifespan=lifespan)

# Initialize shared components
client = AlphaVantageClient()
ai = TradingAI(config)
logger = ExcelLogger(config.CSV_FILENAME)

# Global state for cache (optional but helpful)
cache = {"signals": [], "last_update": None}

class ChatRequest(BaseModel):
    message: str
    symbol: Optional[str] = None

@app.post("/api/chat")
async def chat_with_ai(request: ChatRequest):
    """Conversational AI endpoint for trading advice."""
    print(f"Chat Request: {request.message} (Symbol: {request.symbol})")
    msg = request.message.lower()
    symbol = request.symbol
    
    # 1. Handle common greetings and generic questions
    if any(word in msg for word in ["hello", "hi", "who are you", "help", "hey"]):
        return {"response": "Hello! I am your QuantumTrade AI assistant. I'm here to help you analyze the markets and understand trading signals. Ask me about a specific stock, an indicator like RSI, or for my current Buy/Sell recommendations."}

    # 2. Try to identify if user is asking about a specific asset in the message
    # even if symbol is not passed in the request (e.g. "tell me about nifty")
    for s in config.WATCHLIST:
        if s.lower() in msg or (s.replace("^", "").lower() in msg):
            symbol = s
            break
            
    # 3. If a symbol is identified, get real-time data to make the answer expert
    context = ""
    analysis_data = None
    if symbol:
        try:
            # We call the logic directly to avoid JSONResponse overhead
            analysis_data = get_ai_analysis(symbol)
            if isinstance(analysis_data, dict) and "metrics" in analysis_data:
                trend = analysis_data['metrics']['trend']
                action = analysis_data['action']
                conf = analysis_data['confidence']
                rsi = analysis_data['metrics']['rsi']
                context = f" For {symbol}, my current analysis shows a {trend} trend with a {action} signal ({conf}% confidence). The RSI is at {rsi}."
            elif isinstance(analysis_data, JSONResponse):
                # If it's a JSONResponse (likely an error), we try to extract context if it was a success masked as JSONResponse
                pass
        except Exception as e:
            print(f"Chat Analysis Error: {e}")

    # 4. Keyword-based intelligent responses
    if "nifty" in msg:
        if symbol == "^NSEI" and context:
            return {"response": f"The Nifty 50 is the benchmark Indian stock market index.{context} It's currently showing significant price action."}
        return {"response": "The Nifty 50 represents the weighted average of 50 of the largest Indian companies. You can select '^NSEI' in the dashboard to see my live analysis of the Indian market."}

    if "rsi" in msg:
        if context:
            return {"response": f"RSI (Relative Strength Index) helps identify if an asset is overbought or oversold.{context} Generally, above 70 is overbought and below 30 is oversold."}
        return {"response": "RSI is a momentum indicator. In this dashboard, I use a 14-period RSI to generate signals. Look for assets with RSI below 30 for potential 'Buy' opportunities."}
    
    if "trend" in msg or "moving average" in msg:
        if context:
            return {"response": f"I determine the trend by comparing the spot price to the 20-period Moving Average.{context}"}
        return {"response": "A Bullish trend means the price is staying above the 20-period Moving Average, while a Bearish trend means it's below it."}

    if any(word in msg for word in ["buy", "sell", "trade", "signal", "call", "put"]):
        if context:
            advice = "I recommend a strong BUY" if analysis_data and analysis_data['action'] == "BUY" else ("I suggest SELLING" if analysis_data and analysis_data['action'] == "SELL" else "I recommend HOLDING for now")
            return {"response": f"Based on my algorithmic evaluation of {symbol}, {advice}.{context} Please always use stop-losses to manage your risk."}
        return {"response": "I provide real-time signals for all assets in your watchlist. Select an asset like '^NSEI' or 'BTC-USD' to see my specific AI recommendation and reasoning."}

    if "price" in msg or "how much" in msg:
        if context:
            return {"response": f"The current analysis for {symbol} indicates a price level consistent with its {analysis_data['metrics']['trend'] if analysis_data else 'current'} trend.{context}"}
        return {"response": "I track real-time prices for major indices and crypto. Which specific asset are you interested in?"}

    # 5. Fallback sophisticated response
    if symbol:
        return {"response": f"I see you're interested in {symbol}.{context} Is there something specific about its indicators or potential breakout you'd like to know?"}
    
    return {"response": "That's a great question. As a trading AI, I monitor volatility, volume, and technical indicators. Could you specify which asset or trading concept you'd like me to explain?"}

@app.get("/api/market-data/{symbol}")
def get_market_data(symbol: str, range: str = "1d", interval: str = "5m"):
    """Fetches candle data for charts."""
    try:
        ticker = yf.Ticker(symbol)
        df = ticker.history(period=range, interval=interval)
        if df.empty:
            return JSONResponse(content={"error": "No data found"}, status_code=404)
        
        # Ensure timestamp index is strictly increasing and unique (required by Lightweight Charts)
        df = df[~df.index.duplicated(keep='first')]
        df = df.sort_index()
        
        # Format for Lightweight Charts: { time: timestamp, open: ..., high: ..., low: ..., close: ... }
        data = []
        for index, row in df.iterrows():
            data.append({
                "time": int(index.timestamp()),
                "open": row["Open"],
                "high": row["High"],
                "low": row["Low"],
                "close": row["Close"],
                "volume": row["Volume"]
            })
        return data
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)

@app.get("/api/signals")
def get_signals(limit: int = 50):
    """Returns recent trading signals from the CSV."""
    if not os.path.exists(config.CSV_FILENAME):
        return []
    
    try:
        # Use low_memory=False to avoid DtypeWarnings
        df = pd.read_csv(config.CSV_FILENAME).fillna("N/A")
        # Get the latest 'limit' signals
        latest = df.tail(limit).to_dict(orient="records")
        return latest[::-1] # Return most recent first
    except Exception as e:
        print(f"Signals API Error: {e}")
        return JSONResponse(content={"error": str(e)}, status_code=500)

@app.get("/api/analysis/{symbol}")
def get_ai_analysis(symbol: str):
    """Triggers the AI engine for a full deep analysis of a specific symbol."""
    try:
        # Fetch data required for AI Engine
        spot_price = client.get_spot_price(symbol)
        if not spot_price:
            return JSONResponse(content={"error": f"Failed to fetch current price for {symbol}"}, status_code=500)
            
        hist_data = client.get_intraday_data(symbol)
        options_chain = client.get_options_chain(symbol)
        
        # Generate full signal
        signals = ai.generate_signals(symbol, spot_price, options_chain, hist_data)
        
        if not signals:
            return JSONResponse(content={"error": "AI could not generate a signal for this asset"}, status_code=404)
            
        signal = signals[0]
        
        # Construct conversational reasoning
        trend_desc = "bullish" if signal['trend'] == "BULLISH" else "bearish"
        rsi_desc = "overbought" if signal['rsi'] > 70 else ("oversold" if signal['rsi'] < 30 else "neutral")
        
        reasoning = f"The asset is currently in a {trend_desc} trend with an {rsi_desc} RSI of {signal['rsi']}. "
        
        if signal['action'] == "BUY":
            reasoning += f"Our AI detects a high-probability entry point. "
            if signal['option_type'] != "SPOT":
                reasoning += f"The {signal['option_type']} options show strong {signal['delta']} delta momentum. "
            reasoning += f"Recommendation: BUY with {signal['confidence']}% confidence."
        elif signal['action'] == "SELL":
            reasoning += f"Price action suggests distribution. RSI is {signal['rsi']} and trend is leaning {trend_desc}. "
            reasoning += f"Recommendation: SELL/Short with {signal['confidence']}% confidence."
        else:
            reasoning += "No extreme volatility or clear breakout pattern detected. Recommendation: HOLD until a better setup appears."

        return {
            "symbol": symbol,
            "action": signal['action'],
            "confidence": signal['confidence'],
            "reasoning": reasoning,
            "metrics": {
                "rsi": signal['rsi'],
                "trend": signal['trend'],
                "delta": signal['delta'],
                "iv": signal['iv']
            },
            "timestamp": signal['timestamp']
        }
    except Exception as e:
        print(f"AI Analysis Error: {e}")
        return JSONResponse(content={"error": str(e)}, status_code=500)

@app.get("/api/download/{symbol}")
def download_symbol_logs(symbol: str):
    """Download the signals Excel file specifically for one symbol."""
    if not os.path.exists(config.CSV_FILENAME):
        return JSONResponse(content={"error": "Log file not found"}, status_code=404)
        
    try:
        # Read the raw CSV logs
        df = pd.read_csv(config.CSV_FILENAME).fillna("N/A")
        
        # Filter for the symbol requested (assuming 'symbol' is a column)
        symbol_df = df[df['symbol'] == symbol]
        
        if symbol_df.empty:
            return JSONResponse(content={"error": f"No data found for {symbol}"}, status_code=404)
        
        # Write to in-memory bytes buffer as Excel using openpyxl
        buffer = io.BytesIO()
        with pd.ExcelWriter(buffer, engine='openpyxl') as writer:
            symbol_df.to_excel(writer, index=False, sheet_name=f"{symbol} Trades")
        
        buffer.seek(0)
        
        return StreamingResponse(
            buffer,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename=trading_signals_{symbol}.xlsx"}
        )
    except Exception as e:
        print(f"Error generating Excel for {symbol}: {e}")
        return JSONResponse(content={"error": str(e)}, status_code=500)

@app.get("/api/watchlist")
def get_watchlist():
    """Returns the current watchlist with basic stats."""
    results = []
    for symbol in config.WATCHLIST:
        try:
            ticker = yf.Ticker(symbol)
            info = ticker.fast_info
            
            last_price = info.get("lastPrice", 0)
            prev_close = info.get("previousClose", 1) # default to 1 to avoid ZeroDivisionError
            
            # Calculate 1-Day percentage change
            daily_change = (last_price - prev_close) / prev_close if prev_close else 0
            
            results.append({
                "symbol": symbol,
                "price": last_price,
                "change": daily_change,
                "marketCap": info.get("marketCap", 0)
            })
        except Exception as e:
            print(f"Watchlist error for {symbol}: {e}")
            results.append({"symbol": symbol, "price": 0, "change": 0, "error": True})
    return results

# Serve the web frontend (after we create it)
if os.path.exists("web"):
    app.mount("/", StaticFiles(directory="web", html=True), name="web")

if __name__ == "__main__":
    import uvicorn
    print("\n" + "="*60)
    print("API and Web Server started successfully!")
    print("CLICK HERE TO OPEN DASHBOARD: http://127.0.0.1:8000")
    print("="*60 + "\n")
    uvicorn.run(app, host="127.0.0.1", port=8000)
