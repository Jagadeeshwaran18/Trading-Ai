// Initialize Lucide Icons
lucide.createIcons();

// Symbol Full Names Mapping
const SYMBOL_NAMES = {
    "SPY": "S&P 500 ETF",
    "^NSEI": "NIFTY 50",
    "^NSEBANK": "BANKNIFTY",
    "BTC-USD": "BITCOIN",
    "ETH-USD": "ETHEREUM"
};

function getDisplayName(symbol) {
    return SYMBOL_NAMES[symbol] || symbol;
}

// DOM Elements
const homeView = document.getElementById('homeView');
const chartView = document.getElementById('chartView');
const trackerGrid = document.getElementById('trackerGrid');
const activeSymbolEl = document.getElementById('activeSymbol');
const activePriceEl = document.getElementById('activePrice');
const activeChangeEl = document.getElementById('activeChange');
const backBtn = document.getElementById('backBtn');
const viewExcelBtn = document.getElementById('viewExcelBtn');
const excelView = document.getElementById('excelView');
const excelBackBtn = document.getElementById('excelBackBtn');
const downloadExcelBtn = document.getElementById('downloadExcelBtn');
const excelActiveSymbol = document.getElementById('excelActiveSymbol');
const excelTableHead = document.getElementById('excelTableHead');
const excelTableBody = document.getElementById('excelTableBody');
const timeframes = document.querySelectorAll('.timeframe');

// Strategy DOM Elements
const strategyView = document.getElementById('strategyView');
const openStrategyBtn = document.getElementById('openStrategyBtn');
const strategyBackBtn = document.getElementById('strategyBackBtn');
const refreshStrategyBtn = document.getElementById('refreshStrategyBtn');
const strategyGrid = document.getElementById('strategyGrid');
const excelActionFilter = document.getElementById('excelActionFilter');
const excelDateFilter = document.getElementById('excelDateFilter');

// Prediction DOM Elements
const predictionView = document.getElementById('predictionView');
const openPredictionBtn = document.getElementById('openPredictionBtn');
const predictionBackBtn = document.getElementById('predictionBackBtn');
const predictionActiveSymbol = document.getElementById('predictionActiveSymbol');
const horizonBtns = document.querySelectorAll('.horizon-btn');

// State Management
let activeSymbol = null;
let activeRange = "1d";
let activeInterval = "1m";
let liveTickSpeed = 10000;
let chart = null;
let candleSeries = null;
let emaSeries = null;

let aiMarkers = [];
let manualMarkers = [];
let lastCandleData = [];
let activeExcelData = [];

// Prediction State
let predictionChart = null;
let predictionLineSeries = null;
let activeHorizon = '1y';

// Polling timers
let watchlistTimer = null;
let marketDataTimer = null;

/**
 * Switch Views
 */
function showHomeView() {
    chartView.classList.add('view-hidden');
    excelView.classList.add('view-hidden');
    strategyView.classList.add('view-hidden');
    predictionView.classList.add('view-hidden');
    homeView.classList.remove('view-hidden');

    // Stop market polling
    if (marketDataTimer) clearTimeout(marketDataTimer);
    activeSymbol = null;

    // Resume watchlist polling if paused
    pollWatchlist();
}

function showChartView(symbol) {
    activeSymbol = symbol;

    homeView.classList.add('view-hidden');
    chartView.classList.remove('view-hidden');

    // Stop watchlist polling to save bandwidth
    if (watchlistTimer) clearTimeout(watchlistTimer);

    // Set loading state BEFORE initializing chart to avoid masking errors
    activeSymbolEl.innerText = "Loading...";

    // Init chart if not yet created
    if (!chart) initChart();

    // Start market polling
    pollMarketData(true);
}

/**
 * Initialize Lightweight Charts
 */
