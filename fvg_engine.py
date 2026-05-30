import pandas as pd
import numpy as np

class FVGEngine:
    def __init__(self):
        pass

    def detect_fvgs(self, df):
        """
        Detects Fair Value Gaps (FVG) in historical candlestick data.
        df: pandas DataFrame with columns 'high', 'low', 'close', and index/timestamp.
        
        Returns a list of dicts:
        [
            {
                "type": "bullish" | "bearish",
                "top": float,
                "bottom": float,
                "start_time": int (epoch timestamp in seconds),
                "end_time": int (epoch timestamp in seconds),
                "filled": bool
            }
        ]
        """
        # Ensure we have enough candles and required columns
        if df is None or len(df) < 3:
            return []

        required_cols = {'high', 'low', 'close'}
        # Support case-insensitive columns
        df_cols = {col.lower(): col for col in df.columns}
        if not required_cols.issubset(df_cols.keys()):
            return []

        # Rename columns to lowercase for consistency in processing
        df_clean = df.rename(columns={df_cols[c]: c for c in required_cols})
        
        # Ensure DataFrame is sorted by index
        df_clean = df_clean.sort_index()

        # Handle Timestamps
        if isinstance(df_clean.index, pd.DatetimeIndex):
            timestamps = [int(t.timestamp()) for t in df_clean.index]
        else:
            # Fallback if index is not DatetimeIndex (try parsing, or convert to int if possible)
            try:
                timestamps = [int(pd.to_datetime(t).timestamp()) for t in df_clean.index]
            except Exception:
                timestamps = [int(t) for t in df_clean.index]

        highs = df_clean['high'].values
        lows = df_clean['low'].values
        closes = df_clean['close'].values

        fvgs = []

        # We need at least 3 candles: i-2, i-1, i
        # The FVG pattern forms at candle i, referring back to i-2
        for i in range(2, len(df_clean)):
            # 1. Bullish FVG: Low of candle i is greater than High of candle i-2
            if lows[i] > highs[i-2]:
                fvg_bottom = highs[i-2]
                fvg_top = lows[i]
                start_time = timestamps[i-1] # Gap candle is i-1
                
                # Check mitigation (filling) in subsequent candles
                filled = False
                end_time = None
                for j in range(i + 1, len(df_clean)):
                    if lows[j] <= fvg_bottom:
                        filled = True
                        end_time = timestamps[j]
                        break
                
                fvgs.append({
                    "type": "bullish",
                    "top": float(fvg_top),
                    "bottom": float(fvg_bottom),
                    "start_time": int(start_time),
                    "end_time": int(end_time) if filled else int(timestamps[-1]),
                    "filled": filled
                })

            # 2. Bearish FVG: High of candle i is less than Low of candle i-2
            elif highs[i] < lows[i-2]:
                fvg_top = lows[i-2]
                fvg_bottom = highs[i]
                start_time = timestamps[i-1] # Gap candle is i-1
                
                # Check mitigation (filling) in subsequent candles
                filled = False
                end_time = None
                for j in range(i + 1, len(df_clean)):
                    if highs[j] >= fvg_top:
                        filled = True
                        end_time = timestamps[j]
                        break
                
                fvgs.append({
                    "type": "bearish",
                    "top": float(fvg_top),
                    "bottom": float(fvg_bottom),
                    "start_time": int(start_time),
                    "end_time": int(end_time) if filled else int(timestamps[-1]),
                    "filled": filled
                })

        return fvgs
