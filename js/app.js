let entries = [];
let monthlyBalanceChart = null;
let incomeVsExpenseChart = null;
// Add a variable to track currently filtered entries
let currentFilteredEntries = [];

// Sorting state
let currentSortColumn = null;
let currentSortDirection = 'asc';

// Initialize charts
function initializeCharts() {
    const monthlyBalanceCtx = document.getElementById('monthlyBalanceChart').getContext('2d');
    const incomeVsExpenseCtx = document.getElementById('incomeVsExpenseChart').getContext('2d');

    // Common chart options for better visibility
    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                labels: {
                    color: '#111', // black for contrast
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
                    color: '#404040'
                },
                ticks: {
                    color: '#111' // black for contrast
                }
            },
            x: {
                grid: {
                    color: '#404040'
                },
                ticks: {
                    color: '#111', // black for contrast
                    maxRotation: 45,
                    minRotation: 45
                }
            }
        }
    };

    // Specific options for income vs expense chart with positive/negative values
    const incomeExpenseOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                labels: {
                    color: '#111',
                    font: {
                        size: 12
                    }
                }
            },
            tooltip: {
                callbacks: {
                    label: function(context) {
                        const label = context.dataset.label || '';
                        const value = Math.abs(context.parsed.y);
                        return `${label}: $${value.toFixed(2)}`;
                    }
                }
            }
        },
        scales: {
            y: {
                beginAtZero: true,
                grid: {
                    color: '#404040',
                    drawBorder: true,
                    zeroLineColor: '#000000',
                    zeroLineWidth: 2
                },
                ticks: {
                    color: '#111',
                    callback: function(value) {
                        return '$' + Math.abs(value).toFixed(0);
                    }
                }
            },
            x: {
                grid: {
                    color: '#404040'
                },
                ticks: {
                    color: '#111',
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
                borderColor: '#2ecc71',
                backgroundColor: 'rgba(46, 204, 113, 0.1)',
                tension: 0.1,
                fill: true
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
                    backgroundColor: '#2ecc71',
                    borderColor: '#27ae60',
                    borderWidth: 1
                },
                {
                    label: 'Expenses',
                    data: [],
                    backgroundColor: '#e74c3c',
                    borderColor: '#c0392b',
                    borderWidth: 1
                }
            ]
        },
        options: incomeExpenseOptions
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
function updateCharts(entriesToShow = entries, forceDefaultMonths = false) {
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
    } else {
        const availableMonths = Object.keys(monthlyData).sort();
        if (availableMonths.length === 0) {
            months = getMonthLabelsAroundCurrent();
        } else if (availableMonths.length === 1) {
            // If only one month has data, show a range around it
            months = availableMonths;
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
    incomeVsExpenseChart.data.datasets[1].data = months.map(month => -(expenseData[month] || 0)); // Make expenses negative
    incomeVsExpenseChart.update();
}

// Filter entries based on selected criteria
function filterEntries() {
    const monthFilterStart = document.getElementById('monthFilterStart').value;
    const monthFilterEnd = document.getElementById('monthFilterEnd').value;
    const typeFilter = document.getElementById('typeFilter').value;

    let filteredEntries = entries;

    if (monthFilterStart && monthFilterEnd) {
        filteredEntries = filteredEntries.filter(entry => {
            return entry.month >= monthFilterStart && entry.month <= monthFilterEnd;
        });
    }

    if (typeFilter !== 'all') {
        filteredEntries = filteredEntries.filter(entry => entry.type === typeFilter);
    }

    // Store the current filtered entries for sorting
    currentFilteredEntries = filteredEntries;
    
    displayEntries(filteredEntries);
    updateSummary(filteredEntries);
    updateCharts(filteredEntries, false);
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
        row.innerHTML = `
            <td>${entry.month}</td>
            <td>${entry.type}</td>
            <td>$${parseFloat(entry.amount).toFixed(2)}</td>
            <td>${entry.description}</td>
            <td>
                <button class="delete-btn" data-id="${entry.id}">Delete</button>
            </td>
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

    document.getElementById('totalIncome').textContent = `$${totalIncome.toFixed(2)}`;
    document.getElementById('totalExpenses').textContent = `$${totalExpenses.toFixed(2)}`;
    document.getElementById('netBalance').textContent = `$${netBalance.toFixed(2)}`;
}

function updateSummaryCards(entriesToShow) {
    const totalIncome = entriesToShow.filter(e => e.type === 'income').reduce((sum, e) => sum + parseFloat(e.amount), 0);
    const totalExpense = entriesToShow.filter(e => e.type === 'expense').reduce((sum, e) => sum + parseFloat(e.amount), 0);
    const totalProfit = totalIncome - totalExpense;
    const elRevenue = document.getElementById('totalRevenue');
    const elExpense = document.getElementById('totalExpense');
    const elProfit = document.getElementById('totalProfit');
    if (elRevenue) elRevenue.textContent = `$${totalIncome.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}`;
    if (elExpense) elExpense.textContent = `$${totalExpense.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}`;
    if (elProfit) elProfit.textContent = `$${totalProfit.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}`;
}

function updateTransitionHistoryTable(entriesToShow) {
    const tbody = document.getElementById('transitionHistoryBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    // Show the 10 most recent entries (by month, then by id)
    const sorted = [...entriesToShow].sort((a, b) => b.month.localeCompare(a.month) || b.id - a.id).slice(0, 10);
    sorted.forEach(entry => {
        // Pick an icon based on description/type (simple emoji fallback)
        let icon = '💸';
        if (/upwork/i.test(entry.description)) icon = '<img src="https://upload.wikimedia.org/wikipedia/commons/5/5e/Upwork-logo.png" alt="Upwork" style="width:20px;height:20px;">';
        else if (/netflix/i.test(entry.description)) icon = '<img src="https://upload.wikimedia.org/wikipedia/commons/0/08/Netflix_2015_logo.svg" alt="Netflix" style="width:20px;height:20px;">';
        else if (/spotify/i.test(entry.description)) icon = '<img src="https://upload.wikimedia.org/wikipedia/commons/2/26/Spotify_logo_with_text.svg" alt="Spotify" style="width:20px;height:20px;">';
        else if (entry.type === 'income') icon = '💰';
        else if (entry.type === 'expense') icon = '💸';
        // Format date as DD MMM, YYYY
        let dateStr = entry.month;
        if (dateStr && dateStr.length === 7) {
            const [year, month] = dateStr.split('-');
            dateStr = `01 ${month} ${year}`;
            try {
                const d = new Date(`${year}-${month}-01`);
                dateStr = d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
            } catch {}
        }
        const status = entry.type === 'income' ? 'Credited' : 'Debited';
        const statusClass = entry.type === 'income' ? 'credited' : 'debited';
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><span class="icon">${icon}</span> ${entry.description}</td>
            <td>${entry.type.charAt(0).toUpperCase() + entry.type.slice(1)}</td>
            <td>$${parseFloat(entry.amount).toFixed(2)}</td>
            <td>${dateStr}</td>
            <td class="status ${statusClass}">${status}</td>
        `;
        tbody.appendChild(row);
    });
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
});