function initChart() {
    try {
        const container = document.getElementById('chartContainer');

        // Force fallback dimensions if CSS layout has not yet painted
        const cWidth = container.clientWidth > 0 ? container.clientWidth : window.innerWidth - 64;
        const cHeight = container.clientHeight > 0 ? container.clientHeight : window.innerHeight - 150;

        chart = LightweightCharts.createChart(container, {
            width: cWidth,
            height: cHeight,
            layout: {
                background: { type: 'solid', color: 'transparent' },
                textColor: '#94a3b8',
            },
            grid: {
                vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
                horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
            },
            crosshair: {
                mode: LightweightCharts.CrosshairMode.Normal,
            },
            rightPriceScale: {
                borderColor: 'rgba(255, 255, 255, 0.1)',
            },
            timeScale: {
                borderColor: 'rgba(255, 255, 255, 0.1)',
                timeVisible: true,
                secondsVisible: false,
                tickMarkFormatter: (time, tickMarkType, locale) => {
                    const date = new Date(time * 1000);
                    return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
                },
            },
            localization: {
                locale: navigator.language,
                timeFormatter: (time) => {
                    const date = new Date(time * 1000);
                    return date.toLocaleTimeString(navigator.language, {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: true
                    });
                },
            },
        });

        let seriesType;
        if (LightweightCharts.CandlestickSeries) {
            seriesType = LightweightCharts.CandlestickSeries;
        } else {
            console.error("CandlestickSeries module not found in global LightweightCharts. Falling back or throwing.");
            throw new Error("TradingView Library version mismatch: Missing Candlestick module.");
        }

        candleSeries = chart.addSeries(seriesType, {
            upColor: '#10b981',
            downColor: '#ef4444',
            borderVisible: false,
            wickUpColor: '#10b981',
            wickDownColor: '#ef4444',
        });

        // Add EMA/SMA line series
        const lineSeriesType = LightweightCharts.LineSeries;
        emaSeries = chart.addSeries(lineSeriesType, {
            color: 'rgba(56, 189, 248, 0.7)',
            lineWidth: 2,
            crosshairMarkerVisible: false,
            priceLineVisible: false,
            lastValueVisible: false,
        });

        // Handle Resize
        const resizeObserver = new ResizeObserver(entries => {
            if (entries.length === 0 || !entries[0].contentRect) return;
            if (entries[0].contentRect.width > 0 && entries[0].contentRect.height > 0) {
                chart.applyOptions({
                    width: entries[0].contentRect.width,
                    height: entries[0].contentRect.height
                });
            }
        });
        resizeObserver.observe(container);

    } catch (err) {
        console.error("Critical error starting chart:", err);
        activeSymbolEl.innerText = `Chart Initialization Error: ${err.message}`;
    }
}

/**
 * Fetch and Update Watchlist
 */
async function fetchWatchlist() {
    try {
        const response = await fetch('/api/watchlist');
        const data = await response.json();

        trackerGrid.innerHTML = '';

        data.forEach(item => {
            const changePercent = ((item.change || 0) * 100).toFixed(2);
            const isBullish = changePercent > 0;
            const changeColor = isBullish ? 'var(--bullish)' : 'var(--bearish)';
            const changeSign = isBullish ? '+' : '';

            const displayName = getDisplayName(item.symbol);

            const card = document.createElement('div');
            card.className = 'tracker-card glass';
            card.onclick = () => showChartView(item.symbol);
            card.innerHTML = `
                <div class="tracker-top">
                    <span class="tracker-symbol">${displayName}</span>
                    <span class="tracker-ticker" style="font-size: 0.7rem; opacity: 0.6; display: block; margin-top: -4px;">${item.symbol}</span>
                </div>
                <div class="tracker-bottom">
                    <span class="tracker-price">$${item.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    <span style="color: ${changeColor}; font-weight: 600;">${item.error ? 'Offline' : `${changeSign}${changePercent}% (1D)`}</span>
                </div>
            `;
            trackerGrid.appendChild(card);
        });
    } catch (err) {
        trackerGrid.innerHTML = `<div style="color: var(--bearish); padding: 1rem;">Failed to fetch live trackers.</div>`;
        console.error(err);
    }
}

/**
 * Fetch and Update Market Data
 */
