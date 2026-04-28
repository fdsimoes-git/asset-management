// Button loading state utility
function setButtonLoading(btn, isLoading) {
    if (!btn) return;
    if (isLoading) {
        btn.dataset.originalText = btn.textContent;
        btn.classList.add('loading');
        btn.disabled = true;
    } else {
        btn.classList.remove('loading');
        btn.disabled = false;
        if (btn.dataset.originalText !== undefined) {
            btn.textContent = btn.dataset.originalText;
            delete btn.dataset.originalText;
        }
    }
}

// Canonical list of entry categories + unified colors shared across
// the bar chart, stacked bar chart, and filter chips so a given category is
// always visually consistent. Intentionally neutral-named because the list
// includes both expense-style tags (food, housing, ...) and income-style
// tags (salary, freelance, investment, transfer).
// User categories (issue #70) — fetched from /api/categories on startup
// and refetched after partner-view loads (server-side ensurePartnerCategories
// may have auto-imported partner-only slugs). Each entry: {slug, label,
// color, isDefault, sortOrder, importedFromUserId}.
//
// The hardcoded ENTRY_CATEGORIES + CATEGORY_COLORS constants of v2.5.x are
// replaced by this runtime list. categoryColor() and categoryLabel() perform
// lookups, falling back to a neutral color and the raw slug for orphan tags
// (entries referencing a category the user has since deleted).
let userCategories = [];
let _userCategoriesBySlug = new Map();
const ORPHAN_CATEGORY_COLOR = '#94a3b8';

function setUserCategories(list) {
    userCategories = Array.isArray(list) ? list : [];
    _userCategoriesBySlug = new Map(userCategories.map(c => [c.slug, c]));
    // Keep the manage-modal cap state in sync with any background mutation
    // (partner imports during loadEntries, AI auto-create, restore-defaults
    // from another tab, etc.). updateCategoryCapState() is a no-op when
    // the modal DOM isn't present yet, so it's cheap to call here.
    if (typeof updateCategoryCapState === 'function') updateCategoryCapState();
}

function categoryColor(slug) {
    const c = _userCategoriesBySlug.get(slug);
    return c ? c.color : ORPHAN_CATEGORY_COLOR;
}

function categoryLabel(slug) {
    const c = _userCategoriesBySlug.get(slug);
    if (!c) return slug; // orphan — render raw slug
    if (c.isDefault) return t('cat.' + slug);
    return c.label;
}

function categorySlugList() {
    return userCategories.map(c => c.slug);
}

// Race-protected fetch for /api/categories. Mirrors loadEntries' seq guard.
let _userCategoriesSeq = 0;
async function loadUserCategories() {
    const seq = ++_userCategoriesSeq;
    try {
        const res = await csrfFetch('/api/categories');
        if (seq !== _userCategoriesSeq) return userCategories;
        if (!res.ok) return userCategories;
        const list = await res.json();
        if (seq !== _userCategoriesSeq) return userCategories;
        setUserCategories(list);
    } catch (e) {
        console.error('loadUserCategories failed:', e);
    }
    return userCategories;
}

// Single source of truth for the slug/hex contracts shared across the
// frontend (issue #70). Mirrors server.js SLUG_REGEX / CATEGORY_HEX_REGEX.
const SLUG_REGEX_FE = /^[a-z0-9][a-z0-9-]{0,29}$/;
const HEX_REGEX_FE = /^#[0-9a-fA-F]{6}$/;

let entries = [];
let monthlyBalanceChart = null;
let incomeVsExpenseChart = null;
let categoryChart = null;
let categoryStackedChart = null;
// Category chart supports two presentations: horizontal bar (default) and doughnut.
let currentCategoryChartType = 'bar';
let _categoryCtxRef = null; // kept so setCategoryChartType can rebuild without re-running initializeCharts
let _chartThemeRef = null;  // theme/color palette reference for rebuilds
// Add a variable to track currently filtered entries
let currentFilteredEntries = [];
// Current user info
let currentUser = null;

// Sorting state
let currentSortColumn = null;
let currentSortDirection = 'asc';

// Pagination state for the entries table (issue #69)
const ENTRIES_PAGE_SIZE = 30;
let currentPage = 1;

// Couple feature state
let currentViewMode = 'individual';
let hasPartner = false;

// Build the category-distribution chart as either horizontal bar or doughnut.
// Colors are applied in updateCharts() (sorted by value) so they stay consistent
// with CATEGORY_COLORS regardless of sort order.
function buildCategoryChart(ctx, type, colors) {
    const commonTooltip = {
        backgroundColor: colors.cardBg || '#FBF6EC',
        titleColor: colors.textPrimary,
        bodyColor: colors.textSecondary,
        borderColor: colors.gridColor,
        borderWidth: 1,
        padding: 12,
        cornerRadius: 8
    };
    const title = {
        display: true,
        text: t('chart.expensesByCategory'),
        color: colors.textPrimary,
        font: { size: 14, weight: '500', family: _chartSerifFamily() },
        padding: { bottom: 20 }
    };
    if (type === 'doughnut') {
        return new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: [],
                datasets: [{
                    label: t('chart.amount'),
                    data: [],
                    backgroundColor: [],
                    borderColor: [],
                    borderWidth: 2,
                    hoverOffset: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '55%',
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            color: colors.textSecondary,
                            font: { size: 11, family: _chartFontFamily() },
                            boxWidth: 12,
                            padding: 8
                        }
                    },
                    title,
                    tooltip: {
                        ...commonTooltip,
                        callbacks: {
                            label: function(ctx) {
                                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                                const v = ctx.parsed;
                                const pct = total > 0 ? (v / total * 100).toFixed(1) : '0.0';
                                return `${ctx.label}: $${v.toFixed(2)} (${pct}%)`;
                            }
                        }
                    }
                }
            }
        });
    }
    // Default: horizontal bar
    return new Chart(ctx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: t('chart.amount'),
                data: [],
                backgroundColor: [],
                borderColor: [],
                borderWidth: 2,
                borderRadius: 6,
                hoverBackgroundColor: []
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                title,
                tooltip: {
                    ...commonTooltip,
                    callbacks: {
                        label: function(context) {
                            const v = context.parsed.x;
                            return `$${v.toFixed(2)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: t('chart.axisAmount'),
                        color: colors.textSecondary,
                        font: { family: _chartFontFamily(), size: 11, weight: '500' },
                        padding: { top: 6, bottom: 0 }
                    },
                    grid: { color: colors.gridColor, drawBorder: false },
                    ticks: {
                        color: colors.textMuted,
                        font: { family: _chartFontFamily() },
                        callback: function(value) { return '$' + value.toFixed(0); }
                    }
                },
                y: {
                    grid: { display: false },
                    ticks: {
                        color: colors.textSecondary,
                        font: { size: 11, weight: '500', family: _chartFontFamily() }
                    }
                }
            }
        }
    });
}

// Toggle the chart-loading overlay for a single chart by `data-chart`
// name. Used for targeted loading flashes on an individual chart surface
// (currently just the category chart's bar↔doughnut toggle) without
// blanket-covering every chart with `setChartsLoading`.
function setSingleChartLoading(chartName, isLoading) {
    const wrapper = document.querySelector(`.chart-wrapper[data-chart="${chartName}"]`);
    if (!wrapper) return;
    const overlay = wrapper.querySelector('.chart-loading-overlay');
    if (overlay) overlay.hidden = !isLoading;
    // aria-busy on the wrapper itself so screen readers get the cue too —
    // this path skips `.charts-section` (which would imply ALL charts are
    // loading), so the busy state lives on the specific wrapper.
    if (isLoading) wrapper.setAttribute('aria-busy', 'true');
    else wrapper.removeAttribute('aria-busy');
}

// Pending-rebuild timer ids. Rapid toggle clicks / theme swaps need to
// coalesce so we don't queue redundant rebuilds and don't toggle the
// loading overlay off between queued runs (which would defeat the
// "skeleton while rebuilding" intent).
let _categoryRebuildTimer = null;
let _themeRebuildTimer = null;

function setCategoryChartType(type) {
    if (!['bar', 'doughnut'].includes(type)) return;
    if (type === currentCategoryChartType) return;
    currentCategoryChartType = type;
    // Show the loading skeleton on the category chart and defer the
    // (synchronous) rebuild via setTimeout so the skeleton has a chance
    // to paint first — otherwise the toggle feels instant-but-blank. If
    // the user clicks again before the prior rebuild fires, cancel the
    // pending one and schedule fresh; the skeleton stays on until the
    // last-scheduled rebuild completes.
    setSingleChartLoading('category', true);
    if (_categoryRebuildTimer) clearTimeout(_categoryRebuildTimer);
    _categoryRebuildTimer = setTimeout(() => {
        _categoryRebuildTimer = null;
        if (categoryChart) categoryChart.destroy();
        categoryChart = buildCategoryChart(_categoryCtxRef, type, _chartThemeRef);
        // Re-populate with whatever the current filter view is showing
        if (Array.isArray(currentFilteredEntries)) {
            updateCharts(currentFilteredEntries, false, filterState.start, filterState.end);
        }
        setSingleChartLoading('category', false);
    }, 0);
}

// Tear down and rebuild every chart so it picks up the freshly-resolved
// CSS palette and font tokens — used after Appearance changes (theme /
// typography). Safe to call before charts have been initialised. Same
// coalescing as the category toggle: if the user changes theme twice in
// quick succession, only the last call's rebuild actually runs and the
// loading skeletons stay on until then.
function reapplyChartTheme() {
    setChartsLoading(true);
    if (_themeRebuildTimer) clearTimeout(_themeRebuildTimer);
    _themeRebuildTimer = setTimeout(() => {
        _themeRebuildTimer = null;
        [monthlyBalanceChart, incomeVsExpenseChart, categoryChart, categoryStackedChart].forEach(c => {
            if (c) c.destroy();
        });
        monthlyBalanceChart = incomeVsExpenseChart = categoryChart = categoryStackedChart = null;
        initializeCharts();
        if (Array.isArray(currentFilteredEntries)) {
            updateCharts(currentFilteredEntries, false, filterState.start, filterState.end);
        }
        setChartsLoading(false);
    }, 0);
}

// Resolves the active --sans token to a concrete font-family string for
// Chart.js (which doesn't accept var(--…)). Called from chart configs in
// scopes where the full palette isn't already in hand.
function _chartFontFamily() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--sans');
    return (v && v.trim()) || "Geist, ui-sans-serif, system-ui, sans-serif";
}

// Serif counterpart for chart titles — tracks --serif so editorial vs.
// modern vs. system typography presets reach the chart titles too.
function _chartSerifFamily() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--serif');
    return (v && v.trim()) || "'Instrument Serif', Georgia, serif";
}

// Read theme palette from CSS custom properties so chart colors track the
// active design system (warm earthy "Clay & Sand"). Falls back to the
// hard-coded defaults if a variable is missing — keeps Chart.js happy when
// the page is rendered before the stylesheet has fully resolved.
function readThemePalette() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name, fallback) => {
        const raw = cs.getPropertyValue(name);
        return raw && raw.trim() ? raw.trim() : fallback;
    };
    // Canvas (Chart.js) doesn't accept CSS color-mix() strings, so we mix the
    // accent fill ourselves by parsing the hex token to rgba.
    const hexToRgba = (hex, alpha) => {
        const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex || '').trim());
        if (!m) return 'rgba(184, 89, 58, ' + alpha + ')';
        let h = m[1];
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        const r = parseInt(h.slice(0, 2), 16);
        const g = parseInt(h.slice(2, 4), 16);
        const b = parseInt(h.slice(4, 6), 16);
        return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
    };
    const primary = v('--primary', '#B8593A');
    const negative = v('--negative', primary);
    const positive = v('--positive', '#6B8248');
    const accent1 = v('--accent-1', '#7A8450');
    const accent2 = v('--accent-2', '#C89A3E');
    // Chart.js wants a concrete font-family string — pull it from --sans so
    // chart legends/ticks track the active typography preset.
    const sansFamily = v('--sans', "'Geist', sans-serif");
    return {
        textPrimary: v('--ink', '#26201A'),
        textSecondary: v('--ink-2', '#5A4E3F'),
        textMuted: v('--ink-3', '#8A7A65'),
        gridColor: v('--line', '#DDD0B8'),
        cardBg: v('--card', '#FBF6EC'),
        accent: primary,
        accentGlow: hexToRgba(primary, 0.22),
        success: positive,
        danger: negative,
        olive: accent1,
        ochre: accent2,
        primarySoft: v('--primary-soft', '#E8BFAB'),
        fontFamily: sansFamily,
    };
}

// Initialize charts
function initializeCharts() {
    const monthlyBalanceCtx = document.getElementById('monthlyBalanceChart').getContext('2d');
    const incomeVsExpenseCtx = document.getElementById('incomeVsExpenseChart').getContext('2d');
    const categoryCtx = document.getElementById('categoryChart').getContext('2d');
    const categoryStackedCtx = document.getElementById('categoryStackedChart').getContext('2d');

    const colors = readThemePalette();

    // Reusable axis-title config — same look across all charts so the
    // legends/ticks aren't mystery numbers.
    const axisTitle = (text) => ({
        display: true,
        text: text,
        color: colors.textSecondary,
        font: { family: _chartFontFamily(), size: 11, weight: '500' },
        padding: { top: 6, bottom: 0 }
    });

    // Common chart options driven by the current CSS theme palette —
    // colors and fonts come from readThemePalette() above, which resolves
    // the active --ink / --line / --sans / etc. tokens.
    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                labels: {
                    color: colors.textSecondary,
                    font: {
                        size: 12,
                        family: _chartFontFamily()
                    },
                    padding: 15
                }
            },
            tooltip: {
                backgroundColor: colors.cardBg || '#FBF6EC',
                titleColor: colors.textPrimary,
                bodyColor: colors.textSecondary,
                borderColor: colors.gridColor,
                borderWidth: 1,
                padding: 12,
                cornerRadius: 8,
                titleFont: { family: _chartFontFamily(), weight: '600' },
                bodyFont: { family: _chartFontFamily() }
            }
        },
        scales: {
            y: {
                beginAtZero: true,
                title: axisTitle(t('chart.axisAmount')),
                grid: {
                    color: colors.gridColor,
                    drawBorder: false
                },
                ticks: {
                    color: colors.textMuted,
                    font: { family: _chartFontFamily() }
                }
            },
            x: {
                title: axisTitle(t('chart.axisMonth')),
                grid: {
                    color: colors.gridColor,
                    drawBorder: false
                },
                ticks: {
                    color: colors.textMuted,
                    maxRotation: 45,
                    minRotation: 45,
                    font: { family: _chartFontFamily() }
                }
            }
        }
    };

    // Specific options for income vs expense chart
    const incomeExpenseOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                labels: {
                    color: colors.textSecondary,
                    font: {
                        size: 12,
                        family: _chartFontFamily()
                    },
                    padding: 15
                }
            },
            tooltip: {
                backgroundColor: colors.cardBg || '#FBF6EC',
                titleColor: colors.textPrimary,
                bodyColor: colors.textSecondary,
                borderColor: colors.gridColor,
                borderWidth: 1,
                padding: 12,
                cornerRadius: 8,
                callbacks: {
                    label: function(context) {
                        const label = context.dataset.label || '';
                        const value = context.parsed.y;
                        return `${label}: $${value.toFixed(2)}`;
                    }
                }
            },
            annotation: {
                annotations: {}
            }
        },
        scales: {
            y: {
                beginAtZero: true,
                title: axisTitle(t('chart.axisAmount')),
                grid: {
                    color: colors.gridColor,
                    drawBorder: false
                },
                ticks: {
                    color: colors.textMuted,
                    font: { family: _chartFontFamily() },
                    callback: function(value) {
                        return '$' + value.toFixed(0);
                    }
                }
            },
            x: {
                title: axisTitle(t('chart.axisMonth')),
                grid: {
                    color: colors.gridColor,
                    drawBorder: false
                },
                ticks: {
                    color: colors.textMuted,
                    maxRotation: 45,
                    minRotation: 45,
                    font: { family: _chartFontFamily() }
                }
            }
        }
    };

    monthlyBalanceChart = new Chart(monthlyBalanceCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: t('chart.monthlyBalance'),
                data: [],
                borderColor: colors.accent,
                backgroundColor: colors.accentGlow,
                tension: 0.4,
                fill: true,
                pointBackgroundColor: colors.accent,
                pointBorderColor: colors.cardBg,
                pointBorderWidth: 2,
                pointRadius: 5,
                pointHoverRadius: 7,
                borderWidth: 3
            }]
        },
        options: {
            ...commonOptions,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                ...commonOptions.plugins,
                tooltip: {
                    ...commonOptions.plugins.tooltip,
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: function(ctx) {
                            const v = ctx.parsed.y;
                            return `${ctx.dataset.label}: $${v.toFixed(2)}`;
                        }
                    }
                },
                annotation: {
                    annotations: {
                        zeroLine: {
                            type: 'line',
                            yMin: 0,
                            yMax: 0,
                            borderColor: colors.gridColor,
                            borderWidth: 1,
                            borderDash: [4, 4]
                        }
                    }
                }
            }
        }
    });

    incomeVsExpenseChart = new Chart(incomeVsExpenseCtx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [
                {
                    label: t('chart.income'),
                    data: [],
                    backgroundColor: colors.olive,
                    borderColor: colors.olive,
                    borderWidth: 2,
                    borderRadius: 6,
                    hoverBackgroundColor: colors.success
                },
                {
                    label: t('chart.expenses'),
                    data: [],
                    backgroundColor: colors.accent,
                    borderColor: colors.accent,
                    borderWidth: 2,
                    borderRadius: 6,
                    hoverBackgroundColor: colors.danger
                }
            ]
        },
        options: incomeExpenseOptions
    });

    // Category distribution chart — supports bar (horizontal) or doughnut view.
    // The type can be toggled by the user via the overlay buttons; we rebuild
    // the chart on toggle because Chart.js does not allow changing `type` in place.
    _categoryCtxRef = categoryCtx;
    _chartThemeRef = colors;
    categoryChart = buildCategoryChart(categoryCtx, currentCategoryChartType, colors);

    // Stacked bar chart for entry categories by month. Datasets are rebuilt
    // dynamically on every updateCharts() call from the user's current
    // category list (plus any orphan slugs in the filtered data), so adding
    // / removing categories at runtime updates this chart automatically.
    const stackedDatasets = [];

    categoryStackedChart = new Chart(categoryStackedCtx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: stackedDatasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: colors.textSecondary,
                        font: { size: 10, family: _chartFontFamily() },
                        boxWidth: 12,
                        padding: 10
                    }
                },
                title: {
                    display: true,
                    text: t('chart.expenseCatByMonth'),
                    color: colors.textPrimary,
                    font: { size: 14, weight: '600', family: _chartSerifFamily() },
                    padding: { bottom: 15 }
                },
                tooltip: {
                    backgroundColor: '#1e293b',
                    titleColor: colors.textPrimary,
                    bodyColor: colors.textSecondary,
                    borderColor: 'rgba(148, 163, 184, 0.2)',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8,
                    callbacks: {
                        label: function(context) {
                            const label = context.dataset.label || '';
                            const value = context.parsed.y;
                            return `${label}: $${value.toFixed(2)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    stacked: true,
                    title: axisTitle(t('chart.axisMonth')),
                    grid: { color: colors.gridColor, drawBorder: false },
                    ticks: {
                        color: colors.textMuted,
                        maxRotation: 45,
                        minRotation: 45,
                        font: { family: _chartFontFamily() }
                    }
                },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    title: axisTitle(t('chart.axisAmount')),
                    grid: { color: colors.gridColor, drawBorder: false },
                    ticks: {
                        color: colors.textMuted,
                        font: { family: _chartFontFamily() },
                        callback: function(value) {
                            return '$' + value.toFixed(0);
                        }
                    }
                }
            }
        }
    });
}

function getMonthLabelsAroundCurrent() {
    const labels = [];
    const now = new Date();
    // Get current month in YYYY-MM
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    // Go back 4 months and include current
    for (let i = -4; i <= 0; i++) {
        const d = new Date(currentMonth);
        d.setMonth(d.getMonth() + i);
        const y = d.getFullYear();
        const m = (d.getMonth() + 1).toString().padStart(2, '0');
        labels.push(`${y}-${m}`);
    }
    // Add only one month in the future
    const next = new Date(currentMonth);
    next.setMonth(next.getMonth() + 1);
    const y = next.getFullYear();
    const m = (next.getMonth() + 1).toString().padStart(2, '0');
    labels.push(`${y}-${m}`);
    return labels;
}

// Generate continuous months between start and end dates (inclusive)
function generateContinuousMonths(startMonth, endMonth) {
    const months = [];
    // Parse year and month directly to avoid timezone issues
    const [startYear, startMon] = startMonth.split('-').map(Number);
    const [endYear, endMon] = endMonth.split('-').map(Number);

    let year = startYear;
    let month = startMon;

    while (year < endYear || (year === endYear && month <= endMon)) {
        months.push(`${year}-${month.toString().padStart(2, '0')}`);
        month++;
        if (month > 12) {
            month = 1;
            year++;
        }
    }

    return months;
}

// Update charts with current data
function updateCharts(entriesToShow = entries, forceDefaultMonths = false, filterStart = null, filterEnd = null) {
    const monthlyData = {};
    const incomeData = {};
    const expenseData = {};

    entriesToShow.forEach(entry => {
        const month = entry.month;
        const amount = parseFloat(entry.amount);
        monthlyData[month] = (monthlyData[month] || 0) + (entry.type === 'income' ? amount : -amount);
        if (entry.type === 'income') {
            incomeData[month] = (incomeData[month] || 0) + amount;
        } else {
            expenseData[month] = (expenseData[month] || 0) + amount;
        }
    });

    let months;
    if (forceDefaultMonths) {
        months = getMonthLabelsAroundCurrent();
    } else if (filterStart && filterEnd) {
        // Use filter date range for chart window
        months = generateContinuousMonths(filterStart, filterEnd);
    } else {
        const availableMonths = Object.keys(monthlyData).sort();
        if (availableMonths.length === 0) {
            months = getMonthLabelsAroundCurrent();
        } else if (availableMonths.length === 1) {
            // If only one month has data, show 3-month context window
            const singleMonth = availableMonths[0];
            const [year, month] = singleMonth.split('-').map(Number);
            const prevDate = new Date(year, month - 2, 1);
            const nextDate = new Date(year, month, 1);
            const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
            const nextMonth = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;
            months = generateContinuousMonths(prevMonth, nextMonth);
        } else {
            // Generate continuous months between earliest and latest
            const startMonth = availableMonths[0];
            const endMonth = availableMonths[availableMonths.length - 1];
            months = generateContinuousMonths(startMonth, endMonth);
        }
    }

    let totalAsset = 0;
    const totalAssetData = months.map(month => {
        totalAsset += monthlyData[month] || 0;
        return totalAsset;
    });

    monthlyBalanceChart.data.labels = months;
    monthlyBalanceChart.data.datasets[0].data = totalAssetData;
    monthlyBalanceChart.data.datasets[0].label = forceDefaultMonths ? t('chart.totalAssetRecent') : t('chart.totalAsset');
    monthlyBalanceChart.update();

    incomeVsExpenseChart.data.labels = months;
    const incomeValues = months.map(month => incomeData[month] || 0);
    const expenseValues = months.map(month => expenseData[month] || 0);
    incomeVsExpenseChart.data.datasets[0].data = incomeValues;
    incomeVsExpenseChart.data.datasets[1].data = expenseValues;

    // Add average lines when 2+ months are selected (only show if average > 0)
    if (months.length >= 2) {
        const avgIncome = incomeValues.reduce((a, b) => a + b, 0) / months.length;
        const avgExpense = expenseValues.reduce((a, b) => a + b, 0) / months.length;

        const themePalette = readThemePalette();
        const annotations = {};

        if (avgIncome > 0) {
            annotations.avgIncomeLine = {
                type: 'line',
                yMin: avgIncome,
                yMax: avgIncome,
                borderColor: themePalette.olive,
                borderWidth: 2,
                borderDash: [6, 4],
                label: {
                    display: true,
                    content: t('chart.avgIncome', { value: avgIncome.toFixed(0) }),
                    position: 'start',
                    backgroundColor: themePalette.olive,
                    color: themePalette.cardBg,
                    font: { size: 11, family: _chartFontFamily() },
                    padding: 4
                }
            };
        }

        if (avgExpense > 0) {
            annotations.avgExpenseLine = {
                type: 'line',
                yMin: avgExpense,
                yMax: avgExpense,
                borderColor: themePalette.accent,
                borderWidth: 2,
                borderDash: [6, 4],
                label: {
                    display: true,
                    content: t('chart.avgExpenses', { value: avgExpense.toFixed(0) }),
                    position: 'end',
                    backgroundColor: themePalette.accent,
                    color: themePalette.cardBg,
                    font: { size: 11, family: _chartFontFamily() },
                    padding: 4
                }
            };
        }

        incomeVsExpenseChart.options.plugins.annotation.annotations = annotations;
    } else {
        // Remove annotations when less than 2 months
        incomeVsExpenseChart.options.plugins.annotation.annotations = {};
    }

    incomeVsExpenseChart.update();

    // Update category doughnut chart
    const tagTotals = {};
    entriesToShow
        .filter(e => e.type === 'expense')
        .forEach(entry => {
            const entryTags = (entry.tags && entry.tags.length > 0) ? entry.tags : ['other'];
            const perTagAmount = parseFloat(entry.amount) / entryTags.length;
            entryTags.forEach(tag => {
                tagTotals[tag] = (tagTotals[tag] || 0) + perTagAmount;
            });
        });
    const sortedTags = Object.entries(tagTotals).sort((a, b) => b[1] - a[1]);
    const sortedCategoryKeys = sortedTags.map(([tag]) => tag);
    const sortedColors = sortedCategoryKeys.map(categoryColor);
    categoryChart.data.labels = sortedTags.map(([tag]) => categoryLabel(tag));
    const categoryValues = sortedTags.map(([, amount]) => Math.round(amount * 100) / 100);
    categoryChart.data.datasets[0].data = categoryValues;
    categoryChart.data.datasets[0].backgroundColor = sortedColors.map(c => c + 'cc');
    categoryChart.data.datasets[0].borderColor = sortedColors;
    categoryChart.data.datasets[0].hoverBackgroundColor = sortedColors;
    categoryChart.update();

    // Update stacked category chart — expenses by category per month.
    // Categories axis = user's current category list ∪ orphan slugs found
    // in the filtered data. Orphans get the neutral fallback color.
    const userSlugs = categorySlugList();
    const orphanSlugs = new Set();
    entriesToShow
        .filter(e => e.type === 'expense')
        .forEach(entry => {
            const entryTags = (entry.tags && entry.tags.length > 0) ? entry.tags : ['other'];
            entryTags.forEach(tag => {
                if (!_userCategoriesBySlug.has(tag)) orphanSlugs.add(tag);
            });
        });
    const stackedCategories = [...userSlugs, ...Array.from(orphanSlugs).sort()];

    const categoryMonthlyData = {};
    months.forEach(month => {
        categoryMonthlyData[month] = {};
        stackedCategories.forEach(cat => { categoryMonthlyData[month][cat] = 0; });
    });

    // Aggregate expense entries by month and category — preserve raw tag
    // (including orphans) so deleted-then-recreated categories render
    // correctly without bucketing into 'other'.
    entriesToShow
        .filter(e => e.type === 'expense')
        .forEach(entry => {
            const month = entry.month;
            if (!categoryMonthlyData[month]) return;
            const entryTags = (entry.tags && entry.tags.length > 0) ? entry.tags : ['other'];
            const perTagAmount = parseFloat(entry.amount) / entryTags.length;
            entryTags.forEach(tag => {
                if (categoryMonthlyData[month][tag] != null) {
                    categoryMonthlyData[month][tag] += perTagAmount;
                }
            });
        });

    categoryStackedChart.data.labels = months;

    const categoriesWithData = stackedCategories.filter(category =>
        months.some(month => categoryMonthlyData[month][category] > 0)
    );

    // Rebuild datasets from scratch on every update so adding/removing
    // categories at runtime stays in sync without re-creating the chart.
    categoryStackedChart.data.datasets = stackedCategories.map(category => {
        const color = categoryColor(category);
        return {
            label: categoryLabel(category),
            _category: category,
            data: months.map(month => {
                const value = categoryMonthlyData[month]?.[category] || 0;
                return Math.round(value * 100) / 100;
            }),
            backgroundColor: color + 'cc',
            borderColor: color,
            borderWidth: 1,
            borderRadius: 3,
            hoverBackgroundColor: color,
            hidden: !categoriesWithData.includes(category),
        };
    });

    categoryStackedChart.update();

    // Empty-state overlays: show when a chart has no meaningful data for the
    // current filter window. Base "monthly balance" emptiness on whether any
    // income/expense activity exists — a cumulative series summing to zero
    // (e.g. matched income and expense) is still meaningful data.
    const hasIncomeExpenseData = incomeValues.some(v => v > 0) || expenseValues.some(v => v > 0);
    const hasCategoryData = categoryValues.length > 0 && categoryValues.some(v => v > 0);
    const hasStackedData = categoriesWithData.length > 0;
    setChartEmpty('monthlyBalance', !hasIncomeExpenseData);
    setChartEmpty('incomeVsExpense', !hasIncomeExpenseData);
    setChartEmpty('category', !hasCategoryData);
    setChartEmpty('categoryStacked', !hasStackedData);
}

