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

    // Common chart options for better visibility
    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                labels: {
                    color: '#1e293b',
                    font: {
                        size: 12
                    }
                }
            }
        },
        scales: {
            y: {
                beginAtZero: true,
                grid: {
                    color: '#e2e8f0'
                },
                ticks: {
                    color: '#475569'
                }
            },
            x: {
                grid: {
                    color: '#e2e8f0'
                },
                ticks: {
                    color: '#475569',
                    maxRotation: 45,
                    minRotation: 45
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
                    color: '#1e293b',
                    font: {
                        size: 12
                    }
                }
            },
            tooltip: {
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
            y: {
                beginAtZero: true,
                grid: {
                    color: '#e2e8f0'
                },
                ticks: {
                    color: '#475569',
                    callback: function(value) {
                        return '$' + value.toFixed(0);
                    }
                }
            },
            x: {
                grid: {
                    color: '#e2e8f0'
                },
                ticks: {
                    color: '#475569',
                    maxRotation: 45,
                    minRotation: 45
                }
            }
        }
    };

    monthlyBalanceChart = new Chart(monthlyBalanceCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Monthly Balance',
                data: [],
                borderColor: '#2563eb',
                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                tension: 0.3,
                fill: true,
                pointBackgroundColor: '#2563eb',
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 6
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
                    label: 'Income',
                    data: [],
                    backgroundColor: '#10b981',
                    borderColor: '#059669',
                    borderWidth: 1,
                    borderRadius: 4
                },
                {
                    label: 'Expenses',
                    data: [],
                    backgroundColor: '#ef4444',
                    borderColor: '#dc2626',
                    borderWidth: 1,
                    borderRadius: 4
                }
            ]
        },
        options: incomeExpenseOptions
    });

    // Category distribution chart (horizontal bar)
    const categoryColors = [
        '#f59e0b', '#3b82f6', '#8b5cf6', '#6366f1',
        '#ec4899', '#10b981', '#f97316', '#22c55e',
        '#94a3b8', '#14b8a6', '#a855f7', '#0ea5e9',
        '#ef4444', '#737373'
    ];

    categoryChart = new Chart(categoryCtx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: 'Amount',
                data: [],
                backgroundColor: categoryColors,
                borderColor: categoryColors.map(c => c),
                borderWidth: 1,
                borderRadius: 4
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
                    text: 'Expenses by Category',
                    color: '#1e293b',
                    font: { size: 14, weight: '600' },
                    padding: { bottom: 15 }
                },
                tooltip: {
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
                    grid: { color: '#e2e8f0' },
                    ticks: {
                        color: '#475569',
                        callback: function(value) {
                            return '$' + value.toFixed(0);
                        }
                    }
                },
                y: {
                    grid: { display: false },
                    ticks: {
                        color: '#1e293b',
                        font: { size: 12, weight: '500' }
                    }
                }
            }
        }
    });

    // Stacked bar chart for expense categories by month
    const stackedCategoryColors = [
        '#f59e0b', '#3b82f6', '#8b5cf6', '#6366f1',
        '#ec4899', '#10b981', '#f97316', '#22c55e',
        '#94a3b8', '#14b8a6', '#a855f7', '#0ea5e9',
        '#ef4444', '#737373', '#06b6d4', '#84cc16'
    ];

    const expenseCategories = ['food', 'groceries', 'transport', 'travel', 'entertainment',
        'utilities', 'healthcare', 'education', 'shopping', 'subscription',
        'housing', 'salary', 'freelance', 'investment', 'transfer', 'other'];

    const stackedDatasets = expenseCategories.map((category, index) => ({
        label: category.charAt(0).toUpperCase() + category.slice(1),
        data: [],
        backgroundColor: stackedCategoryColors[index % stackedCategoryColors.length],
        borderColor: stackedCategoryColors[index % stackedCategoryColors.length],
        borderWidth: 1,
        borderRadius: 2
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
                        color: '#1e293b',
                        font: { size: 10 },
                        boxWidth: 12,
                        padding: 8
                    }
                },
                title: {
                    display: true,
                    text: 'Expense Categories by Month',
                    color: '#1e293b',
                    font: { size: 14, weight: '600' },
                    padding: { bottom: 10 }
                },
                tooltip: {
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
                    grid: { color: '#e2e8f0' },
                    ticks: {
                        color: '#475569',
                        maxRotation: 45,
                        minRotation: 45
                    }
                },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    grid: { color: '#e2e8f0' },
                    ticks: {
                        color: '#475569',
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
    const start = new Date(startMonth + '-01');
    const end = new Date(endMonth + '-01');

    const current = new Date(start);
    while (current <= end) {
        const year = current.getFullYear();
        const month = (current.getMonth() + 1).toString().padStart(2, '0');
        months.push(`${year}-${month}`);
        current.setMonth(current.getMonth() + 1);
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
    monthlyBalanceChart.data.datasets[0].label = forceDefaultMonths ? 'Total Asset Progression (Last 6 Months)' : 'Total Asset Progression';
    monthlyBalanceChart.update();

    incomeVsExpenseChart.data.labels = months;
    incomeVsExpenseChart.data.datasets[0].data = months.map(month => incomeData[month] || 0);
    incomeVsExpenseChart.data.datasets[1].data = months.map(month => expenseData[month] || 0);
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
    categoryChart.data.labels = sortedTags.map(([tag]) => tag.charAt(0).toUpperCase() + tag.slice(1));
    categoryChart.data.datasets[0].data = sortedTags.map(([, amount]) => Math.round(amount * 100) / 100);
    categoryChart.update();

    // Update stacked category chart - expenses by category per month
    const expenseCategoryList = ['food', 'groceries', 'transport', 'travel', 'entertainment',
        'utilities', 'healthcare', 'education', 'shopping', 'subscription',
        'housing', 'salary', 'freelance', 'investment', 'transfer', 'other'];

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
        const tags = (entry.tags || []).map(t =>
            `<span class="tag tag-${t}">${t}</span>`
        ).join(' ');
        const coupleBadge = entry.isCoupleExpense ? '<span class="couple-badge">Couple</span>' : '';

        // In combined view, only show Edit/Delete for user's own entries
        const isOwnEntry = !currentUser || entry.userId === currentUser.id;
        const actionButtons = isOwnEntry
            ? `<button class="edit-btn" data-id="${entry.id}">Edit</button>
               <button class="delete-btn" data-id="${entry.id}">Delete</button>`
            : '<span style="color: var(--text-secondary); font-size: 0.75rem;">Partner\'s entry</span>';

        row.innerHTML = `
            <td>${entry.month}</td>
            <td><span class="entry-type entry-type-${entry.type}">${entry.type}</span></td>
            <td>$${parseFloat(entry.amount).toFixed(2)}</td>
            <td>${coupleBadge}${entry.description}</td>
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
    netEl.style.color = netBalance >= 0 ? '#2563eb' : '#ef4444';
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
});

closeBulkUploadModalBtn.addEventListener('click', () => {
    bulkUploadModal.style.display = 'none';
});

// Category options for dropdowns
const categoryOptions = ['food', 'groceries', 'transport', 'travel', 'entertainment', 'utilities', 'healthcare', 'education', 'shopping', 'subscription', 'housing', 'salary', 'freelance', 'investment', 'transfer', 'other'];

function generateCategorySelect(selectedTag, index) {
    const options = categoryOptions.map(cat =>
        `<option value="${cat}"${cat === selectedTag ? ' selected' : ''}>${cat.charAt(0).toUpperCase() + cat.slice(1)}</option>`
    ).join('');
    return `<select class="preview-select category-select" data-index="${index}">${options}</select>`;
}

function generateTypeSelect(selectedType, index) {
    return `<select class="preview-select type-select" data-index="${index}">
        <option value="expense"${selectedType === 'expense' ? ' selected' : ''}>Expense</option>
        <option value="income"${selectedType === 'income' ? ' selected' : ''}>Income</option>
    </select>`;
}

processBulkPdfBtn.addEventListener('click', async () => {
    const pdfFile = bulkPdfUploadInput.files[0];
    if (!pdfFile) {
        alert('Please select a PDF file.');
        return;
    }

    // Show loading indicator
    loadingIndicator.style.display = 'block';
    processBulkPdfBtn.disabled = true;
    processBulkPdfBtn.textContent = 'Processing...';

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
            const errorData = await response.text();
            alert(`Error processing PDF: ${response.statusText}. ${errorData}`);
        }
    } catch (error) {
        alert('Failed to process PDF. Check console for details.');
        console.error(error);
    } finally {
        // Hide loading indicator and reset button
        loadingIndicator.style.display = 'none';
        processBulkPdfBtn.disabled = false;
        processBulkPdfBtn.textContent = 'Upload and Process';
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
        alert('Please enter a valid month in YYYY-MM format');
        return false;
    }

    // Validate amount is a positive number
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
        alert('Please enter a valid positive amount');
        return false;
    }

    // Validate description is not empty after trimming
    if (!description) {
        alert('Please enter a description');
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
                        <button class="bulk-action-btn bulk-action-btn--save bulk-save-btn" data-index="${index}" aria-label="Save changes to entry: ${escapedDescription}">Save</button>
                        <button class="bulk-action-btn bulk-action-btn--cancel bulk-cancel-btn" data-index="${index}" aria-label="Cancel editing entry: ${escapedDescription}">Cancel</button>
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
                        <button class="bulk-action-btn bulk-action-btn--edit bulk-edit-btn" data-index="${index}" aria-label="Edit entry: ${escapedDescription}">Edit</button>
                        <button class="bulk-action-btn bulk-action-btn--delete bulk-delete-btn" data-index="${index}" aria-label="Delete entry: ${escapedDescription}">Delete</button>
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
                if (confirm('Delete this entry from the preview?')) {
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
        bulkExtractedEntriesTbody.innerHTML = `<tr><td colspan="${colspan}">No valid entries found in PDF.</td></tr>`;
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

            // Update local entries array with server-saved entries (which have proper IDs)
            entries.push(...savedEntries);

            // Re-apply current filters instead of showing all entries
            filterEntries();

            // Close modal and show success message
            bulkUploadModal.style.display = 'none';
            alert(`Successfully added ${savedEntries.length} entries to your database!`);

        } catch (error) {
            console.error('Error saving bulk entries:', error);
            alert(`Error saving entries: ${error.message}. Some entries may not have been saved.`);
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
            submitBtn.textContent = 'Saving...';
        }

        // --- Manual Entry Logic ---
        let rawAmount = document.getElementById('amount').value;
        let amountValue = rawAmount.replace(/\s/g, '').replace(/,/g, '.');
        // Remove thousands separators (dots not followed by digits)
        amountValue = amountValue.replace(/(\.(?=\d{3}(\.|$)))/g, '');
        const parsedAmount = parseFloat(amountValue);
        if (isNaN(parsedAmount) || amountValue.trim() === '') {
            alert('Please enter a valid number for Amount (use a dot as decimal separator).');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Add Entry';
            }
            return;
        }

        const tagsInput = document.getElementById('tags').value;
        const tags = tagsInput ? tagsInput.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) : [];
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
            alert('Please fill in Month, Type, and Amount for manual entry.');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Add Entry';
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
                const newEntry = await response.json();
                entries.push(newEntry);
                // Re-apply current filters to include the new entry if it matches
                filterEntries();
                newForm.reset();
                closeModal();
            } else {
                const errorData = await response.text();
                console.error('Error adding entry:', response.statusText, errorData);
                alert(`Error adding entry: ${response.statusText}.`);
            }
        } catch (error) {
            console.error('Fetch error:', error);
            alert('Failed to add entry. Check console for details.');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Add Entry';
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
            const confirmation = confirm('Are you sure you want to delete this entry?');
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
                        alert('Failed to delete entry on server.');
                    }
                } catch (error) {
                    console.error('Error deleting entry:', error);
                     alert('Failed to delete entry. Check console for details.');
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
        const tags = tagsInput ? tagsInput.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) : [];
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
                const savedEntry = await response.json();
                // Update local entries array
                const index = entries.findIndex(entry => entry.id === id);
                if (index !== -1) {
                    entries[index] = savedEntry;
                }
                document.getElementById('editEntryModal').style.display = 'none';
                filterEntries();
            } else {
                alert('Failed to update entry.');
            }
        } catch (error) {
            console.error('Error updating entry:', error);
            alert('Failed to update entry. Check console for details.');
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
            alert('Logout failed.');
        }
    });

    document.getElementById('monthFilterStart').addEventListener('input', filterEntries);
    document.getElementById('monthFilterEnd').addEventListener('input', filterEntries);
    document.getElementById('typeFilter').addEventListener('change', filterEntries);
    document.getElementById('categoryFilter').addEventListener('change', filterEntries);

    // ============ ADMIN PANEL FUNCTIONALITY ============

    // Fetch current user info on load
    async function fetchCurrentUser() {
        try {
            const response = await fetch('/api/user');
            if (response.ok) {
                currentUser = await response.json();
                hasPartner = !!currentUser.partnerId;
                updateUIForRole();
                updateUIForPartner();
            }
        } catch (error) {
            console.error('Error fetching user:', error);
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
                partnerInfo.textContent = `Partner: ${currentUser.partnerUsername}`;
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

    // Display users in admin table
    function displayUsersTable(users) {
        const tbody = document.getElementById('usersTableBody');
        tbody.innerHTML = '';

        users.forEach(user => {
            const row = document.createElement('tr');
            const partnerDisplay = user.partnerUsername
                ? `<span class="partner-badge">${user.partnerUsername}</span>`
                : '-';
            row.innerHTML = `
                <td>${user.id}</td>
                <td>${user.username}</td>
                <td><span class="role-badge role-${user.role}">${user.role}</span></td>
                <td>${partnerDisplay}</td>
                <td><span class="status-badge status-${user.isActive ? 'active' : 'inactive'}">
                    ${user.isActive ? 'Active' : 'Inactive'}</span></td>
                <td>${new Date(user.createdAt).toLocaleDateString()}</td>
                <td>${user.entriesCount || 0}</td>
                <td class="user-actions">
                    <button class="edit-btn" onclick="toggleUserStatus(${user.id}, ${!user.isActive})">${user.isActive ? 'Deactivate' : 'Activate'}</button>
                    ${user.id !== currentUser.id ?
                        `<button class="delete-btn" onclick="deleteUser(${user.id})">Delete</button>` : ''}
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
                alert(data.message || 'Failed to update user');
            }
        } catch (error) {
            alert('Error updating user');
        }
    };

    // Delete user
    window.deleteUser = async function(userId) {
        if (!confirm('Are you sure you want to delete this user? All their entries will also be deleted.')) {
            return;
        }

        try {
            const response = await fetch(`/api/admin/users/${userId}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                alert('User deleted successfully');
                loadUsersForAdmin();
            } else {
                const data = await response.json();
                alert(data.message || 'Failed to delete user');
            }
        } catch (error) {
            alert('Error deleting user');
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
                alert('User created successfully');
                loadUsersForAdmin();
                e.target.reset();
            } else {
                const data = await response.json();
                alert(data.message || 'Failed to create user');
            }
        } catch (error) {
            alert('Error creating user');
        }
    });

    // Admin panel modal handlers
    document.getElementById('adminPanelBtn').addEventListener('click', () => {
        document.getElementById('adminModal').style.display = 'block';
        loadUsersForAdmin();
        loadCouplesForAdmin();
        populateCoupleDropdowns();
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
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-secondary);">No couples linked yet</td></tr>';
            return;
        }

        couples.forEach(couple => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${couple.user1.username}</td>
                <td>${couple.user2.username}</td>
                <td>${new Date(couple.linkedAt).toLocaleDateString()}</td>
                <td>
                    <button class="delete-btn" onclick="unlinkCouple(${couple.user1.id})">Unlink</button>
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
                    select.innerHTML = '<option value="">Select user...</option>';
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
                alert('Please select both users');
                return;
            }

            if (userId1 === userId2) {
                alert('Please select two different users');
                return;
            }

            try {
                const response = await fetch('/api/admin/couples/link', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId1, userId2 })
                });

                if (response.ok) {
                    alert('Users linked as couple successfully');
                    loadCouplesForAdmin();
                    populateCoupleDropdowns();
                    loadUsersForAdmin();
                    e.target.reset();
                } else {
                    const data = await response.json();
                    alert(data.message || 'Failed to link users');
                }
            } catch (error) {
                alert('Error linking users');
            }
        });
    }

    // Unlink couple
    window.unlinkCouple = async function(userId) {
        if (!confirm('Are you sure you want to unlink this couple?')) return;

        try {
            const response = await fetch('/api/admin/couples/unlink', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId })
            });

            if (response.ok) {
                alert('Couple unlinked successfully');
                loadCouplesForAdmin();
                populateCoupleDropdowns();
                loadUsersForAdmin();
            } else {
                const data = await response.json();
                alert(data.message || 'Failed to unlink couple');
            }
        } catch (error) {
            alert('Error unlinking couple');
        }
    };

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