async function fetchMarketData(fitContent = false) {
    if (!activeSymbol) return;
    if (!candleSeries) return; // Prevent overwriting geometry errors

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000); // 6-second max timeout

    try {
        const response = await fetch(`/api/market-data/${activeSymbol}?range=${activeRange}&interval=${activeInterval}`, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const rawData = await response.json();

        if (rawData.error) {
            throw new Error(rawData.error);
        }

        const data = rawData.data;
        const prevDayClose = rawData.previousClose;

        if (data && data.length > 0) {
            if (data[0].time === undefined || data[0].close === undefined) {
                throw new Error("Server returned corrupt or unexpected data format.");
            }

            // Update the chart with the real data from the server
            // This ensures we show proper candles forming instead of flat lines
            candleSeries.setData(data);
            lastCandleData = data;
            
            if (emaSeries && data.length > 0) {
                // Calculate 14-period SMA
                const period = 14;
                const smaData = [];
                for (let i = 0; i < data.length; i++) {
                    if (i < period - 1) continue;
                    let sum = 0;
                    for (let j = 0; j < period; j++) {
                        sum += data[i - j].close;
                    }
                    smaData.push({ time: data[i].time, value: sum / period });
                }
                emaSeries.setData(smaData);
            }

            if (fitContent) {
                chart.timeScale().fitContent();
            }

            // Update Header with exact live data from API (matches watchlist)
            const livePrice = rawData.currentPrice;
            const liveChange = rawData.dailyChange * 100;

            activeSymbolEl.innerText = getDisplayName(activeSymbol);
            activePriceEl.innerText = `$${livePrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

            // Format Change percent (Always show 1D change to match dashboard)
            const isBullish = liveChange >= 0;
            const changeColor = isBullish ? 'var(--bullish)' : 'var(--bearish)';
            const changeSign = isBullish ? '+' : '';
            activeChangeEl.innerText = `${changeSign}${liveChange.toFixed(2)}% (1D)`;
            activeChangeEl.style.color = changeColor;

            // Plot markers from logs
            await fetchAndPlotSignals();
        } else {
            throw new Error("Server returned an empty dataset for this timeframe.");
        }

    } catch (err) {
        clearTimeout(timeoutId);
        console.error("Failed to fetch market data:", err);
        if (err.name === 'AbortError') {
            activeSymbolEl.innerText = `Error: Server Timed Out. AI engine busy?`;
        } else {
            activeSymbolEl.innerText = `Error: ${err.message}`;
        }
    }
}

/**
 * Fetch and Plot Excel Signal Logs as Markers
 */
async function fetchAndPlotSignals() {
    if (!activeSymbol || !candleSeries || !lastCandleData || lastCandleData.length === 0) {
        console.warn("fetchAndPlotSignals: Missing dependencies or data");
        return;
    }
    
    try {
        const response = await fetch(`/api/logs/${activeSymbol}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const logs = await response.json();
        
        updatePnLDisplay(logs);
        
        const markers = [];
        
        // 1. Process real signals from logs
        if (logs && Array.isArray(logs)) {
            for (const log of logs) {
                if (log.action === "BUY" || log.action === "SELL") {
                    // Robust timestamp parsing
                    const ts = String(log.timestamp).replace(' ', 'T');
                    const logTime = Math.floor(new Date(ts).getTime() / 1000);
                    
                    if (isNaN(logTime)) continue;

                    // Find the closest candle in time
                    let closest = null;
                    let minDiff = Infinity;
                    
                    for (const candle of lastCandleData) {
                        const diff = Math.abs(candle.time - logTime);
                        if (diff < minDiff) {
                            minDiff = diff;
                            closest = candle;
                        }
                    }

                    // Only plot if we found a candle within a reasonable range (relax to 5 days = 432000s for timezone differences)
                    if (closest && minDiff < 432000) {
                        // Determine Label (e.g., BUY CALL, BUY PUT, or just BUY)
                        let markerLabel = log.action;
                        if (log.option_type && log.option_type !== "SPOT") {
                            markerLabel += " " + log.option_type;
                        }

                        markers.push({
                            time: closest.time,
                            position: log.action === "BUY" ? 'belowBar' : 'aboveBar',
                            color: log.action === "BUY" ? '#10b981' : '#ef4444',
                            shape: log.action === "BUY" ? 'arrowUp' : 'arrowDown',
                            text: markerLabel,
                            size: 2
                        });
                    }
                }
            }
        }

        // 2. Add a TEST marker to verify that the marker engine is actually working
        // This will appear on the 5th candle from the start
        if (lastCandleData.length > 5) {
            markers.push({
                time: lastCandleData[5].time,
                position: 'belowBar',
                color: '#facc15',
                shape: 'arrowUp',
                text: 'SYSTEM ACTIVE',
            });
        }

        // 3. Sort markers by time (required by library)
        markers.sort((a, b) => a.time - b.time);

        // Update global AI markers
        aiMarkers = markers;
        
        applyAllMarkers();
        
        
    } catch (err) {
        console.error("fetchAndPlotSignals error:", err);
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Manual Markers & Plotting Engine
// ---------------------------------------------------------------------------------------------------------------------

function applyAllMarkers() {
    if (!candleSeries) return;
    
    // Merge ai and manual markers, sort by time ascending
    let allMarkers = [...aiMarkers, ...manualMarkers];
    allMarkers.sort((a, b) => a.time - b.time);
    
    // Deduplicate (strictly 1 marker per candle time)
    const finalMarkers = [];
    const seenTimes = new Set();
    for (let i = allMarkers.length - 1; i >= 0; i--) {
        const m = allMarkers[i];
        if (!seenTimes.has(m.time)) {
            finalMarkers.push(m);
            seenTimes.add(m.time);
        }
    }
    finalMarkers.reverse(); // Restore ascending chronological order

    console.log(`Setting ${finalMarkers.length} total markers on chart (AI: ${aiMarkers.length}, Manual: ${manualMarkers.length})`);
    
    try {
        if (typeof candleSeries.setMarkers === 'function') {
            candleSeries.setMarkers(finalMarkers);
        } else if (LightweightCharts.createSeriesMarkers) {
            if (!window.chartMarkersPlugin) {
                window.chartMarkersPlugin = LightweightCharts.createSeriesMarkers(candleSeries, finalMarkers);
            } else if (typeof window.chartMarkersPlugin.setMarkers === 'function') {
                window.chartMarkersPlugin.setMarkers(finalMarkers);
            }
        }
    } catch(err) {
        console.error("Error setting markers", err);
    }
}

window.addManualMarker = function(type) {
    if (!lastCandleData || !lastCandleData.time) {
        alert("Wait for market data to load before placing manual markers.");
        return;
    }
    
    const isBuy = type === 'BUY';
    const marker = {
        time: lastCandleData.time,
        position: isBuy ? 'belowBar' : 'aboveBar',
        color: isBuy ? '#22c55e' : '#ef4444',
        shape: isBuy ? 'arrowUp' : 'arrowDown',
        text: type,
        size: 2
    };
    
    manualMarkers.push(marker);
    applyAllMarkers();
    console.log(`Manual ${type} marker added at ${new Date(lastCandleData.time * 1000).toLocaleTimeString()}`);
};

/**
 * Polling Loops
 */
function pollWatchlist() {
    if (activeSymbol) return; // Don't poll watchlist if in chart view
    fetchWatchlist().finally(() => {
        watchlistTimer = setTimeout(pollWatchlist, 3000); // Poll every 3s for fast real-time updates
    });
}

function pollMarketData(fitContent = false) {
    if (!activeSymbol) return; // Don't poll market if in home view
    fetchMarketData(fitContent).finally(() => {
        marketDataTimer = setTimeout(() => pollMarketData(false), liveTickSpeed); // Poll continuously at set speed
    });
}

/**
 * Event Listeners
 */
backBtn.onclick = () => showHomeView();

// Removed manual buttons logic

// Global Dropdown Toggle Logic
document.querySelectorAll('.dropdown').forEach(dropdown => {
    const btn = dropdown.querySelector('.btn-dropdown');
    const content = dropdown.querySelector('.dropdown-content');
    
    if (btn && content) {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            
            // Close other dropdowns first
            document.querySelectorAll('.dropdown-content.show').forEach(c => {
                if (c !== content) c.classList.remove('show');
            });
            
            content.classList.toggle('show');
        });
    }
});

// Close all dropdowns if clicked outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown')) {
        document.querySelectorAll('.dropdown-content.show').forEach(c => c.classList.remove('show'));
    }
});

