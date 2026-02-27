let entries = [];
let monthlyBalanceChart = null;
let incomeVsExpenseChart = null;
let categoryChart = null;
let categoryStackedChart = null;
// Add a variable to track currently filtered entries
let currentFilteredEntries = [];
// Current user info
let currentUser = null;

// Sorting state
let currentSortColumn = null;
let currentSortDirection = 'asc';

// Couple feature state
let currentViewMode = 'individual';
let hasPartner = false;

// Initialize charts
function initializeCharts() {
    const monthlyBalanceCtx = document.getElementById('monthlyBalanceChart').getContext('2d');
    const incomeVsExpenseCtx = document.getElementById('incomeVsExpenseChart').getContext('2d');
    const categoryCtx = document.getElementById('categoryChart').getContext('2d');
    const categoryStackedCtx = document.getElementById('categoryStackedChart').getContext('2d');

    // Dark theme colors
    const colors = {
        textPrimary: '#f8fafc',
        textSecondary: '#94a3b8',
        textMuted: '#64748b',
        gridColor: 'rgba(148, 163, 184, 0.1)',
        accent: '#f59e0b',
        accentGlow: 'rgba(245, 158, 11, 0.2)',
        success: '#10b981',
        danger: '#ef4444'
    };

    // Common chart options for dark theme
    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                labels: {
                    color: colors.textSecondary,
                    font: {
                        size: 12,
                        family: "'DM Sans', sans-serif"
                    },
                    padding: 15
                }
            },
            tooltip: {
                backgroundColor: '#1e293b',
                titleColor: colors.textPrimary,
                bodyColor: colors.textSecondary,
                borderColor: 'rgba(148, 163, 184, 0.2)',
                borderWidth: 1,
                padding: 12,
                cornerRadius: 8,
                titleFont: { family: "'DM Sans', sans-serif", weight: '600' },
                bodyFont: { family: "'DM Sans', sans-serif" }
            }
        },
        scales: {
            y: {
                beginAtZero: true,
                grid: {
                    color: colors.gridColor,
                    drawBorder: false
                },
                ticks: {
                    color: colors.textMuted,
                    font: { family: "'DM Sans', sans-serif" }
                }
            },
            x: {
                grid: {
                    color: colors.gridColor,
                    drawBorder: false
                },
                ticks: {
                    color: colors.textMuted,
                    maxRotation: 45,
                    minRotation: 45,
                    font: { family: "'DM Sans', sans-serif" }
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
                        family: "'DM Sans', sans-serif"
                    },
                    padding: 15
                }
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
            },
            annotation: {
                annotations: {}
            }
        },
        scales: {
            y: {
                beginAtZero: true,
                grid: {
                    color: colors.gridColor,
                    drawBorder: false
                },
                ticks: {
                    color: colors.textMuted,
                    font: { family: "'DM Sans', sans-serif" },
                    callback: function(value) {
                        return '$' + value.toFixed(0);
                    }
                }
            },
            x: {
                grid: {
                    color: colors.gridColor,
                    drawBorder: false
                },
                ticks: {
                    color: colors.textMuted,
                    maxRotation: 45,
                    minRotation: 45,
                    font: { family: "'DM Sans', sans-serif" }
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
                pointBorderColor: '#0f172a',
                pointBorderWidth: 2,
                pointRadius: 5,
                pointHoverRadius: 7,
                borderWidth: 3
            }]
        },
        options: commonOptions
    });

    incomeVsExpenseChart = new Chart(incomeVsExpenseCtx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [
                {
                    label: t('chart.income'),
                    data: [],
                    backgroundColor: 'rgba(16, 185, 129, 0.8)',
                    borderColor: colors.success,
                    borderWidth: 2,
                    borderRadius: 6,
                    hoverBackgroundColor: colors.success
                },
                {
                    label: t('chart.expenses'),
                    data: [],
                    backgroundColor: 'rgba(239, 68, 68, 0.8)',
                    borderColor: colors.danger,
                    borderWidth: 2,
                    borderRadius: 6,
                    hoverBackgroundColor: colors.danger
                }
            ]
        },
        options: incomeExpenseOptions
    });

    // Category distribution chart (horizontal bar)
    const categoryColors = [
        '#fbbf24', '#3b82f6', '#a855f7', '#6366f1',
        '#ec4899', '#10b981', '#f97316', '#22c55e',
        '#94a3b8', '#14b8a6', '#8b5cf6', '#0ea5e9',
        '#ef4444', '#64748b'
    ];

    categoryChart = new Chart(categoryCtx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: t('chart.amount'),
                data: [],
                backgroundColor: categoryColors.map(c => c + 'cc'),
                borderColor: categoryColors,
                borderWidth: 2,
                borderRadius: 6,
                hoverBackgroundColor: categoryColors
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                title: {
                    display: true,
                    text: t('chart.expensesByCategory'),
                    color: colors.textPrimary,
                    font: { size: 14, weight: '600', family: "'Fraunces', serif" },
                    padding: { bottom: 20 }
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
                            return `$${context.parsed.x.toFixed(2)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    grid: { color: colors.gridColor, drawBorder: false },
                    ticks: {
                        color: colors.textMuted,
                        font: { family: "'DM Sans', sans-serif" },
                        callback: function(value) {
                            return '$' + value.toFixed(0);
                        }
                    }
                },
                y: {
                    grid: { display: false },
                    ticks: {
                        color: colors.textSecondary,
                        font: { size: 11, weight: '500', family: "'DM Sans', sans-serif" }
                    }
                }
            }
        }
    });

    // Stacked bar chart for expense categories by month
    const stackedCategoryColors = [
        '#fbbf24', '#3b82f6', '#a855f7', '#6366f1',
        '#ec4899', '#10b981', '#f97316', '#22c55e',
        '#94a3b8', '#14b8a6', '#8b5cf6', '#0ea5e9',
        '#ef4444', '#64748b', '#06b6d4', '#84cc16'
    ];

    const expenseCategories = ['food', 'groceries', 'transport', 'travel', 'entertainment',
        'utilities', 'healthcare', 'education', 'shopping', 'subscription',
        'housing', 'salary', 'freelance', 'investment', 'transfer', 'wedding', 'other'];

    const stackedDatasets = expenseCategories.map((category, index) => ({
        label: t('cat.' + category),
        data: [],
        backgroundColor: stackedCategoryColors[index % stackedCategoryColors.length] + 'cc',
        borderColor: stackedCategoryColors[index % stackedCategoryColors.length],
        borderWidth: 1,
        borderRadius: 3,
        hoverBackgroundColor: stackedCategoryColors[index % stackedCategoryColors.length]
    }));

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
                        font: { size: 10, family: "'DM Sans', sans-serif" },
                        boxWidth: 12,
                        padding: 10
                    }
                },
                title: {
                    display: true,
                    text: t('chart.expenseCatByMonth'),
                    color: colors.textPrimary,
                    font: { size: 14, weight: '600', family: "'Fraunces', serif" },
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
                    grid: { color: colors.gridColor, drawBorder: false },
                    ticks: {
                        color: colors.textMuted,
                        maxRotation: 45,
                        minRotation: 45,
                        font: { family: "'DM Sans', sans-serif" }
                    }
                },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    grid: { color: colors.gridColor, drawBorder: false },
                    ticks: {
                        color: colors.textMuted,
                        font: { family: "'DM Sans', sans-serif" },
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

        const annotations = {};

        if (avgIncome > 0) {
            annotations.avgIncomeLine = {
                type: 'line',
                yMin: avgIncome,
                yMax: avgIncome,
                borderColor: '#10b981',
                borderWidth: 2,
                borderDash: [6, 4],
                label: {
                    display: true,
                    content: t('chart.avgIncome', { value: avgIncome.toFixed(0) }),
                    position: 'start',
                    backgroundColor: 'rgba(16, 185, 129, 0.85)',
                    color: '#fff',
                    font: { size: 11, family: "'DM Sans', sans-serif" },
                    padding: 4
                }
            };
        }

        if (avgExpense > 0) {
            annotations.avgExpenseLine = {
                type: 'line',
                yMin: avgExpense,
                yMax: avgExpense,
                borderColor: '#ef4444',
                borderWidth: 2,
                borderDash: [6, 4],
                label: {
                    display: true,
                    content: t('chart.avgExpenses', { value: avgExpense.toFixed(0) }),
                    position: 'end',
                    backgroundColor: 'rgba(239, 68, 68, 0.85)',
                    color: '#fff',
                    font: { size: 11, family: "'DM Sans', sans-serif" },
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
    categoryChart.data.labels = sortedTags.map(([tag]) => t('cat.' + tag));
    categoryChart.data.datasets[0].data = sortedTags.map(([, amount]) => Math.round(amount * 100) / 100);
    categoryChart.update();

    // Update stacked category chart - expenses by category per month
    const expenseCategoryList = ['food', 'groceries', 'transport', 'travel', 'entertainment',
        'utilities', 'healthcare', 'education', 'shopping', 'subscription',
        'housing', 'salary', 'freelance', 'investment', 'transfer', 'wedding', 'other'];

    // Build a map: { month: { category: totalAmount } }
    const categoryMonthlyData = {};
    months.forEach(month => {
        categoryMonthlyData[month] = {};
        expenseCategoryList.forEach(cat => {
            categoryMonthlyData[month][cat] = 0;
        });
    });

    // Aggregate expense entries by month and category
    entriesToShow
        .filter(e => e.type === 'expense')
        .forEach(entry => {
            const month = entry.month;
            if (!categoryMonthlyData[month]) return;

            const entryTags = (entry.tags && entry.tags.length > 0) ? entry.tags : ['other'];
            const perTagAmount = parseFloat(entry.amount) / entryTags.length;

            entryTags.forEach(tag => {
                const normalizedTag = expenseCategoryList.includes(tag) ? tag : 'other';
                categoryMonthlyData[month][normalizedTag] += perTagAmount;
            });
        });

    // Update chart labels (months)
    categoryStackedChart.data.labels = months;

    // Determine which categories have any data
    const categoriesWithData = expenseCategoryList.filter(category => {
        return months.some(month => categoryMonthlyData[month][category] > 0);
    });

    // Update each dataset with monthly values for its category
    categoryStackedChart.data.datasets.forEach((dataset, index) => {
        const category = expenseCategoryList[index];
        dataset.data = months.map(month => {
            const value = categoryMonthlyData[month]?.[category] || 0;
            return Math.round(value * 100) / 100;
        });
        // Hide categories with no data from legend
        dataset.hidden = !categoriesWithData.includes(category);
    });

    categoryStackedChart.update();
}

// Filter entries based on selected criteria
function filterEntries() {
    const monthFilterStart = document.getElementById('monthFilterStart').value;
    const monthFilterEnd = document.getElementById('monthFilterEnd').value;
    const typeFilter = document.getElementById('typeFilter').value;
    const categoryFilterSelect = document.getElementById('categoryFilter');
    const selectedCategories = Array.from(categoryFilterSelect.selectedOptions).map(opt => opt.value);

    let filteredEntries = entries;

    if (monthFilterStart && monthFilterEnd) {
        filteredEntries = filteredEntries.filter(entry => {
            return entry.month >= monthFilterStart && entry.month <= monthFilterEnd;
        });
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
function displayEntries(entriesToShow) {
    const tbody = document.getElementById('entriesBody');
    tbody.innerHTML = '';

    // Apply current sorting if set, otherwise default to month descending
    let sortedEntries;
    if (currentSortColumn) {
        sortedEntries = sortEntries(entriesToShow, currentSortColumn, currentSortDirection);
    } else {
        sortedEntries = [...entriesToShow].sort((a, b) => b.month.localeCompare(a.month));
    }

    sortedEntries.forEach(entry => {
        const row = document.createElement('tr');
        const escapedDescription = escapeHtml(entry.description);
        const tags = (entry.tags || []).map(tag =>
            `<span class="tag tag-${escapeHtml(tag)}">${escapeHtml(t('cat.' + tag))}</span>`
        ).join(' ');
        const coupleBadge = entry.isCoupleExpense ? `<span class="couple-badge">${t('dash.couple')}</span>` : '';

        // In combined view, only show Edit/Delete for user's own entries
        const isOwnEntry = !currentUser || entry.userId === currentUser.id;
        const actionButtons = isOwnEntry
            ? `<button class="edit-btn" data-id="${entry.id}">${t('common.edit')}</button>
               <button class="delete-btn" data-id="${entry.id}">${t('common.delete')}</button>`
            : `<span style="color: var(--text-secondary); font-size: 0.75rem;">${t('dash.partnersEntry')}</span>`;

        row.innerHTML = `
            <td>${escapeHtml(entry.month)}</td>
            <td><span class="entry-type entry-type-${escapeHtml(entry.type)}">${escapeHtml(entry.type)}</span></td>
            <td>$${parseFloat(entry.amount).toFixed(2)}</td>
            <td>${coupleBadge}${escapedDescription}</td>
            <td>${tags || '<span class="tag tag-other">-</span>'}</td>
            <td>${actionButtons}</td>
        `;
        tbody.appendChild(row);
    });

    // Update sort indicators
    updateSortIndicators();
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

    incomeEl.textContent = `$${totalIncome.toFixed(2)}`;
    incomeEl.style.color = '#10b981';

    expensesEl.textContent = `$${totalExpenses.toFixed(2)}`;
    expensesEl.style.color = '#ef4444';

    netEl.textContent = `$${netBalance.toFixed(2)}`;
    netEl.style.color = netBalance >= 0 ? '#f59e0b' : '#ef4444';
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
    const hasKey = provider === 'openai'
        ? (currentUser && currentUser.hasOpenaiKeyAvailable)
        : (currentUser && currentUser.hasGeminiKeyAvailable);

    if (hasKey) {
        statusDiv.innerHTML = `<span style="color: var(--color-success);">&#10003;</span> <span style="color: var(--color-success);">${t('bulk.keyStored')}</span>`;
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

// Category options for dropdowns
const categoryOptions = ['food', 'groceries', 'transport', 'travel', 'entertainment', 'utilities', 'healthcare', 'education', 'shopping', 'subscription', 'housing', 'salary', 'freelance', 'investment', 'transfer', 'wedding', 'other'];

function generateCategorySelect(selectedTag, index) {
    const options = categoryOptions.map(cat =>
        `<option value="${cat}"${cat === selectedTag ? ' selected' : ''}>${t('cat.' + cat)}</option>`
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
        : (currentUser && currentUser.hasGeminiKeyAvailable);
    if (!currentUser || !hasKey) {
        alert(t('bulk.alertEnterKey'));
        return;
    }

    // Show loading indicator
    loadingIndicator.style.display = 'block';
    processBulkPdfBtn.disabled = true;
    processBulkPdfBtn.textContent = t('bulk.processing');

    const formData = new FormData();
    formData.append('pdfFile', pdfFile);
    try {
        const response = await fetch('/api/process-pdf', {
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
        processBulkPdfBtn.disabled = false;
        processBulkPdfBtn.textContent = t('bulk.uploadProcess');
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

confirmBulkEntriesBtn.addEventListener('click', async () => {
    if (bulkExtractedEntries.length > 0) {
        try {
            // Save each entry to the server with their current type and tags
            const savePromises = bulkExtractedEntries.map(async (entry) => {
                const response = await fetch('/api/entries', {
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
                    throw new Error(`Failed to save entry: ${response.statusText}`);
                }

                return await response.json();
            });

            // Wait for all entries to be saved
            const savedEntries = await Promise.all(savePromises);

            // Reload entries from server to ensure view mode filtering is applied correctly
            await window.loadEntries();

            // Close modal and show success message
            bulkUploadModal.style.display = 'none';
            alert(t('bulk.successAdd', { count: savedEntries.length }));

        } catch (error) {
            console.error('Error saving bulk entries:', error);
            alert(t('bulk.errorSave', { message: error.message }));
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

    // Load entries from server
    fetch('/api/entries')
        .then(response => response.json())
        .then(data => {
            entries = data;
            // Initialize currentFilteredEntries to all entries
            currentFilteredEntries = entries;
            displayEntries(entries);
            updateSummary(entries);
            updateCharts(entries, true);
            updateCoupleShare(entries);
        })
        .catch(error => console.error('Error loading entries:', error));

    // Remove any previous event listeners to avoid duplicates
    const oldForm = document.getElementById('entryForm');
    const newForm = oldForm.cloneNode(true);
    oldForm.parentNode.replaceChild(newForm, oldForm);
    // Attach robust submit handler
    newForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = newForm.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = t('modal.saving');
        }

        // --- Manual Entry Logic ---
        let rawAmount = document.getElementById('amount').value;
        let amountValue = rawAmount.replace(/\s/g, '').replace(/,/g, '.');
        // Remove thousands separators (dots not followed by digits)
        amountValue = amountValue.replace(/(\.(?=\d{3}(\.|$)))/g, '');
        const parsedAmount = parseFloat(amountValue);
        if (isNaN(parsedAmount) || amountValue.trim() === '') {
            alert(t('entry.alertValidAmount'));
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = t('modal.addEntryBtn');
            }
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
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = t('modal.addEntryBtn');
            }
            return;
        }
        try {
            const response = await fetch('/api/entries', {
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
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = t('modal.addEntryBtn');
            }
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
                try {
                    const response = await fetch(`/api/entries/${id}`, {
                        method: 'DELETE'
                    });

                    if (response.ok) {
                        // Remove entry from the local array *without* full page reload
                        entries = entries.filter(entry => entry.id !== id);
                        // Re-apply current filters to update the display
                        filterEntries();
                    } else {
                        console.error('Error deleting entry on server:', response.statusText);
                        alert(t('entry.alertDeleteFailed'));
                    }
                } catch (error) {
                    console.error('Error deleting entry:', error);
                     alert(t('entry.alertDeleteError'));
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
            const response = await fetch(`/api/entries/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedEntry)
            });

            if (response.ok) {
                // Reload entries from server to ensure view mode filtering is applied correctly
                await loadEntries();
                document.getElementById('editEntryModal').style.display = 'none';
            } else {
                alert(t('entry.alertUpdateFailed'));
            }
        } catch (error) {
            console.error('Error updating entry:', error);
            alert(t('entry.alertUpdateError'));
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
        document.getElementById('monthFilterStart').value = '';
        document.getElementById('monthFilterEnd').value = '';
        document.getElementById('typeFilter').value = 'all';
        // Deselect all options in multi-select
        const categoryFilter = document.getElementById('categoryFilter');
        Array.from(categoryFilter.options).forEach(opt => opt.selected = false);
        // Reset currentFilteredEntries to all entries
        currentFilteredEntries = entries;
        // Reset filters should show ALL entries again
        displayEntries(entries);
        updateSummary(entries);
        updateCharts(entries, true);
        updateCoupleShare(entries);
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
            displayEntries(currentFilteredEntries);
        });
    });

    // Add New Entry button opens modal
    document.getElementById('addEntryBtn').addEventListener('click', openModal);
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
        try {
            await fetch('/api/logout', { method: 'POST', credentials: 'include' });
            window.location.href = '/login.html';
        } catch (error) {
            alert(t('logout.failed'));
        }
    });

    document.getElementById('settingsBtn').addEventListener('click', openSettingsModal);

    document.getElementById('monthFilterStart').addEventListener('input', filterEntries);
    document.getElementById('monthFilterEnd').addEventListener('input', filterEntries);
    document.getElementById('typeFilter').addEventListener('change', filterEntries);
    document.getElementById('categoryFilter').addEventListener('change', filterEntries);

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
                        <button type="button" id="settingsAiProviderSaveBtn" class="edit-btn" style="padding: 0.4rem 0.8rem;">${t('common.save')}</button>
                    </div>
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
        wireSettingsAiProvider(overlay);
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
            try {
                const response = await fetch('/api/user/email', {
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
                    try {
                        const response = await fetch('/api/user/2fa/disable', {
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
                enableBtn.disabled = true;
                enableBtn.textContent = t('common.loading');

                try {
                    const response = await fetch('/api/user/2fa/setup', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include'
                    });

                    if (!response.ok) {
                        alert(t('error.generic'));
                        enableBtn.disabled = false;
                        enableBtn.textContent = t('settings.enable2FA');
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

                        verifyBtn.disabled = true;
                        try {
                            const vRes = await fetch('/api/user/2fa/verify', {
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
                                verifyBtn.disabled = false;
                            }
                        } catch (e) {
                            alert(t('error.generic'));
                            verifyBtn.disabled = false;
                        }
                    }

                    verifyBtn.addEventListener('click', verifySetup);
                    codeInput.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') verifySetup();
                    });

                } catch (e) {
                    alert(t('error.generic'));
                    enableBtn.disabled = false;
                    enableBtn.textContent = t('settings.enable2FA');
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
                    try {
                        const response = await fetch('/api/user/gemini-key', { method: 'DELETE', credentials: 'include' });
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
                try {
                    const response = await fetch('/api/user/gemini-key', {
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
                    try {
                        const response = await fetch('/api/user/openai-key', { method: 'DELETE', credentials: 'include' });
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
                try {
                    const response = await fetch('/api/user/openai-key', {
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

    function wireSettingsAiProvider(overlay) {
        const saveBtn = overlay.querySelector('#settingsAiProviderSaveBtn');
        if (!saveBtn) return;

        saveBtn.addEventListener('click', async () => {
            const selected = overlay.querySelector('input[name="aiProvider"]:checked');
            if (!selected) return;
            const provider = selected.value;
            try {
                const response = await fetch('/api/user/ai-provider', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ aiProvider: provider }),
                    credentials: 'include'
                });
                if (response.ok) {
                    currentUser.aiProvider = provider;
                    updateAiKeyUI();
                    alert(t('settings.aiProviderSaveSuccess'));
                } else {
                    alert(t('settings.aiProviderSaveError'));
                }
            } catch (e) {
                alert(t('settings.aiProviderSaveError'));
            }
        });
    }

    // Fetch current user info on load
    async function fetchCurrentUser() {
        try {
            const response = await fetch('/api/user');
            if (response.ok) {
                currentUser = await response.json();
                hasPartner = !!currentUser.partnerId;
                updateUIForRole();
                updateUIForPartner();
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
        if (currentUser && currentUser.role === 'admin') {
            adminBtn.style.display = 'inline-flex';
        } else {
            adminBtn.style.display = 'none';
        }
    }

    // Update UI for couple features
    function updateUIForPartner() {
        const viewModeContainer = document.getElementById('viewModeContainer');
        const coupleExpenseToggle = document.getElementById('coupleExpenseToggle');
        const editCoupleExpenseToggle = document.getElementById('editCoupleExpenseToggle');
        const partnerInfo = document.getElementById('partnerInfo');

        if (hasPartner) {
            viewModeContainer.style.display = 'flex';
            if (coupleExpenseToggle) coupleExpenseToggle.style.display = 'block';
            if (editCoupleExpenseToggle) editCoupleExpenseToggle.style.display = 'block';
            if (partnerInfo && currentUser.partnerUsername) {
                partnerInfo.textContent = t('common.partner') + ': ' + currentUser.partnerUsername;
            }
        } else {
            viewModeContainer.style.display = 'none';
            if (coupleExpenseToggle) coupleExpenseToggle.style.display = 'none';
            if (editCoupleExpenseToggle) editCoupleExpenseToggle.style.display = 'none';
        }
    }

    // Set view mode and reload entries
    function setViewMode(mode) {
        currentViewMode = mode;

        // Update button states
        document.getElementById('individualViewBtn').classList.toggle('active', mode === 'individual');
        document.getElementById('combinedViewBtn').classList.toggle('active', mode === 'combined');

        // Reload entries with new view mode
        loadEntries();
    }

    // Load entries from server with viewMode
    async function loadEntries() {
        try {
            const response = await fetch(`/api/entries?viewMode=${currentViewMode}`);
            if (response.ok) {
                entries = await response.json();
                // Re-apply any active filters so the UI stays consistent
                filterEntries();
            }
        } catch (error) {
            console.error('Error loading entries:', error);
        }
    }
    window.loadEntries = loadEntries;

    // Load users for admin panel
    async function loadUsersForAdmin() {
        try {
            const response = await fetch('/api/admin/users');
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
                ? `<span class="partner-badge">${user.partnerUsername}</span>`
                : '-';
            const emailDisplay = user.hasEmail
                ? '<span style="color: var(--color-success);">&#10003;</span>'
                : '<span style="color: var(--color-text-muted);">-</span>';
            const twoFADisplay = user.has2FA
                ? '<span style="color: var(--color-success);">&#10003;</span>'
                : '<span style="color: var(--color-text-muted);">-</span>';
            row.innerHTML = `
                <td>${user.id}</td>
                <td>${user.username}</td>
                <td><span class="role-badge role-${user.role}">${user.role === 'admin' ? t('admin.roleAdmin') : t('admin.roleUser')}</span></td>
                <td>${emailDisplay}</td>
                <td>${twoFADisplay}</td>
                <td>${partnerDisplay}</td>
                <td><span class="status-badge status-${user.isActive ? 'active' : 'inactive'}">
                    ${user.isActive ? t('admin.active') : t('admin.inactive')}</span></td>
                <td>${new Date(user.createdAt).toLocaleDateString()}</td>
                <td>${user.entriesCount || 0}</td>
                <td class="user-actions">
                    <button class="edit-btn" onclick="toggleUserStatus(${user.id}, ${!user.isActive})">${user.isActive ? t('admin.deactivate') : t('admin.activate')}</button>
                    ${user.id !== currentUser.id ?
                        `<button class="delete-btn" onclick="deleteUser(${user.id})">${t('common.delete')}</button>` : ''}
                </td>
            `;
            tbody.appendChild(row);
        });
    }

    // Toggle user active status
    window.toggleUserStatus = async function(userId, newStatus) {
        try {
            const response = await fetch(`/api/admin/users/${userId}`, {
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
        }
    };

    // Delete user
    window.deleteUser = async function(userId) {
        if (!confirm(t('admin.confirmDeleteUser'))) {
            return;
        }

        try {
            const response = await fetch(`/api/admin/users/${userId}`, {
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
        }
    };

    // Create user from admin panel
    document.getElementById('createUserForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const username = document.getElementById('newUsername').value;
        const password = document.getElementById('newPassword').value;
        const role = document.getElementById('newRole').value;

        try {
            const response = await fetch('/api/admin/users', {
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
            const response = await fetch('/api/admin/couples');
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
                <td>${couple.user1.username}</td>
                <td>${couple.user2.username}</td>
                <td>${new Date(couple.linkedAt).toLocaleDateString()}</td>
                <td>
                    <button class="delete-btn" onclick="unlinkCouple(${couple.user1.id})">${t('admin.unlink')}</button>
                </td>
            `;
            tbody.appendChild(row);
        });
    }

    // Populate couple dropdowns with unlinked users
    async function populateCoupleDropdowns() {
        try {
            const response = await fetch('/api/admin/users');
            if (response.ok) {
                const users = await response.json();
                const unlinkedUsers = users.filter(u => !u.partnerId && u.isActive);

                const select1 = document.getElementById('coupleUser1');
                const select2 = document.getElementById('coupleUser2');

                if (!select1 || !select2) return;

                [select1, select2].forEach(select => {
                    select.innerHTML = `<option value="">${t('admin.selectUser')}</option>`;
                    unlinkedUsers.forEach(user => {
                        select.innerHTML += `<option value="${user.id}">${user.username}</option>`;
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

            try {
                const response = await fetch('/api/admin/couples/link', {
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
            }
        });
    }

    // Unlink couple
    window.unlinkCouple = async function(userId) {
        if (!confirm(t('admin.confirmUnlink'))) return;

        try {
            const response = await fetch('/api/admin/couples/unlink', {
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
        }
    };

    // ============ INVITE CODE MANAGEMENT ============

    async function loadInviteCodesForAdmin() {
        try {
            const response = await fetch('/api/admin/invite-codes');
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

                try {
                    const response = await fetch(`/api/admin/invite-codes/${codeVal}`, {
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
                }
            });
        });
    }

    const generateInviteCodeBtn = document.getElementById('generateInviteCodeBtn');
    if (generateInviteCodeBtn) {
        generateInviteCodeBtn.addEventListener('click', async () => {
            try {
                const response = await fetch('/api/admin/invite-codes', {
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

    // Fetch current user on load
    fetchCurrentUser();
});