function setChartEmpty(chartName, isEmpty) {
    const wrapper = document.querySelector(`.chart-wrapper[data-chart="${chartName}"]`);
    if (!wrapper) return;
    const overlay = wrapper.querySelector('.chart-empty-state');
    const canvas = wrapper.querySelector('canvas');
    if (overlay) overlay.hidden = !isEmpty;
    if (canvas) canvas.style.opacity = isEmpty ? '0.15' : '1';
}

function setChartsLoading(isLoading) {
    document.querySelectorAll('.chart-wrapper .chart-loading-overlay').forEach(el => {
        el.hidden = !isLoading;
    });
    const section = document.querySelector('.charts-section');
    if (section) section.setAttribute('aria-busy', String(!!isLoading));
}

function setEntriesLoading(isLoading) {
    const overlay = document.getElementById('entriesTableLoadingOverlay');
    if (overlay) overlay.hidden = !isLoading;
    const summary = document.querySelector('.entries-section .summary');
    if (summary) summary.classList.toggle('is-loading', isLoading);
    const section = document.querySelector('.entries-section');
    if (section) section.setAttribute('aria-busy', String(!!isLoading));
}

// Toggles the `is-loading` class on the hero net-worth card + each KPI
// tile, dimming live numbers and overlaying a shimmer block via CSS while
// data is being fetched. Also flips aria-busy so screen-reader users get
// the cue.
function setHeroLoading(isLoading) {
    const hero = document.getElementById('heroRow');
    if (!hero) return;
    hero.setAttribute('aria-busy', String(!!isLoading));
    const networth = hero.querySelector('.hero-networth');
    if (networth) networth.classList.toggle('is-loading', isLoading);
    hero.querySelectorAll('.kpi').forEach(el => el.classList.toggle('is-loading', isLoading));
}

function setViewLoading(isLoading) {
    setChartsLoading(isLoading);
    setEntriesLoading(isLoading);
    setHeroLoading(isLoading);
}

// ============ FILTER STATE ============

const DEFAULT_FILTER_STATE = Object.freeze({ start: '', end: '', type: 'all', categories: [], quickRange: null });
// Shallow-spreading DEFAULT_FILTER_STATE leaks the `categories` array by
// reference, which meant chip clicks mutated the "default" and reset no
// longer released selected categories. Always build a fresh state through
// this factory so each consumer gets an independent categories array.
function freshFilterState() {
    return { start: '', end: '', type: 'all', categories: [], quickRange: null };
}
let filterState = freshFilterState();

function filterStorageKey() {
    const uid = (currentUser && currentUser.id) || 'anon';
    return `assetmgmt.filters.v1.${uid}.${currentViewMode}`;
}

const VALID_FILTER_TYPES = new Set(['all', 'income', 'expense']);
const VALID_QUICK_RANGES = new Set(['3m', '6m', '12m', 'ytd', 'all']);
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function sanitizeFilterState(raw) {
    const out = freshFilterState();
    if (!raw || typeof raw !== 'object') return out;
    if (typeof raw.start === 'string' && (raw.start === '' || MONTH_RE.test(raw.start))) out.start = raw.start;
    if (typeof raw.end === 'string' && (raw.end === '' || MONTH_RE.test(raw.end))) out.end = raw.end;
    if (typeof raw.type === 'string' && VALID_FILTER_TYPES.has(raw.type)) out.type = raw.type;
    if (Array.isArray(raw.categories)) {
        // Accept any well-formed slug — categories the user has since
        // deleted will simply not match anything (they show as orphans
        // in entries). Strict whitelist would silently drop chips on
        // category rename / re-add cycles.
        out.categories = [...new Set(raw.categories.filter(c => typeof c === 'string' && SLUG_REGEX_FE.test(c)))];
    }
    if (raw.quickRange === null || (typeof raw.quickRange === 'string' && VALID_QUICK_RANGES.has(raw.quickRange))) {
        out.quickRange = raw.quickRange || null;
    }
    return out;
}

function loadFilterState() {
    try {
        const raw = localStorage.getItem(filterStorageKey());
        if (!raw) return null;
        return sanitizeFilterState(JSON.parse(raw));
    } catch { return null; }
}

function saveFilterState() {
    try { localStorage.setItem(filterStorageKey(), JSON.stringify(filterState)); }
    catch { /* quota — ignore */ }
}

function applyFilterStateToDOM() {
    // If a persisted quick-range no longer matches the saved start/end (e.g.
    // "last 3 months" saved weeks ago now maps to a different window), clear
    // it so we don't mislead the user with a stale active preset.
    if (filterState.quickRange && !rangeMatchesQuickRange(filterState.quickRange)) {
        filterState.quickRange = null;
    }
    document.getElementById('monthFilterStart').value = filterState.start || '';
    document.getElementById('monthFilterEnd').value = filterState.end || '';
    document.getElementById('typeFilter').value = filterState.type || 'all';
    renderCategoryChips();
    syncHiddenCategorySelect();
    document.querySelectorAll('.quick-range-btn').forEach(btn => {
        const isActive = btn.dataset.range === filterState.quickRange;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', String(isActive));
    });
}

function renderCategoryChips() {
    const container = document.getElementById('categoryChips');
    if (!container) return;
    container.innerHTML = '';
    userCategories.forEach(catRow => {
        const cat = catRow.slug;
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'cat-chip';
        chip.dataset.cat = cat;
        chip.textContent = categoryLabel(cat);
        if (catRow.importedFromUserId != null) {
            // Decorative tooltip; partner-imported categories are still
            // independent local copies (not affected by partner deletes).
            const importedTip = (typeof t === 'function' && t('category.importedTooltip')) || 'Imported from partner';
            chip.title = importedTip;
        }
        const color = categoryColor(cat);
        chip.style.setProperty('--chip-color', color);
        chip.style.setProperty('--chip-color-bg', hexWithAlpha(color, 0.18));
        const isSelected = filterState.categories.includes(cat);
        chip.classList.toggle('active', isSelected);
        chip.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
        chip.addEventListener('click', () => {
            const i = filterState.categories.indexOf(cat);
            if (i === -1) filterState.categories.push(cat);
            else filterState.categories.splice(i, 1);
            const pressed = filterState.categories.includes(cat);
            chip.classList.toggle('active', pressed);
            chip.setAttribute('aria-pressed', pressed ? 'true' : 'false');
            syncHiddenCategorySelect();
            onFilterChanged();
        });
        container.appendChild(chip);
    });
}

function hexWithAlpha(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

function syncHiddenCategorySelect() {
    const select = document.getElementById('categoryFilter');
    if (!select) return;
    // Rebuild option list from runtime user categories so the hidden
    // <select> stays in sync as categories are added/removed.
    const desired = userCategories.map(c => c.slug);
    const existing = Array.from(select.options).map(o => o.value);
    const slugListChanged = desired.length !== existing.length || desired.some((s, i) => s !== existing[i]);
    if (slugListChanged) {
        select.innerHTML = '';
        userCategories.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.slug;
            opt.textContent = categoryLabel(c.slug);
            select.appendChild(opt);
        });
    } else {
        // Slug list unchanged — but labels can still drift (rename, language
        // switch affecting default labels, imported badge changes). Refresh
        // each option's textContent so the hidden select stays consistent.
        Array.from(select.options).forEach(opt => {
            const fresh = categoryLabel(opt.value);
            if (opt.textContent !== fresh) opt.textContent = fresh;
        });
    }
    Array.from(select.options).forEach(opt => {
        opt.selected = filterState.categories.includes(opt.value);
    });
}

function readFilterStateFromInputs() {
    filterState.start = document.getElementById('monthFilterStart').value;
    filterState.end = document.getElementById('monthFilterEnd').value;
    filterState.type = document.getElementById('typeFilter').value;
    // categories managed directly by chip click handlers
}

function onFilterChanged() {
    readFilterStateFromInputs();
    // If user edits month inputs manually, drop the "quick range" active state
    // unless they still match.
    if (filterState.quickRange && !rangeMatchesQuickRange(filterState.quickRange)) {
        filterState.quickRange = null;
        document.querySelectorAll('.quick-range-btn').forEach(b => {
            b.classList.remove('active');
            b.setAttribute('aria-pressed', 'false');
        });
    }
    saveFilterState();
    renderActiveFiltersBar();
    filterEntries();
}

function applyQuickRange(range) {
    const now = new Date();
    const endYM = ymStr(now.getFullYear(), now.getMonth() + 1);
    let startYM = '';
    if (range === '3m') {
        const d = new Date(now.getFullYear(), now.getMonth() - 2, 1);
        startYM = ymStr(d.getFullYear(), d.getMonth() + 1);
    } else if (range === '6m') {
        const d = new Date(now.getFullYear(), now.getMonth() - 5, 1);
        startYM = ymStr(d.getFullYear(), d.getMonth() + 1);
    } else if (range === '12m') {
        const d = new Date(now.getFullYear(), now.getMonth() - 11, 1);
        startYM = ymStr(d.getFullYear(), d.getMonth() + 1);
    } else if (range === 'ytd') {
        startYM = ymStr(now.getFullYear(), 1);
    } else if (range === 'all') {
        startYM = '';
        filterState.end = '';
    }
    filterState.start = startYM;
    filterState.end = range === 'all' ? '' : endYM;
    filterState.quickRange = range;
    applyFilterStateToDOM();
    saveFilterState();
    renderActiveFiltersBar();
    filterEntries();
}

function ymStr(y, m) { return `${y}-${String(m).padStart(2, '0')}`; }

function rangeMatchesQuickRange(range) {
    const now = new Date();
    const endExpected = ymStr(now.getFullYear(), now.getMonth() + 1);
    if (range === 'all') return !filterState.start && !filterState.end;
    if (filterState.end !== endExpected) return false;
    if (range === 'ytd') return filterState.start === ymStr(now.getFullYear(), 1);
    const mMap = { '3m': 2, '6m': 5, '12m': 11 };
    if (!(range in mMap)) return false;
    const d = new Date(now.getFullYear(), now.getMonth() - mMap[range], 1);
    return filterState.start === ymStr(d.getFullYear(), d.getMonth() + 1);
}

function renderActiveFiltersBar() {
    const bar = document.getElementById('activeFiltersBar');
    const list = document.getElementById('activeFiltersList');
    const count = document.getElementById('filterResultsCount');
    if (!bar || !list || !count) return;

    list.innerHTML = '';
    const chips = [];

    if (filterState.start || filterState.end) {
        const label = `${filterState.start || '…'} → ${filterState.end || '…'}`;
        chips.push({ label, onRemove: () => {
            filterState.start = ''; filterState.end = ''; filterState.quickRange = null;
            applyFilterStateToDOM(); saveFilterState(); renderActiveFiltersBar(); filterEntries();
        }});
    }
    if (filterState.type && filterState.type !== 'all') {
        chips.push({ label: t('type.' + filterState.type), onRemove: () => {
            filterState.type = 'all'; applyFilterStateToDOM(); saveFilterState(); renderActiveFiltersBar(); filterEntries();
        }});
    }
    filterState.categories.forEach(cat => {
        chips.push({ label: categoryLabel(cat), onRemove: () => {
            filterState.categories = filterState.categories.filter(c => c !== cat);
            renderCategoryChips(); syncHiddenCategorySelect(); saveFilterState(); renderActiveFiltersBar(); filterEntries();
        }});
    });

    chips.forEach(chip => {
        const el = document.createElement('span');
        el.className = 'active-filter-chip';
        el.textContent = chip.label + ' ';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('aria-label', t('filter.removeFilter'));
        btn.textContent = '✕';
        btn.addEventListener('click', chip.onRemove);
        el.appendChild(btn);
        list.appendChild(el);
    });

    // Count + total are updated after filterEntries runs (see filterEntries)
    bar.hidden = chips.length === 0 && !filterState.start && !filterState.end && filterState.type === 'all' && filterState.categories.length === 0;
    // Keep visible when chips non-empty; show zero-chip state only if we later add result count-always mode
}

function updateFilterResultsCount(filtered) {
    const count = document.getElementById('filterResultsCount');
    if (!count) return;
    const bar = document.getElementById('activeFiltersBar');
    const hasAnyFilter = filterState.start || filterState.end || (filterState.type && filterState.type !== 'all') || filterState.categories.length > 0;
    if (!hasAnyFilter) {
        if (bar) bar.hidden = true;
        return;
    }
    if (bar) bar.hidden = false;
    const total = filtered.reduce((s, e) => s + parseFloat(e.amount), 0);
    count.textContent = t('filter.resultsCount', { count: filtered.length, total: '$' + total.toFixed(2) });
}

// Filter entries based on selected criteria
function filterEntries(opts) {
    // Filter changes reset to page 1 by default; entry mutations (delete)
    // pass { resetPage: false } so we just clamp inside displayEntries() and
    // keep the user near the row they just touched.
    const resetPage = !opts || opts.resetPage !== false;
    if (resetPage) currentPage = 1;
    const monthFilterStart = filterState.start;
    const monthFilterEnd = filterState.end;
    const typeFilter = filterState.type;
    const selectedCategories = filterState.categories;

    let filteredEntries = entries;

    if (monthFilterStart && monthFilterEnd) {
        filteredEntries = filteredEntries.filter(entry => {
            return entry.month >= monthFilterStart && entry.month <= monthFilterEnd;
        });
    } else if (monthFilterStart) {
        filteredEntries = filteredEntries.filter(entry => entry.month >= monthFilterStart);
    } else if (monthFilterEnd) {
        filteredEntries = filteredEntries.filter(entry => entry.month <= monthFilterEnd);
    }

    if (typeFilter !== 'all') {
        filteredEntries = filteredEntries.filter(entry => entry.type === typeFilter);
    }

    if (selectedCategories.length > 0) {
        filteredEntries = filteredEntries.filter(entry =>
            entry.tags && entry.tags.some(tag => selectedCategories.includes(tag))
        );
    }

    // Store the current filtered entries for sorting
    currentFilteredEntries = filteredEntries;

    displayEntries(filteredEntries);
    updateSummary(filteredEntries);
    updateCharts(filteredEntries, false, monthFilterStart, monthFilterEnd);
    updateCoupleShare(filteredEntries);
    updateFilterResultsCount(filteredEntries);
}

// Sort entries function
function sortEntries(entriesToShow, column, direction) {
    return [...entriesToShow].sort((a, b) => {
        let aValue, bValue;

        switch (column) {
            case 'month':
                aValue = a.month;
                bValue = b.month;
                break;
            case 'type':
                aValue = a.type;
                bValue = b.type;
                break;
            case 'amount':
                aValue = parseFloat(a.amount);
                bValue = parseFloat(b.amount);
                break;
            case 'description':
                aValue = a.description.toLowerCase();
                bValue = b.description.toLowerCase();
                break;
            case 'tags':
                aValue = (a.tags && a.tags[0]) || 'zzz'; // Sort empty last
                bValue = (b.tags && b.tags[0]) || 'zzz';
                break;
            default:
                return 0;
        }

        if (direction === 'asc') {
            return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
        } else {
            return aValue < bValue ? 1 : aValue > bValue ? -1 : 0;
        }
    });
}

// Update sort indicators
function updateSortIndicators() {
    const sortableHeaders = document.querySelectorAll('.sortable');
    sortableHeaders.forEach(header => {
        header.classList.remove('asc', 'desc');
        if (header.dataset.sort === currentSortColumn) {
            header.classList.add(currentSortDirection);
        }
    });
}