let isLiveSimMode = false;

// Unified Selectors
document.querySelectorAll('.timeframe-option').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault();

        const content = btn.closest('.dropdown-content');
        if (content) {
            content.classList.remove('show');
        }

        document.querySelectorAll('.timeframe-option').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const labelText = btn.innerText.trim().split(' ')[0];
        const dropdownSpan = document.querySelector('#timeframeDropdownBtn span');
        if (dropdownSpan) {
            dropdownSpan.innerHTML = `<i data-lucide="clock" class="inline-icon"></i> ${labelText}`;
            lucide.createIcons();
        }

        activeRange = btn.dataset.range;
        activeInterval = btn.dataset.interval;

        liveTickSpeed = parseInt(btn.dataset.speed || "10000");
        isLiveSimMode = liveTickSpeed < 10000;

        // Immediately fetch data and redraw chart
        if (marketDataTimer) clearTimeout(marketDataTimer);
        pollMarketData(true);
    });
});

// AI Panel logic
const aiBtn = document.getElementById('aiBtn');
const closeAiBtn = document.getElementById('closeAiBtn');
const aiPanel = document.getElementById('aiPanel');

let aiAnalysisTimer = null;

if (aiBtn && aiPanel && closeAiBtn) {
    aiBtn.onclick = () => {
        aiPanel.classList.toggle('hide-panel');
        if (!aiPanel.classList.contains('hide-panel')) {
            updateAIAnalysis();
        } else {
            if (aiAnalysisTimer) clearTimeout(aiAnalysisTimer);
        }
    };

    closeAiBtn.onclick = () => {
        aiPanel.classList.add('hide-panel');
        if (aiAnalysisTimer) clearTimeout(aiAnalysisTimer);
    };
}

