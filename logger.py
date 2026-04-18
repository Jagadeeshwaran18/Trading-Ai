import pandas as pd
import os

class ExcelLogger:
    def __init__(self, filename):
        self.filename = filename

    def log_signals(self, signals):
        """Appends a list of signal dictionaries to the CSV file."""
        if not signals:
            return

        df = pd.DataFrame(signals)

        if not os.path.exists(self.filename):
            # Create a new file with headers
            df.to_excel = None # Not used anymore
            df.to_csv(self.filename, index=False)
        else:
            # Append without headers
            df.to_csv(self.filename, mode='a', index=False, header=False)
        
        print(f"[{pd.Timestamp.now()}] Logged {len(signals)} signals to {self.filename}")
