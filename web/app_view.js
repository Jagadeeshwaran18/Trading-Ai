// Initialize Lucide Icons
lucide.createIcons();

// DOM Elements
const homeView = document.getElementById('homeView');
const chartView = document.getElementById('chartView');
const trackerGrid = document.getElementById('trackerGrid');
const activeSymbolEl = document.getElementById('activeSymbol');
const activePriceEl = document.getElementById('activePrice');
const activeChangeEl = document.getElementById('activeChange');
const backBtn = document.getElementById('backBtn');
const downloadBtn = document.getElementById('downloadBtn');
const timeframes = document.querySelectorAll('.timeframe');

// State Management
let activeSymbol = null;
let activeRange = "1d";
let activeInterval = "1m";
let liveTickSpeed = 10000;
let chart = null;
let candleSeries = null;

// Polling timers
let watchlistTimer = null;
let marketDataTimer = null;

/**
 * Switch Views
 */
function showHomeView() {
    chartView.classList.add('view-hidden');
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

            const card = document.createElement('div');
            card.className = 'tracker-card glass';
            card.onclick = () => showChartView(item.symbol);
            card.innerHTML = `
                <div class="tracker-top">
                    <span class="tracker-symbol">${item.symbol}</span>
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

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        if (data && data.length > 0) {
            if (data[0].time === undefined || data[0].close === undefined) {
                throw new Error("Server returned corrupt or unexpected data format.");
            }

            // SIMULATED LIVE TICK ENGINE 
            if (isLiveSimMode && !fitContent) {
                // We are in hyper-tick mode and just pulling live data updates!
                const livePrice = data[data.length - 1].close;
                const newPosTime = Math.floor(Date.now() / 1000);

                try {
                    candleSeries.update({
                        time: newPosTime,
                        open: livePrice,
                        high: livePrice,
                        low: livePrice,
                        close: livePrice
                    });
                } catch (e) {
                    // Fallback to setting data if update fails due to timeline geometry
                    candleSeries.setData(data);
                }
            } else {
                candleSeries.setData(data);
                if (fitContent) {
                    chart.timeScale().fitContent();
                }
            }

            // Update Header
            const lastPrice = data[data.length - 1].close;
            const prevPrice = data[0].close;
            const change = ((lastPrice - prevPrice) / prevPrice * 100).toFixed(2);

            activeSymbolEl.innerText = activeSymbol;
            activePriceEl.innerText = `$${lastPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

            // Format Change percent
            const isBullish = change > 0;
            const changeColor = isBullish ? 'var(--bullish)' : 'var(--bearish)';
            const changeSign = isBullish ? '+' : '';
            activeChangeEl.innerText = `${changeSign}${change}% (${activeRange.toUpperCase()})`;
            activeChangeEl.style.color = changeColor;
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
 * Polling Loops
 */
function pollWatchlist() {
    if (activeSymbol) return; // Don't poll watchlist if in chart view
    fetchWatchlist().finally(() => {
        watchlistTimer = setTimeout(pollWatchlist, 15000); // Poll every 15s
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

// Dropdown Toggle Logic
const dropdownBtn = document.getElementById('timeframeDropdownBtn');
const dropdownContent = document.querySelector('.dropdown-content');

let isLiveSimMode = false;

if (dropdownBtn && dropdownContent) {
    dropdownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdownContent.classList.toggle('show');
    });

    // Close dropdown if clicked outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dropdown')) {
            if (dropdownContent.classList.contains('show')) {
                dropdownContent.classList.remove('show');
            }
        }
    });
}

// Unified Selectors
document.querySelectorAll('.timeframe-option').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault();

        if (dropdownContent) {
            dropdownContent.classList.remove('show');
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

downloadBtn.onclick = () => {
    if (activeSymbol) {
        window.location.href = `/api/download/${activeSymbol}`;
    }
};

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