async function updateAIAnalysis() {
    if (!activeSymbol || aiPanel.classList.contains('hide-panel')) return;

    try {
        const response = await fetch(`/api/analysis/${activeSymbol}`);
        const data = await response.json();

        if (data.error) throw new Error(data.error);

        // Update UI
        const badge = document.getElementById('aiSignalBadge');
        badge.innerText = data.action;
        badge.className = 'ai-signal-badge ' + data.action.toLowerCase();

        document.getElementById('aiConfidenceBar').style.width = `${data.confidence}%`;
        document.getElementById('aiConfidenceText').innerText = `${data.confidence.toFixed(1)}%`;

        document.getElementById('aiMetricRsi').innerText = data.metrics.rsi;
        document.getElementById('aiMetricTrend').innerText = data.metrics.trend;

        document.getElementById('aiReasoningText').innerText = data.reasoning;

    } catch (err) {
        console.warn("AI Analysis Fetch Error:", err);
    } finally {
        // Auto-refresh every 10 seconds while panel is open
        if (!aiPanel.classList.contains('hide-panel')) {
            aiAnalysisTimer = setTimeout(updateAIAnalysis, 10000);
        }
    }
}

if (viewExcelBtn) {
    viewExcelBtn.onclick = async () => {
        if (!activeSymbol) return;
        
        // Hide chart view and show excel view
        chartView.classList.add('view-hidden');
        excelView.classList.remove('view-hidden');
        excelActiveSymbol.innerText = getDisplayName(activeSymbol) + " Data Logs";
        excelTableHead.innerHTML = '<th>Loading...</th>';
        excelTableBody.innerHTML = '';
        
        try {
            const response = await fetch(`/api/logs/${activeSymbol}`);
            const data = await response.json();
            
            if (data && data.length > 0) {
                activeExcelData = data;
                updatePnLDisplay(data);
                // Generate headers dynamically from the first row
                const headers = Object.keys(data[0]);
                excelTableHead.innerHTML = headers.map(h => `<th>${h.charAt(0).toUpperCase() + h.slice(1)}</th>`).join('');
                
                // Reset filters to default
                if(excelActionFilter) excelActionFilter.value = "ALL";
                if(excelDateFilter) excelDateFilter.value = "ALL";
                
                renderFilteredExcelTable();
            } else {
                activeExcelData = [];
                excelTableHead.innerHTML = '<th>No data found</th>';
                excelTableBody.innerHTML = '';
            }
        } catch (err) {
            console.error("Failed to fetch logs:", err);
            excelTableHead.innerHTML = '<th>Error loading data</th>';
        }
    };
}

if (excelBackBtn) {
    excelBackBtn.onclick = () => {
        excelView.classList.add('view-hidden');
        chartView.classList.remove('view-hidden');
    };
}

if (downloadExcelBtn) {
    downloadExcelBtn.onclick = () => {
        if (activeSymbol) {
            const actionVal = excelActionFilter ? excelActionFilter.value : "ALL";
            const dateVal = excelDateFilter ? excelDateFilter.value : "ALL";
            window.location.href = `/api/download/${activeSymbol}?action=${actionVal}&date_range=${dateVal}`;
        }
    };
}

function renderFilteredExcelTable() {
    if (!activeExcelData || activeExcelData.length === 0) {
        excelTableBody.innerHTML = '';
        return;
    }
    
    const actionVal = excelActionFilter ? excelActionFilter.value : "ALL";
    const dateVal = excelDateFilter ? excelDateFilter.value : "ALL";
    
    let filteredData = activeExcelData;
    
    if (actionVal !== "ALL") {
        filteredData = filteredData.filter(row => row.action === actionVal);
    }
    
    if (dateVal !== "ALL") {
        const now = new Date();
        now.setHours(0,0,0,0);
        let cutoffTime = 0;
        
        if (dateVal === "today") cutoffTime = now.getTime();
        else if (dateVal === "3d") cutoffTime = now.getTime() - (3 * 24 * 60 * 60 * 1000);
        else if (dateVal === "1w") cutoffTime = now.getTime() - (7 * 24 * 60 * 60 * 1000);
        else if (dateVal === "1m") cutoffTime = now.getTime() - (30 * 24 * 60 * 60 * 1000);
        
        filteredData = filteredData.filter(row => {
            const rowTime = new Date(row.timestamp.replace(' ', 'T')).getTime();
            return rowTime >= cutoffTime;
        });
    }
    
    const headers = Object.keys(activeExcelData[0]);
    excelTableBody.innerHTML = filteredData.map(row => {
        return '<tr>' + headers.map(h => `<td>${row[h] !== null && row[h] !== undefined ? row[h] : ''}</td>`).join('') + '</tr>';
    }).join('');
}