closeBulkUploadModalBtn.addEventListener('click', () => {
    bulkUploadModal.style.display = 'none';
});

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
            const batchExpenses = await response.json();
            const validExpenses = batchExpenses.filter(exp => exp && exp.month && exp.amount && exp.description);
            bulkExtractedEntries = validExpenses.map(exp => ({ ...exp, type: 'expense' }));
            // Preview in table
            bulkExtractedEntriesTbody.innerHTML = '';
            if (bulkExtractedEntries.length > 0) {
                bulkExtractedEntries.forEach(entry => {
                    const row = document.createElement('tr');
                    row.innerHTML = `<td>${entry.month}</td><td>$${parseFloat(entry.amount).toFixed(2)}</td><td>${entry.description}</td>`;
                    bulkExtractedEntriesTbody.appendChild(row);
                });
                confirmBulkEntriesBtn.style.display = 'inline-block';
            } else {
                bulkExtractedEntriesTbody.innerHTML = '<tr><td colspan="3">No valid entries found in PDF.</td></tr>';
                confirmBulkEntriesBtn.style.display = 'none';
            }
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



confirmBulkEntriesBtn.addEventListener('click', async () => {
    if (bulkExtractedEntries.length > 0) {
        try {
            // Save each entry to the server
            const savePromises = bulkExtractedEntries.map(async (entry) => {
                const response = await fetch('/api/entries', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        month: entry.month,
                        type: 'expense',
                        amount: entry.amount,
                        description: entry.description
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
    // Optionally clear error messages here if you add them
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
            updateSummaryCards(entries);
            updateTransitionHistoryTable(entries);
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
            const originalText = submitBtn.textContent;
            submitBtn.textContent = 'Saving...';
        }
        const pdfUploadInput = document.getElementById('pdfUpload');
        const pdfFile = pdfUploadInput ? pdfUploadInput.files[0] : null;

        if (pdfFile) {
            // --- PDF Upload Logic ---
            console.log('Processing PDF file...');
            const formData = new FormData();
            formData.append('pdfFile', pdfFile); // Match the name expected by the backend

            try {
                // Send PDF to your NEW backend endpoint for processing
                const response = await fetch('/api/process-pdf', { // *** YOU NEED TO CREATE THIS BACKEND ENDPOINT ***
                    method: 'POST',
                    body: formData // FormData sets the correct Content-Type automatically
                });

                if (response.ok) {
                    const batchExpenses = await response.json(); // Expecting an array of expense objects

                    // --- Batch Update ---
                    // Assuming backend returns array like: [{ month: 'YYYY-MM', amount: 123.45, description: '...', id: '...' }, ...]
                    // Filter out any potentially invalid entries returned by the backend/AI
                    const validExpenses = batchExpenses.filter(exp => exp && exp.month && exp.amount && exp.description);

                    if (validExpenses.length > 0) {
                        // Add the 'type' field as it's likely not coming from the PDF/AI
                        const newEntries = validExpenses.map(exp => ({
                            ...exp,
                            type: 'expense' // Explicitly set type for PDF uploads
                        }));

                        entries.push(...newEntries); // Add all new entries

                        // Re-apply current filters instead of showing all entries
                        filterEntries();
                        newForm.reset(); // Clear the form (including file input)
                        closeModal(); // Close modal
                        console.log(`Successfully added ${newEntries.length} expenses from PDF.`);
                    } else {
                         console.warn('PDF processed, but no valid expense data was extracted.');
                         alert('Could not extract valid expense data from the PDF.');
                    }

                } else {
                    // Handle backend processing errors (e.g., Gemini API issues)
                    const errorData = await response.text();
                    console.error('Error processing PDF on server:', response.statusText, errorData);
                    alert(`Error processing PDF: ${response.statusText}. Check server logs.`);
                }
            } catch (error) {
                console.error('Error sending PDF for processing:', error);
                alert('Failed to send PDF for processing. Check console for details.');
            }

        } else {
            // --- Original Single Entry Logic ---
            let rawAmount = document.getElementById('amount').value;
            console.log('[DEBUG] Raw amount input:', rawAmount);
            let amountValue = rawAmount.replace(/\s/g, '').replace(/,/g, '.');
            // Remove thousands separators (dots not followed by digits)
            amountValue = amountValue.replace(/(\.(?=\d{3}(\.|$)))/g, '');
            console.log('[DEBUG] Processed amount:', amountValue);
            const parsedAmount = parseFloat(amountValue);
            console.log('[DEBUG] parseFloat(amountValue):', parsedAmount);
            if (isNaN(parsedAmount) || amountValue.trim() === '') {
                alert('Please enter a valid number for Amount (use a dot as decimal separator).');
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = originalText;
                }
                return;
            }
            const entry = {
                month: document.getElementById('month').value,
                type: document.getElementById('type').value,
                amount: amountValue,
                description: document.getElementById('description').value
            };
            console.log('[DEBUG] Submitting entry:', entry);
            if (!entry.month || !entry.type || !entry.amount) {
                alert('Please fill in Month, Type, and Amount for manual entry.');
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = originalText;
                }
                return;
            }
            try {
                console.log('[DEBUG] Sending POST to /api/entries...');
                const response = await fetch('/api/entries', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(entry)
                });
                console.log('[DEBUG] Received response:', response.status);
                if (response.ok) {
                    const newEntry = await response.json();
                    console.log('[DEBUG] Entry added successfully:', newEntry);
                    entries.push(newEntry);
                    // Re-apply current filters to include the new entry if it matches
                    filterEntries();
                    newForm.reset();
                    closeModal();
                } else {
                    const errorData = await response.text();
                    console.error('[DEBUG] Error adding entry:', response.statusText, errorData);
                    alert(`Error adding entry: ${response.statusText}.`);
                }
            } catch (error) {
                console.error('[DEBUG] Fetch error:', error);
                alert('Failed to add entry. Check console for details.');
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Add Entry';
                }
                console.log('[DEBUG] Submit handler finished.');
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
                        entries = entries.filter(entry => entry.id !== id); // Now both are numbers
                        // Re-apply current filters to update the display
                        filterEntries();
                        // Optional: Show a success message
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
    });

    // Filter controls - only clear button now, apply is handled by dynamic listeners
    document.getElementById('clearFilters').addEventListener('click', () => {
        document.getElementById('monthFilterStart').value = '';
        document.getElementById('monthFilterEnd').value = '';
        document.getElementById('typeFilter').value = 'all';
        // Reset currentFilteredEntries to all entries
        currentFilteredEntries = entries;
        // Reset filters should show ALL entries again
        displayEntries(entries);
        updateSummary(entries);
        updateCharts(entries, true); // Update charts based on all entries
        updateSummaryCards(entries);
        updateTransitionHistoryTable(entries);
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
}); 