// Display entries in the table
// Caches the last sort result keyed by source-array identity + sort settings,
// so paginating a large list doesn't re-sort O(n log n) on every Prev/Next.
let _sortedEntriesCache = { source: null, column: null, direction: null, result: null };
function displayEntries(entriesToShow) {
    const tbody = document.getElementById('entriesBody');
    tbody.innerHTML = '';

    // Apply current sorting if set, otherwise default to month descending.
    // filterEntries() always reassigns currentFilteredEntries to a new array,
    // so reference equality is enough to detect "filter changed".
    let sortedEntries;
    const cache = _sortedEntriesCache;
    if (cache.source === entriesToShow
        && cache.column === currentSortColumn
        && cache.direction === currentSortDirection
        && cache.result) {
        sortedEntries = cache.result;
    } else {
        if (currentSortColumn) {
            sortedEntries = sortEntries(entriesToShow, currentSortColumn, currentSortDirection);
        } else {
            sortedEntries = [...entriesToShow].sort((a, b) => b.month.localeCompare(a.month));
        }
        _sortedEntriesCache = {
            source: entriesToShow,
            column: currentSortColumn,
            direction: currentSortDirection,
            result: sortedEntries,
        };
    }

    // Pagination: clamp currentPage so deletes/edits that shrink the list
    // never leave us on a page that no longer exists.
    const totalEntries = sortedEntries.length;
    const totalPages = Math.max(1, Math.ceil(totalEntries / ENTRIES_PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    const startIdx = (currentPage - 1) * ENTRIES_PAGE_SIZE;
    const pageEntries = sortedEntries.slice(startIdx, startIdx + ENTRIES_PAGE_SIZE);

    pageEntries.forEach(entry => {
        const row = document.createElement('tr');
        const escapedDescription = escapeHtml(entry.description);
        const tags = (entry.tags || []).map(tag =>
            (() => {
                const _col = categoryColor(tag);
                const _bg = hexWithAlpha(_col, 0.15);
                const _bd = hexWithAlpha(_col, 0.3);
                return `<span class="tag tag-${escapeHtml(tag)}" style="background:${_bg};color:${_col};border-color:${_bd}">${escapeHtml(categoryLabel(tag))}</span>`;
            })()
        ).join(' ');
        const coupleBadge = entry.isCoupleExpense ? `<span class="couple-badge">${t('dash.couple')}</span>` : '';
        const inMyShare = currentViewMode === 'myshare';
        const halfBadge = (inMyShare && entry.isCoupleExpense)
            ? `<span class="share-half-badge" title="${escapeHtml(t('dash.halfSharedTooltip'))}">${escapeHtml(t('dash.halfSharedBadge'))}</span>`
            : '';

        // In combined view, only show Edit/Delete for user's own entries.
        // In "My Share" view, halved couple rows are display-only (amount shown is half the stored value).
        // Require currentUser to be loaded — otherwise partner rows briefly
        // render with edit/delete buttons during the initial load window
        // (entries are fetched before fetchCurrentUser resolves).
        const isOwnEntry = !!currentUser && entry.userId === currentUser.id;
        const editable = isOwnEntry && !(inMyShare && entry.isCoupleExpense);
        const actionButtons = editable
            ? `<button class="edit-btn" data-id="${entry.id}">${t('common.edit')}</button>
               <button class="delete-btn" data-id="${entry.id}">${t('common.delete')}</button>`
            : (inMyShare && entry.isCoupleExpense)
                ? `<span style="color: var(--color-text-muted); font-size: 0.75rem;" title="${escapeHtml(t('dash.halfSharedTooltip'))}">${escapeHtml(t('dash.halfSharedBadge'))}</span>`
                : currentUser
                    ? `<span style="color: var(--color-text-secondary); font-size: 0.75rem;">${t('dash.partnersEntry')}</span>`
                    : '';

        row.innerHTML = `
            <td>${escapeHtml(entry.month)}</td>
            <td><span class="entry-type entry-type-${escapeHtml(entry.type)}">${escapeHtml(entry.type)}</span></td>
            <td>$${parseFloat(entry.amount).toFixed(2)}</td>
            <td>${halfBadge}${coupleBadge}${escapedDescription}</td>
            <td>${tags || '<span class="tag tag-other">-</span>'}</td>
            <td>${actionButtons}</td>
        `;
        tbody.appendChild(row);
    });

    // Update sort indicators
    updateSortIndicators();
    // Render pagination control (hidden when ≤ 1 page)
    renderEntriesPagination(totalEntries, totalPages);
}

// Render pagination controls below the entries table.
// Hidden entirely when there's nothing to paginate.
function renderEntriesPagination(totalEntries, totalPages) {
    const container = document.getElementById('entriesPagination');
    if (!container) return;
    if (totalEntries <= ENTRIES_PAGE_SIZE) {
        container.hidden = true;
        container.innerHTML = '';
        return;
    }
    container.hidden = false;
    const from = (currentPage - 1) * ENTRIES_PAGE_SIZE + 1;
    const to = Math.min(currentPage * ENTRIES_PAGE_SIZE, totalEntries);
    const showing = t('pagination.showing', { from, to, total: totalEntries });
    const pageOf = t('pagination.pageOf', { current: currentPage, total: totalPages });
    const prevLabel = t('pagination.previous');
    const nextLabel = t('pagination.next');
    const prevDisabled = currentPage <= 1 ? 'disabled' : '';
    const nextDisabled = currentPage >= totalPages ? 'disabled' : '';
    container.innerHTML = `
        <span class="entries-pagination-info" aria-live="polite">${escapeHtml(showing)}</span>
        <div class="entries-pagination-controls">
            <button type="button" class="entries-pagination-btn" data-page-action="prev" ${prevDisabled} aria-label="${escapeHtml(prevLabel)}">${escapeHtml(prevLabel)}</button>
            <span class="entries-pagination-indicator">${escapeHtml(pageOf)}</span>
            <button type="button" class="entries-pagination-btn" data-page-action="next" ${nextDisabled} aria-label="${escapeHtml(nextLabel)}">${escapeHtml(nextLabel)}</button>
        </div>
    `;
}

// Update summary statistics
function updateSummary(entriesToShow) {
    const totalIncome = entriesToShow
        .filter(entry => entry.type === 'income')
        .reduce((sum, entry) => sum + parseFloat(entry.amount), 0);

    const totalExpenses = entriesToShow
        .filter(entry => entry.type === 'expense')
        .reduce((sum, entry) => sum + parseFloat(entry.amount), 0);

    const netBalance = totalIncome - totalExpenses;

    const incomeEl = document.getElementById('totalIncome');
    const expensesEl = document.getElementById('totalExpenses');
    const netEl = document.getElementById('netBalance');

    if (incomeEl) {
        incomeEl.textContent = `$${totalIncome.toFixed(2)}`;
        incomeEl.style.color = 'var(--positive)';
    }
    if (expensesEl) {
        expensesEl.textContent = `$${totalExpenses.toFixed(2)}`;
        expensesEl.style.color = 'var(--negative)';
    }
    if (netEl) {
        netEl.textContent = `$${netBalance.toFixed(2)}`;
        netEl.style.color = netBalance >= 0 ? 'var(--ink)' : 'var(--negative)';
    }

    // Hero / KPI row
    updateHeroKpis(entriesToShow, { totalIncome, totalExpenses, netBalance });
}

// --- Hero net-worth + KPI column ---
// Renders the bignum net-worth figure, three KPI cards (income/expense/saving
// rate) with sparklines, and month-over-month delta pills. The figures sum
// the entries currently visible to the user (filters + view mode applied) so
// they always reflect what's on screen.
function updateHeroKpis(entriesToShow, totals) {
    const heroInt = document.getElementById('heroNetWorthInt');
    if (!heroInt) return; // hero row not in this page

    // Localize currency formatting to the active app language. EN → USD/$,
    // PT → BRL/R$ — matches the symbol the chart strings already use in
    // PT (chart.avgIncome / chart.avgExpenses say "R$"). Drives both the
    // hero bignum and the +/− delta pill so symbol, grouping, and decimal
    // separator all stay consistent.
    const isPt = (typeof getLang === 'function' && getLang() === 'pt');
    const locale = isPt ? 'pt-BR' : 'en-US';
    const currency = isPt ? 'BRL' : 'USD';
    const currencyFmt0 = new Intl.NumberFormat(locale, {
        style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0
    });
    const currencyFmt2 = new Intl.NumberFormat(locale, {
        style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2
    });
    // Plain (no currency) integer formatter for KPI value spans, where
    // the currency symbol lives in a separate `.unit` element.
    const intFmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
    const fmt = (n) => intFmt.format(Math.round(Math.abs(n)));
    const fmtSigned = (n) => (n >= 0 ? '+' : '-') + currencyFmt0.format(Math.abs(n));
    // Currency symbol pulled from formatToParts so we get whatever symbol
    // the active locale uses ("R$" for pt-BR, "$" for en-US, etc.).
    const currencySymbol = (() => {
        const sym = currencyFmt0.formatToParts(0).find(p => p.type === 'currency');
        return sym ? sym.value : (isPt ? 'R$' : '$');
    })();
    const kpiIncomeUnit = document.getElementById('kpiIncomeUnit');
    if (kpiIncomeUnit) kpiIncomeUnit.textContent = currencySymbol;
    const kpiExpenseUnit = document.getElementById('kpiExpenseUnit');
    if (kpiExpenseUnit) kpiExpenseUnit.textContent = currencySymbol;

    // Split the bignum into "currency symbol prefix" / "integer with grouping" /
    // "decimal" parts via formatToParts so the prefix span shows the right
    // symbol ($ vs R$), the integer span has the locale's grouping
    // separators, and the decimal span carries the right separator (`.`
    // vs `,`).
    const netBalance = totals.netBalance;
    const netParts = currencyFmt2.formatToParts(Math.abs(netBalance));
    const intIdx = netParts.findIndex(p => p.type === 'integer');
    const decIdx = netParts.findIndex(p => p.type === 'decimal');
    const prefix = netParts.slice(0, intIdx >= 0 ? intIdx : netParts.length).map(p => p.value).join('');
    const integer = netParts
        .slice(intIdx >= 0 ? intIdx : 0, decIdx >= 0 ? decIdx : netParts.length)
        .filter(p => p.type === 'integer' || p.type === 'group')
        .map(p => p.value)
        .join('');
    const decimal = decIdx >= 0 ? netParts.slice(decIdx).map(p => p.value).join('') : '';
    heroInt.textContent = integer;

    const heroDec = document.getElementById('heroNetWorthDec');
    if (heroDec) heroDec.textContent = decimal;

    const heroPre = document.getElementById('heroNetWorthPre');
    if (heroPre) heroPre.textContent = (netBalance < 0 ? '−' : '') + prefix;

    // Group entries by year-month
    const byMonth = new Map();
    for (const e of entriesToShow) {
        const ym = (e.month || '').slice(0, 7); // expects "YYYY-MM" or "YYYY-MM-DD"
        if (!ym) continue;
        if (!byMonth.has(ym)) byMonth.set(ym, { income: 0, expense: 0 });
        const bucket = byMonth.get(ym);
        const amt = parseFloat(e.amount) || 0;
        if (e.type === 'income') bucket.income += amt;
        else if (e.type === 'expense') bucket.expense += amt;
    }
    const months = [...byMonth.keys()].sort();
    const last6 = months.slice(-6);
    const incomeSeries = last6.map(m => byMonth.get(m).income);
    const expenseSeries = last6.map(m => byMonth.get(m).expense);
    const savingSeries = last6.map(m => {
        const b = byMonth.get(m);
        return b.income > 0 ? Math.round(((b.income - b.expense) / b.income) * 100) : 0;
    });

    // Period label = latest month in view
    const heroPeriod = document.getElementById('heroPeriodLabel');
    if (heroPeriod) {
        const latest = months[months.length - 1];
        if (latest) {
            const [y, m] = latest.split('-');
            const dt = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
            // Reuses the function-scope `locale` derived from getLang() so a
            // Portuguese UI shows "ABRIL DE 2026" instead of "APRIL 2026".
            heroPeriod.textContent = dt.toLocaleString(locale, { month: 'long', year: 'numeric' }).toUpperCase();
        } else {
            heroPeriod.textContent = '—';
        }
    }

    // Net-worth MoM delta: compare the running cumulative net to the prior
    // month's running cumulative.
    let cumPrev = 0, cumLatest = 0;
    let running = 0;
    months.forEach((m, i) => {
        const b = byMonth.get(m);
        running += (b.income - b.expense);
        if (i === months.length - 2) cumPrev = running;
        if (i === months.length - 1) cumLatest = running;
    });
    if (months.length < 2) cumPrev = 0;
    const heroDelta = document.getElementById('heroDelta');
    const heroDeltaMeta = document.getElementById('heroDeltaMeta');
    if (heroDelta) {
        const change = cumLatest - cumPrev;
        if (months.length < 2 || cumPrev === 0 || !isFinite(cumPrev)) {
            // Percent-change off a zero baseline is undefined — show an em
            // dash instead of a misleading "▲ 0.0%".
            heroDelta.textContent = '—';
            heroDelta.classList.remove('up', 'down');
        } else {
            const pct = (change / Math.abs(cumPrev)) * 100;
            heroDelta.textContent = (change >= 0 ? '▲ ' : '▼ ') + Math.abs(pct).toFixed(1) + '%';
            heroDelta.classList.toggle('up', change >= 0);
            heroDelta.classList.toggle('down', change < 0);
        }
    }
    if (heroDeltaMeta) {
        const change = cumLatest - cumPrev;
        heroDeltaMeta.textContent = (months.length >= 2)
            ? `${fmtSigned(change)} ${t('dash.vsLastMonth')}`
            : '';
    }

    // KPI cards: current-month income / expense / saving rate, with MoM delta
    // and a 6-point sparkline.
    const latestM = byMonth.get(months[months.length - 1]) || { income: 0, expense: 0 };
    const prevM = byMonth.get(months[months.length - 2]) || { income: 0, expense: 0 };
    const setKpi = (idValue, idDelta, idSpark, value, prev, series, opts = {}) => {
        const valEl = document.getElementById(idValue);
        if (valEl) valEl.textContent = opts.percent ? Math.round(value).toString() : fmt(value);
        const deltaEl = document.getElementById(idDelta);
        if (deltaEl) {
            if (prev === 0 || !isFinite(prev)) {
                deltaEl.textContent = '—';
                deltaEl.classList.remove('up', 'down');
            } else {
                // For percent-valued KPIs (e.g. saving rate) the delta is a
                // point change, not a percent-of-percent. Showing the latter
                // would label e.g. 10% → 20% as "+100.0 pts" instead of +10.
                const delta = opts.percent ? (value - prev) : (((value - prev) / Math.abs(prev)) * 100);
                const isGood = opts.invert ? (value <= prev) : (value >= prev);
                deltaEl.textContent = (delta >= 0 ? '+' : '−') + Math.abs(delta).toFixed(1) + (opts.percent ? ' pts' : '%');
                deltaEl.classList.toggle('up', isGood);
                deltaEl.classList.toggle('down', !isGood);
            }
        }
        const sparkEl = document.getElementById(idSpark);
        if (sparkEl) sparkEl.innerHTML = renderSparkline(series, opts.color);
    };
    setKpi('kpiIncomeValue', 'kpiIncomeDelta', 'kpiIncomeSpark', latestM.income, prevM.income, incomeSeries, { color: 'var(--accent-1)' });
    setKpi('kpiExpenseValue', 'kpiExpenseDelta', 'kpiExpenseSpark', latestM.expense, prevM.expense, expenseSeries, { color: 'var(--primary)', invert: true });
    const latestRate = latestM.income > 0 ? ((latestM.income - latestM.expense) / latestM.income) * 100 : 0;
    const prevRate = prevM.income > 0 ? ((prevM.income - prevM.expense) / prevM.income) * 100 : 0;
    setKpi('kpiSavingValue', 'kpiSavingDelta', 'kpiSavingSpark', latestRate, prevRate, savingSeries, { color: 'var(--accent-2)', percent: true });
}

// Pure-SVG sparkline. Mirrors the shape used by the design prototype
// (charts.jsx Sparkline) but rendered as static HTML so we don't need a
// React runtime.
function renderSparkline(data, color) {
    if (!Array.isArray(data) || data.length < 2) {
        return '<svg viewBox="0 0 220 32" preserveAspectRatio="none" style="width:100%; height:32px;"></svg>';
    }
    const w = 220, h = 32;
    const max = Math.max(...data), min = Math.min(...data);
    const range = max - min || 1;
    const xs = (i) => (i / (data.length - 1)) * w;
    const ys = (v) => h - 3 - ((v - min) / range) * (h - 6);
    const pts = data.map((v, i) => [xs(i), ys(v)]);
    let d = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[i + 1];
        const cx = (x0 + x1) / 2;
        d += ` C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`;
    }
    // CSS variables (var(--…)) don't reliably resolve when set directly
    // on SVG presentation attributes (notably in Safari). Routing through
    // the `color` CSS property and using `currentColor` on the SVG nodes
    // works across browsers and still lets the sparkline reskin when the
    // theme palette changes.
    const safeColor = color || 'var(--primary)';
    const last = pts[pts.length - 1];
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%; height:32px; color:${safeColor};">
        <path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        <circle cx="${last[0]}" cy="${last[1]}" r="2.5" fill="currentColor" />
    </svg>`;
}

// --- Couple Expense Share Widget ---
function updateCoupleShare(entriesToShow) {
    const section = document.getElementById('coupleShareSection');
    if (!section) return;

    // Only show in combined view with a valid partner
    if (currentViewMode !== 'combined' || !hasPartner || !currentUser) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';

    // Calculate totals for each person (expenses only for fair split)
    const userExpenses = entriesToShow
        .filter(e => e.type === 'expense' && e.userId === currentUser.id)
        .reduce((sum, e) => sum + parseFloat(e.amount), 0);

    const partnerExpenses = entriesToShow
        .filter(e => e.type === 'expense' && e.userId === currentUser.partnerId)
        .reduce((sum, e) => sum + parseFloat(e.amount), 0);

    const totalExpenses = userExpenses + partnerExpenses;
    const userPercent = totalExpenses > 0 ? (userExpenses / totalExpenses) * 100 : 0;
    const partnerPercent = totalExpenses > 0 ? (partnerExpenses / totalExpenses) * 100 : 0;

    // Update names
    document.getElementById('coupleShareUserName').textContent = currentUser.username || 'You';
    document.getElementById('coupleSharePartnerName').textContent = currentUser.partnerUsername || 'Partner';

    // Update amounts
    document.getElementById('coupleShareUserAmount').textContent = `$${userExpenses.toFixed(2)}`;
    document.getElementById('coupleSharePartnerAmount').textContent = `$${partnerExpenses.toFixed(2)}`;

    // Update bars
    const userBar = document.getElementById('coupleShareUserBar');
    const partnerBar = document.getElementById('coupleSharePartnerBar');
    userBar.style.width = `${userPercent}%`;
    userBar.setAttribute('aria-valuenow', Math.round(userPercent));
    userBar.setAttribute('aria-label', `${currentUser.username || 'Your'} expense share`);
    partnerBar.style.width = `${partnerPercent}%`;
    partnerBar.setAttribute('aria-valuenow', Math.round(partnerPercent));
    partnerBar.setAttribute('aria-label', `${currentUser.partnerUsername || 'Partner'} expense share`);

    // Update percentages
    document.getElementById('coupleShareUserPercent').textContent = t('dash.ofTotal', { percent: userPercent.toFixed(1) });
    document.getElementById('coupleSharePartnerPercent').textContent = t('dash.ofTotal', { percent: partnerPercent.toFixed(1) });

    // Settlement calculation (50/50 split)
    const settlementEl = document.getElementById('coupleSettlementAmount');
    const directionEl = document.getElementById('coupleSettlementDirection');

    if (totalExpenses === 0) {
        settlementEl.textContent = t('dash.noExpenses');
        settlementEl.className = 'settlement-amount settlement-settled';
        settlementEl.style.color = '';
        directionEl.textContent = '';
    } else if (Math.abs(userExpenses - partnerExpenses) < 0.01) {
        settlementEl.textContent = t('dash.allSettled');
        settlementEl.className = 'settlement-amount settlement-settled';
        settlementEl.style.color = '';
        directionEl.textContent = t('dash.bothPaidEqually');
    } else {
        const overpayer = userExpenses > partnerExpenses ? currentUser.username : currentUser.partnerUsername;
        const underpayer = userExpenses > partnerExpenses ? currentUser.partnerUsername : currentUser.username;
        const owedAmount = Math.abs(userExpenses - partnerExpenses) / 2;

        settlementEl.textContent = `$${owedAmount.toFixed(2)}`;
        settlementEl.className = 'settlement-amount';
        settlementEl.style.color = '#f59e0b';
        directionEl.textContent = t('dash.owes', { underpayer: underpayer, overpayer: overpayer });
    }
}

// --- Bulk PDF Upload Modal Logic ---
const bulkUploadModal = document.getElementById('bulkUploadModal');
const openBulkUploadModalBtn = document.getElementById('openBulkUploadModal');
const closeBulkUploadModalBtn = document.getElementById('closeBulkUploadModal');
const bulkPdfUploadInput = document.getElementById('bulkPdfUpload');
const processBulkPdfBtn = document.getElementById('processBulkPdfBtn');
const bulkExtractedEntriesTbody = document.getElementById('bulkExtractedEntries');
const confirmBulkEntriesBtn = document.getElementById('confirmBulkEntriesBtn');
const loadingIndicator = document.getElementById('loadingIndicator');

let bulkExtractedEntries = [];

// --- AI Key/Provider UI Management ---
function updateAiKeyUI() {
    const statusDiv = document.getElementById('aiKeyStatus');
    if (!statusDiv) return;

    const provider = currentUser && currentUser.aiProvider || 'gemini';
    const hasUserKey = provider === 'openai'
        ? (currentUser && currentUser.hasOpenaiApiKey)
        : provider === 'anthropic'
        ? (currentUser && (currentUser.hasAnthropicApiKey || currentUser.hasClaudeOauthToken))
        : provider === 'copilot'
        ? (currentUser && currentUser.hasGithubCopilotToken)
        : (currentUser && currentUser.hasGeminiApiKey);
    const hasKey = provider === 'openai'
        ? (currentUser && currentUser.hasOpenaiKeyAvailable)
        : provider === 'anthropic'
        ? (currentUser && currentUser.hasAnthropicKeyAvailable)
        : provider === 'copilot'
        ? (currentUser && currentUser.hasCopilotKeyAvailable)
        : (currentUser && currentUser.hasGeminiKeyAvailable);

    if (hasUserKey) {
        statusDiv.innerHTML = `<span style="color: var(--color-success);">&#10003;</span> <span style="color: var(--color-success);">${t('bulk.keyStored')}</span>`;
    } else if (hasKey) {
        statusDiv.innerHTML = `<span style="color: var(--color-success);">&#10003;</span> <span style="color: var(--color-success);">${t('bulk.keyConfigured')}</span>`;
    } else {
        statusDiv.innerHTML = `<span style="color: var(--color-text-muted);">${t('bulk.keyRequired')}</span>`;
    }
}

openBulkUploadModalBtn.addEventListener('click', () => {
    bulkUploadModal.style.display = 'block';
    bulkExtractedEntriesTbody.innerHTML = '';
    confirmBulkEntriesBtn.style.display = 'none';
    loadingIndicator.style.display = 'none';
    bulkPdfUploadInput.value = '';
    bulkExtractedEntries = [];
    // Show/hide Couple column header based on partner status
    const bulkCoupleHeader = document.getElementById('bulkCoupleHeader');
    if (bulkCoupleHeader) {
        bulkCoupleHeader.style.display = hasPartner ? '' : 'none';
    }
    updateAiKeyUI();
});

closeBulkUploadModalBtn.addEventListener('click', () => {
    bulkUploadModal.style.display = 'none';
});

// ============ Manage Categories modal (issue #70) ============
const manageCategoriesModal = document.getElementById('manageCategoriesModal');
const manageCategoriesBtn = document.getElementById('manageCategoriesBtn');
const closeManageCategoriesModalBtn = document.getElementById('closeManageCategoriesModal');
const categoryListBody = document.getElementById('categoryListBody');
const newCategorySlugInput = document.getElementById('newCategorySlug');
const newCategoryLabelInput = document.getElementById('newCategoryLabel');
const newCategoryColorInput = document.getElementById('newCategoryColor');
const addCategoryBtn = document.getElementById('addCategoryBtn');
const resetCategoriesBtn = document.getElementById('resetCategoriesBtn');
const categoryFormError = document.getElementById('categoryFormError');
const categoryCapNote = document.getElementById('categoryCapNote');

// Mirrors db.MAX_CATEGORIES_PER_USER on the server. Kept in sync manually
// — the server is the source of truth (POST /api/categories returns 409
// regardless), so a stale FE value is degraded UX, never a security gap.
const MAX_CATEGORIES_PER_USER_FE = 100;

function setCatFormError(msg) {
    if (categoryFormError) categoryFormError.textContent = msg || '';
}

// Reflect the per-user cap in the manage modal: disable the Add button +
// inputs when at/over cap, and show a small inline note. Called from
// renderCategoryManageList so the state stays in sync with userCategories.
function updateCategoryCapState() {
    if (!addCategoryBtn || !categoryCapNote) return;
    const used = userCategories.length;
    const atCap = used >= MAX_CATEGORIES_PER_USER_FE;
    addCategoryBtn.disabled = atCap;
    if (newCategorySlugInput) newCategorySlugInput.disabled = atCap;
    if (newCategoryLabelInput) newCategoryLabelInput.disabled = atCap;
    if (newCategoryColorInput) newCategoryColorInput.disabled = atCap;
    if (atCap) {
        categoryCapNote.textContent = t('category.capReached', {
            used: String(used),
            max: String(MAX_CATEGORIES_PER_USER_FE)
        });
        categoryCapNote.hidden = false;
    } else {
        categoryCapNote.textContent = '';
        categoryCapNote.hidden = true;
    }
}