if (excelActionFilter) excelActionFilter.onchange = renderFilteredExcelTable;
if (excelDateFilter) excelDateFilter.onchange = renderFilteredExcelTable;

/**
 * Profit and Loss Calculation
 */
function updatePnLDisplay(logs) {
    if (!logs || !Array.isArray(logs) || logs.length === 0) {
        setPnLText(0);
        return;
    }

    let totalPnL = 0;
    let entryPrice = null;
    let position = null;

    // Logs are typically newest first, so we sort chronologically (oldest first)
    const sortedLogs = [...logs].sort((a, b) => new Date(a.timestamp.replace(' ', 'T')).getTime() - new Date(b.timestamp.replace(' ', 'T')).getTime());

    for (const log of sortedLogs) {
        const price = parseFloat(log.spot);
        if (isNaN(price)) continue;

        if (log.action === 'BUY') {
            if (position === 'SELL') {
                const tradePnL = ((entryPrice - price) / entryPrice) * 100;
                totalPnL += tradePnL;
                position = null;
                entryPrice = null;
            } else if (!position) {
                position = 'BUY';
                entryPrice = price;
            }
        } else if (log.action === 'SELL') {
            if (position === 'BUY') {
                const tradePnL = ((price - entryPrice) / entryPrice) * 100;
                totalPnL += tradePnL;
                position = null;
                entryPrice = null;
            } else if (!position) {
                position = 'SELL';
                entryPrice = price;
            }
        }
    }

    // Add unrealized PnL if there is an open position and we have a current spot price
    // But since logs just contain executed signals, we'll only do realized PnL for now.

    setPnLText(totalPnL);
}

function setPnLText(pnlValue) {
    const formatted = pnlValue.toFixed(2) + '%';
    const sign = pnlValue > 0 ? '+' : '';
    const text = sign + formatted;
    
    const excelPnL = document.getElementById('excelTotalPnL');
    if (excelPnL) {
        excelPnL.innerText = 'Total PnL: ' + text;
        excelPnL.className = 'pnl-badge ' + (pnlValue > 0 ? 'pnl-positive' : (pnlValue < 0 ? 'pnl-negative' : ''));
    }

    const sessionPnL = document.getElementById('aiMetricPnL');
    if (sessionPnL) {
        sessionPnL.innerText = text;
        sessionPnL.className = 'pnl-badge ' + (pnlValue > 0 ? 'pnl-positive' : (pnlValue < 0 ? 'pnl-negative' : ''));
    }
}

/**
 * Strategy Recommendations Logic
 */
function showStrategyView() {
    homeView.classList.add('view-hidden');
    chartView.classList.add('view-hidden');
    excelView.classList.add('view-hidden');
    strategyView.classList.remove('view-hidden');
    
    // Stop polling
    if (watchlistTimer) clearTimeout(watchlistTimer);
    if (marketDataTimer) clearTimeout(marketDataTimer);
    
    fetchAndRenderStrategies();
}

if (openStrategyBtn) {
    openStrategyBtn.onclick = () => showStrategyView();
}

if (strategyBackBtn) {
    strategyBackBtn.onclick = () => {
        strategyView.classList.add('view-hidden');
        showHomeView();
    };
}

if (refreshStrategyBtn) {
    refreshStrategyBtn.onclick = () => fetchAndRenderStrategies();
}

async function fetchAndRenderStrategies() {
    if (!strategyGrid) return;
    strategyGrid.innerHTML = '<div style="padding: 2rem; text-align: center; color: var(--text-muted);">Fetching live global strategies...</div>';
    
    try {
        const response = await fetch('/api/signals?limit=30');
        const data = await response.json();
        
        if (!data || data.length === 0) {
            strategyGrid.innerHTML = '<div style="padding: 2rem; color: var(--text-muted);">No strategies available at the moment.</div>';
            return;
        }
        
        strategyGrid.innerHTML = '';
        
        data.forEach(signal => {
            // Convert global server timestamp to user's local timezone visually
            const dateObj = new Date(signal.timestamp.replace(' ', 'T'));
            const localTimeStr = dateObj.toLocaleString([], {
                month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
            
            const badgeClass = signal.action.toLowerCase();
            const optionText = signal.option_type === "SPOT" ? "SPOT" : `${signal.option_type} ${signal.strike}`;
            
            const card = document.createElement('div');
            card.className = 'strategy-card';
            card.innerHTML = `
                <div class="strategy-header">
                    <span class="strategy-symbol">${signal.symbol} <span style="font-size:0.8rem; color:var(--text-muted)">${optionText}</span></span>
                    <span class="strategy-time" title="Local Time"><i data-lucide="globe" class="inline-icon" style="width:12px;height:12px;"></i> ${localTimeStr}</span>
                </div>
                <div class="strategy-body">
                    <div class="strategy-row">
                        <span>Current Price</span>
                        <span>$${parseFloat(signal.spot).toFixed(2)}</span>
                    </div>
                    <div class="strategy-row">
                        <span>RSI (14)</span>
                        <span>${signal.rsi}</span>
                    </div>
                    <div class="strategy-row">
                        <span>Trend</span>
                        <span>${signal.trend}</span>
                    </div>
                    <div class="strategy-row">
                        <span>Confidence</span>
                        <span>${parseFloat(signal.confidence).toFixed(1)}%</span>
                    </div>
                </div>
                <div class="strategy-footer">
                    <span style="font-size:0.8rem; color:var(--text-muted);">AI Engine Evaluated</span>
                    <span class="strategy-badge ${badgeClass}">${signal.action}</span>
                </div>
            `;
            strategyGrid.appendChild(card);
        });
        
        lucide.createIcons();
        
    } catch (err) {
        console.error("Failed to fetch strategies:", err);
        strategyGrid.innerHTML = '<div style="color: var(--bearish); padding: 1rem;">Error loading strategies. Check server connection.</div>';
    }
}

// Start the app in Home View
pollWatchlist();

/**
 * Real-time Clock
 */
function startClock() {
    const clockEl = document.getElementById('liveClock');
    if (!clockEl) return;

    function update() {
        clockEl.innerText = new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
    }

    update();
    setInterval(update, 1000);
}

/**
 * Chat AI Logic
 */
const openChatBtn = document.getElementById('openChatBtn');
const closeChatBtn = document.getElementById('closeChatBtn');
const chatWindow = document.getElementById('chatWindow');
const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');
const chatMessages = document.getElementById('chatMessages');

if (openChatBtn && chatWindow && closeChatBtn) {
    openChatBtn.onclick = () => {
        chatWindow.classList.toggle('hide-chat');
        if (!chatWindow.classList.contains('hide-chat')) {
            chatInput.focus();
        }
    };

    closeChatBtn.onclick = () => {
        chatWindow.classList.add('hide-chat');
    };
}

async function sendChatMessage() {
    const message = chatInput.value.trim();
    if (!message) return;

    // 1. Add User Message
    addMessageToUI(message, 'user');
    chatInput.value = '';

    // 2. Add Typing Indicator
    const typingId = showTypingIndicator();

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                message: message,
                symbol: activeSymbol // Pass current symbol context if available
            })
        });

        const data = await response.json();
        
        // 3. Remove Typing Indicator and Add Bot Message
        removeTypingIndicator(typingId);
        
        if (data && data.response) {
            addMessageToUI(data.response, 'bot');
        } else if (data && data.detail) {
            const detailText = typeof data.detail === 'object' ? JSON.stringify(data.detail) : data.detail;
            addMessageToUI("Error: " + detailText, 'bot');
        } else {
            addMessageToUI("I'm sorry, I couldn't process that request properly. Check if the server is running.", 'bot');
        }

    } catch (err) {
        console.error("Chat Error:", err);
        removeTypingIndicator(typingId);
        addMessageToUI("Sorry, I'm having trouble connecting to the neural network. Please try again later.", 'bot');
    }
}