function renderCategoryManageList() {
    if (!categoryListBody) return;
    updateCategoryCapState();
    categoryListBody.innerHTML = '';
    if (userCategories.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="4" style="text-align:center; color: var(--color-text-secondary); padding: 1rem;">${escapeHtml(t('category.empty') || 'No categories yet.')}</td>`;
        categoryListBody.appendChild(tr);
        return;
    }
    userCategories.forEach(cat => {
        const tr = document.createElement('tr');
        const colorCell = document.createElement('td');
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = cat.color;
        colorInput.addEventListener('change', async () => {
            const v = colorInput.value;
            if (!HEX_REGEX_FE.test(v)) return;
            try {
                const res = await csrfFetch('/api/categories/' + encodeURIComponent(cat.slug), {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ color: v.toLowerCase() })
                });
                if (res.ok) {
                    await loadUserCategories();
                    renderCategoryManageList();
                    renderCategoryChips();
                    syncHiddenCategorySelect();
                    filterEntries({ resetPage: false });
                }
            } catch (e) { console.error(e); }
        });
        colorCell.appendChild(colorInput);
        tr.appendChild(colorCell);

        const labelCell = document.createElement('td');
        if (cat.isDefault) {
            labelCell.textContent = categoryLabel(cat.slug);
            const tag = document.createElement('span');
            tag.className = 'cat-row-default-badge';
            tag.textContent = '(' + (t('category.defaultBadge') || 'default') + ')';
            labelCell.appendChild(tag);
        } else {
            const labelInput = document.createElement('input');
            labelInput.type = 'text';
            labelInput.value = cat.label;
            labelInput.maxLength = 60;
            labelInput.addEventListener('change', async () => {
                const v = labelInput.value.trim();
                if (!v) { labelInput.value = cat.label; return; }
                try {
                    const res = await csrfFetch('/api/categories/' + encodeURIComponent(cat.slug), {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ label: v })
                    });
                    if (res.ok) {
                        await loadUserCategories();
                        renderCategoryManageList();
                        renderCategoryChips();
                        syncHiddenCategorySelect();
                        filterEntries({ resetPage: false });
                    }
                } catch (e) { console.error(e); }
            });
            labelCell.appendChild(labelInput);
            if (cat.importedFromUserId != null) {
                const imp = document.createElement('span');
                imp.className = 'cat-row-imported-badge';
                imp.textContent = '(' + (t('category.imported') || 'imported') + ')';
                imp.title = t('category.importedTooltip') || 'Imported from your partner';
                labelCell.appendChild(imp);
            }
        }
        tr.appendChild(labelCell);

        const slugCell = document.createElement('td');
        slugCell.textContent = cat.slug;
        slugCell.style.fontFamily = 'monospace';
        slugCell.style.color = 'var(--color-text-secondary)';
        tr.appendChild(slugCell);

        const actionsCell = document.createElement('td');
        actionsCell.style.textAlign = 'right';
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'cat-delete-btn';
        delBtn.textContent = t('common.delete') || 'Delete';
        delBtn.addEventListener('click', async () => {
            const confirmMsg = (t('category.deleteConfirm') || 'Delete this category? Existing entries keep the tag but render as orphans.').replace('{slug}', cat.slug);
            if (!confirm(confirmMsg)) return;
            try {
                const res = await csrfFetch('/api/categories/' + encodeURIComponent(cat.slug), { method: 'DELETE' });
                if (res.ok) {
                    await loadUserCategories();
                    renderCategoryManageList();
                    renderCategoryChips();
                    syncHiddenCategorySelect();
                    filterEntries({ resetPage: false });
                }
            } catch (e) { console.error(e); }
        });
        actionsCell.appendChild(delBtn);
        tr.appendChild(actionsCell);

        categoryListBody.appendChild(tr);
    });
}

function closeManageCategoriesModal() {
    if (manageCategoriesModal) manageCategoriesModal.style.display = 'none';
}

function openManageCategoriesModal() {
    setCatFormError('');
    if (newCategorySlugInput) newCategorySlugInput.value = '';
    if (newCategoryLabelInput) newCategoryLabelInput.value = '';
    if (newCategoryColorInput) newCategoryColorInput.value = '#94a3b8';
    renderCategoryManageList();
    if (manageCategoriesModal) {
        manageCategoriesModal.style.display = 'block';
        // Move keyboard focus into the modal for accessibility — slug input
        // is the most likely first interaction.
        if (newCategorySlugInput) {
            requestAnimationFrame(() => { try { newCategorySlugInput.focus(); } catch (_) {} });
        }
    }
}

if (manageCategoriesBtn) {
    manageCategoriesBtn.addEventListener('click', openManageCategoriesModal);
}
if (closeManageCategoriesModalBtn) {
    closeManageCategoriesModalBtn.addEventListener('click', closeManageCategoriesModal);
    // The close control is a <span role="button">, so keyboard users need
    // explicit Enter/Space handling (matches the bulk-duplicate modal).
    closeManageCategoriesModalBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            closeManageCategoriesModal();
        }
    });
}
if (manageCategoriesModal) {
    manageCategoriesModal.addEventListener('click', (e) => {
        if (e.target === manageCategoriesModal) closeManageCategoriesModal();
    });
    // Escape-to-close while the modal is visible.
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && manageCategoriesModal.style.display !== 'none' && manageCategoriesModal.style.display !== '') {
            closeManageCategoriesModal();
        }
    });
}

if (addCategoryBtn) {
    addCategoryBtn.addEventListener('click', async () => {
        setCatFormError('');
        const slug = (newCategorySlugInput.value || '').trim().toLowerCase();
        const label = (newCategoryLabelInput.value || '').trim();
        const color = (newCategoryColorInput.value || '#94a3b8').toLowerCase();
        if (!SLUG_REGEX_FE.test(slug)) {
            setCatFormError(t('category.invalidSlug') || 'Slug must be lowercase letters/digits/hyphens, starting with a letter or digit.');
            return;
        }
        if (!label) {
            setCatFormError(t('category.labelRequired') || 'Label is required.');
            return;
        }
        if (!HEX_REGEX_FE.test(color)) {
            setCatFormError(t('category.invalidColor') || 'Color must be a 6-digit hex value.');
            return;
        }
        if (_userCategoriesBySlug.has(slug)) {
            setCatFormError(t('category.duplicateSlug') || 'A category with that slug already exists.');
            return;
        }
        try {
            const res = await csrfFetch('/api/categories', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ slug, label, color })
            });
            if (!res.ok) {
                let msg = t('category.addFailed') || 'Failed to add category.';
                try { const body = await res.json(); if (body && (body.message || body.error)) msg = body.message || body.error; } catch {}
                // Refresh local state so the cap note + button-disabled state
                // reflect any concurrent mutation that caused the 409 (e.g.
                // a partner import pushed us past the cap between the modal
                // opening and the click).
                if (res.status === 409) {
                    await loadUserCategories();
                    renderCategoryManageList();
                }
                setCatFormError(msg);
                return;
            }
            await loadUserCategories();
            renderCategoryManageList();
            renderCategoryChips();
            syncHiddenCategorySelect();
            filterEntries({ resetPage: false });
            newCategorySlugInput.value = '';
            newCategoryLabelInput.value = '';
        } catch (e) {
            console.error(e);
            setCatFormError(t('category.addFailed') || 'Failed to add category.');
        }
    });
}

if (resetCategoriesBtn) {
    resetCategoriesBtn.addEventListener('click', async () => {
        if (!confirm(t('category.resetConfirm') || 'Restore the default categories? Your custom categories will be kept.')) return;
        try {
            const res = await csrfFetch('/api/categories/reset-defaults', { method: 'POST' });
            if (res.ok) {
                await loadUserCategories();
                renderCategoryManageList();
                renderCategoryChips();
                syncHiddenCategorySelect();
                filterEntries({ resetPage: false });
            } else if (res.status === 409) {
                // Restoring would push the user past the cap (deleted defaults
                // can't fit). Surface the server's message in the same inline
                // error area used by Add, and refresh local state so the cap
                // note reflects current usage.
                const resetFailedKey = 'category.resetFailed';
                const resetFailedText = t(resetFailedKey);
                let msg = resetFailedText === resetFailedKey ? 'Could not restore defaults.' : resetFailedText;
                try { const body = await res.json(); if (body && body.message) msg = body.message; } catch {}
                await loadUserCategories();
                renderCategoryManageList();
                setCatFormError(msg);
            }
        } catch (e) { console.error(e); }
    });
}
// ============ end Manage Categories modal ============

function generateCategorySelect(selectedTag, index) {
    // Source the option list from the user's current category list. If the
    // selected tag isn't in the list (orphan / partner-only tag from the
    // PDF parser), include it as an extra option so the user can keep it.
    const slugs = categorySlugList();
    const opts = [...slugs];
    if (selectedTag && !opts.includes(selectedTag)) opts.push(selectedTag);
    const options = opts.map(cat =>
        `<option value="${escapeHtml(cat)}"${cat === selectedTag ? ' selected' : ''}>${escapeHtml(categoryLabel(cat))}</option>`
    ).join('');
    return `<select class="preview-select category-select" data-index="${index}">${options}</select>`;
}

function generateTypeSelect(selectedType, index) {
    return `<select class="preview-select type-select" data-index="${index}">
        <option value="expense"${selectedType === 'expense' ? ' selected' : ''}>${t('type.expense')}</option>
        <option value="income"${selectedType === 'income' ? ' selected' : ''}>${t('type.income')}</option>
    </select>`;
}

processBulkPdfBtn.addEventListener('click', async () => {
    const pdfFile = bulkPdfUploadInput.files[0];
    if (!pdfFile) {
        alert(t('bulk.alertSelectPdf'));
        return;
    }

    if (pdfFile.size > 10 * 1024 * 1024) {
        alert(t('bulk.alertTooLarge'));
        return;
    }

    // Validate that an AI API key is configured for the selected provider
    const provider = currentUser && currentUser.aiProvider || 'gemini';
    const hasKey = provider === 'openai'
        ? (currentUser && currentUser.hasOpenaiKeyAvailable)
        : provider === 'anthropic'
        ? (currentUser && currentUser.hasAnthropicKeyAvailable)
        : provider === 'copilot'
        ? (currentUser && currentUser.hasCopilotKeyAvailable)
        : (currentUser && currentUser.hasGeminiKeyAvailable);
    if (!currentUser || !hasKey) {
        alert(t('bulk.alertEnterKey'));
        return;
    }

    // Show loading indicator
    loadingIndicator.style.display = 'block';
    setButtonLoading(processBulkPdfBtn, true);

    const formData = new FormData();
    formData.append('pdfFile', pdfFile);
    try {
        const response = await csrfFetch('/api/process-pdf', {
            method: 'POST',
            body: formData
        });
        if (response.ok) {
            const batchEntries = await response.json();
            const validEntries = batchEntries.filter(exp => exp && exp.month && exp.amount && exp.description);
            bulkExtractedEntries = validEntries.map(exp => ({
                ...exp,
                type: exp.type || 'expense',
                tags: exp.tags || [],
                isCoupleExpense: false
            }));
            // Preview in table with editable dropdowns
            renderBulkPreviewTable();
        } else {
            let errorMsg = response.statusText;
            try {
                const errorData = await response.json();
                errorMsg = errorData.message || errorMsg;
            } catch { /* ignore parse errors */ }
            alert(t('bulk.errorProcess', { message: errorMsg }));
        }
    } catch (error) {
        alert(t('bulk.errorFailed'));
        console.error(error);
    } finally {
        // Hide loading indicator and reset button
        loadingIndicator.style.display = 'none';
        setButtonLoading(processBulkPdfBtn, false);
    }
});

// Helper function to escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Helper function to validate month format (YYYY-MM)
function isValidMonthFormat(month) {
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

// Helper function to save entry from edit mode
function saveEntryFromEdit(index, row) {
    const month = row.querySelector('.bulk-edit-month').value;
    const amount = row.querySelector('.bulk-edit-amount').value;
    const description = row.querySelector('.bulk-edit-description').value.trim();
    const parsedAmount = parseFloat(amount);

    // Validate month format
    if (!isValidMonthFormat(month)) {
        alert(t('bulk.alertValidMonth'));
        return false;
    }

    // Validate amount is a positive number
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
        alert(t('bulk.alertValidAmount'));
        return false;
    }

    // Validate description is not empty after trimming
    if (!description) {
        alert(t('bulk.alertEnterDesc'));
        return false;
    }

    bulkExtractedEntries[index].month = month;
    bulkExtractedEntries[index].amount = parsedAmount;
    bulkExtractedEntries[index].description = description;
    delete bulkExtractedEntries[index].isEditing;
    delete bulkExtractedEntries[index].originalValues;
    renderBulkPreviewTable();
    return true;
}

// Helper function to cancel entry edit and restore original values
function cancelEntryEdit(index) {
    const entry = bulkExtractedEntries[index];
    if (entry.originalValues) {
        entry.month = entry.originalValues.month;
        entry.amount = entry.originalValues.amount;
        entry.description = entry.originalValues.description;
        entry.type = entry.originalValues.type;
        entry.tags = entry.originalValues.tags;
        delete entry.originalValues;
    }
    delete entry.isEditing;
    renderBulkPreviewTable();
}

// Render the bulk preview table
function renderBulkPreviewTable() {
    bulkExtractedEntriesTbody.innerHTML = '';
    if (bulkExtractedEntries.length > 0) {
        bulkExtractedEntries.forEach((entry, index) => {
            const currentTag = (entry.tags && entry.tags[0]) || 'other';
            const currentType = entry.type || 'expense';
            const row = document.createElement('tr');
            row.dataset.index = index;

            // Escape all user-provided values to prevent XSS
            const escapedMonth = escapeHtml(entry.month);
            const escapedDescription = escapeHtml(entry.description);
            const escapedType = escapeHtml(currentType);
            const escapedTag = escapeHtml(currentTag);

            // Couple checkbox cell (only shown if user has partner)
            const coupleCell = hasPartner
                ? `<td><input type="checkbox" class="bulk-couple-check" data-index="${index}" ${entry.isCoupleExpense ? 'checked' : ''}></td>`
                : '';
            // Empty cell for couple column in edit mode
            const coupleCellEdit = hasPartner ? '<td></td>' : '';

            if (entry.isEditing) {
                // Editing mode - show input fields with type/category as read-only
                row.innerHTML = `
                    <td><input type="month" class="bulk-edit-input bulk-edit-month" value="${escapedMonth}" aria-label="Month for entry ${index + 1}"></td>
                    <td>${escapedType}</td>
                    <td><input type="number" class="bulk-edit-input bulk-edit-input--amount bulk-edit-amount" value="${parseFloat(entry.amount).toFixed(2)}" step="0.01" min="0.01" aria-label="Amount for entry ${index + 1}"></td>
                    <td><input type="text" class="bulk-edit-input bulk-edit-description" value="${escapedDescription}" aria-label="Description for entry ${index + 1}"></td>
                    <td>${escapedTag}</td>
                    ${coupleCellEdit}
                    <td>
                        <button class="bulk-action-btn bulk-action-btn--save bulk-save-btn" data-index="${index}" aria-label="Save changes to entry: ${escapedDescription}">${t('common.save')}</button>
                        <button class="bulk-action-btn bulk-action-btn--cancel bulk-cancel-btn" data-index="${index}" aria-label="Cancel editing entry: ${escapedDescription}">${t('common.cancel')}</button>
                    </td>
                `;
            } else {
                // View mode - show values with edit/delete buttons
                row.innerHTML = `
                    <td>${escapedMonth}</td>
                    <td>${generateTypeSelect(currentType, index)}</td>
                    <td>$${parseFloat(entry.amount).toFixed(2)}</td>
                    <td>${escapedDescription}</td>
                    <td>${generateCategorySelect(currentTag, index)}</td>
                    ${coupleCell}
                    <td>
                        <button class="bulk-action-btn bulk-action-btn--edit bulk-edit-btn" data-index="${index}" aria-label="Edit entry: ${escapedDescription}">${t('common.edit')}</button>
                        <button class="bulk-action-btn bulk-action-btn--delete bulk-delete-btn" data-index="${index}" aria-label="Delete entry: ${escapedDescription}">${t('common.delete')}</button>
                    </td>
                `;
            }
            bulkExtractedEntriesTbody.appendChild(row);
        });

        // Add event listeners for dropdown changes (only in view mode)
        document.querySelectorAll('.category-select').forEach(select => {
            select.addEventListener('change', (e) => {
                const index = parseInt(e.target.dataset.index);
                bulkExtractedEntries[index].tags = [e.target.value];
            });
        });

        document.querySelectorAll('.type-select').forEach(select => {
            select.addEventListener('change', (e) => {
                const index = parseInt(e.target.dataset.index);
                bulkExtractedEntries[index].type = e.target.value;
            });
        });

        // Add event listeners for couple checkboxes (only if user has partner)
        document.querySelectorAll('.bulk-couple-check').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const index = parseInt(e.target.dataset.index);
                bulkExtractedEntries[index].isCoupleExpense = e.target.checked;
            });
        });

        // Add event listeners for edit buttons
        document.querySelectorAll('.bulk-edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.target.dataset.index);
                const entry = bulkExtractedEntries[index];

                // Ensure only one entry is in edit mode at a time
                bulkExtractedEntries.forEach((e, i) => {
                    if (i !== index && e.isEditing) {
                        cancelEntryEdit(i);
                    }
                });

                // Store original values for cancel functionality
                entry.originalValues = {
                    month: entry.month,
                    amount: entry.amount,
                    description: entry.description,
                    type: entry.type || 'expense',
                    tags: entry.tags ? [...entry.tags] : ['other']
                };
                entry.isEditing = true;
                renderBulkPreviewTable();
            });
        });

        // Add event listeners for delete buttons
        document.querySelectorAll('.bulk-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.target.dataset.index);
                if (confirm(t('bulk.confirmDelete'))) {
                    bulkExtractedEntries.splice(index, 1);
                    renderBulkPreviewTable();
                }
            });
        });

        // Add event listeners for save buttons (edit mode)
        document.querySelectorAll('.bulk-save-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.target.dataset.index);
                const row = e.target.closest('tr');
                saveEntryFromEdit(index, row);
            });
        });

        // Add event listeners for cancel buttons (edit mode)
        document.querySelectorAll('.bulk-cancel-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.target.dataset.index);
                cancelEntryEdit(index);
            });
        });

        // Add keyboard event listeners for edit mode inputs (Enter to save, Escape to cancel)
        document.querySelectorAll('.bulk-edit-input').forEach(input => {
            input.addEventListener('keydown', (e) => {
                const row = e.target.closest('tr');
                const index = parseInt(row.dataset.index);

                if (e.key === 'Enter') {
                    e.preventDefault();
                    saveEntryFromEdit(index, row);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelEntryEdit(index);
                }
            });
        });

        confirmBulkEntriesBtn.style.display = 'inline-block';
    } else {
        const colspan = hasPartner ? 7 : 6;
        bulkExtractedEntriesTbody.innerHTML = `<tr><td colspan="${colspan}">${t('bulk.noEntries')}</td></tr>`;
        confirmBulkEntriesBtn.style.display = 'none';
    }
}

// ── Bulk upload duplicate detection ──
// Walks the user through a confirmation modal for each candidate that the
// server reports as a duplicate (same month + type + amount + case-insensitive
// trimmed description). User can Skip / Add anyway, or apply Skip-all /
// Add-all for the remaining duplicates. Returns the indices to drop.
//
// Non-blocking inline notice shown inside the bulk upload modal when the
// duplicate-check round-trip fails — better UX than alert() because it
// doesn't interrupt the flow, the user can still confirm the entries.
function showBulkUploadBanner(message) {
    const modalContent = document.querySelector('#bulkUploadModal .modal-content');
    if (!modalContent) return;
    let banner = document.getElementById('bulkUploadBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'bulkUploadBanner';
        banner.setAttribute('role', 'status');
        banner.setAttribute('aria-live', 'polite');
        banner.style.cssText = 'padding: 0.75rem 1rem; margin: 0.75rem 0; border-radius: var(--radius-md); border: 1px solid var(--color-warning, #b45309); background: rgba(180, 83, 9, 0.1); color: var(--color-text-primary); font-size: 0.85rem;';
        // Insert above the preview heading if present, else append.
        const previewHeading = modalContent.querySelector('h3');
        if (previewHeading) modalContent.insertBefore(banner, previewHeading);
        else modalContent.appendChild(banner);
    }
    banner.textContent = message;
    if (banner._dismissTimer) clearTimeout(banner._dismissTimer);
    banner._dismissTimer = setTimeout(() => {
        if (banner.parentNode) banner.parentNode.removeChild(banner);
    }, 6000);
}

async function resolveBulkDuplicates(candidates) {
    let duplicates;
    try {
        const resp = await csrfFetch('/api/entries/check-duplicates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entries: candidates })
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        duplicates = (data.results || []).filter(r => r && r.duplicate);
    } catch (err) {
        console.warn('Duplicate check failed, proceeding without it:', err);
        showBulkUploadBanner(t('bulk.dup.checkFailed'));
        return new Set();
    }

    if (duplicates.length === 0) return new Set();

    const modal = document.getElementById('bulkDuplicateModal');
    const candidateBox = document.getElementById('bulkDuplicateCandidate');
    const existingBox = document.getElementById('bulkDuplicateExisting');
    const progress = document.getElementById('bulkDuplicateProgress');
    const skipBtn = document.getElementById('bulkDupSkipBtn');
    const addBtn = document.getElementById('bulkDupAddBtn');
    const skipAllBtn = document.getElementById('bulkDupSkipAllBtn');
    const addAllBtn = document.getElementById('bulkDupAddAllBtn');

    // Decimal-safe round-half-away-from-zero to 2dp on the string form,
    // mirroring Postgres NUMERIC `ROUND(x, 2)` semantics. Avoids the
    // parseFloat→toFixed IEEE-754 trap (e.g. "1.005" → "1.00" with toFixed
    // but "1.01" with Postgres ROUND), so the modal shows the exact value
    // that the duplicate check used and that NUMERIC(15,2) would store.
    const fmtAmount = (a) => {
        if (a == null) return '';
        const s = String(a).trim();
        const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
        if (!m) {
            const n = parseFloat(s);
            return Number.isFinite(n) ? n.toFixed(2) : s;
        }
        const sign = m[1] || '';
        const intPart = m[2];
        const frac = m[3] || '';
        if (frac.length <= 2) {
            return sign + intPart + '.' + (frac + '00').slice(0, 2);
        }
        const head = frac.slice(0, 2);
        const next = frac.charCodeAt(2) - 48; // ASCII '0'
        if (next < 5) return sign + intPart + '.' + head;
        // round up: increment the 2dp number with carry propagation
        const arr = (intPart + head).split('');
        let i = arr.length - 1;
        let carry = 1;
        while (carry && i >= 0) {
            const d = arr[i].charCodeAt(0) - 48 + carry;
            arr[i] = String(d % 10);
            carry = d >= 10 ? 1 : 0;
            i--;
        }
        if (carry) arr.unshift('1');
        const out = arr.join('');
        return sign + out.slice(0, out.length - 2) + '.' + out.slice(out.length - 2);
    };
    const renderEntry = (e) => {
        const tag = (e.tags && e.tags[0]) || 'other';
        const typeLabel = e.type === 'income' ? t('type.income') : t('type.expense');
        const couple = e.isCoupleExpense ? t('bulk.dup.yes') : t('bulk.dup.no');
        return `
            <div><strong>${t('bulk.dup.fieldMonth')}:</strong> ${escapeHtml(e.month || '')}</div>
            <div><strong>${t('bulk.dup.fieldType')}:</strong> ${escapeHtml(typeLabel)}</div>
            <div><strong>${t('bulk.dup.fieldAmount')}:</strong> ${escapeHtml(fmtAmount(e.amount))}</div>
            <div><strong>${t('bulk.dup.fieldDescription')}:</strong> ${escapeHtml(e.description || '')}</div>
            <div><strong>${t('bulk.dup.fieldCategory')}:</strong> ${escapeHtml(categoryLabel(tag))}</div>
            <div><strong>${t('bulk.dup.fieldCouple')}:</strong> ${escapeHtml(couple)}</div>
        `;
    };

    const drop = new Set();
    let bulkChoice = null; // 'skipAll' | 'addAll' | null
    const closeBtn = document.getElementById('closeBulkDuplicateModal');

    for (let i = 0; i < duplicates.length; i++) {
        const { index, duplicate } = duplicates[i];
        if (bulkChoice === 'skipAll') { drop.add(index); continue; }
        if (bulkChoice === 'addAll') { continue; }

        const candidate = candidates[index];
        candidateBox.innerHTML = renderEntry(candidate);
        existingBox.innerHTML = renderEntry(duplicate);
        progress.textContent = t('bulk.dup.progress', { current: i + 1, total: duplicates.length });
        modal.style.display = 'block';
        // Move focus into the modal so keyboard users land on an actionable
        // control (mirrors the focus behavior of openModal()).
        setTimeout(() => { try { skipBtn.focus(); } catch (_) { /* noop */ } }, 0);

        const choice = await new Promise((resolve) => {
            const cleanup = () => {
                skipBtn.removeEventListener('click', onSkip);
                addBtn.removeEventListener('click', onAdd);
                skipAllBtn.removeEventListener('click', onSkipAll);
                addAllBtn.removeEventListener('click', onAddAll);
                if (closeBtn) {
                    closeBtn.removeEventListener('click', onClose);
                    closeBtn.removeEventListener('keydown', onCloseKey);
                }
                document.removeEventListener('keydown', onEscape, true);
            };
            const onSkip = () => { cleanup(); resolve('skip'); };
            const onAdd = () => { cleanup(); resolve('add'); };
            const onSkipAll = () => { cleanup(); resolve('skipAll'); };
            const onAddAll = () => { cleanup(); resolve('addAll'); };
            // Dismissing the modal (close X / Escape) is treated as "skip all"
            // — cancel the rest of the duplicate workflow without saving any
            // of the still-pending duplicate candidates.
            const onClose = () => { cleanup(); resolve('skipAll'); };
            const onCloseKey = (ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onClose(); }
            };
            const onEscape = (ev) => {
                if (ev.key === 'Escape' && modal.style.display !== 'none') {
                    ev.stopPropagation();
                    onClose();
                }
            };
            skipBtn.addEventListener('click', onSkip);
            addBtn.addEventListener('click', onAdd);
            skipAllBtn.addEventListener('click', onSkipAll);
            addAllBtn.addEventListener('click', onAddAll);
            if (closeBtn) {
                closeBtn.addEventListener('click', onClose);
                closeBtn.addEventListener('keydown', onCloseKey);
            }
            // Capture so we beat the global Escape handler that otherwise
            // would close the (unrelated) Add Entry modal.
            document.addEventListener('keydown', onEscape, true);
        });

        modal.style.display = 'none';

        if (choice === 'skip') drop.add(index);
        else if (choice === 'skipAll') { drop.add(index); bulkChoice = 'skipAll'; }
        else if (choice === 'addAll') { bulkChoice = 'addAll'; }
        // 'add' — keep as-is
    }

    return drop;
}

confirmBulkEntriesBtn.addEventListener('click', async () => {
    if (bulkExtractedEntries.length > 0) {
        // This button updates its own textContent mid-flight ("Saving 1/N",
        // "Saving 2/N", …) — that progress text IS the loading feedback,
        // so we deliberately don't add the .loading class here (it would
        // hide the text via `color: transparent`). Just disabling and
        // letting the per-iteration text update do the work.
        const originalText = confirmBulkEntriesBtn.textContent;
        confirmBulkEntriesBtn.disabled = true;
        try {
            // Pre-flight duplicate detection — user confirms per duplicate.
            const candidates = bulkExtractedEntries.map(e => ({
                month: e.month,
                type: e.type || 'expense',
                amount: e.amount,
                description: e.description,
                tags: Array.isArray(e.tags) ? e.tags.slice() : [],
                isCoupleExpense: !!e.isCoupleExpense
            }));
            const skipIndices = await resolveBulkDuplicates(candidates);
            const toSave = bulkExtractedEntries.filter((_, i) => !skipIndices.has(i));
            const skippedCount = skipIndices.size;

            if (toSave.length === 0) {
                bulkUploadModal.style.display = 'none';
                if (skippedCount > 0) {
                    alert(t('bulk.dup.skippedSummary', { skipped: skippedCount }));
                }
                return;
            }

            // Save each entry sequentially to avoid overwhelming the DB pool
            const savedEntries = [];
            const total = toSave.length;
            for (const entry of toSave) {
                confirmBulkEntriesBtn.textContent = t('bulk.saving', { current: savedEntries.length + 1, total });
                const response = await csrfFetch('/api/entries', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        month: entry.month,
                        type: entry.type || 'expense',
                        amount: entry.amount,
                        description: entry.description,
                        tags: entry.tags || [],
                        isCoupleExpense: entry.isCoupleExpense || false
                    })
                });

                if (!response.ok) {
                    throw new Error(`Failed to save entry ${savedEntries.length + 1}/${total}: ${response.statusText}`);
                }

                savedEntries.push(await response.json());
            }

            // Reload entries from server to ensure view mode filtering is applied correctly
            await window.loadEntries();

            // Close modal and show success message
            bulkUploadModal.style.display = 'none';
            const baseMsg = t('bulk.successAdd', { count: savedEntries.length });
            const summary = skippedCount > 0
                ? `${baseMsg}\n${t('bulk.dup.skippedSummary', { skipped: skippedCount })}`
                : baseMsg;
            alert(summary);

        } catch (error) {
            console.error('Error saving bulk entries:', error);
            alert(t('bulk.errorSave', { message: error.message }));
        } finally {
            confirmBulkEntriesBtn.disabled = false;
            confirmBulkEntriesBtn.textContent = originalText;
        }
    }
});

// Optional: Close modal when clicking outside content
window.addEventListener('click', (event) => {
    if (event.target === bulkUploadModal) {
        bulkUploadModal.style.display = 'none';
    }
});

// --- Modal/Form Robust Handling ---
function closeModal() {
    const modal = document.getElementById('entryModal');
    modal.style.display = 'none';
}

function openModal() {
    const modal = document.getElementById('entryModal');
    const form = document.getElementById('entryForm');
    form.reset();
    // Reset couple expense checkbox
    const isCoupleExpenseCheckbox = document.getElementById('isCoupleExpense');
    if (isCoupleExpenseCheckbox) {
        isCoupleExpenseCheckbox.checked = false;
    }
    modal.style.display = 'block';
    // Focus first input
    setTimeout(() => {
        const firstInput = form.querySelector('input,select,textarea');
        if (firstInput) firstInput.focus();
    }, 100);
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    initializeCharts();

    // Restore any persisted filter state before loading data (uses 'anon' key
    // until fetchCurrentUser populates currentUser, at which point setViewMode
    // will re-apply with the user-scoped key).
    const persisted = loadFilterState();
    if (persisted) filterState = persisted;
    applyFilterStateToDOM();

    // Load entries from server
    setViewLoading(true);
    fetch('/api/entries')
        .then(response => response.json())
        .then(data => {
            entries = data;
            // Initialize currentFilteredEntries via filterEntries so the
            // persisted filter state is honoured on first paint.
            filterEntries();
            renderActiveFiltersBar();
        })
        .catch(error => console.error('Error loading entries:', error))
        .finally(() => setViewLoading(false));

    // Remove any previous event listeners to avoid duplicates
    const oldForm = document.getElementById('entryForm');
    const newForm = oldForm.cloneNode(true);
    oldForm.parentNode.replaceChild(newForm, oldForm);
    // Attach robust submit handler
    newForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = newForm.querySelector('button[type="submit"]');
        setButtonLoading(submitBtn, true);

        // --- Manual Entry Logic ---
        let rawAmount = document.getElementById('amount').value;
        let amountValue = rawAmount.replace(/\s/g, '').replace(/,/g, '.');
        // Remove thousands separators (dots not followed by digits)
        amountValue = amountValue.replace(/(\.(?=\d{3}(\.|$)))/g, '');
        const parsedAmount = parseFloat(amountValue);
        if (isNaN(parsedAmount) || amountValue.trim() === '') {
            alert(t('entry.alertValidAmount'));
            setButtonLoading(submitBtn, false);
            return;
        }

        const tagsInput = document.getElementById('tags').value;
        const tags = tagsInput ? tagsInput.split(',').map(tag => tag.trim().toLowerCase()).filter(Boolean) : [];
        const isCoupleExpenseCheckbox = document.getElementById('isCoupleExpense');
        const isCoupleExpense = isCoupleExpenseCheckbox ? isCoupleExpenseCheckbox.checked : false;

        const entry = {
            month: document.getElementById('month').value,
            type: document.getElementById('type').value,
            amount: amountValue,
            description: document.getElementById('description').value,
            tags: tags,
            isCoupleExpense: isCoupleExpense
        };
        if (!entry.month || !entry.type || !entry.amount) {
            alert(t('entry.alertFillFields'));
            setButtonLoading(submitBtn, false);
            return;
        }
        try {
            const response = await csrfFetch('/api/entries', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(entry)
            });
            if (response.ok) {
                // Reload entries from server to ensure view mode filtering is applied correctly
                await loadEntries();
                newForm.reset();
                closeModal();
            } else {
                const errorData = await response.text();
                console.error('Error adding entry:', response.statusText, errorData);
                alert(t('entry.alertAddError', { message: response.statusText }));
            }
        } catch (error) {
            console.error('Fetch error:', error);
            alert(t('entry.alertAddFailed'));
        } finally {
            setButtonLoading(submitBtn, false);
        }
    });

    // Delete entry
    document.getElementById('entriesBody').addEventListener('click', async (e) => {
        if (e.target.classList.contains('delete-btn')) {
            const id = parseInt(e.target.dataset.id); // Convert string ID to number
            if (!id || isNaN(id)) {
                console.error('Delete button clicked but no valid ID found.');
                return;
            }
            const confirmation = confirm(t('entry.confirmDelete'));
            if (confirmation) {
                const deleteBtn = e.target;
                setButtonLoading(deleteBtn, true);
                try {
                    const response = await csrfFetch(`/api/entries/${id}`, {
                        method: 'DELETE'
                    });

                    if (response.ok) {
                        // Remove entry from the local array *without* full page reload
                        entries = entries.filter(entry => entry.id !== id);
                        // Re-apply current filters to update the display.
                        // Preserve the current page — displayEntries() clamps
                        // if the deletion emptied the last page.
                        filterEntries({ resetPage: false });
                    } else {
                        console.error('Error deleting entry on server:', response.statusText);
                        alert(t('entry.alertDeleteFailed'));
                    }
                } catch (error) {
                    console.error('Error deleting entry:', error);
                     alert(t('entry.alertDeleteError'));
                } finally {
                    setButtonLoading(deleteBtn, false);
                }
            }
        }

        // Edit entry - open modal
        if (e.target.classList.contains('edit-btn')) {
            const id = parseInt(e.target.dataset.id);
            const entry = entries.find(entry => entry.id === id);
            if (entry) {
                document.getElementById('editEntryId').value = entry.id;
                document.getElementById('editMonth').value = entry.month;
                document.getElementById('editType').value = entry.type;
                document.getElementById('editAmount').value = entry.amount;
                document.getElementById('editDescription').value = entry.description;
                document.getElementById('editTags').value = (entry.tags || []).join(', ');
                const editIsCoupleExpense = document.getElementById('editIsCoupleExpense');
                if (editIsCoupleExpense) {
                    editIsCoupleExpense.checked = entry.isCoupleExpense || false;
                }
                document.getElementById('editEntryModal').style.display = 'block';
            }
        }
    });

    // Edit entry form submission
    document.getElementById('editEntryForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const editSubmitBtn = e.target.querySelector('button[type="submit"]');
        setButtonLoading(editSubmitBtn, true);

        const id = parseInt(document.getElementById('editEntryId').value);
        const tagsInput = document.getElementById('editTags').value;
        const tags = tagsInput ? tagsInput.split(',').map(tag => tag.trim().toLowerCase()).filter(Boolean) : [];
        const editIsCoupleExpense = document.getElementById('editIsCoupleExpense');
        const isCoupleExpense = editIsCoupleExpense ? editIsCoupleExpense.checked : false;

        const updatedEntry = {
            month: document.getElementById('editMonth').value,
            type: document.getElementById('editType').value,
            amount: parseFloat(document.getElementById('editAmount').value),
            description: document.getElementById('editDescription').value,
            tags: tags,
            isCoupleExpense: isCoupleExpense
        };

        try {
            const response = await csrfFetch(`/api/entries/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedEntry)
            });

            if (response.ok) {
                // Reload entries from server so view-mode filtering stays correct,
                // but preserve the user's current page (displayEntries() clamps
                // if the edit somehow shrinks the visible set).
                await loadEntries({ resetPage: false });
                document.getElementById('editEntryModal').style.display = 'none';
            } else {
                alert(t('entry.alertUpdateFailed'));
            }
        } catch (error) {
            console.error('Error updating entry:', error);
            alert(t('entry.alertUpdateError'));
        } finally {
            setButtonLoading(editSubmitBtn, false);
        }
    });

    // Close edit modal
    document.getElementById('closeEditModal').addEventListener('click', () => {
        document.getElementById('editEntryModal').style.display = 'none';
    });

    // Close edit modal when clicking outside
    window.addEventListener('click', (e) => {
        const editModal = document.getElementById('editEntryModal');
        if (e.target === editModal) {
            editModal.style.display = 'none';
        }
    });

    // Filter controls - only clear button now, apply is handled by dynamic listeners
    document.getElementById('clearFilters').addEventListener('click', () => {
        filterState = freshFilterState();
        applyFilterStateToDOM();
        saveFilterState();
        renderActiveFiltersBar();
        // Reset currentFilteredEntries to all entries
        currentFilteredEntries = entries;
        // Reset filters should show ALL entries again, starting from page 1
        currentPage = 1;
        displayEntries(entries);
        updateSummary(entries);
        updateCharts(entries, true);
        updateCoupleShare(entries);
        updateFilterResultsCount(entries);
    });

    // Sorting functionality
    document.querySelectorAll('.sortable').forEach(header => {
        header.addEventListener('click', () => {
            const column = header.dataset.sort;

            // Toggle sort direction if same column, otherwise set to ascending
            if (currentSortColumn === column) {
                currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortColumn = column;
                currentSortDirection = 'asc';
            }

            // Re-display entries with new sorting using currently filtered entries
            // Reset to page 1 — sorting reorders the result set so the user
            // expects to start from the top.
            currentPage = 1;
            displayEntries(currentFilteredEntries);
        });
    });

    // Pagination button handler (event-delegated so re-renders don't leak
    // listeners; container is rebuilt on every displayEntries call).
    const paginationEl = document.getElementById('entriesPagination');
    if (paginationEl) {
        paginationEl.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-page-action]');
            if (!btn || btn.disabled) return;
            const action = btn.dataset.pageAction;
            if (action === 'prev' && currentPage > 1) currentPage--;
            else if (action === 'next') currentPage++;
            else return;
            displayEntries(currentFilteredEntries);
            // Re-render replaces the buttons, so restore focus to the matching
            // new button to keep keyboard users in place. If that button is
            // now disabled (we hit a boundary), fall back to the opposite one.
            const fresh = paginationEl.querySelector(`[data-page-action="${action}"]`);
            if (fresh && !fresh.disabled) {
                fresh.focus();
            } else {
                const other = paginationEl.querySelector(`[data-page-action="${action === 'prev' ? 'next' : 'prev'}"]`);
                if (other) other.focus();
            }
            // Scroll the table into view so users see the new rows. Honor
            // prefers-reduced-motion to avoid jumpy animation for those users.
            const table = document.getElementById('entriesTable');
            if (table) {
                const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                table.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
            }
        });
    }

    // Add New Entry button opens modal
    document.getElementById('addEntryBtn').addEventListener('click', openModal);

    // Topbar CTAs delegate to the legacy header buttons so existing handlers
    // keep working unchanged. Bulk + add are wired here; settings/admin/logout
    // are reachable via the sidebar (and the legacy header buttons remain in
    // the DOM but hidden, retaining their event listeners as fallbacks).
    const topbarAdd = document.getElementById('topbarAddEntryBtn');
    if (topbarAdd) topbarAdd.addEventListener('click', () => document.getElementById('addEntryBtn').click());
    const topbarBulk = document.getElementById('topbarBulkBtn');
    if (topbarBulk) topbarBulk.addEventListener('click', () => document.getElementById('openBulkUploadModal').click());

    // Mobile sidebar drawer: hamburger button in topbar slides the sidebar
    // in from the left on narrow screens. On desktop the .open class does
    // nothing (the slide transform is gated behind the mobile media query),
    // so this code is a no-op there.
    (function () {
        const toggle = document.getElementById('sidebarToggle');
        const sidebar = document.getElementById('primarySidebar');
        const backdrop = document.getElementById('sidebarBackdrop');
        if (!toggle || !sidebar || !backdrop) return;
        // Track who triggered the open so we can return focus there on
        // close — keeps keyboard / screen-reader users out of focus limbo
        // when the drawer hides under the slide-out transform.
        let lastFocused = null;
        // Swap the toggle's accessible name in lockstep with the drawer
        // state so screen readers don't keep announcing "Open menu" while
        // the menu is already open.
        const setToggleLabel = (open) => {
            const key = open ? 'nav.closeMenu' : 'nav.openMenu';
            const label = (typeof t === 'function') ? t(key) : (open ? 'Close menu' : 'Open menu');
            toggle.setAttribute('aria-label', label);
            toggle.setAttribute('title', label);
            toggle.setAttribute('data-i18n-aria-label', key);
            toggle.setAttribute('data-i18n-title', key);
        };
        const openSidebar = () => {
            lastFocused = document.activeElement;
            sidebar.classList.add('open');
            backdrop.classList.add('open');
            toggle.setAttribute('aria-expanded', 'true');
            setToggleLabel(true);
            // Move focus into the drawer so SR users land on the nav.
            const firstNav = sidebar.querySelector('.nav-item:not([disabled])');
            if (firstNav) firstNav.focus();
        };
        const closeSidebar = () => {
            const wasOpen = sidebar.classList.contains('open');
            sidebar.classList.remove('open');
            backdrop.classList.remove('open');
            toggle.setAttribute('aria-expanded', 'false');
            setToggleLabel(false);
            // Restore focus to whichever element opened the drawer (the
            // hamburger by default), but only if a close actually happened
            // and the previous element is still in the DOM.
            if (wasOpen) {
                const target = (lastFocused && document.body.contains(lastFocused)) ? lastFocused : toggle;
                if (target && typeof target.focus === 'function') target.focus();
            }
            lastFocused = null;
        };
        toggle.addEventListener('click', () => {
            if (sidebar.classList.contains('open')) closeSidebar();
            else openSidebar();
        });
        backdrop.addEventListener('click', closeSidebar);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && sidebar.classList.contains('open')) closeSidebar();
        });
        // Auto-close after any nav action so the drawer doesn't sit on top
        // of the content the user just navigated to.
        sidebar.addEventListener('click', (e) => {
            if (e.target.closest('.nav-item[data-target]')) closeSidebar();
        });
    })();

    // Sidebar nav: route data-target clicks to the existing modals/sections.
    // The remaining "Coming soon" item (Goals) is aria-disabled and stays
    // inert; Reports / Budgets open their own modals (issues #92, #93).
    document.querySelectorAll('.sidebar .nav-item[data-target]').forEach(item => {
        item.addEventListener('click', () => {
            const target = item.getAttribute('data-target');
            // Visual active state — only one nav-item active at a time.
            document.querySelectorAll('.sidebar .nav-item').forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            switch (target) {
                case 'dashboard':
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                    break;
                case 'entries': {
                    const sec = document.querySelector('.entries-section');
                    if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    break;
                }
                case 'manageCategories': {
                    const btn = document.getElementById('manageCategoriesBtn');
                    if (btn) btn.click();
                    break;
                }
                case 'bulk':
                    document.getElementById('openBulkUploadModal').click();
                    break;
                case 'settings':
                    document.getElementById('settingsBtn').click();
                    break;
                case 'admin':
                    document.getElementById('adminPanelBtn').click();
                    break;
                case 'logout':
                    document.getElementById('logoutBtn').click();
                    break;
                case 'advisor': {
                    const fab = document.getElementById('chatFab');
                    if (fab) fab.click();
                    break;
                }
                case 'reports':
                    openReportsModal();
                    break;
                case 'budgets':
                    openBudgetsModal();
                    break;
            }
        });
    });
    // Close modal on close button
    document.querySelector('#entryModal .close').addEventListener('click', closeModal);
    // Close modal on outside click
    window.addEventListener('click', (event) => {
        if (event.target === document.getElementById('entryModal')) {
            closeModal();
        }
    });
    // Close modal on Escape key
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeModal();
        }
    });

    // Logout button
    document.getElementById('logoutBtn').addEventListener('click', async function() {
        const logoutBtn = this;
        setButtonLoading(logoutBtn, true);
        try {
            await csrfFetch('/api/logout', { method: 'POST', credentials: 'include' });
            window.location.href = '/login.html';
        } catch (error) {
            alert(t('logout.failed'));
            setButtonLoading(logoutBtn, false);
        }
    });

    document.getElementById('settingsBtn').addEventListener('click', async function() {
        setButtonLoading(this, true);
        try {
            await openSettingsModal();
        } finally {
            setButtonLoading(this, false);
        }
    });

    document.getElementById('monthFilterStart').addEventListener('input', onFilterChanged);
    document.getElementById('monthFilterEnd').addEventListener('input', onFilterChanged);
    document.getElementById('typeFilter').addEventListener('change', onFilterChanged);
    // Category chips manage their own change events; keep native select in sync only

    // Render category chips now that DOM is ready (before any entries load)
    renderCategoryChips();

    // Quick-range preset buttons
    document.querySelectorAll('.quick-range-btn').forEach(btn => {
        btn.addEventListener('click', () => applyQuickRange(btn.dataset.range));
    });

    // Collapsible filter panel toggle (visible on mobile)
    const filtersCollapseBtn = document.getElementById('filtersCollapseToggle');
    const filtersBody = document.getElementById('filtersBody');
    if (filtersCollapseBtn && filtersBody) {
        filtersCollapseBtn.addEventListener('click', () => {
            const expanded = filtersCollapseBtn.getAttribute('aria-expanded') === 'true';
            const next = !expanded;
            filtersCollapseBtn.setAttribute('aria-expanded', String(next));
            filtersBody.hidden = !next;
            const label = t(next ? 'filter.collapse' : 'filter.expand');
            filtersCollapseBtn.title = label;
            filtersCollapseBtn.setAttribute('aria-label', label);
        });

        // Ensure the filters panel never stays hidden above the mobile
        // breakpoint where the collapse button isn't rendered. Without this,
        // collapsing on mobile and resizing to desktop would leave the panel
        // permanently hidden with no way to re-expand it.
        const mq = window.matchMedia('(min-width: 769px)');
        const handleBreakpoint = (e) => {
            if (e.matches) {
                filtersBody.hidden = false;
                filtersCollapseBtn.setAttribute('aria-expanded', 'true');
            }
        };
        handleBreakpoint(mq);
        if (mq.addEventListener) mq.addEventListener('change', handleBreakpoint);
        else if (mq.addListener) mq.addListener(handleBreakpoint);
    }

    // Category chart type toggle (bar ↔ doughnut)
    document.querySelectorAll('.chart-type-toggle .chart-type-btn').forEach(btn => {
        // Sync initial aria-pressed from the pre-set .active class in HTML.
        btn.setAttribute('aria-pressed', String(btn.classList.contains('active')));
        btn.addEventListener('click', () => {
            const type = btn.dataset.type;
            setCategoryChartType(type);
            document.querySelectorAll('.chart-type-toggle .chart-type-btn').forEach(b => {
                const isActive = b === btn;
                b.classList.toggle('active', isActive);
                b.setAttribute('aria-pressed', String(isActive));
            });
            try { localStorage.setItem('assetmgmt.categoryChartType', type); } catch {}
        });
    });

    // ============ REPORTS MODAL (issue #92) ============
    //
    // Lightweight modal: pick format + date range + type, then request the
    // export with `fetch(...)`, read the response as a Blob, and trigger
    // the browser download by clicking a transient `<a>` that points to a
    // temporary `blob:` URL. Going through fetch (rather than an `<a href>`
    // navigation to the API URL) lets us surface 4xx/5xx responses as
    // in-modal alerts instead of having the browser navigate the SPA away
    // to a JSON error body. Authentication and any CSRF requirements are
    // enforced by the backend export endpoint. The server respects the
    // user's current viewMode (individual / combined / myshare) and
    // replies with `Content-Disposition: attachment` so the browser saves
    // the file rather than displaying it.
    function openReportsModal() {
        const overlay = document.createElement('div');
        overlay.className = 'modal';
        overlay.style.display = 'block';

        const start = (filterState && filterState.start) || '';
        const end = (filterState && filterState.end) || '';
        const typeF = (filterState && filterState.type) || 'all';
        const viewMode = currentViewMode || 'individual';

        overlay.innerHTML = `
            <div class="modal-content" style="max-width: 480px;">
                <span class="close" id="closeReportsModal">&times;</span>
                <h2>${t('report.title')}</h2>
                <p style="color: var(--color-text-muted); font-size: 0.9rem; margin-bottom: 1.25rem;">${t('report.help')}</p>

                <div class="form-group">
                    <label>${t('report.format')}</label>
                    <div style="display: flex; gap: 16px; align-items: center; padding-top: 6px;">
                        <label style="display: flex; gap: 6px; align-items: center; cursor: pointer;"><input type="radio" name="reportFormat" value="pdf" checked> PDF</label>
                        <label style="display: flex; gap: 6px; align-items: center; cursor: pointer;"><input type="radio" name="reportFormat" value="csv"> CSV</label>
                    </div>
                </div>

                <div class="form-group">
                    <label for="reportStart">${t('report.startMonth')}</label>
                    <input type="month" id="reportStart" value="${escapeHtml(start)}">
                </div>
                <div class="form-group">
                    <label for="reportEnd">${t('report.endMonth')}</label>
                    <input type="month" id="reportEnd" value="${escapeHtml(end)}">
                </div>
                <div class="form-group">
                    <label for="reportType">${t('common.type')}</label>
                    <select id="reportType">
                        <option value="all" ${typeF === 'all' ? 'selected' : ''}>${t('type.all')}</option>
                        <option value="income" ${typeF === 'income' ? 'selected' : ''}>${t('type.income')}</option>
                        <option value="expense" ${typeF === 'expense' ? 'selected' : ''}>${t('type.expense')}</option>
                    </select>
                </div>

                <p style="color: var(--color-text-muted); font-size: 0.8rem; margin-top: 12px;">${t('report.viewModeHint', { mode: t({ individual: 'dash.individual', combined: 'dash.combined', myshare: 'dash.myShare' }[viewMode] || 'dash.individual') })}</p>

                <div style="display: flex; gap: 8px; margin-top: 1.25rem; justify-content: flex-end;">
                    <button type="button" id="reportCancelBtn" class="edit-btn">${t('common.cancel')}</button>
                    <button type="button" id="reportExportBtn" class="filter-btn">${t('report.export')}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const cleanup = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
        overlay.querySelector('#closeReportsModal').addEventListener('click', cleanup);
        overlay.querySelector('#reportCancelBtn').addEventListener('click', cleanup);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });

        overlay.querySelector('#reportExportBtn').addEventListener('click', async () => {
            const exportBtn = overlay.querySelector('#reportExportBtn');
            const fmt = overlay.querySelector('input[name="reportFormat"]:checked').value;
            const startV = overlay.querySelector('#reportStart').value;
            const endV = overlay.querySelector('#reportEnd').value;
            const typeV = overlay.querySelector('#reportType').value;
            if (startV && endV && startV > endV) {
                alert(t('report.errStartAfterEnd'));
                return;
            }

            const params = new URLSearchParams();
            params.set('format', fmt);
            params.set('viewMode', viewMode);
            if (startV) params.set('start', startV);
            if (endV) params.set('end', endV);
            if (typeV && typeV !== 'all') params.set('type', typeV);
            if (filterState && Array.isArray(filterState.categories) && filterState.categories.length) {
                params.set('categories', filterState.categories.join(','));
            }

            // Fetch + blob (rather than `<a href>` navigation) so we can
            // surface 4xx/5xx errors as in-modal alerts instead of having
            // the browser navigate away from the SPA to a JSON error body.
            setButtonLoading(exportBtn, true);
            try {
                const res = await fetch('/api/reports/export?' + params.toString(), {
                    credentials: 'include'
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    alert(err.message || t('report.exportError') || ('Export failed: ' + res.status));
                    return;
                }
                const blob = await res.blob();
                const filenameMatch = /filename="?([^"]+)"?/i.exec(res.headers.get('Content-Disposition') || '');
                const filename = filenameMatch ? filenameMatch[1] : ('report.' + fmt);
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                a.rel = 'noopener';
                document.body.appendChild(a);
                a.click();
                a.remove();
                // Defer revocation by a tick so browsers (notably Safari)
                // have actually started the download before the blob: URL
                // is invalidated. Calling revoke synchronously after click
                // can intermittently produce "failed" downloads on large
                // blobs.
                setTimeout(() => URL.revokeObjectURL(url), 0);
                cleanup();
            } catch (e) {
                console.error('Report export failed:', e);
                alert(t('report.exportError') || 'Export failed');
            } finally {
                setButtonLoading(exportBtn, false);
            }
        });
    }

    // ============ BUDGETS MODAL (issue #93) ============
    //
    // Lists every category the user owns plus an "overall" row at the top,
    // each with: an editable monthly target, the actual spend so far this
    // month, and a colored progress bar. Save behaviour: a positive value
    // PUTs the budget; clearing the input (or saving 0) DELETEs the row,
    // matching the explicit Clear button.
    // Build the GET /api/budgets URL with the client-local month + the
    // active viewMode, so the server doesn't fall back to its own clock
    // (timezone skew) and so couple users see the same scope as the
    // dashboard. Used by the initial load and by every refresh after a
    // PUT/DELETE so the modal always stays on the same tracking window.
    function buildBudgetsUrl(month) {
        const params = new URLSearchParams({
            month,
            viewMode: currentViewMode || 'individual'
        });
        return '/api/budgets?' + params.toString();
    }

    function currentClientMonth() {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    }

    async function loadBudgets(month) {
        const res = await fetch(buildBudgetsUrl(month), { credentials: 'include' });
        if (!res.ok) throw new Error('GET /api/budgets failed: ' + res.status);
        return res.json();
    }

    async function openBudgetsModal() {
        const overlay = document.createElement('div');
        overlay.className = 'modal';
        overlay.style.display = 'block';
        overlay.innerHTML = `
            <div class="modal-content" style="max-width: 640px;">
                <span class="close" id="closeBudgetsModal">&times;</span>
                <h2>${t('budget.title')}</h2>
                <p style="color: var(--color-text-muted); font-size: 0.9rem; margin-bottom: 1rem;">${t('budget.help')}</p>
                <div id="budgetsBody" style="min-height: 80px;">
                    <div style="color: var(--color-text-muted); padding: 16px 0;">${t('common.loading')}</div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        const cleanup = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
        overlay.querySelector('#closeBudgetsModal').addEventListener('click', cleanup);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });

        const body = overlay.querySelector('#budgetsBody');
        // Capture the month once when the modal opens. Crossing a month
        // boundary mid-edit would otherwise silently shift the tracking
        // window on the post-save refresh.
        const trackingMonth = currentClientMonth();
        try {
            const data = await loadBudgets(trackingMonth);
            renderBudgetsModal(body, data, trackingMonth);
        } catch (e) {
            console.error('Failed to load budgets:', e);
            body.innerHTML = `<div style="color: var(--color-danger); padding: 12px 0;">${escapeHtml(t('budget.loadError'))}</div>`;
        }
    }

    function renderBudgetsModal(container, data, trackingMonth) {
        const overall = data.overall || { amount: 0, actual: 0 };
        const rows = data.byCategory || [];

        // Locale-aware currency formatter (pt-BR → BRL/R$, en-US → USD/$).
        // Matches the hero-KPI formatting introduced in PR #91; we don't
        // honor `data.currency` from the API because the server intentionally
        // doesn't dictate it (currency follows the client's language).
        const isPt = (typeof getLang === 'function' && getLang() === 'pt');
        const moneyFmt = new Intl.NumberFormat(isPt ? 'pt-BR' : 'en-US', {
            style: 'currency',
            currency: isPt ? 'BRL' : 'USD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        const fmtMoney = (n) => moneyFmt.format(Number(n) || 0);
        // Safe progress: 0 if no budget. Cap at 100% for the bar fill but
        // surface a separate "over budget" pill when actual > budget.
        const progressFor = (amount, actual) => {
            if (!amount || amount <= 0) return { pct: null, over: false };
            const ratio = actual / amount;
            return { pct: Math.min(ratio, 1) * 100, over: ratio > 1, raw: ratio * 100 };
        };
        const barColor = (p) => {
            if (!p) return 'var(--ink-3)';
            if (p.over) return 'var(--negative)';
            if (p.pct >= 70) return 'var(--accent-2)';
            return 'var(--positive)';
        };

        const renderRow = (slug, label, color, amount, actual, isOverall, isOrphan) => {
            const p = progressFor(amount, actual);
            const barWidth = p.pct == null ? 0 : p.pct;
            const fill = barColor(p);
            const overPill = p.over
                ? `<span class="delta-pill down" style="margin-left: 8px;">${escapeHtml(t('budget.overBudget'))}</span>`
                : '';
            // "Orphan" rows are slugs the server saw spend on but the user
            // doesn't have in user_categories anymore (deleted category, or
            // the synthetic 'other' bucket). PUT to those slugs would 404
            // server-side, so we render them read-only — only Clear is
            // allowed (DELETE works against the user_id row regardless of
            // category ownership). A small "(removed)" tag visually marks
            // them.
            const orphanPill = isOrphan
                ? `<span class="mono tiny muted" style="margin-left: 8px;">${escapeHtml(t('budget.orphanLabel'))}</span>`
                : '';
            const swatch = isOverall
                ? `<span style="display:inline-block; width:10px; height:10px; border-radius:2px; background: var(--ink); margin-right: 6px;"></span>`
                : `<span style="display:inline-block; width:10px; height:10px; border-radius:2px; background: ${escapeHtml(color || 'var(--ink-3)')}; margin-right: 6px;"></span>`;
            const inputDisabled = isOrphan ? 'disabled' : '';
            const clearDisabled = (amount > 0) ? '' : 'disabled';

            return `
                <div class="budget-row" data-slug="${escapeHtml(slug)}" data-orphan="${isOrphan ? '1' : '0'}" style="padding: 10px 0; border-bottom: 1px solid var(--color-border-subtle); ${isOrphan ? 'opacity: 0.7;' : ''}">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div style="flex: 1; min-width: 0;">
                            <div style="display: flex; align-items: center; font-weight: ${isOverall ? '600' : '500'};">
                                ${swatch}<span>${escapeHtml(label)}</span>${overPill}${orphanPill}
                            </div>
                            <div style="font-family: var(--mono); font-size: 11px; color: var(--color-text-muted); margin-top: 2px;">
                                ${fmtMoney(actual)} ${t('budget.spent')} · ${p.pct == null ? t('budget.noTarget') : fmtMoney(amount) + ' ' + t('budget.target') + (p.over ? ' · ' + p.raw.toFixed(0) + '%' : ' · ' + p.pct.toFixed(0) + '%')}
                            </div>
                        </div>
                        <input type="number" class="budget-amount" min="0" step="0.01" value="${amount > 0 ? amount.toFixed(2) : ''}" placeholder="0.00" ${inputDisabled}
                               style="width: 110px; padding: 6px 8px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-bg-base); color: var(--color-text-primary); font-family: var(--mono);" />
                        <button type="button" class="budget-clear edit-btn" style="padding: 4px 8px; font-size: 11px;" ${clearDisabled}>${t('common.delete')}</button>
                    </div>
                    <div style="height: 6px; background: var(--color-border-subtle); border-radius: 3px; margin-top: 8px; overflow: hidden;">
                        <div style="height: 100%; width: ${barWidth}%; background: ${fill}; transition: width 0.2s ease;"></div>
                    </div>
                </div>
            `;
        };

        // Default-category rows have `label` seeded as the raw slug
        // server-side; the rest of the app translates those via
        // categoryLabel(slug) → i18n key `cat.<slug>`. Fall back to the
        // server-provided label only when categoryLabel doesn't recognize
        // the slug (custom or orphan categories).
        const budgetRowLabel = (r) => {
            if (!r || !r.slug) return (r && r.label) || '';
            if (typeof categoryLabel !== 'function') return r.label || r.slug;
            const localized = categoryLabel(r.slug);
            return localized && localized !== r.slug ? localized : (r.label || r.slug);
        };

        container.innerHTML = `
            <div style="font-family: var(--mono); font-size: 10px; letter-spacing: 0.06em; color: var(--ink-3); text-transform: uppercase; margin-bottom: 6px;">
                ${t('budget.month')}: ${escapeHtml(data.month || '')}
            </div>
            ${renderRow('_overall', t('budget.overallLabel'), null, overall.amount, overall.actual, true, false)}
            ${rows.map(r => renderRow(r.slug, budgetRowLabel(r), r.color, r.amount, r.actual, false, !!r.isOrphan)).join('')}
        `;

        // Save on blur or Enter; clear via the explicit button.
        container.querySelectorAll('.budget-row').forEach(row => {
            const slug = row.getAttribute('data-slug');
            const input = row.querySelector('.budget-amount');
            const clearBtn = row.querySelector('.budget-clear');
            const isOrphan = row.getAttribute('data-orphan') === '1';
            const save = async () => {
                if (isOrphan) return; // input is disabled; defensive
                const raw = input.value.trim();
                const isEmpty = raw === '';
                const v = isEmpty ? 0 : Number(raw);
                if (!isEmpty && (!Number.isFinite(v) || v < 0)) {
                    // Restore the previous value rather than clearing — an
                    // empty field would otherwise trigger the DELETE path on
                    // the next blur and silently remove a saved budget the
                    // user didn't intend to remove. Show the browser's
                    // built-in validity tooltip via setCustomValidity, then
                    // immediately clear the validity so the field doesn't
                    // stay stuck after revert.
                    input.setCustomValidity(t('budget.invalidAmount'));
                    input.reportValidity();
                    input.value = input.defaultValue;
                    input.setCustomValidity('');
                    return;
                }
                input.setCustomValidity('');
                // Empty input or 0 clears the row — same effect as the Clear
                // button. Avoids stranding a 0-amount row that the UI then
                // renders as "no target set" with a disabled Clear.
                const shouldDelete = isEmpty || v === 0;
                // Visual feedback while the round-trip is in flight: disable
                // the input + Clear button and mark the row aria-busy so SR
                // users get the cue. The row gets re-rendered on success, so
                // we only need to restore prior state on the error path —
                // capture Clear's pre-request disabled state up-front so we
                // can put it back exactly as `renderRow` left it.
                const clearWasDisabled = clearBtn ? clearBtn.disabled : false;
                row.setAttribute('aria-busy', 'true');
                input.disabled = true;
                if (clearBtn) clearBtn.disabled = true;
                try {
                    let res;
                    if (shouldDelete) {
                        res = await csrfFetch('/api/budgets/' + encodeURIComponent(slug), { method: 'DELETE' });
                        if (!res.ok && res.status !== 404) {
                            alert(t('budget.deleteError'));
                            return;
                        }
                    } else {
                        res = await csrfFetch('/api/budgets/' + encodeURIComponent(slug), {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ amount: v })
                        });
                        if (!res.ok) {
                            const err = await res.json().catch(() => ({}));
                            alert(err.message || t('budget.saveError'));
                            return;
                        }
                    }
                    const fresh = await loadBudgets(trackingMonth);
                    renderBudgetsModal(container, fresh, trackingMonth);
                } catch (e) {
                    console.error('Budget save failed:', e);
                    alert(shouldDelete ? t('budget.deleteError') : t('budget.saveError'));
                } finally {
                    if (row.isConnected) {
                        row.removeAttribute('aria-busy');
                        input.disabled = false;
                        if (clearBtn) clearBtn.disabled = clearWasDisabled;
                    }
                }
            };
            input.addEventListener('focusout', (e) => {
                // If focus is moving to this row's Clear button, the user
                // is about to delete the budget — let the click handler
                // run instead. If we save() here, it'd disable Clear before
                // the click fires and the user would end up with an
                // unintended PUT (and potentially miss the DELETE entirely).
                if (e.relatedTarget === clearBtn) return;
                const original = input.defaultValue;
                if (input.value !== original) save();
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
            });
            clearBtn.addEventListener('click', async () => {
                setButtonLoading(clearBtn, true);
                try {
                    const res = await csrfFetch('/api/budgets/' + encodeURIComponent(slug), { method: 'DELETE' });
                    if (!res.ok && res.status !== 404) {
                        alert(t('budget.deleteError'));
                        return;
                    }
                    const fresh = await loadBudgets(trackingMonth);
                    renderBudgetsModal(container, fresh, trackingMonth);
                } catch (e) {
                    console.error('DELETE /api/budgets failed:', e);
                    alert(t('budget.deleteError'));
                } finally {
                    // The row gets re-rendered on success, so this only
                    // matters on the error path. Guard against the button
                    // already being detached.
                    if (clearBtn.isConnected) setButtonLoading(clearBtn, false);
                }
            });
        });
    }

    // ============ SETTINGS MODAL ============

    async function openSettingsModal() {
        // Fetch email and 2FA status in parallel
        let emailData = { hasEmail: false, maskedEmail: null };
        let twoFAData = { enabled: false, backupCodesRemaining: 0 };

        try {
            const [emailRes, twoFARes] = await Promise.all([
                fetch('/api/user/email', { credentials: 'include' }),
                fetch('/api/user/2fa/status', { credentials: 'include' })
            ]);
            if (emailRes.ok) emailData = await emailRes.json();
            if (twoFARes.ok) twoFAData = await twoFARes.json();
        } catch (e) {
            // Continue with defaults
        }

        const overlay = document.createElement('div');
        overlay.className = 'modal';
        overlay.style.display = 'block';

        const emailInfo = emailData.hasEmail
            ? `<span style="color: var(--color-text-primary);">${escapeHtml(emailData.maskedEmail)}</span>`
            : `<span style="color: var(--color-text-muted);">${t('settings.noEmail')}</span>`;

        const emailBtnLabel = emailData.hasEmail ? t('settings.changeEmail') : t('settings.addEmail');

        const twoFAStatus = twoFAData.enabled
            ? `<span style="color: var(--color-success);">${t('settings.twoFAEnabled')}</span>`
            : `<span style="color: var(--color-text-muted);">${t('settings.twoFADisabled')}</span>`;

        const backupInfo = twoFAData.enabled
            ? `<small style="color: var(--color-text-muted); display: block; margin-top: 0.25rem;">${t('settings.backupCodesRemaining', { count: twoFAData.backupCodesRemaining })}</small>`
            : '';

        overlay.innerHTML = `
            <div class="modal-content" style="max-width: 480px;">
                <span class="close" id="closeSettingsModal">&times;</span>
                <h2>${t('settings.title')}</h2>

                <div style="margin-bottom: 2rem;">
                    <h3 style="font-size: 1rem; margin-bottom: 0.75rem; color: var(--color-text-primary);">${t('settings.emailSection')}</h3>
                    <div id="settingsEmailDisplay">
                        <p style="margin: 0 0 0.75rem 0;">${t('settings.currentEmail')}: ${emailInfo}</p>
                        <button type="button" id="settingsEmailBtn" class="edit-btn" style="padding: 0.4rem 0.8rem;">${emailBtnLabel}</button>
                    </div>
                    <div id="settingsEmailForm" style="display: none;">
                        <div class="form-group" style="margin-bottom: 0.75rem;">
                            <input type="email" id="settingsEmailInput" placeholder="your@email.com" style="width: 100%; padding: 0.75rem; background: var(--color-bg-base); border: 1px solid var(--color-border); border-radius: 8px; color: var(--color-text-primary); font-family: var(--font-body);">
                        </div>
                        <small style="color: var(--color-text-muted); display: block; margin-bottom: 0.75rem;">${t('settings.emailHelp')}</small>
                        <div style="display: flex; gap: 0.5rem;">
                            <button type="button" id="settingsEmailSave" class="edit-btn" style="padding: 0.4rem 0.8rem;">${t('common.save')}</button>
                            <button type="button" id="settingsEmailCancel" class="edit-btn" style="padding: 0.4rem 0.8rem;">${t('common.cancel')}</button>
                        </div>
                    </div>
                </div>

                <div>
                    <h3 style="font-size: 1rem; margin-bottom: 0.75rem; color: var(--color-text-primary);">${t('settings.twoFASection')}</h3>
                    <div id="settings2FAStatus">
                        <p style="margin: 0 0 0.75rem 0;">${twoFAStatus}${backupInfo}</p>
                        ${twoFAData.enabled
                            ? `<button type="button" id="settings2FADisableBtn" class="delete-btn" style="padding: 0.4rem 0.8rem;">${t('settings.disable2FA')}</button>`
                            : `<button type="button" id="settings2FAEnableBtn" class="edit-btn" style="padding: 0.4rem 0.8rem;">${t('settings.enable2FA')}</button>`
                        }
                    </div>
                    <div id="settings2FASetup" style="display: none;"></div>
                    <div id="settings2FADisable" style="display: none;"></div>
                </div>

                <div style="margin-top: 2rem;">
                    <h3 style="font-size: 1rem; margin-bottom: 0.75rem; color: var(--color-text-primary);">${t('settings.geminiSection')}</h3>
                    <div id="settingsGeminiDisplay">
                        ${currentUser && currentUser.hasGeminiApiKey
                            ? `<p style="margin: 0 0 0.75rem 0;">
                                <span style="color: var(--color-success);">&#10003;</span>
                                <span style="color: var(--color-success);">${t('settings.geminiSaved')}</span>
                               </p>
                               <div style="display: flex; gap: 0.5rem;">
                                   <button type="button" id="settingsGeminiChangeBtn" class="edit-btn" style="padding: 0.4rem 0.8rem;">${t('settings.geminiChange')}</button>
                                   <button type="button" id="settingsGeminiRemoveBtn" class="delete-btn" style="padding: 0.4rem 0.8rem;">${t('settings.geminiRemove')}</button>
                               </div>`
                            : `<p style="margin: 0 0 0.75rem 0; color: var(--color-text-muted);">${t('settings.geminiNone')}</p>`
                        }
                    </div>
                    <div id="settingsGeminiForm" style="display: ${currentUser && currentUser.hasGeminiApiKey ? 'none' : 'block'};">
                        <div class="form-group" style="margin-bottom: 0.75rem;">
                            <input type="password" id="settingsGeminiInput" placeholder="${t('settings.geminiPlaceholder')}" style="width: 100%; padding: 0.75rem; background: var(--color-bg-base); border: 1px solid var(--color-border); border-radius: 8px; color: var(--color-text-primary); font-family: var(--font-body);" autocomplete="off">
                        </div>
                        <small style="color: var(--color-text-muted); display: block; margin-bottom: 0.75rem;">${t('settings.geminiHelp')}</small>
                        <div style="display: flex; gap: 0.5rem;">
                            <button type="button" id="settingsGeminiSaveBtn" class="edit-btn" style="padding: 0.4rem 0.8rem;">${t('common.save')}</button>
                            <button type="button" id="settingsGeminiCancelBtn" class="edit-btn" style="padding: 0.4rem 0.8rem; display: none;">${t('common.cancel')}</button>
                        </div>
                    </div>
                </div>

                <div style="margin-top: 2rem;">
                    <h3 style="font-size: 1rem; margin-bottom: 0.75rem; color: var(--color-text-primary);">${t('settings.openaiSection')}</h3>
                    <div id="settingsOpenaiDisplay">
                        ${currentUser && currentUser.hasOpenaiApiKey
                            ? `<p style="margin: 0 0 0.75rem 0;">
                                <span style="color: var(--color-success);">&#10003;</span>
                                <span style="color: var(--color-success);">${t('settings.openaiSaved')}</span>
                               </p>
                               <div style="display: flex; gap: 0.5rem;">
                                   <button type="button" id="settingsOpenaiChangeBtn" class="edit-btn" style="padding: 0.4rem 0.8rem;">${t('settings.openaiChange')}</button>
                                   <button type="button" id="settingsOpenaiRemoveBtn" class="delete-btn" style="padding: 0.4rem 0.8rem;">${t('settings.openaiRemove')}</button>
                               </div>`
                            : `<p style="margin: 0 0 0.75rem 0; color: var(--color-text-muted);">${t('settings.openaiNone')}</p>`
                        }
                    </div>
                    <div id="settingsOpenaiForm" style="display: ${currentUser && currentUser.hasOpenaiApiKey ? 'none' : 'block'};">
                        <div class="form-group" style="margin-bottom: 0.75rem;">
                            <input type="password" id="settingsOpenaiInput" placeholder="${t('settings.openaiPlaceholder')}" style="width: 100%; padding: 0.75rem; background: var(--color-bg-base); border: 1px solid var(--color-border); border-radius: 8px; color: var(--color-text-primary); font-family: var(--font-body);" autocomplete="off">
                        </div>
                        <small style="color: var(--color-text-muted); display: block; margin-bottom: 0.75rem;">${t('settings.openaiHelp')}</small>
                        <div style="display: flex; gap: 0.5rem;">
                            <button type="button" id="settingsOpenaiSaveBtn" class="edit-btn" style="padding: 0.4rem 0.8rem;">${t('common.save')}</button>
                            <button type="button" id="settingsOpenaiCancelBtn" class="edit-btn" style="padding: 0.4rem 0.8rem; display: none;">${t('common.cancel')}</button>
                        </div>
                    </div>
                </div>

                <div style="margin-top: 2rem;">
                    <h3 style="font-size: 1rem; margin-bottom: 0.75rem; color: var(--color-text-primary);">${t('settings.anthropicSection')}</h3>
                    <div id="settingsAnthropicDisplay">
                        ${currentUser && currentUser.hasAnthropicApiKey
                            ? `<p style="margin: 0 0 0.75rem 0;">
                                <span style="color: var(--color-success);">&#10003;</span>
                                <span style="color: var(--color-success);">${t('settings.anthropicSaved')}</span>
                               </p>
                               <div style="display: flex; gap: 0.5rem;">
                                   <button type="button" id="settingsAnthropicChangeBtn" class="edit-btn" style="padding: 0.4rem 0.8rem;">${t('settings.anthropicChange')}</button>
                                   <button type="button" id="settingsAnthropicRemoveBtn" class="delete-btn" style="padding: 0.4rem 0.8rem;">${t('settings.anthropicRemove')}</button>
                               </div>`
                            : `<p style="margin: 0 0 0.75rem 0; color: var(--color-text-muted);">${t('settings.anthropicNone')}</p>`
                        }
                    </div>
                    <div id="settingsAnthropicForm" style="display: ${currentUser && currentUser.hasAnthropicApiKey ? 'none' : 'block'};">
                        <div class="form-group" style="margin-bottom: 0.75rem;">
                            <input type="password" id="settingsAnthropicInput" placeholder="${t('settings.anthropicPlaceholder')}" style="width: 100%; padding: 0.75rem; background: var(--color-bg-base); border: 1px solid var(--color-border); border-radius: 8px; color: var(--color-text-primary); font-family: var(--font-body);" autocomplete="off">
                        </div>
                        <small style="color: var(--color-text-muted); display: block; margin-bottom: 0.75rem;">${t('settings.anthropicHelp')}</small>
                        <div style="display: flex; gap: 0.5rem;">
                            <button type="button" id="settingsAnthropicSaveBtn" class="edit-btn" style="padding: 0.4rem 0.8rem;">${t('common.save')}</button>
                            <button type="button" id="settingsAnthropicCancelBtn" class="edit-btn" style="padding: 0.4rem 0.8rem; display: none;">${t('common.cancel')}</button>
                        </div>
                    </div>
                </div>

                <div style="margin-top: 2rem;">
                    <h3 style="font-size: 1rem; margin-bottom: 0.75rem; color: var(--color-text-primary);">${t('settings.claudeOauthSection')}</h3>
                    <div id="settingsClaudeOauthDisplay">
                        ${currentUser && currentUser.hasClaudeOauthToken
                            ? `<p style="margin: 0 0 0.75rem 0;">
                                <span style="color: var(--color-success);">&#10003;</span>
                                <span style="color: var(--color-success);">${t('settings.claudeOauthSaved')}</span>
                               </p>
                               <div style="display: flex; gap: 0.5rem;">
                                   <button type="button" id="settingsClaudeOauthChangeBtn" class="edit-btn" style="padding: 0.4rem 0.8rem;">${t('settings.claudeOauthChange')}</button>
                                   <button type="button" id="settingsClaudeOauthRemoveBtn" class="delete-btn" style="padding: 0.4rem 0.8rem;">${t('settings.claudeOauthRemove')}</button>
                               </div>`
                            : `<p style="margin: 0 0 0.75rem 0; color: var(--color-text-muted);">${t('settings.claudeOauthNone')}</p>`
                        }
                    </div>
                    <div id="settingsClaudeOauthForm" style="display: ${currentUser && currentUser.hasClaudeOauthToken ? 'none' : 'block'};">
                        <div class="form-group" style="margin-bottom: 0.75rem;">
                            <input type="password" id="settingsClaudeOauthInput" placeholder="${t('settings.claudeOauthPlaceholder')}" style="width: 100%; padding: 0.75rem; background: var(--color-bg-base); border: 1px solid var(--color-border); border-radius: 8px; color: var(--color-text-primary); font-family: var(--font-body);" autocomplete="off">
                        </div>
                        <small style="color: var(--color-text-muted); display: block; margin-bottom: 0.75rem;">${t('settings.claudeOauthHelp')}</small>
                        <div style="display: flex; gap: 0.5rem;">
                            <button type="button" id="settingsClaudeOauthSaveBtn" class="edit-btn" style="padding: 0.4rem 0.8rem;">${t('common.save')}</button>
                            <button type="button" id="settingsClaudeOauthCancelBtn" class="edit-btn" style="padding: 0.4rem 0.8rem; display: none;">${t('common.cancel')}</button>
                        </div>
                    </div>
                </div>

                <div style="margin-top: 2rem;">
                    <h3 style="font-size: 1rem; margin-bottom: 0.75rem; color: var(--color-text-primary);">${t('settings.copilotOauthSection')}</h3>
                    <div id="settingsCopilotOauthDisplay">
                        ${currentUser && currentUser.hasGithubCopilotToken
                            ? `<p style="margin: 0 0 0.75rem 0;">
                                <span style="color: var(--color-success);">&#10003;</span>
                                <span style="color: var(--color-success);">${t('settings.copilotOauthSaved')}</span>
                               </p>
                               <div style="display: flex; gap: 0.5rem;">
                                   <button type="button" id="settingsCopilotOauthChangeBtn" class="edit-btn" style="padding: 0.4rem 0.8rem;">${t('settings.copilotOauthChange')}</button>
                                   <button type="button" id="settingsCopilotOauthRemoveBtn" class="delete-btn" style="padding: 0.4rem 0.8rem;">${t('settings.copilotOauthRemove')}</button>
                               </div>`
                            : `<p style="margin: 0 0 0.75rem 0; color: var(--color-text-muted);">${t('settings.copilotOauthNone')}</p>`
                        }
                    </div>
                    <div id="settingsCopilotOauthForm" style="display: ${currentUser && currentUser.hasGithubCopilotToken ? 'none' : 'block'};">
                        <div class="form-group" style="margin-bottom: 0.75rem;">
                            <input type="password" id="settingsCopilotOauthInput" placeholder="${t('settings.copilotOauthPlaceholder')}" style="width: 100%; padding: 0.75rem; background: var(--color-bg-base); border: 1px solid var(--color-border); border-radius: 8px; color: var(--color-text-primary); font-family: var(--font-body);" autocomplete="off">
                        </div>
                        <small style="color: var(--color-text-muted); display: block; margin-bottom: 0.75rem;">${t('settings.copilotOauthHelp')}</small>
                        <div style="display: flex; gap: 0.5rem;">
                            <button type="button" id="settingsCopilotOauthSaveBtn" class="edit-btn" style="padding: 0.4rem 0.8rem;">${t('common.save')}</button>
                            <button type="button" id="settingsCopilotOauthCancelBtn" class="edit-btn" style="padding: 0.4rem 0.8rem; display: none;">${t('common.cancel')}</button>
                        </div>
                    </div>
                </div>

                <div style="margin-top: 2rem;">
                    <h3 style="font-size: 1rem; margin-bottom: 0.75rem; color: var(--color-text-primary);">${t('settings.aiProviderSection')}</h3>
                    <p style="margin: 0 0 0.75rem 0; color: var(--color-text-muted); font-size: 0.875rem;">${t('settings.aiProviderLabel')}</p>
                    <div style="display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;">
                        <label style="display: flex; align-items: center; gap: 0.4rem; cursor: pointer;">
                            <input type="radio" name="aiProvider" id="aiProviderGemini" value="gemini" ${(!currentUser || !currentUser.aiProvider || currentUser.aiProvider === 'gemini') ? 'checked' : ''}>
                            ${t('settings.aiProviderGemini')}
                        </label>
                        <label style="display: flex; align-items: center; gap: 0.4rem; cursor: pointer;">
                            <input type="radio" name="aiProvider" id="aiProviderOpenai" value="openai" ${(currentUser && currentUser.aiProvider === 'openai') ? 'checked' : ''}>
                            ${t('settings.aiProviderOpenai')}
                        </label>
                        <label style="display: flex; align-items: center; gap: 0.4rem; cursor: pointer;">
                            <input type="radio" name="aiProvider" id="aiProviderAnthropic" value="anthropic" ${(currentUser && currentUser.aiProvider === 'anthropic') ? 'checked' : ''}>
                            ${t('settings.aiProviderAnthropic')}
                        </label>
                        <label style="display: flex; align-items: center; gap: 0.4rem; cursor: pointer;">
                            <input type="radio" name="aiProvider" id="aiProviderCopilot" value="copilot" ${(currentUser && currentUser.aiProvider === 'copilot') ? 'checked' : ''}>
                            ${t('settings.aiProviderCopilot')}
                        </label>
                        <button type="button" id="settingsAiProviderSaveBtn" class="edit-btn" style="padding: 0.4rem 0.8rem;">${t('common.save')}</button>
                    </div>

                    <div id="aiModelSection" style="margin-top: 1rem; display: none;">
                        <p style="margin: 0 0 0.5rem 0; color: var(--color-text-muted); font-size: 0.875rem;">${t('settings.aiModelLabel')}</p>
                        <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
                            <select id="aiModelSelect" style="padding: 0.5rem; background: var(--color-bg-base); border: 1px solid var(--color-border); border-radius: 8px; color: var(--color-text-primary); font-family: var(--font-body); min-width: 200px;">
                                <option value="">${t('settings.aiModelDefault')}</option>
                            </select>
                            <button type="button" id="settingsAiModelSaveBtn" class="edit-btn" style="padding: 0.4rem 0.8rem;">${t('common.save')}</button>
                            <span id="aiModelLoading" style="display: none; color: var(--color-text-muted); font-size: 0.875rem;">${t('settings.aiModelLoading')}</span>
                        </div>
                    </div>

                    <div id="webSearchToggleSection" style="margin-top: 1rem;">
                        <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                            <input type="checkbox" id="settingsWebSearchToggle" ${(currentUser && currentUser.webSearchEnabled) ? 'checked' : ''}>
                            <span style="color: var(--color-text-primary); font-size: 0.9rem;">${t('settings.webSearchLabel')}</span>
                        </label>
                        <small style="display: block; margin-top: 0.35rem; color: var(--color-text-muted); font-size: 0.8rem;">${t('settings.webSearchHelp', { perTurn: (currentUser && currentUser.webSearchPerTurnCap) || 3, perDay: (currentUser && currentUser.webSearchDailyCap) || 30 })}</small>
                        <small id="webSearchInactiveHint" style="display: ${(currentUser && currentUser.webSearchEnabled && currentUser.aiProvider !== 'anthropic') ? 'block' : 'none'}; margin-top: 0.35rem; color: var(--color-warning, #d97706); font-size: 0.8rem;">${t('settings.webSearchInactiveProvider')}</small>
                    </div>
                </div>

                <div style="margin-top: 2rem;">
                    <h3 style="font-size: 1rem; margin-bottom: 0.75rem; color: var(--color-text-primary);">${t('settings.appearanceSection')}</h3>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
                        <label style="display: flex; flex-direction: column; gap: 0.35rem;">
                            <span style="font-size: 0.85rem; color: var(--color-text-muted);">${t('settings.themeLabel')}</span>
                            <select id="settingsThemeSelect" style="padding: 0.5rem; background: var(--color-bg-base); border: 1px solid var(--color-border); border-radius: 8px; color: var(--color-text-primary); font-family: var(--font-body);">
                                <option value="earthy">${t('settings.themeEarthy')}</option>
                                <option value="dark">${t('settings.themeDark')}</option>
                                <option value="light">${t('settings.themeLight')}</option>
                            </select>
                        </label>
                        <label style="display: flex; flex-direction: column; gap: 0.35rem;">
                            <span style="font-size: 0.85rem; color: var(--color-text-muted);">${t('settings.typographyLabel')}</span>
                            <select id="settingsTypographySelect" style="padding: 0.5rem; background: var(--color-bg-base); border: 1px solid var(--color-border); border-radius: 8px; color: var(--color-text-primary); font-family: var(--font-body);">
                                <option value="editorial">${t('settings.typographyEditorial')}</option>
                                <option value="modern">${t('settings.typographyModern')}</option>
                                <option value="system">${t('settings.typographySystem')}</option>
                            </select>
                        </label>
                    </div>
                    <small style="display: block; margin-top: 0.5rem; color: var(--color-text-muted); font-size: 0.8rem;">${t('settings.appearanceHelp')}</small>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const closeBtn = overlay.querySelector('#closeSettingsModal');
        function cleanup() { document.body.removeChild(overlay); }
        closeBtn.addEventListener('click', cleanup);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });

        wireSettingsEmail(overlay, emailData);
        wireSettings2FA(overlay, twoFAData, cleanup);
        wireSettingsGemini(overlay);
        wireSettingsOpenai(overlay);
        wireSettingsAnthropic(overlay);
        wireSettingsClaudeOauth(overlay);
        wireSettingsCopilotOauth(overlay);
        wireSettingsAiProvider(overlay);
        wireSettingsAiModel(overlay);
        wireSettingsWebSearch(overlay);
        wireSettingsAppearance(overlay);
    }

    function wireSettingsAppearance(overlay) {
        const themeSel = overlay.querySelector('#settingsThemeSelect');
        const typoSel = overlay.querySelector('#settingsTypographySelect');
        if (!themeSel || !typoSel) return;
        // Default values match the dataset attributes the early-bootstrap
        // script applied to <html> on page load.
        themeSel.value = document.documentElement.getAttribute('data-theme') || 'earthy';
        typoSel.value = document.documentElement.getAttribute('data-typography') || 'editorial';

        themeSel.addEventListener('change', () => {
            const v = themeSel.value;
            try {
                if (v === 'earthy') localStorage.removeItem('appTheme');
                else localStorage.setItem('appTheme', v);
            } catch (e) {}
            if (v === 'earthy') document.documentElement.removeAttribute('data-theme');
            else document.documentElement.setAttribute('data-theme', v);
            reapplyChartTheme();
        });

        typoSel.addEventListener('change', () => {
            const v = typoSel.value;
            try {
                if (v === 'editorial') localStorage.removeItem('appTypography');
                else localStorage.setItem('appTypography', v);
            } catch (e) {}
            if (v === 'editorial') document.documentElement.removeAttribute('data-typography');
            else document.documentElement.setAttribute('data-typography', v);
            reapplyChartTheme();
        });
    }

    function wireSettingsEmail(overlay, emailData) {
        const emailBtn = overlay.querySelector('#settingsEmailBtn');
        const emailDisplay = overlay.querySelector('#settingsEmailDisplay');
        const emailForm = overlay.querySelector('#settingsEmailForm');
        const emailInput = overlay.querySelector('#settingsEmailInput');
        const saveBtn = overlay.querySelector('#settingsEmailSave');
        const cancelBtn = overlay.querySelector('#settingsEmailCancel');

        if (!emailBtn) return;

        emailBtn.addEventListener('click', () => {
            emailDisplay.style.display = 'none';
            emailForm.style.display = '';
            emailInput.value = '';
            emailInput.focus();
        });

        cancelBtn.addEventListener('click', () => {
            emailForm.style.display = 'none';
            emailDisplay.style.display = '';
        });

        saveBtn.addEventListener('click', async () => {
            const value = emailInput.value.trim();
            if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
                alert(t('settings.enterValidEmail'));
                return;
            }
            setButtonLoading(saveBtn, true);
            try {
                const response = await csrfFetch('/api/user/email', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: value || '' }),
                    credentials: 'include'
                });
                if (response.ok) {
                    // Refresh modal
                    document.body.removeChild(overlay);
                    openSettingsModal();
                } else {
                    const data = await response.json();
                    alert(data.message || t('error.generic'));
                }
            } catch (e) {
                alert(t('error.generic'));
            } finally {
                setButtonLoading(saveBtn, false);
            }
        });

        emailInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') saveBtn.click();
            if (e.key === 'Escape') cancelBtn.click();
        });
    }

    function wireSettings2FA(overlay, twoFAData, cleanupModal) {
        if (twoFAData.enabled) {
            // Disable flow
            const disableBtn = overlay.querySelector('#settings2FADisableBtn');
            const disableDiv = overlay.querySelector('#settings2FADisable');
            if (!disableBtn) return;

            disableBtn.addEventListener('click', () => {
                disableDiv.innerHTML = `
                    <p style="margin: 0.75rem 0; color: var(--color-text-secondary);">${t('settings.disable2FAConfirm')}</p>
                    <div class="form-group" style="margin-bottom: 0.75rem;">
                        <input type="text" id="settings2FADisableCode" maxlength="6" placeholder="000000" style="width: 100%; padding: 0.75rem; background: var(--color-bg-base); border: 1px solid var(--color-border); border-radius: 8px; color: var(--color-text-primary); font-family: var(--font-body);">
                    </div>
                    <button type="button" id="settings2FAConfirmDisable" class="delete-btn" style="padding: 0.4rem 0.8rem;">${t('settings.confirmDisable')}</button>
                `;
                disableDiv.style.display = '';
                disableBtn.style.display = 'none';
                disableDiv.querySelector('#settings2FADisableCode').focus();

                disableDiv.querySelector('#settings2FAConfirmDisable').addEventListener('click', async () => {
                    const code = disableDiv.querySelector('#settings2FADisableCode').value.trim();
                    if (!code) return;
                    const confirmDisableBtn = disableDiv.querySelector('#settings2FAConfirmDisable');
                    setButtonLoading(confirmDisableBtn, true);
                    try {
                        const response = await csrfFetch('/api/user/2fa/disable', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ totpCode: code }),
                            credentials: 'include'
                        });
                        if (response.ok) {
                            cleanupModal();
                            openSettingsModal();
                        } else {
                            const data = await response.json();
                            alert(data.message || t('error.generic'));
                        }
                    } catch (e) {
                        alert(t('error.generic'));
                    } finally {
                        setButtonLoading(confirmDisableBtn, false);
                    }
                });

                disableDiv.querySelector('#settings2FADisableCode').addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') disableDiv.querySelector('#settings2FAConfirmDisable').click();
                });
            });
        } else {
            // Enable flow
            const enableBtn = overlay.querySelector('#settings2FAEnableBtn');
            const setupDiv = overlay.querySelector('#settings2FASetup');
            if (!enableBtn) return;

            enableBtn.addEventListener('click', async () => {
                setButtonLoading(enableBtn, true);

                try {
                    const response = await csrfFetch('/api/user/2fa/setup', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include'
                    });

                    if (!response.ok) {
                        alert(t('error.generic'));
                        setButtonLoading(enableBtn, false);
                        return;
                    }

                    const data = await response.json();
                    enableBtn.style.display = 'none';

                    setupDiv.innerHTML = `
                        <div style="text-align: center; margin-top: 0.75rem;">
                            <p style="margin-bottom: 0.75rem; color: var(--color-text-secondary);">${t('settings.scanQR')}</p>
                            <img src="${data.qrCode}" alt="QR Code" style="max-width: 200px; border-radius: 8px; margin-bottom: 0.75rem;">
                            <details style="margin-bottom: 1rem; text-align: left;">
                                <summary style="cursor: pointer; color: var(--color-text-muted); font-size: 0.85rem;">${t('settings.manualEntry')}</summary>
                                <code style="display: block; margin-top: 0.5rem; padding: 0.5rem; background: var(--color-bg-base); border-radius: 6px; word-break: break-all; font-size: 0.8rem;">${escapeHtml(data.secret)}</code>
                            </details>
                        </div>
                        <div class="form-group" style="margin-bottom: 0.75rem;">
                            <label style="display: block; margin-bottom: 0.4rem; color: var(--color-text-secondary); font-size: 0.8rem;">${t('settings.enterCode')}</label>
                            <input type="text" id="settings2FASetupCode" maxlength="6" placeholder="000000" style="width: 100%; padding: 0.75rem; background: var(--color-bg-base); border: 1px solid var(--color-border); border-radius: 8px; color: var(--color-text-primary); font-family: var(--font-body);">
                        </div>
                        <button type="button" id="settings2FAVerifyBtn" style="width: 100%; padding: 0.6rem;">${t('settings.verifyAndEnable')}</button>
                        <div id="settings2FABackupCodes" style="display: none;"></div>
                    `;
                    setupDiv.style.display = '';

                    const codeInput = setupDiv.querySelector('#settings2FASetupCode');
                    codeInput.focus();

                    const verifyBtn = setupDiv.querySelector('#settings2FAVerifyBtn');
                    const backupDiv = setupDiv.querySelector('#settings2FABackupCodes');

                    async function verifySetup() {
                        const code = codeInput.value.trim();
                        if (!code || code.length < 6) {
                            alert(t('settings.enterValidCode'));
                            return;
                        }

                        setButtonLoading(verifyBtn, true);
                        try {
                            const vRes = await csrfFetch('/api/user/2fa/verify', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ totpCode: code }),
                                credentials: 'include'
                            });

                            if (vRes.ok) {
                                const vData = await vRes.json();
                                // Hide setup form, show backup codes
                                codeInput.style.display = 'none';
                                verifyBtn.style.display = 'none';
                                setupDiv.querySelector('details')?.remove();
                                setupDiv.querySelector('img')?.remove();
                                setupDiv.querySelector('label')?.remove();
                                const scanP = setupDiv.querySelector('p');
                                if (scanP) scanP.textContent = t('settings.twoFASuccess');

                                backupDiv.innerHTML = `
                                    <div style="margin-top: 1rem; padding: 1rem; background: var(--color-bg-base); border-radius: 8px; border: 1px solid var(--color-border);">
                                        <p style="margin: 0 0 0.5rem; font-weight: 600; color: var(--color-accent-primary);">${t('settings.saveBackupCodes')}</p>
                                        <p style="margin: 0 0 0.75rem; font-size: 0.85rem; color: var(--color-text-secondary);">${t('settings.backupCodesWarning')}</p>
                                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.35rem; font-family: monospace; font-size: 0.95rem;">
                                            ${vData.backupCodes.map(c => `<code style="padding: 0.3rem 0.5rem; background: var(--color-bg-elevated); border-radius: 4px; text-align: center;">${escapeHtml(c)}</code>`).join('')}
                                        </div>
                                    </div>
                                    <button type="button" id="settings2FADoneBtn" style="width: 100%; margin-top: 1rem; padding: 0.6rem;">${t('settings.done')}</button>
                                `;
                                backupDiv.style.display = '';

                                backupDiv.querySelector('#settings2FADoneBtn').addEventListener('click', () => {
                                    cleanupModal();
                                    openSettingsModal();
                                });
                            } else {
                                const vErrData = await vRes.json();
                                alert(vErrData.message || t('settings.enterValidCode'));
                                setButtonLoading(verifyBtn, false);
                            }
                        } catch (e) {
                            alert(t('error.generic'));
                            setButtonLoading(verifyBtn, false);
                        }
                    }

                    verifyBtn.addEventListener('click', verifySetup);
                    codeInput.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') verifySetup();
                    });

                } catch (e) {
                    alert(t('error.generic'));
                    setButtonLoading(enableBtn, false);
                }
            });
        }
    }

    function wireSettingsGemini(overlay) {
        const display = overlay.querySelector('#settingsGeminiDisplay');
        const form = overlay.querySelector('#settingsGeminiForm');
        const input = overlay.querySelector('#settingsGeminiInput');
        const saveBtn = overlay.querySelector('#settingsGeminiSaveBtn');
        const cancelBtn = overlay.querySelector('#settingsGeminiCancelBtn');

        if (!display || !form) return;

        function rebuildDisplay(hasKey) {
            if (hasKey) {
                display.innerHTML = `
                    <p style="margin: 0 0 0.75rem 0;">
                        <span style="color: var(--color-success);">&#10003;</span>
                        <span style="color: var(--color-success);">${t('settings.geminiSaved')}</span>
                    </p>
                    <div style="display: flex; gap: 0.5rem;">
                        <button type="button" id="settingsGeminiChangeBtn" class="edit-btn" style="padding: 0.4rem 0.8rem;">${t('settings.geminiChange')}</button>
                        <button type="button" id="settingsGeminiRemoveBtn" class="delete-btn" style="padding: 0.4rem 0.8rem;">${t('settings.geminiRemove')}</button>
                    </div>`;
                wireChangeAndRemove();
            } else {
                display.innerHTML = `<p style="margin: 0 0 0.75rem 0; color: var(--color-text-muted);">${t('settings.geminiNone')}</p>`;
            }
        }

        function wireChangeAndRemove() {
            const changeBtn = overlay.querySelector('#settingsGeminiChangeBtn');
            const removeBtn = overlay.querySelector('#settingsGeminiRemoveBtn');

            if (changeBtn) {
                changeBtn.addEventListener('click', () => {
                    display.style.display = 'none';
                    form.style.display = 'block';
                    cancelBtn.style.display = '';
                    input.value = '';
                    input.focus();
                });
            }

            if (removeBtn) {
                removeBtn.addEventListener('click', async () => {
                    if (!confirm(t('gemini.confirmRemove'))) return;
                    setButtonLoading(removeBtn, true);
                    try {
                        const response = await csrfFetch('/api/user/gemini-key', { method: 'DELETE', credentials: 'include' });
                        if (response.ok) {
                            const data = await response.json();
                            currentUser.hasGeminiApiKey = false;
                            currentUser.hasGeminiKeyAvailable = data.hasGeminiKeyAvailable || false;
                            rebuildDisplay(false);
                            form.style.display = 'block';
                            cancelBtn.style.display = 'none';
                            input.value = '';
                            updateAiKeyUI();
                            alert(t('settings.geminiRemoveSuccess'));
                        } else {
                            alert(t('gemini.removeFailed'));
                        }
                    } catch (e) {
                        alert(t('gemini.removeFailed'));
                    } finally {
                        setButtonLoading(removeBtn, false);
                    }
                });
            }
        }

        // Wire initial change/remove buttons if key exists
        wireChangeAndRemove();

        // Cancel button
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                form.style.display = 'none';
                cancelBtn.style.display = 'none';
                display.style.display = '';
                input.value = '';
            });
        }

        // Save button
        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                const value = input.value.trim();
                if (!value) {
                    input.focus();
                    return;
                }
                setButtonLoading(saveBtn, true);
                try {
                    const response = await csrfFetch('/api/user/gemini-key', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ geminiApiKey: value }),
                        credentials: 'include'
                    });
                    if (response.ok) {
                        currentUser.hasGeminiApiKey = true;
                        currentUser.hasGeminiKeyAvailable = true;
                        rebuildDisplay(true);
                        display.style.display = '';
                        form.style.display = 'none';
                        cancelBtn.style.display = 'none';
                        input.value = '';
                        updateAiKeyUI();
                        alert(t('settings.geminiSaveSuccess'));
                    } else {
                        const data = await response.json();
                        alert(data.message || t('error.generic'));
                    }
                } catch (e) {
                    alert(t('error.generic'));
                } finally {
                    setButtonLoading(saveBtn, false);
                }
            });
        }

        // Keyboard shortcuts
        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') saveBtn.click();
                if (e.key === 'Escape' && cancelBtn.style.display !== 'none') cancelBtn.click();
            });
        }
    }

    function wireSettingsOpenai(overlay) {
        const display = overlay.querySelector('#settingsOpenaiDisplay');
        const form = overlay.querySelector('#settingsOpenaiForm');
        const input = overlay.querySelector('#settingsOpenaiInput');
        const saveBtn = overlay.querySelector('#settingsOpenaiSaveBtn');
        const cancelBtn = overlay.querySelector('#settingsOpenaiCancelBtn');

        if (!display || !form) return;

        function rebuildDisplay(hasKey) {
            if (hasKey) {
                display.innerHTML = `
                    <p style="margin: 0 0 0.75rem 0;">
                        <span style="color: var(--color-success);">&#10003;</span>
                        <span style="color: var(--color-success);">${t('settings.openaiSaved')}</span>
                    </p>
                    <div style="display: flex; gap: 0.5rem;">
                        <button type="button" id="settingsOpenaiChangeBtn" class="edit-btn" style="padding: 0.4rem 0.8rem;">${t('settings.openaiChange')}</button>
                        <button type="button" id="settingsOpenaiRemoveBtn" class="delete-btn" style="padding: 0.4rem 0.8rem;">${t('settings.openaiRemove')}</button>
                    </div>`;
                wireChangeAndRemove();
            } else {
                display.innerHTML = `<p style="margin: 0 0 0.75rem 0; color: var(--color-text-muted);">${t('settings.openaiNone')}</p>`;
            }
        }

        function wireChangeAndRemove() {
            const changeBtn = overlay.querySelector('#settingsOpenaiChangeBtn');
            const removeBtn = overlay.querySelector('#settingsOpenaiRemoveBtn');

            if (changeBtn) {
                changeBtn.addEventListener('click', () => {
                    display.style.display = 'none';
                    form.style.display = 'block';
                    cancelBtn.style.display = '';
                    input.value = '';
                    input.focus();
                });
            }

            if (removeBtn) {
                removeBtn.addEventListener('click', async () => {
                    if (!confirm(t('openai.confirmRemove'))) return;
                    setButtonLoading(removeBtn, true);
                    try {
                        const response = await csrfFetch('/api/user/openai-key', { method: 'DELETE', credentials: 'include' });
                        if (response.ok) {
                            const data = await response.json();
                            currentUser.hasOpenaiApiKey = false;
                            currentUser.hasOpenaiKeyAvailable = data.hasOpenaiKeyAvailable || false;
                            rebuildDisplay(false);
                            form.style.display = 'block';
                            cancelBtn.style.display = 'none';
                            input.value = '';
                            updateAiKeyUI();
                            alert(t('settings.openaiRemoveSuccess'));
                        } else {
                            alert(t('openai.removeFailed'));
                        }
                    } catch (e) {
                        alert(t('openai.removeFailed'));
                    } finally {
                        setButtonLoading(removeBtn, false);
                    }
                });
            }
        }

        wireChangeAndRemove();

        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                form.style.display = 'none';
                cancelBtn.style.display = 'none';
                display.style.display = '';
                input.value = '';
            });
        }

        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                const value = input.value.trim();
                if (!value) {
                    input.focus();
                    return;
                }
                setButtonLoading(saveBtn, true);
                try {
                    const response = await csrfFetch('/api/user/openai-key', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ openaiApiKey: value }),
                        credentials: 'include'
                    });
                    if (response.ok) {
                        currentUser.hasOpenaiApiKey = true;
                        currentUser.hasOpenaiKeyAvailable = true;
                        rebuildDisplay(true);
                        display.style.display = '';
                        form.style.display = 'none';
                        cancelBtn.style.display = 'none';
                        input.value = '';
                        updateAiKeyUI();
                        alert(t('settings.openaiSaveSuccess'));
                    } else {
                        const data = await response.json();
                        alert(data.message || t('error.generic'));
                    }
                } catch (e) {
                    alert(t('error.generic'));
                } finally {
                    setButtonLoading(saveBtn, false);
                }
            });
        }

        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') saveBtn.click();
                if (e.key === 'Escape' && cancelBtn.style.display !== 'none') cancelBtn.click();
            });
        }
    }

    function wireSettingsAnthropic(overlay) {
        const display = overlay.querySelector('#settingsAnthropicDisplay');
        const form = overlay.querySelector('#settingsAnthropicForm');
        const input = overlay.querySelector('#settingsAnthropicInput');
        const saveBtn = overlay.querySelector('#settingsAnthropicSaveBtn');
        const cancelBtn = overlay.querySelector('#settingsAnthropicCancelBtn');

        if (!display || !form) return;

        function rebuildDisplay(hasKey) {
            if (hasKey) {
                display.innerHTML = `
                    <p style="margin: 0 0 0.75rem 0;">
                        <span style="color: var(--color-success);">&#10003;</span>
                        <span style="color: var(--color-success);">${t('settings.anthropicSaved')}</span>
                    </p>
                    <div style="display: flex; gap: 0.5rem;">
                        <button type="button" id="settingsAnthropicChangeBtn" class="edit-btn" style="padding: 0.4rem 0.8rem;">${t('settings.anthropicChange')}</button>
                        <button type="button" id="settingsAnthropicRemoveBtn" class="delete-btn" style="padding: 0.4rem 0.8rem;">${t('settings.anthropicRemove')}</button>
                    </div>`;
                wireChangeAndRemove();
            } else {
                display.innerHTML = `<p style="margin: 0 0 0.75rem 0; color: var(--color-text-muted);">${t('settings.anthropicNone')}</p>`;
            }
        }

        function wireChangeAndRemove() {
            const changeBtn = overlay.querySelector('#settingsAnthropicChangeBtn');
            const removeBtn = overlay.querySelector('#settingsAnthropicRemoveBtn');

            if (changeBtn) {
                changeBtn.addEventListener('click', () => {
                    display.style.display = 'none';
                    form.style.display = 'block';
                    cancelBtn.style.display = '';
                    input.value = '';
                    input.focus();
                });
            }

            if (removeBtn) {
                removeBtn.addEventListener('click', async () => {
                    if (!confirm(t('anthropic.confirmRemove'))) return;
                    setButtonLoading(removeBtn, true);
                    try {
                        const response = await csrfFetch('/api/user/anthropic-key', { method: 'DELETE', credentials: 'include' });
                        if (response.ok) {
                            const data = await response.json();
                            currentUser.hasAnthropicApiKey = false;
                            currentUser.hasAnthropicKeyAvailable = data.hasAnthropicKeyAvailable || false;
                            rebuildDisplay(false);
                            form.style.display = 'block';
                            cancelBtn.style.display = 'none';
                            input.value = '';
                            updateAiKeyUI();
                            alert(t('settings.anthropicRemoveSuccess'));
                        } else {
                            alert(t('anthropic.removeFailed'));
                        }
                    } catch (e) {
                        alert(t('anthropic.removeFailed'));
                    } finally {
                        setButtonLoading(removeBtn, false);
                    }
                });
            }
        }

        wireChangeAndRemove();

        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                form.style.display = 'none';
                cancelBtn.style.display = 'none';
                display.style.display = '';
                input.value = '';
            });
        }

        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                const value = input.value.trim();
                if (!value) {
                    input.focus();
                    return;
                }
                setButtonLoading(saveBtn, true);
                try {
                    const response = await csrfFetch('/api/user/anthropic-key', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ anthropicApiKey: value }),
                        credentials: 'include'
                    });
                    if (response.ok) {
                        currentUser.hasAnthropicApiKey = true;
                        currentUser.hasAnthropicKeyAvailable = true;
                        rebuildDisplay(true);
                        display.style.display = '';
                        form.style.display = 'none';
                        cancelBtn.style.display = 'none';
                        input.value = '';
                        updateAiKeyUI();
                        alert(t('settings.anthropicSaveSuccess'));
                    } else {
                        const data = await response.json();
                        alert(data.message || t('error.generic'));
                    }
                } catch (e) {
                    alert(t('error.generic'));
                } finally {
                    setButtonLoading(saveBtn, false);
                }
            });
        }

        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') saveBtn.click();
                if (e.key === 'Escape' && cancelBtn.style.display !== 'none') cancelBtn.click();
            });
        }
    }

    function wireSettingsClaudeOauth(overlay) {
        const display = overlay.querySelector('#settingsClaudeOauthDisplay');
        const form = overlay.querySelector('#settingsClaudeOauthForm');
        const input = overlay.querySelector('#settingsClaudeOauthInput');
        const saveBtn = overlay.querySelector('#settingsClaudeOauthSaveBtn');
        const cancelBtn = overlay.querySelector('#settingsClaudeOauthCancelBtn');

        if (!display || !form) return;

        function rebuildDisplay(hasToken) {
            if (hasToken) {
                display.innerHTML = `
                    <p style="margin: 0 0 0.75rem 0;">
                        <span style="color: var(--color-success);">&#10003;</span>
                        <span style="color: var(--color-success);">${t('settings.claudeOauthSaved')}</span>
                    </p>
                    <div style="display: flex; gap: 0.5rem;">
                        <button type="button" id="settingsClaudeOauthChangeBtn" class="edit-btn" style="padding: 0.4rem 0.8rem;">${t('settings.claudeOauthChange')}</button>
                        <button type="button" id="settingsClaudeOauthRemoveBtn" class="delete-btn" style="padding: 0.4rem 0.8rem;">${t('settings.claudeOauthRemove')}</button>
                    </div>`;
                wireChangeAndRemove();
            } else {
                display.innerHTML = `<p style="margin: 0 0 0.75rem 0; color: var(--color-text-muted);">${t('settings.claudeOauthNone')}</p>`;
            }
        }

        function wireChangeAndRemove() {
            const changeBtn = overlay.querySelector('#settingsClaudeOauthChangeBtn');
            const removeBtn = overlay.querySelector('#settingsClaudeOauthRemoveBtn');

            if (changeBtn) {
                changeBtn.addEventListener('click', () => {
                    display.style.display = 'none';
                    form.style.display = 'block';
                    cancelBtn.style.display = '';
                    input.value = '';
                    input.focus();
                });
            }

            if (removeBtn) {
                removeBtn.addEventListener('click', async () => {
                    if (!confirm(t('claude.oauth.confirmRemove'))) return;
                    setButtonLoading(removeBtn, true);
                    try {
                        const response = await csrfFetch('/api/user/claude-oauth-token', { method: 'DELETE', credentials: 'include' });
                        if (response.ok) {
                            const data = await response.json();
                            currentUser.hasClaudeOauthToken = false;
                            if (typeof data.hasAnthropicKeyAvailable === 'boolean') {
                                currentUser.hasAnthropicKeyAvailable = data.hasAnthropicKeyAvailable;
                            }
                            rebuildDisplay(false);
                            form.style.display = 'block';
                            cancelBtn.style.display = 'none';
                            input.value = '';
                            updateAiKeyUI();
                            alert(t('settings.claudeOauthRemoveSuccess'));
                        } else {
                            alert(t('claude.oauth.removeFailed'));
                        }
                    } catch (e) {
                        alert(t('claude.oauth.removeFailed'));
                    } finally {
                        setButtonLoading(removeBtn, false);
                    }
                });
            }
        }

        wireChangeAndRemove();

        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                form.style.display = 'none';
                cancelBtn.style.display = 'none';
                display.style.display = '';
                input.value = '';
            });
        }

        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                const value = input.value.trim();
                if (!value) {
                    input.focus();
                    return;
                }
                setButtonLoading(saveBtn, true);
                try {
                    const response = await csrfFetch('/api/user/claude-oauth-token', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ claudeOauthToken: value }),
                        credentials: 'include'
                    });
                    if (response.ok) {
                        currentUser.hasClaudeOauthToken = true;
                        currentUser.hasAnthropicKeyAvailable = true;
                        rebuildDisplay(true);
                        display.style.display = '';
                        form.style.display = 'none';
                        cancelBtn.style.display = 'none';
                        input.value = '';
                        updateAiKeyUI();
                        alert(t('settings.claudeOauthSaveSuccess'));
                    } else {
                        const data = await response.json().catch(() => ({}));
                        alert(data.message || t('error.generic'));
                    }
                } catch (e) {
                    alert(t('error.generic'));
                } finally {
                    setButtonLoading(saveBtn, false);
                }
            });
        }

        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && saveBtn) saveBtn.click();
                if (e.key === 'Escape' && cancelBtn && cancelBtn.style.display !== 'none') cancelBtn.click();
            });
        }
    }

    function wireSettingsCopilotOauth(overlay) {
        const display = overlay.querySelector('#settingsCopilotOauthDisplay');
        const form = overlay.querySelector('#settingsCopilotOauthForm');
        const input = overlay.querySelector('#settingsCopilotOauthInput');
        const saveBtn = overlay.querySelector('#settingsCopilotOauthSaveBtn');
        const cancelBtn = overlay.querySelector('#settingsCopilotOauthCancelBtn');

        if (!display || !form) return;

        function rebuildDisplay(hasToken) {
            if (hasToken) {
                display.innerHTML = `
                    <p style="margin: 0 0 0.75rem 0;">
                        <span style="color: var(--color-success);">&#10003;</span>
                        <span style="color: var(--color-success);">${t('settings.copilotOauthSaved')}</span>
                    </p>
                    <div style="display: flex; gap: 0.5rem;">
                        <button type="button" id="settingsCopilotOauthChangeBtn" class="edit-btn" style="padding: 0.4rem 0.8rem;">${t('settings.copilotOauthChange')}</button>
                        <button type="button" id="settingsCopilotOauthRemoveBtn" class="delete-btn" style="padding: 0.4rem 0.8rem;">${t('settings.copilotOauthRemove')}</button>
                    </div>`;
                wireChangeAndRemove();
            } else {
                display.innerHTML = `<p style="margin: 0 0 0.75rem 0; color: var(--color-text-muted);">${t('settings.copilotOauthNone')}</p>`;
            }
        }

        function wireChangeAndRemove() {
            const changeBtn = overlay.querySelector('#settingsCopilotOauthChangeBtn');
            const removeBtn = overlay.querySelector('#settingsCopilotOauthRemoveBtn');

            if (changeBtn) {
                changeBtn.addEventListener('click', () => {
                    display.style.display = 'none';
                    form.style.display = 'block';
                    cancelBtn.style.display = '';
                    input.value = '';
                    input.focus();
                });
            }

            if (removeBtn) {
                removeBtn.addEventListener('click', async () => {
                    if (!confirm(t('copilot.oauth.confirmRemove'))) return;
                    setButtonLoading(removeBtn, true);
                    try {
                        const response = await csrfFetch('/api/user/github-copilot-token', { method: 'DELETE', credentials: 'include' });
                        if (response.ok) {
                            const data = await response.json();
                            currentUser.hasGithubCopilotToken = false;
                            if (typeof data.hasCopilotKeyAvailable === 'boolean') {
                                currentUser.hasCopilotKeyAvailable = data.hasCopilotKeyAvailable;
                            }
                            rebuildDisplay(false);
                            form.style.display = 'block';
                            cancelBtn.style.display = 'none';
                            input.value = '';
                            updateAiKeyUI();
                            alert(t('settings.copilotOauthRemoveSuccess'));
                        } else {
                            alert(t('copilot.oauth.removeFailed'));
                        }
                    } catch (e) {
                        alert(t('copilot.oauth.removeFailed'));
                    } finally {
                        setButtonLoading(removeBtn, false);
                    }
                });
            }
        }

        wireChangeAndRemove();

        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                form.style.display = 'none';
                cancelBtn.style.display = 'none';
                display.style.display = '';
                input.value = '';
            });
        }

        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                const value = input.value.trim();
                if (!value) {
                    input.focus();
                    return;
                }
                if (!/^(gho_|ghu_|ghp_|github_pat_)/.test(value)) {
                    alert(t('settings.copilotOauthInvalid'));
                    return;
                }
                setButtonLoading(saveBtn, true);
                try {
                    const response = await csrfFetch('/api/user/github-copilot-token', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ githubCopilotToken: value }),
                        credentials: 'include'
                    });
                    if (response.ok) {
                        currentUser.hasGithubCopilotToken = true;
                        currentUser.hasCopilotKeyAvailable = true;
                        rebuildDisplay(true);
                        display.style.display = '';
                        form.style.display = 'none';
                        cancelBtn.style.display = 'none';
                        input.value = '';
                        updateAiKeyUI();
                        alert(t('settings.copilotOauthSaveSuccess'));
                    } else {
                        const data = await response.json().catch(() => ({}));
                        alert(data.message || t('error.generic'));
                    }
                } catch (e) {
                    alert(t('error.generic'));
                } finally {
                    setButtonLoading(saveBtn, false);
                }
            });
        }

        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && saveBtn) saveBtn.click();
                if (e.key === 'Escape' && cancelBtn && cancelBtn.style.display !== 'none') cancelBtn.click();
            });
        }
    }

    function wireSettingsAiProvider(overlay) {
        const saveBtn = overlay.querySelector('#settingsAiProviderSaveBtn');
        if (!saveBtn) return;

        saveBtn.addEventListener('click', async () => {
            const selected = overlay.querySelector('input[name="aiProvider"]:checked');
            if (!selected) return;
            const provider = selected.value;
            setButtonLoading(saveBtn, true);
            try {
                const response = await csrfFetch('/api/user/ai-provider', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ aiProvider: provider }),
                    credentials: 'include'
                });
                if (response.ok) {
                    currentUser.aiProvider = provider;
                    currentUser.aiModel = null;
                    updateAiKeyUI();
                    overlay.dispatchEvent(new CustomEvent('providerChanged'));
                    alert(t('settings.aiProviderSaveSuccess'));
                } else {
                    alert(t('settings.aiProviderSaveError'));
                }
            } catch (e) {
                alert(t('settings.aiProviderSaveError'));
            } finally {
                setButtonLoading(saveBtn, false);
            }
        });
    }

    function wireSettingsWebSearch(overlay) {
        const toggle = overlay.querySelector('#settingsWebSearchToggle');
        const inactiveHint = overlay.querySelector('#webSearchInactiveHint');
        if (!toggle) return;

        function refreshInactiveHint() {
            if (!inactiveHint) return;
            const enabled = !!toggle.checked;
            const provider = currentUser && currentUser.aiProvider;
            inactiveHint.style.display = (enabled && provider && provider !== 'anthropic') ? 'block' : 'none';
        }

        toggle.addEventListener('change', async () => {
            const enabled = !!toggle.checked;
            toggle.disabled = true;
            try {
                const response = await csrfFetch('/api/user/web-search-toggle', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enabled }),
                    credentials: 'include'
                });
                if (response.ok) {
                    currentUser.webSearchEnabled = enabled;
                    refreshInactiveHint();
                } else {
                    toggle.checked = !enabled;
                    alert(t('settings.webSearchSaveError'));
                }
            } catch (e) {
                toggle.checked = !enabled;
                alert(t('settings.webSearchSaveError'));
            } finally {
                toggle.disabled = false;
            }
        });

        overlay.addEventListener('providerChanged', refreshInactiveHint);
    }

    function wireSettingsAiModel(overlay) {
        const section = overlay.querySelector('#aiModelSection');
        const select = overlay.querySelector('#aiModelSelect');
        const saveBtn = overlay.querySelector('#settingsAiModelSaveBtn');
        const loading = overlay.querySelector('#aiModelLoading');
        if (!section || !select || !saveBtn) return;

        async function loadModels() {
            loading.style.display = 'inline';
            select.disabled = true;
            try {
                const response = await csrfFetch('/api/ai/models', { credentials: 'include' });
                if (!response.ok) throw new Error('fetch failed');
                const data = await response.json();

                // Clear existing options (keep default)
                select.innerHTML = `<option value="">${t('settings.aiModelDefault')}</option>`;

                if (data.models.length === 0) {
                    section.style.display = 'none';
                    return;
                }

                const modelIds = new Set(data.models.map(m => m.id));

                // If user has a selected model that's not in the list, show it as unavailable
                if (data.selectedModel && !modelIds.has(data.selectedModel)) {
                    const opt = document.createElement('option');
                    opt.value = data.selectedModel;
                    opt.textContent = `${data.selectedModel} (${t('settings.aiModelUnavailable')})`;
                    select.appendChild(opt);
                }

                for (const model of data.models) {
                    const opt = document.createElement('option');
                    opt.value = model.id;
                    opt.textContent = model.name;
                    select.appendChild(opt);
                }

                select.value = data.selectedModel || '';
                section.style.display = 'block';
            } catch (e) {
                section.style.display = 'none';
            } finally {
                loading.style.display = 'none';
                select.disabled = false;
            }
        }

        saveBtn.addEventListener('click', async () => {
            const aiModel = select.value || null;
            setButtonLoading(saveBtn, true);
            try {
                const response = await csrfFetch('/api/user/ai-model', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ aiModel }),
                    credentials: 'include'
                });
                if (response.ok) {
                    const data = await response.json();
                    currentUser.aiModel = data.aiModel;
                    alert(t('settings.aiModelSaveSuccess'));
                } else {
                    alert(t('settings.aiModelSaveError'));
                }
            } catch (e) {
                alert(t('settings.aiModelSaveError'));
            } finally {
                setButtonLoading(saveBtn, false);
            }
        });

        // Reload models when provider changes
        overlay.addEventListener('providerChanged', () => {
            select.value = '';
            loadModels();
        });

        loadModels();
    }

    // Fetch current user info on load
    async function fetchCurrentUser() {
        try {
            const response = await csrfFetch('/api/user');
            if (response.ok) {
                currentUser = await response.json();
                hasPartner = !!currentUser.partnerId;
                updateUIForRole();
                updateUIForPartner();
                applyUserToShell();
                // Categories are user-scoped (issue #70). Fetch them now so
                // the chips, charts, and select dropdowns can render with
                // the correct palette + labels. Self-heals via the GET
                // endpoint if the user has no rows yet.
                await loadUserCategories();
                // Now that we know the user id, reload filters under their
                // key (they were loaded under 'anon' at DOMContentLoaded).
                // Always reset — falling back to defaults when the user has
                // no saved state — so stale anon filters don't leak through.
                const persisted = loadFilterState();
                filterState = persisted || freshFilterState();
                applyFilterStateToDOM();
                renderActiveFiltersBar();
                if (entries) filterEntries();
            } else {
                window.location.href = '/login.html';
            }
        } catch (error) {
            console.error('Error fetching user:', error);
            window.location.href = '/login.html';
        }
    }

    // Update UI based on user role
    function updateUIForRole() {
        const adminBtn = document.getElementById('adminPanelBtn');
        const sidebarAdminItem = document.getElementById('sidebarAdminItem');
        if (currentUser && currentUser.role === 'admin') {
            adminBtn.style.display = 'inline-flex';
            if (sidebarAdminItem) sidebarAdminItem.style.display = '';
        } else {
            adminBtn.style.display = 'none';
            if (sidebarAdminItem) sidebarAdminItem.style.display = 'none';
        }
    }

    // Populate sidebar avatar + topbar greeting from currentUser.
    function applyUserToShell() {
        if (!currentUser) return;
        const username = currentUser.username || '';
        const initials = username
            .split(/\s+/)
            .filter(Boolean)
            .map(s => s[0])
            .slice(0, 2)
            .join('')
            .toUpperCase() || (username.slice(0, 2).toUpperCase()) || '·';
        const avatar = document.getElementById('sidebarAvatar');
        if (avatar) avatar.textContent = initials;
        const nameEl = document.getElementById('sidebarUserName');
        if (nameEl) nameEl.textContent = username || '—';
        const planEl = document.getElementById('sidebarUserPlan');
        if (planEl) {
            planEl.textContent = (currentUser.partnerId ? (typeof t === 'function' ? t('nav.couplePlan') : 'COUPLE PLAN') : (typeof t === 'function' ? t('nav.individualPlan') : 'INDIVIDUAL PLAN'));
        }
        const greetingEl = document.getElementById('topbarGreeting');
        if (greetingEl) {
            const hour = new Date().getHours();
            const part = hour < 12 ? (typeof t === 'function' ? t('nav.morning') : 'Good morning')
                : hour < 18 ? (typeof t === 'function' ? t('nav.afternoon') : 'Good afternoon')
                : (typeof t === 'function' ? t('nav.evening') : 'Good evening');
            // Avoid rendering "Good morning,." when the username is missing —
            // drop the comma + name segment and just punctuate the greeting.
            greetingEl.textContent = username ? `${part}, ${username}.` : `${part}.`;
        }
    }

    // Update UI for couple features
    function updateUIForPartner() {
        const viewModeContainer = document.getElementById('viewModeContainer');
        const coupleExpenseToggle = document.getElementById('coupleExpenseToggle');
        const editCoupleExpenseToggle = document.getElementById('editCoupleExpenseToggle');
        const partnerInfo = document.getElementById('partnerInfo');
        const myShareBtn = document.getElementById('myShareViewBtn');

        if (hasPartner) {
            viewModeContainer.style.display = 'flex';
            if (coupleExpenseToggle) coupleExpenseToggle.style.display = 'block';
            if (editCoupleExpenseToggle) editCoupleExpenseToggle.style.display = 'block';
            if (myShareBtn) myShareBtn.style.display = '';
            if (partnerInfo && currentUser.partnerUsername) {
                partnerInfo.textContent = t('common.partner') + ': ' + currentUser.partnerUsername;
            }
        } else {
            viewModeContainer.style.display = 'none';
            if (coupleExpenseToggle) coupleExpenseToggle.style.display = 'none';
            if (editCoupleExpenseToggle) editCoupleExpenseToggle.style.display = 'none';
            if (myShareBtn) myShareBtn.style.display = 'none';
            // If user was on myshare/combined but lost partner, reset
            if (currentViewMode !== 'individual') currentViewMode = 'individual';
        }
    }

    // Set view mode and reload entries
    function setViewMode(mode) {
        if (!['individual', 'combined', 'myshare'].includes(mode)) mode = 'individual';
        currentViewMode = mode;

        // Update button states + expose pressed semantics for a11y
        const setActive = (el, isActive) => {
            if (!el) return;
            el.classList.toggle('active', isActive);
            el.setAttribute('aria-pressed', String(isActive));
        };
        setActive(document.getElementById('individualViewBtn'), mode === 'individual');
        setActive(document.getElementById('combinedViewBtn'), mode === 'combined');
        setActive(document.getElementById('myShareViewBtn'), mode === 'myshare');

        // Restore persisted filters for this view (or reset to defaults)
        const persisted = loadFilterState();
        filterState = persisted || freshFilterState();
        applyFilterStateToDOM();
        renderActiveFiltersBar();

        // Wipe stale data from the previous view immediately so the user
        // never sees the wrong rows/totals during the fetch round-trip.
        // setViewLoading then dims the (now empty) summary and overlays the
        // table + charts until loadEntries() resolves with the new data.
        entries = [];
        currentFilteredEntries = [];
        const tbody = document.getElementById('entriesBody');
        if (tbody) tbody.innerHTML = '';
        // Hide stale pagination controls during the reload so prev/next can't
        // be clicked against a now-empty list. renderEntriesPagination()
        // restores them once filterEntries() runs with the new data.
        const paginationEl = document.getElementById('entriesPagination');
        if (paginationEl) { paginationEl.hidden = true; paginationEl.innerHTML = ''; }
        updateSummary([]);
        setViewLoading(true);

        // Reload entries with new view mode
        loadEntries();
    }

    // Monotonic counter so out-of-order responses (e.g. Individual fetched
    // before the user clicks Combined) can never overwrite the latest view.
    let loadEntriesSeq = 0;

    // Load entries from server with viewMode.
    // opts.resetPage (default true) is forwarded to filterEntries() so that
    // edit-triggered reloads can preserve the user's current page.
    async function loadEntries(opts) {
        const seq = ++loadEntriesSeq;
        try {
            setViewLoading(true);
            const response = await csrfFetch(`/api/entries?viewMode=${currentViewMode}`);
            // A newer request started while this one was in flight — discard.
            if (seq !== loadEntriesSeq) return;
            if (response.ok) {
                entries = await response.json();
                if (seq !== loadEntriesSeq) return;
                // In partner views the server may have auto-imported
                // partner-only categories via ensurePartnerCategories;
                // refresh the local list so chips/charts/dropdowns
                // pick them up. Fire-and-forget — the chart datasets
                // are rebuilt from raw entry tags either way.
                if (currentViewMode !== 'individual') {
                    loadUserCategories().then(() => {
                        // Bail out if a newer loadEntries() started or if the
                        // user switched to the individual view in the
                        // meantime — running this would re-render against
                        // stale state and cause flicker.
                        if (seq !== loadEntriesSeq) return;
                        if (currentViewMode === 'individual') return;
                        renderCategoryChips();
                        syncHiddenCategorySelect();
                        // Re-apply filters/charts with the freshly known palette.
                        filterEntries({ resetPage: false });
                    });
                }
                // Re-apply any active filters so the UI stays consistent
                filterEntries(opts);
            }
        } catch (error) {
            console.error('Error loading entries:', error);
        } finally {
            // Only the latest in-flight request is allowed to clear the
            // loading state; older ones bail out without flicker.
            if (seq === loadEntriesSeq) setViewLoading(false);
        }
    }
    window.loadEntries = loadEntries;

    // Load users for admin panel
    async function loadUsersForAdmin() {
        try {
            const response = await csrfFetch('/api/admin/users');
            if (response.ok) {
                const users = await response.json();
                displayUsersTable(users);
            }
        } catch (error) {
            console.error('Error loading users:', error);
        }
    }

    // Store users for lookup (avoids XSS from inline onclick handlers)
    let adminUsersCache = {};

    // Display users in admin table
    function displayUsersTable(users) {
        const tbody = document.getElementById('usersTableBody');
        tbody.innerHTML = '';

        // Cache users for safe lookup
        adminUsersCache = {};
        users.forEach(user => {
            adminUsersCache[user.id] = user;
        });

        users.forEach(user => {
            const row = document.createElement('tr');
            const partnerDisplay = user.partnerUsername
                ? `<span class="partner-badge">${escapeHtml(user.partnerUsername)}</span>`
                : '-';
            const emailDisplay = user.hasEmail
                ? '<span style="color: var(--color-success);">&#10003;</span>'
                : '<span style="color: var(--color-text-muted);">-</span>';
            const twoFADisplay = user.has2FA
                ? '<span style="color: var(--color-success);">&#10003;</span>'
                : '<span style="color: var(--color-text-muted);">-</span>';
            // user.role is a server-side enum ('admin' | 'user') so the
            // class suffix is safe; we still escape user.username defensively
            // in case the username regex is ever loosened or a row is
            // inserted via a path that bypasses validation.
            row.innerHTML = `
                <td>${user.id}</td>
                <td>${escapeHtml(user.username)}</td>
                <td><span class="role-badge role-${user.role}">${user.role === 'admin' ? t('admin.roleAdmin') : t('admin.roleUser')}</span></td>
                <td>${emailDisplay}</td>
                <td>${twoFADisplay}</td>
                <td>${partnerDisplay}</td>
                <td><span class="status-badge status-${user.isActive ? 'active' : 'inactive'}">
                    ${user.isActive ? t('admin.active') : t('admin.inactive')}</span></td>
                <td>${new Date(user.createdAt).toLocaleDateString()}</td>
                <td>${user.entriesCount || 0}</td>
                <td class="user-actions">
                    <button class="edit-btn" onclick="toggleUserStatus(this, ${user.id}, ${!user.isActive})">${user.isActive ? t('admin.deactivate') : t('admin.activate')}</button>
                    ${user.id !== currentUser.id ?
                        `<button class="delete-btn" onclick="deleteUser(this, ${user.id})">${t('common.delete')}</button>` : ''}
                </td>
            `;
            tbody.appendChild(row);
        });
    }

    // Toggle user active status
    window.toggleUserStatus = async function(btn, userId, newStatus) {
        setButtonLoading(btn, true);
        try {
            const response = await csrfFetch(`/api/admin/users/${userId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isActive: newStatus })
            });

            if (response.ok) {
                loadUsersForAdmin();
            } else {
                const data = await response.json();
                alert(data.message || t('error.updateUser'));
            }
        } catch (error) {
            alert(t('error.updateUser'));
        } finally {
            setButtonLoading(btn, false);
        }
    };

    // Delete user
    window.deleteUser = async function(btn, userId) {
        if (!confirm(t('admin.confirmDeleteUser'))) {
            return;
        }

        setButtonLoading(btn, true);
        try {
            const response = await csrfFetch(`/api/admin/users/${userId}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                alert(t('admin.userDeleted'));
                loadUsersForAdmin();
            } else {
                const data = await response.json();
                alert(data.message || t('error.deleteUser'));
            }
        } catch (error) {
            alert(t('error.deleteUser'));
        } finally {
            setButtonLoading(btn, false);
        }
    };

    // Create user from admin panel
    document.getElementById('createUserForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const username = document.getElementById('newUsername').value;
        const password = document.getElementById('newPassword').value;
        const role = document.getElementById('newRole').value;
        const createBtn = e.target.querySelector('button[type="submit"]');
        setButtonLoading(createBtn, true);

        try {
            const response = await csrfFetch('/api/admin/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, role })
            });

            if (response.ok) {
                alert(t('admin.userCreated'));
                loadUsersForAdmin();
                e.target.reset();
            } else {
                const data = await response.json();
                alert(data.message || t('error.createUser'));
            }
        } catch (error) {
            alert(t('error.createUser'));
        } finally {
            setButtonLoading(createBtn, false);
        }
    });

    // Admin panel modal handlers
    document.getElementById('adminPanelBtn').addEventListener('click', () => {
        document.getElementById('adminModal').style.display = 'block';
        loadUsersForAdmin();
        loadCouplesForAdmin();
        populateCoupleDropdowns();
        loadInviteCodesForAdmin();
        const display = document.getElementById('generatedCodeDisplay');
        if (display) display.style.display = 'none';
    });

    document.getElementById('closeAdminModal').addEventListener('click', () => {
        document.getElementById('adminModal').style.display = 'none';
    });

    // Close admin modal when clicking outside
    window.addEventListener('click', (event) => {
        const adminModal = document.getElementById('adminModal');
        if (event.target === adminModal) {
            adminModal.style.display = 'none';
        }
    });

    // ============ COUPLE MANAGEMENT FUNCTIONALITY ============

    // Load couples for admin
    async function loadCouplesForAdmin() {
        try {
            const response = await csrfFetch('/api/admin/couples');
            if (response.ok) {
                const data = await response.json();
                displayCouplesTable(data.couples);
            }
        } catch (error) {
            console.error('Error loading couples:', error);
        }
    }

    // Display couples in admin table
    function displayCouplesTable(couples) {
        const tbody = document.getElementById('couplesTableBody');
        if (!tbody) return;

        tbody.innerHTML = '';

        if (couples.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-secondary);">${t('admin.noCouples')}</td></tr>`;
            return;
        }

        couples.forEach(couple => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${escapeHtml(couple.user1.username)}</td>
                <td>${escapeHtml(couple.user2.username)}</td>
                <td>${new Date(couple.linkedAt).toLocaleDateString()}</td>
                <td>
                    <button class="delete-btn" onclick="unlinkCouple(this, ${couple.user1.id})">${t('admin.unlink')}</button>
                </td>
            `;
            tbody.appendChild(row);
        });
    }

    // Populate couple dropdowns with unlinked users
    async function populateCoupleDropdowns() {
        try {
            const response = await csrfFetch('/api/admin/users');
            if (response.ok) {
                const users = await response.json();
                const unlinkedUsers = users.filter(u => !u.partnerId && u.isActive);

                const select1 = document.getElementById('coupleUser1');
                const select2 = document.getElementById('coupleUser2');

                if (!select1 || !select2) return;

                [select1, select2].forEach(select => {
                    // Build options via DOM construction (textContent) instead
                    // of innerHTML += string concat, to keep usernames safe
                    // even if validation invariants ever shift.
                    select.innerHTML = '';
                    const placeholder = document.createElement('option');
                    placeholder.value = '';
                    placeholder.textContent = t('admin.selectUser');
                    select.appendChild(placeholder);
                    unlinkedUsers.forEach(user => {
                        const opt = document.createElement('option');
                        opt.value = String(user.id);
                        opt.textContent = user.username;
                        select.appendChild(opt);
                    });
                });
            }
        } catch (error) {
            console.error('Error populating couple dropdowns:', error);
        }
    }

    // Link couple form submission
    const linkCoupleForm = document.getElementById('linkCoupleForm');
    if (linkCoupleForm) {
        linkCoupleForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const userId1 = parseInt(document.getElementById('coupleUser1').value);
            const userId2 = parseInt(document.getElementById('coupleUser2').value);

            if (!userId1 || !userId2) {
                alert(t('admin.selectBothUsers'));
                return;
            }

            if (userId1 === userId2) {
                alert(t('admin.selectDifferent'));
                return;
            }

            const linkBtn = e.target.querySelector('button[type="submit"]');
            setButtonLoading(linkBtn, true);
            try {
                const response = await csrfFetch('/api/admin/couples/link', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId1, userId2 })
                });

                if (response.ok) {
                    alert(t('admin.coupleLinked'));
                    loadCouplesForAdmin();
                    populateCoupleDropdowns();
                    loadUsersForAdmin();
                    e.target.reset();
                } else {
                    const data = await response.json();
                    alert(data.message || t('error.linkCouple'));
                }
            } catch (error) {
                alert(t('error.linkCouple'));
            } finally {
                setButtonLoading(linkBtn, false);
            }
        });
    }

    // Unlink couple
    window.unlinkCouple = async function(btn, userId) {
        if (!confirm(t('admin.confirmUnlink'))) return;

        setButtonLoading(btn, true);
        try {
            const response = await csrfFetch('/api/admin/couples/unlink', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId })
            });

            if (response.ok) {
                alert(t('admin.coupleUnlinked'));
                loadCouplesForAdmin();
                populateCoupleDropdowns();
                loadUsersForAdmin();
            } else {
                const data = await response.json();
                alert(data.message || t('error.unlinkCouple'));
            }
        } catch (error) {
            alert(t('error.unlinkCouple'));
        } finally {
            setButtonLoading(btn, false);
        }
    };

    // ============ INVITE CODE MANAGEMENT ============

    async function loadInviteCodesForAdmin() {
        try {
            const response = await csrfFetch('/api/admin/invite-codes');
            if (response.ok) {
                const codes = await response.json();
                displayInviteCodesTable(codes);
            }
        } catch (error) {
            console.error('Error loading invite codes:', error);
        }
    }

    function displayInviteCodesTable(codes) {
        const tbody = document.getElementById('inviteCodesTableBody');
        if (!tbody) return;

        tbody.innerHTML = '';

        if (codes.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--color-text-secondary);">${t('admin.noInviteCodes')}</td></tr>`;
            return;
        }

        const sortedCodes = [...codes].reverse();

        sortedCodes.forEach(code => {
            const row = document.createElement('tr');

            const codeCell = document.createElement('td');
            const codeSpan = document.createElement('span');
            codeSpan.className = 'code-value';
            codeSpan.textContent = code.code;
            codeCell.appendChild(codeSpan);
            row.appendChild(codeCell);

            const createdByCell = document.createElement('td');
            createdByCell.textContent = code.createdByUsername || '-';
            row.appendChild(createdByCell);

            const createdAtCell = document.createElement('td');
            createdAtCell.textContent = new Date(code.createdAt).toLocaleDateString();
            row.appendChild(createdAtCell);

            const statusCell = document.createElement('td');
            const statusSpan = document.createElement('span');
            statusSpan.classList.add('code-badge');
            if (code.isUsed) {
                statusSpan.classList.add('code-used');
                statusSpan.textContent = t('admin.used');
            } else {
                statusSpan.classList.add('code-active');
                statusSpan.textContent = t('admin.active');
            }
            statusCell.appendChild(statusSpan);
            row.appendChild(statusCell);

            const usedByCell = document.createElement('td');
            usedByCell.textContent = code.usedByUsername
                ? `${code.usedByUsername} (${new Date(code.usedAt).toLocaleDateString()})`
                : '-';
            row.appendChild(usedByCell);

            const deleteCell = document.createElement('td');
            if (!code.isUsed) {
                const deleteButton = document.createElement('button');
                deleteButton.classList.add('delete-btn', 'invite-code-delete-btn');
                deleteButton.textContent = t('common.delete');
                deleteButton.dataset.code = code.code;
                deleteCell.appendChild(deleteButton);
            }
            row.appendChild(deleteCell);

            tbody.appendChild(row);
        });

        document.querySelectorAll('.invite-code-delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const codeVal = e.target.dataset.code;
                if (!confirm(t('admin.confirmDeleteCode', { code: codeVal }))) return;

                const deleteCodeBtn = e.target;
                setButtonLoading(deleteCodeBtn, true);
                try {
                    const response = await csrfFetch(`/api/admin/invite-codes/${codeVal}`, {
                        method: 'DELETE'
                    });
                    if (response.ok) {
                        loadInviteCodesForAdmin();
                    } else {
                        const data = await response.json();
                        alert(data.message || t('error.deleteCode'));
                    }
                } catch (error) {
                    alert(t('error.deleteCode'));
                } finally {
                    setButtonLoading(deleteCodeBtn, false);
                }
            });
        });
    }

    const generateInviteCodeBtn = document.getElementById('generateInviteCodeBtn');
    if (generateInviteCodeBtn) {
        generateInviteCodeBtn.addEventListener('click', async () => {
            setButtonLoading(generateInviteCodeBtn, true);
            try {
                const response = await csrfFetch('/api/admin/invite-codes', {
                    method: 'POST'
                });

                if (response.ok) {
                    const data = await response.json();
                    const display = document.getElementById('generatedCodeDisplay');
                    const value = document.getElementById('generatedCodeValue');
                    display.style.display = 'block';
                    value.textContent = data.code;
                    loadInviteCodesForAdmin();
                } else {
                    const data = await response.json();
                    alert(data.message || t('error.generateCode'));
                }
            } catch (error) {
                alert(t('error.generateCode'));
            } finally {
                setButtonLoading(generateInviteCodeBtn, false);
            }
        });
    }

    // ============ VIEW MODE TOGGLE EVENT LISTENERS ============

    document.getElementById('individualViewBtn').addEventListener('click', () => {
        setViewMode('individual');
    });

    document.getElementById('combinedViewBtn').addEventListener('click', () => {
        setViewMode('combined');
    });

    const myShareBtn = document.getElementById('myShareViewBtn');
    if (myShareBtn) {
        myShareBtn.addEventListener('click', () => setViewMode('myshare'));
    }

    // Restore saved category chart type
    try {
        const savedType = localStorage.getItem('assetmgmt.categoryChartType');
        if (savedType === 'doughnut') {
            const doughBtn = document.querySelector('.chart-type-toggle .chart-type-btn[data-type="doughnut"]');
            if (doughBtn) doughBtn.click();
        }
    } catch {}

    // Fetch current user on load
    fetchCurrentUser();
});