function addMessageToUI(text, sender) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${sender}-message`;
    msgDiv.innerText = text;
    chatMessages.appendChild(msgDiv);
    
    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showTypingIndicator() {
    const id = 'typing-' + Date.now();
    const indicator = document.createElement('div');
    indicator.id = id;
    indicator.className = 'typing-indicator';
    indicator.innerHTML = `
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
    `;
    chatMessages.appendChild(indicator);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return id;
}

function removeTypingIndicator(id) {
    const indicator = document.getElementById(id);
    if (indicator) indicator.remove();
}

if (sendChatBtn) {
    sendChatBtn.onclick = sendChatMessage;
}

if (chatInput) {
    chatInput.onkeypress = (e) => {
        if (e.key === 'Enter') sendChatMessage();
    };
}

// Start the real-time clock
startClock();

/**
 * Future Prediction Logic (Dedicated View)
 */
function showPredictionView() {
    if (!activeSymbol) return;
    
    chartView.classList.add('view-hidden');
    excelView.classList.add('view-hidden');
    strategyView.classList.add('view-hidden');
    homeView.classList.add('view-hidden');
    predictionView.classList.remove('view-hidden');
    
    predictionActiveSymbol.innerText = getDisplayName(activeSymbol);
    
    // Stop all background polling/charts
    if (watchlistTimer) clearTimeout(watchlistTimer);
    if (marketDataTimer) clearTimeout(marketDataTimer);
    
    initPredictionChart();
    fetchPredictionData(activeHorizon);
}

function initPredictionChart() {
    const container = document.getElementById('predictionChartContainer');
    if (!container) return;

    // Use fallback dimensions if the container isn't fully painted yet
    const width = container.clientWidth || window.innerWidth - 64;
    const height = container.clientHeight || 500;

    if (!predictionChart) {
        try {
            predictionChart = LightweightCharts.createChart(container, {
                width: width,
                height: height,
                layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#94a3b8' },
                grid: { vertLines: { color: 'rgba(255, 255, 255, 0.05)' }, horzLines: { color: 'rgba(255, 255, 255, 0.05)' } },
                crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
                rightPriceScale: { borderColor: 'rgba(255, 255, 255, 0.1)' },
                timeScale: { borderColor: 'rgba(255, 255, 255, 0.1)', timeVisible: true }
            });

            const lineSeriesType = LightweightCharts.LineSeries || LightweightCharts.AreaSeries; // Fallback to Area if Line is missing for some reason
            predictionLineSeries = predictionChart.addSeries(lineSeriesType, {
                color: '#a78bfa',
                lineWidth: 3,
                crosshairMarkerVisible: true,
                lastValueVisible: true,
                priceLineVisible: false,
            });

            new ResizeObserver(entries => {
                if (entries.length > 0 && predictionChart) {
                    const { width, height } = entries[0].contentRect;
                    if (width > 0 && height > 0) {
                        predictionChart.applyOptions({ width, height });
                    }
                }
            }).observe(container);
        } catch (e) {
            console.error("Critical error creating prediction chart:", e);
        }
    }
}

async function fetchPredictionData(horizon) {
    if (!activeSymbol) return;
    
    // Ensure chart is initialized
    if (!predictionChart || !predictionLineSeries) {
        initPredictionChart();
    }
    
    if (!predictionLineSeries) {
        console.error("Prediction chart initialization failed.");
        return;
    }

    const loadingOverlay = document.getElementById('predictionLoading');
    const errorOverlay = document.getElementById('predictionError');
    const errorText = document.getElementById('predictionErrorText');

    // Show loading, hide error
    loadingOverlay.classList.remove('view-hidden');
    errorOverlay.classList.add('view-hidden');

    try {
        const response = await fetch(`/api/predict/${activeSymbol}?horizon=${horizon}`);
        const data = await response.json();
        
        if (data.error) throw new Error(data.error);

        if (data.prediction && data.prediction.length > 0) {
            predictionLineSeries.setData(data.prediction);
            predictionChart.timeScale().fitContent();

            // Update Stats
            if (data.metrics) {
                document.getElementById('statSpotPrice').innerText = `$${data.metrics.spot_price.toLocaleString()}`;
                document.getElementById('statDrift').innerText = `${data.metrics.annual_drift}%`;
                
                const returnEl = document.getElementById('statExpectedReturn');
                returnEl.innerText = `${data.metrics.expected_return > 0 ? '+' : ''}${data.metrics.expected_return}%`;
                returnEl.className = data.metrics.expected_return > 0 ? 'bullish' : 'bearish';

                const targetPrice = data.prediction[data.prediction.length - 1].value;
                document.getElementById('statTargetPrice').innerText = `$${targetPrice.toLocaleString()}`;
            }
        }
    } catch(err) {
        console.error("Prediction failed:", err);
        errorText.innerText = `Prediction Error: ${err.message}`;
        errorOverlay.classList.remove('view-hidden');
    } finally {
        loadingOverlay.classList.add('view-hidden');
    }
}

// Event Listeners for Prediction View
if (openPredictionBtn) {
    openPredictionBtn.onclick = () => showPredictionView();
}

if (predictionBackBtn) {
    predictionBackBtn.onclick = () => {
        predictionView.classList.add('view-hidden');
        chartView.classList.remove('view-hidden');
        pollMarketData(true);
    };
}

const retryBtn = document.getElementById('predictionRetryBtn');
if (retryBtn) {
    retryBtn.onclick = () => fetchPredictionData(activeHorizon);
}

horizonBtns.forEach(btn => {
    btn.onclick = () => {
        horizonBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeHorizon = btn.getAttribute('data-horizon');
        fetchPredictionData(activeHorizon);
    };
});
