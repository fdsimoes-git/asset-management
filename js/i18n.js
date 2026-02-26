// ============ INTERNATIONALIZATION (i18n) ============

const translations = {
  en: {
    // ── Language toggle ──
    'lang.switch': 'PT',
    'lang.switch.title': 'Switch to Portuguese',

    // ── Common ──
    'common.appName': 'Asset Manager',
    'common.assetManagement': 'Asset Management',
    'common.logout': 'Logout',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.actions': 'Actions',
    'common.or': 'or',
    'common.loading': 'Loading...',
    'common.username': 'Username',
    'common.password': 'Password',
    'common.email': 'Email',
    'common.month': 'Month',
    'common.type': 'Type',
    'common.amount': 'Amount',
    'common.description': 'Description',
    'common.status': 'Status',
    'common.created': 'Created',
    'common.role': 'Role',
    'common.partner': 'Partner',

    // ── Types ──
    'type.income': 'Income',
    'type.expense': 'Expense',
    'type.all': 'All',

    // ── Categories ──
    'cat.food': 'Food',
    'cat.groceries': 'Groceries',
    'cat.transport': 'Transport',
    'cat.travel': 'Travel',
    'cat.entertainment': 'Entertainment',
    'cat.utilities': 'Utilities',
    'cat.healthcare': 'Healthcare',
    'cat.education': 'Education',
    'cat.shopping': 'Shopping',
    'cat.subscription': 'Subscription',
    'cat.housing': 'Housing',
    'cat.salary': 'Salary',
    'cat.freelance': 'Freelance',
    'cat.investment': 'Investment',
    'cat.transfer': 'Transfer',
    'cat.wedding': 'Wedding',
    'cat.other': 'Other',

    // ── Dashboard header ──
    'dash.addEntry': 'Add New Entry',
    'dash.bulkUpload': 'Bulk PDF Upload',
    'dash.settings': 'Settings',
    'dash.adminPanel': 'Admin Panel',

    // ── Filters ──
    'dash.filters': 'Filters',
    'dash.startMonth': 'Start Month',
    'dash.endMonth': 'End Month',
    'dash.category': 'Category',
    'dash.clearFilters': 'Clear Filters',

    // ── View mode ──
    'dash.viewMode': 'View Mode',
    'dash.individual': 'Individual',
    'dash.combined': 'Combined (Couple)',

    // ── Couple share ──
    'dash.expenseShare': 'Expense Share',
    'dash.you': 'You',
    'dash.partnerLabel': 'Partner',
    'dash.ofTotal': '{percent}% of total',
    'dash.settlement': 'Settlement',
    'dash.allSettled': 'All settled up!',
    'dash.noExpenses': 'No expenses recorded',
    'dash.bothPaidEqually': 'Both paid equally',
    'dash.owes': '{underpayer} owes {overpayer}',

    // ── Charts ──
    'dash.dashboard': 'Dashboard',
    'chart.monthlyBalance': 'Monthly Balance',
    'chart.totalAsset': 'Total Asset Progression',
    'chart.totalAssetRecent': 'Total Asset Progression (Last 6 Months)',
    'chart.income': 'Income',
    'chart.expenses': 'Expenses',
    'chart.amount': 'Amount',
    'chart.expensesByCategory': 'Expenses by Category',
    'chart.expenseCatByMonth': 'Expense Categories by Month',
    'chart.avgIncome': 'Avg Income: ${value}',
    'chart.avgExpenses': 'Avg Expenses: ${value}',

    // ── Entries table ──
    'dash.registeredEntries': 'Registered Entries',
    'dash.totalIncome': 'Total Income',
    'dash.totalExpenses': 'Total Expenses',
    'dash.netBalance': 'Net Balance',
    'dash.tags': 'Tags',
    'dash.action': 'Action',
    'dash.couple': 'Couple',
    'dash.partnersEntry': "Partner's entry",

    // ── Add/Edit entry modal ──
    'modal.addEntry': 'Add New Entry',
    'modal.editEntry': 'Edit Entry',
    'modal.month': 'Month',
    'modal.type': 'Type',
    'modal.amount': 'Amount',
    'modal.description': 'Description',
    'modal.tags': 'Tags (comma-separated)',
    'modal.tagsPlaceholder': 'e.g. food, subscription',
    'modal.coupleExpense': 'This is a couple expense',
    'modal.coupleHelp': 'Couple expenses will appear in the combined view for both partners.',
    'modal.addEntryBtn': 'Add Entry',
    'modal.saveChanges': 'Save Changes',
    'modal.saving': 'Saving...',

    // ── Bulk upload modal ──
    'bulk.title': 'Bulk Upload from PDF',
    'bulk.selectFile': 'Select PDF File',
    'bulk.keyStored': 'Saved API key will be used',
    'bulk.keyRequired': 'A Gemini API key is required. Configure it in Settings.',
    'bulk.uploadProcess': 'Upload and Process',
    'bulk.processing': 'Processing...',
    'bulk.analyzing': 'Analyzing PDF with AI...',
    'bulk.preview': 'Preview Extracted Entries',
    'bulk.confirm': 'Confirm and Add Entries',
    'bulk.noEntries': 'No valid entries found in PDF.',
    'bulk.category': 'Category',

    // ── Bulk upload alerts ──
    'bulk.alertSelectPdf': 'Please select a PDF file.',
    'bulk.alertTooLarge': 'File is too large. Maximum size is 10MB.',
    'bulk.alertEnterKey': 'No Gemini API key configured. Please add one in Settings.',
    'bulk.alertValidMonth': 'Please enter a valid month in YYYY-MM format',
    'bulk.alertValidAmount': 'Please enter a valid positive amount',
    'bulk.alertEnterDesc': 'Please enter a description',
    'bulk.confirmDelete': 'Delete this entry from the preview?',
    'bulk.successAdd': 'Successfully added {count} entries to your database!',
    'bulk.errorSave': 'Error saving entries: {message}. Some entries may not have been saved.',
    'bulk.errorProcess': 'Error processing PDF: {message}',
    'bulk.errorFailed': 'Failed to process PDF. Check console for details.',

    // ── Entry form alerts ──
    'entry.alertValidAmount': 'Please enter a valid number for Amount (use a dot as decimal separator).',
    'entry.alertFillFields': 'Please fill in Month, Type, and Amount for manual entry.',
    'entry.alertAddError': 'Error adding entry: {message}.',
    'entry.alertAddFailed': 'Failed to add entry. Check console for details.',
    'entry.confirmDelete': 'Are you sure you want to delete this entry?',
    'entry.alertDeleteFailed': 'Failed to delete entry on server.',
    'entry.alertDeleteError': 'Failed to delete entry. Check console for details.',
    'entry.alertUpdateFailed': 'Failed to update entry.',
    'entry.alertUpdateError': 'Failed to update entry. Check console for details.',

    // ── Gemini key ──
    'gemini.confirmRemove': 'Remove your saved Gemini API key?',
    'gemini.removeFailed': 'Failed to remove API key.',

    // ── Logout ──
    'logout.failed': 'Logout failed.',

    // ── Admin panel ──
    'admin.title': 'User Management',
    'admin.createUser': 'Create New User',
    'admin.roleUser': 'User',
    'admin.roleAdmin': 'Admin',
    'admin.createBtn': 'Create User',
    'admin.id': 'ID',
    'admin.entries': 'Entries',
    'admin.twoFA': '2FA',
    'admin.set': 'Set',
    'admin.deactivate': 'Deactivate',
    'admin.activate': 'Activate',
    'admin.active': 'Active',
    'admin.inactive': 'Inactive',
    'admin.noCouples': 'No couples linked yet',
    'admin.confirmDeleteUser': 'Are you sure you want to delete this user? All their entries will also be deleted.',
    'admin.userDeleted': 'User deleted successfully',
    'admin.userCreated': 'User created successfully',

    // ── Settings ──
    'settings.title': 'Settings',
    'settings.emailSection': 'Email',
    'settings.currentEmail': 'Current email',
    'settings.noEmail': 'No email set',
    'settings.changeEmail': 'Change Email',
    'settings.addEmail': 'Add Email',
    'settings.emailHelp': 'Used for password recovery. Leave empty to remove.',
    'settings.enterValidEmail': 'Please enter a valid email address',
    'settings.twoFASection': 'Two-Factor Authentication',
    'settings.twoFAEnabled': 'Enabled',
    'settings.twoFADisabled': 'Disabled',
    'settings.backupCodesRemaining': '{count} backup codes remaining',
    'settings.enable2FA': 'Enable 2FA',
    'settings.disable2FA': 'Disable 2FA',
    'settings.scanQR': 'Scan this QR code with your authenticator app',
    'settings.manualEntry': 'Manual entry',
    'settings.enterCode': 'Enter the 6-digit code from your app',
    'settings.verifyAndEnable': 'Verify and Enable',
    'settings.enterValidCode': 'Please enter a valid 6-digit code',
    'settings.twoFASuccess': '2FA enabled successfully!',
    'settings.saveBackupCodes': 'Save Your Backup Codes',
    'settings.backupCodesWarning': 'Store these codes in a safe place. Each code can only be used once.',
    'settings.done': 'Done',
    'settings.disable2FAConfirm': 'Enter your current authenticator code to disable 2FA',
    'settings.confirmDisable': 'Confirm Disable',

    // ── Gemini API Key settings ──
    'settings.geminiSection': 'Gemini API Key',
    'settings.geminiSaved': 'API key saved',
    'settings.geminiChange': 'Change',
    'settings.geminiRemove': 'Remove',
    'settings.geminiNone': 'No API key configured',
    'settings.geminiPlaceholder': 'Enter your Gemini API key',
    'settings.geminiHelp': 'Used for AI-powered PDF processing and financial advisor chat. Get your key at aistudio.google.com.',
    'settings.geminiSaveSuccess': 'Gemini API key saved successfully',
    'settings.geminiRemoveSuccess': 'Gemini API key removed',

    // ── Couple management ──
    'admin.coupleManagement': 'Couple Management',
    'admin.linkCouple': 'Link Users as Couple',
    'admin.user1': 'User 1',
    'admin.user2': 'User 2',
    'admin.selectUser': 'Select user...',
    'admin.linkBtn': 'Link as Couple',
    'admin.linkedCouples': 'Linked Couples',
    'admin.linkedDate': 'Linked Date',
    'admin.unlink': 'Unlink',
    'admin.selectBothUsers': 'Please select both users',
    'admin.selectDifferent': 'Please select two different users',
    'admin.coupleLinked': 'Users linked as couple successfully',
    'admin.confirmUnlink': 'Are you sure you want to unlink this couple?',
    'admin.coupleUnlinked': 'Couple unlinked successfully',

    // ── Invite codes ──
    'admin.inviteCodes': 'Invite Codes',
    'admin.generateCode': 'Generate New Invite Code',
    'admin.generateBtn': 'Generate Code',
    'admin.newCode': 'New Code:',
    'admin.allCodes': 'All Invite Codes',
    'admin.code': 'Code',
    'admin.createdBy': 'Created By',
    'admin.used': 'Used',
    'admin.usedBy': 'Used By',
    'admin.noInviteCodes': 'No invite codes generated yet',
    'admin.confirmDeleteCode': 'Delete invite code {code}?',

    // ── Generic errors ──
    'error.updateUser': 'Error updating user',
    'error.deleteUser': 'Error deleting user',
    'error.createUser': 'Error creating user',
    'error.linkCouple': 'Error linking users',
    'error.unlinkCouple': 'Error unlinking couple',
    'error.generateCode': 'Error generating invite code',
    'error.deleteCode': 'Error deleting invite code',
    'error.generic': 'An error occurred. Please try again.',
    'error.userNotFound': 'User not found',

    // ── Login page ──
    'login.title': 'Asset Manager',
    'login.heroTagline': 'Take control of your finances with a secure, intelligent platform built for individuals and couples who want real visibility into their money.',
    'login.feature.encryption': 'AES-256 Encryption',
    'login.feature.encryptionDesc': 'Your data encrypted at rest with bank-grade security',
    'login.feature.analytics': 'Visual Analytics',
    'login.feature.analyticsDesc': 'Interactive charts for income, expenses, and categories',
    'login.feature.ai': 'AI-Powered Import',
    'login.feature.aiDesc': 'Upload bank statements and let AI extract transactions',
    'login.feature.couples': 'Couples Mode',
    'login.feature.couplesDesc': 'Link accounts with your partner for shared tracking',
    'login.feature.mobile': 'Mobile Native',
    'login.feature.mobileDesc': 'Full iOS app for managing finances on the go',
    'login.feature.categories': 'Smart Categories',
    'login.feature.categoriesDesc': '17 built-in tags for granular categorization',
    'login.feature.twoFactor': 'Two-Factor Auth (2FA)',
    'login.feature.twoFactorDesc': 'Protect your account with TOTP authenticator apps and backup codes',
    'login.feature.aiChat': 'AI Financial Advisor',
    'login.feature.aiChatDesc': 'Chat with an AI advisor that analyzes your real financial data',
    'login.welcome': 'Welcome Back',
    'login.subtitle': 'Sign in to manage your assets',
    'login.usernamePlaceholder': 'Enter your username',
    'login.passwordPlaceholder': 'Enter your password',
    'login.signIn': 'Sign In',
    'login.forgotPassword': 'Forgot your password?',
    'login.resetIt': 'Reset it',
    'login.noAccount': "Don't have an account?",
    'login.createOne': 'Create one',
    'login.errorDefault': 'Invalid username or password',
    'login.errorGeneric': 'An error occurred. Please try again.',
    'login.twoFAStep': 'Two-Factor Authentication',
    'login.twoFAPrompt': 'Enter the code from your authenticator app',
    'login.twoFACode': 'Verification Code',
    'login.twoFAPlaceholder': '000000',
    'login.twoFABackupHint': 'You can also use an 8-character backup code',
    'login.verify': 'Verify',
    'login.backToLogin': 'Back to login',
    'login.twoFAInvalid': 'Invalid verification code',

    // ── Register page ──
    'register.title': 'Create Account',
    'register.subtitle': 'Start managing your assets today',
    'register.usernamePlaceholder': 'Choose a username',
    'register.usernameHelp': '3-30 characters, letters, numbers, and underscores',
    'register.emailPlaceholder': 'your@email.com',
    'register.emailHelp': 'Used for password recovery',
    'register.passwordPlaceholder': 'Create a strong password',
    'register.passwordHelp': 'Minimum 8 characters',
    'register.confirmPassword': 'Confirm Password',
    'register.confirmPlaceholder': 'Re-enter your password',
    'register.paypalToggle': "Don't have an invite code? Buy one with Credit/Debit Card",
    'register.price': 'Price:',
    'register.paymentConfirmed': 'Payment confirmed! Code auto-filled below.',
    'register.inviteCode': 'Invite Code',
    'register.invitePlaceholder': 'Enter your invite code',
    'register.inviteHelp': 'Required. Ask an administrator for a code.',
    'register.createAccount': 'Create Account',
    'register.hasAccount': 'Already have an account?',
    'register.signIn': 'Sign in',
    'register.success': 'Account Created Successfully!',
    'register.redirecting': 'Redirecting to login...',
    'register.errorEmail': 'A valid email address is required',
    'register.errorPasswordMatch': 'Passwords do not match',
    'register.errorPasswordLength': 'Password must be at least 8 characters',
    'register.errorUsername': 'Username can only contain letters, numbers, and underscores',
    'register.errorInviteCode': 'Invite code is required',
    'register.errorGeneric': 'An error occurred. Please try again.',
    'register.paypalLoadError': 'Unable to load PayPal at the moment. Please try again later.',
    'register.paypalError': 'Payment error. Please try again.',
    'register.paypalCaptureError': 'Payment capture failed. Please try again.',

    // ── Forgot password page ──
    'forgot.title': 'Reset Password',
    'forgot.subtitle': 'Enter your username to receive a reset code',
    'forgot.sendCode': 'Send Reset Code',
    'forgot.sending': 'Sending',
    'forgot.resetCode': 'Reset Code',
    'forgot.codePlaceholder': 'Enter the code from your email',
    'forgot.codeHelp': 'Check your email for the 8-character code',
    'forgot.newPassword': 'New Password',
    'forgot.newPasswordPlaceholder': 'Create a new password',
    'forgot.passwordHelp': 'Minimum 8 characters',
    'forgot.confirmPassword': 'Confirm Password',
    'forgot.confirmPlaceholder': 'Re-enter your new password',
    'forgot.resetBtn': 'Reset Password',
    'forgot.resetting': 'Resetting',
    'forgot.rememberPassword': 'Remember your password?',
    'forgot.signIn': 'Sign in',
    'forgot.success': 'Password Reset Successfully!',
    'forgot.redirecting': 'Redirecting to login...',
    'forgot.step2Subtitle': 'Enter the code sent to your email',
    'forgot.errorUsername': 'Please enter your username.',
    'forgot.errorAllFields': 'All fields are required.',
    'forgot.errorPasswordLength': 'Password must be at least 8 characters.',
    'forgot.errorPasswordMatch': 'Passwords do not match.',
    'forgot.errorGeneric': 'An error occurred. Please try again.',
    'forgot.errorResetFailed': 'Failed to reset password.',

    // ── AI Chat ──
    'chat.title': 'AI Financial Advisor',
    'chat.placeholder': 'Ask about your finances...',
    'chat.send': 'Send',
    'chat.close': 'Close',
    'chat.welcome': 'Hello! I\'m your AI financial advisor. I can analyze your income, expenses, and spending patterns to help you make better financial decisions.',
    'chat.welcomeExamples': 'For example:\n- "How much did I spend last month?"\n- "What are my biggest expenses?"\n- "Compare January vs February"',
    'chat.errorNoKey': 'No AI API key configured. Please add your Gemini API key in Settings to use the chat advisor.',
    'chat.errorGeneric': 'Sorry, something went wrong. Please try again.',
    'chat.errorRateLimit': 'Too many messages. Please wait a few minutes and try again.',
  },

  pt: {
    // ── Language toggle ──
    'lang.switch': 'EN',
    'lang.switch.title': 'Switch to English',

    // ── Common ──
    'common.appName': 'Asset Manager',
    'common.assetManagement': 'Gest\u00e3o de Ativos',
    'common.logout': 'Sair',
    'common.save': 'Salvar',
    'common.cancel': 'Cancelar',
    'common.delete': 'Excluir',
    'common.edit': 'Editar',
    'common.actions': 'A\u00e7\u00f5es',
    'common.or': 'ou',
    'common.loading': 'Carregando...',
    'common.username': 'Usu\u00e1rio',
    'common.password': 'Senha',
    'common.email': 'E-mail',
    'common.month': 'M\u00eas',
    'common.type': 'Tipo',
    'common.amount': 'Valor',
    'common.description': 'Descri\u00e7\u00e3o',
    'common.status': 'Status',
    'common.created': 'Criado',
    'common.role': 'Fun\u00e7\u00e3o',
    'common.partner': 'Parceiro(a)',

    // ── Types ──
    'type.income': 'Receita',
    'type.expense': 'Despesa',
    'type.all': 'Todos',

    // ── Categories ──
    'cat.food': 'Alimenta\u00e7\u00e3o',
    'cat.groceries': 'Supermercado',
    'cat.transport': 'Transporte',
    'cat.travel': 'Viagem',
    'cat.entertainment': 'Lazer',
    'cat.utilities': 'Contas/Utilidades',
    'cat.healthcare': 'Sa\u00fade',
    'cat.education': 'Educa\u00e7\u00e3o',
    'cat.shopping': 'Compras',
    'cat.subscription': 'Assinatura',
    'cat.housing': 'Moradia',
    'cat.salary': 'Sal\u00e1rio',
    'cat.freelance': 'Freelance',
    'cat.investment': 'Investimento',
    'cat.transfer': 'Transfer\u00eancia',
    'cat.wedding': 'Casamento',
    'cat.other': 'Outros',

    // ── Dashboard header ──
    'dash.addEntry': 'Nova Entrada',
    'dash.bulkUpload': 'Upload PDF em Lote',
    'dash.settings': 'Configura\u00e7\u00f5es',
    'dash.adminPanel': 'Painel Admin',

    // ── Filters ──
    'dash.filters': 'Filtros',
    'dash.startMonth': 'M\u00eas Inicial',
    'dash.endMonth': 'M\u00eas Final',
    'dash.category': 'Categoria',
    'dash.clearFilters': 'Limpar Filtros',

    // ── View mode ──
    'dash.viewMode': 'Modo de Visualiza\u00e7\u00e3o',
    'dash.individual': 'Individual',
    'dash.combined': 'Combinado (Casal)',

    // ── Couple share ──
    'dash.expenseShare': 'Divis\u00e3o de Despesas',
    'dash.you': 'Voc\u00ea',
    'dash.partnerLabel': 'Parceiro(a)',
    'dash.ofTotal': '{percent}% do total',
    'dash.settlement': 'Acerto',
    'dash.allSettled': 'Tudo acertado!',
    'dash.noExpenses': 'Nenhuma despesa registrada',
    'dash.bothPaidEqually': 'Ambos pagaram igualmente',
    'dash.owes': '{underpayer} deve a {overpayer}',

    // ── Charts ──
    'dash.dashboard': 'Painel',
    'chart.monthlyBalance': 'Balan\u00e7o Mensal',
    'chart.totalAsset': 'Evolu\u00e7\u00e3o Patrimonial',
    'chart.totalAssetRecent': 'Evolu\u00e7\u00e3o Patrimonial (\u00daltimos 6 Meses)',
    'chart.income': 'Receita',
    'chart.expenses': 'Despesas',
    'chart.amount': 'Valor',
    'chart.expensesByCategory': 'Despesas por Categoria',
    'chart.expenseCatByMonth': 'Categorias de Despesas por M\u00eas',
    'chart.avgIncome': 'M\u00e9dia Receita: R${value}',
    'chart.avgExpenses': 'M\u00e9dia Despesas: R${value}',

    // ── Entries table ──
    'dash.registeredEntries': 'Entradas Registradas',
    'dash.totalIncome': 'Receita Total',
    'dash.totalExpenses': 'Despesas Totais',
    'dash.netBalance': 'Saldo L\u00edquido',
    'dash.tags': 'Tags',
    'dash.action': 'A\u00e7\u00e3o',
    'dash.couple': 'Casal',
    'dash.partnersEntry': 'Entrada do parceiro(a)',

    // ── Add/Edit entry modal ──
    'modal.addEntry': 'Nova Entrada',
    'modal.editEntry': 'Editar Entrada',
    'modal.month': 'M\u00eas',
    'modal.type': 'Tipo',
    'modal.amount': 'Valor',
    'modal.description': 'Descri\u00e7\u00e3o',
    'modal.tags': 'Tags (separadas por v\u00edrgula)',
    'modal.tagsPlaceholder': 'ex: alimenta\u00e7\u00e3o, assinatura',
    'modal.coupleExpense': 'Esta \u00e9 uma despesa de casal',
    'modal.coupleHelp': 'Despesas de casal aparecer\u00e3o na visualiza\u00e7\u00e3o combinada para ambos.',
    'modal.addEntryBtn': 'Adicionar Entrada',
    'modal.saveChanges': 'Salvar Altera\u00e7\u00f5es',
    'modal.saving': 'Salvando...',

    // ── Bulk upload modal ──
    'bulk.title': 'Upload em Lote via PDF',
    'bulk.selectFile': 'Selecionar Arquivo PDF',
    'bulk.keyStored': 'Chave API salva ser\u00e1 utilizada',
    'bulk.keyRequired': 'Uma chave API Gemini \u00e9 necess\u00e1ria. Configure em Ajustes.',
    'bulk.uploadProcess': 'Enviar e Processar',
    'bulk.processing': 'Processando...',
    'bulk.analyzing': 'Analisando PDF com IA...',
    'bulk.preview': 'Pr\u00e9-visualizar Entradas Extra\u00eddas',
    'bulk.confirm': 'Confirmar e Adicionar Entradas',
    'bulk.noEntries': 'Nenhuma entrada v\u00e1lida encontrada no PDF.',
    'bulk.category': 'Categoria',

    // ── Bulk upload alerts ──
    'bulk.alertSelectPdf': 'Por favor, selecione um arquivo PDF.',
    'bulk.alertTooLarge': 'Arquivo muito grande. Tamanho m\u00e1ximo \u00e9 10MB.',
    'bulk.alertEnterKey': 'Nenhuma chave API Gemini configurada. Adicione uma em Ajustes.',
    'bulk.alertValidMonth': 'Por favor, insira um m\u00eas v\u00e1lido no formato AAAA-MM',
    'bulk.alertValidAmount': 'Por favor, insira um valor positivo v\u00e1lido',
    'bulk.alertEnterDesc': 'Por favor, insira uma descri\u00e7\u00e3o',
    'bulk.confirmDelete': 'Excluir esta entrada da pr\u00e9-visualiza\u00e7\u00e3o?',
    'bulk.successAdd': '{count} entradas adicionadas com sucesso ao banco de dados!',
    'bulk.errorSave': 'Erro ao salvar entradas: {message}. Algumas entradas podem n\u00e3o ter sido salvas.',
    'bulk.errorProcess': 'Erro ao processar PDF: {message}',
    'bulk.errorFailed': 'Falha ao processar PDF. Verifique o console para detalhes.',

    // ── Entry form alerts ──
    'entry.alertValidAmount': 'Por favor, insira um n\u00famero v\u00e1lido para o Valor (use ponto como separador decimal).',
    'entry.alertFillFields': 'Por favor, preencha M\u00eas, Tipo e Valor para a entrada manual.',
    'entry.alertAddError': 'Erro ao adicionar entrada: {message}.',
    'entry.alertAddFailed': 'Falha ao adicionar entrada. Verifique o console para detalhes.',
    'entry.confirmDelete': 'Tem certeza que deseja excluir esta entrada?',
    'entry.alertDeleteFailed': 'Falha ao excluir entrada no servidor.',
    'entry.alertDeleteError': 'Falha ao excluir entrada. Verifique o console para detalhes.',
    'entry.alertUpdateFailed': 'Falha ao atualizar entrada.',
    'entry.alertUpdateError': 'Falha ao atualizar entrada. Verifique o console para detalhes.',

    // ── Gemini key ──
    'gemini.confirmRemove': 'Remover sua chave API Gemini salva?',
    'gemini.removeFailed': 'Falha ao remover chave API.',

    // ── Logout ──
    'logout.failed': 'Falha ao sair.',

    // ── Admin panel ──
    'admin.title': 'Gerenciamento de Usu\u00e1rios',
    'admin.createUser': 'Criar Novo Usu\u00e1rio',
    'admin.roleUser': 'Usu\u00e1rio',
    'admin.roleAdmin': 'Admin',
    'admin.createBtn': 'Criar Usu\u00e1rio',
    'admin.id': 'ID',
    'admin.entries': 'Entradas',
    'admin.twoFA': '2FA',
    'admin.set': 'Definir',
    'admin.deactivate': 'Desativar',
    'admin.activate': 'Ativar',
    'admin.active': 'Ativo',
    'admin.inactive': 'Inativo',
    'admin.noCouples': 'Nenhum casal vinculado ainda',
    'admin.confirmDeleteUser': 'Tem certeza que deseja excluir este usu\u00e1rio? Todas as entradas dele tamb\u00e9m ser\u00e3o exclu\u00eddas.',
    'admin.userDeleted': 'Usu\u00e1rio exclu\u00eddo com sucesso',
    'admin.userCreated': 'Usu\u00e1rio criado com sucesso',

    // ── Settings ──
    'settings.title': 'Configura\u00e7\u00f5es',
    'settings.emailSection': 'E-mail',
    'settings.currentEmail': 'E-mail atual',
    'settings.noEmail': 'Nenhum e-mail definido',
    'settings.changeEmail': 'Alterar E-mail',
    'settings.addEmail': 'Adicionar E-mail',
    'settings.emailHelp': 'Usado para recupera\u00e7\u00e3o de senha. Deixe vazio para remover.',
    'settings.enterValidEmail': 'Por favor, insira um endere\u00e7o de e-mail v\u00e1lido',
    'settings.twoFASection': 'Autentica\u00e7\u00e3o de Dois Fatores',
    'settings.twoFAEnabled': 'Ativada',
    'settings.twoFADisabled': 'Desativada',
    'settings.backupCodesRemaining': '{count} c\u00f3digos de backup restantes',
    'settings.enable2FA': 'Ativar 2FA',
    'settings.disable2FA': 'Desativar 2FA',
    'settings.scanQR': 'Escaneie este c\u00f3digo QR com seu app autenticador',
    'settings.manualEntry': 'Entrada manual',
    'settings.enterCode': 'Digite o c\u00f3digo de 6 d\u00edgitos do seu app',
    'settings.verifyAndEnable': 'Verificar e Ativar',
    'settings.enterValidCode': 'Por favor, insira um c\u00f3digo v\u00e1lido de 6 d\u00edgitos',
    'settings.twoFASuccess': '2FA ativada com sucesso!',
    'settings.saveBackupCodes': 'Salve Seus C\u00f3digos de Backup',
    'settings.backupCodesWarning': 'Guarde estes c\u00f3digos em um local seguro. Cada c\u00f3digo s\u00f3 pode ser usado uma vez.',
    'settings.done': 'Concluir',
    'settings.disable2FAConfirm': 'Digite o c\u00f3digo atual do autenticador para desativar 2FA',
    'settings.confirmDisable': 'Confirmar Desativa\u00e7\u00e3o',

    // ── Gemini API Key settings ──
    'settings.geminiSection': 'Chave API Gemini',
    'settings.geminiSaved': 'Chave API salva',
    'settings.geminiChange': 'Alterar',
    'settings.geminiRemove': 'Remover',
    'settings.geminiNone': 'Nenhuma chave API configurada',
    'settings.geminiPlaceholder': 'Digite sua chave API Gemini',
    'settings.geminiHelp': 'Usada para processamento de PDF com IA e consultor financeiro. Obtenha em aistudio.google.com.',
    'settings.geminiSaveSuccess': 'Chave API Gemini salva com sucesso',
    'settings.geminiRemoveSuccess': 'Chave API Gemini removida',

    // ── Couple management ──
    'admin.coupleManagement': 'Gerenciamento de Casais',
    'admin.linkCouple': 'Vincular Usu\u00e1rios como Casal',
    'admin.user1': 'Usu\u00e1rio 1',
    'admin.user2': 'Usu\u00e1rio 2',
    'admin.selectUser': 'Selecionar usu\u00e1rio...',
    'admin.linkBtn': 'Vincular como Casal',
    'admin.linkedCouples': 'Casais Vinculados',
    'admin.linkedDate': 'Data de V\u00ednculo',
    'admin.unlink': 'Desvincular',
    'admin.selectBothUsers': 'Por favor, selecione ambos os usu\u00e1rios',
    'admin.selectDifferent': 'Por favor, selecione dois usu\u00e1rios diferentes',
    'admin.coupleLinked': 'Usu\u00e1rios vinculados como casal com sucesso',
    'admin.confirmUnlink': 'Tem certeza que deseja desvincular este casal?',
    'admin.coupleUnlinked': 'Casal desvinculado com sucesso',

    // ── Invite codes ──
    'admin.inviteCodes': 'C\u00f3digos de Convite',
    'admin.generateCode': 'Gerar Novo C\u00f3digo de Convite',
    'admin.generateBtn': 'Gerar C\u00f3digo',
    'admin.newCode': 'Novo C\u00f3digo:',
    'admin.allCodes': 'Todos os C\u00f3digos de Convite',
    'admin.code': 'C\u00f3digo',
    'admin.createdBy': 'Criado Por',
    'admin.used': 'Usado',
    'admin.usedBy': 'Usado Por',
    'admin.noInviteCodes': 'Nenhum c\u00f3digo de convite gerado ainda',
    'admin.confirmDeleteCode': 'Excluir c\u00f3digo de convite {code}?',

    // ── Generic errors ──
    'error.updateUser': 'Erro ao atualizar usu\u00e1rio',
    'error.deleteUser': 'Erro ao excluir usu\u00e1rio',
    'error.createUser': 'Erro ao criar usu\u00e1rio',
    'error.linkCouple': 'Erro ao vincular usu\u00e1rios',
    'error.unlinkCouple': 'Erro ao desvincular casal',
    'error.generateCode': 'Erro ao gerar c\u00f3digo de convite',
    'error.deleteCode': 'Erro ao excluir c\u00f3digo de convite',
    'error.generic': 'Ocorreu um erro. Por favor, tente novamente.',
    'error.userNotFound': 'Usu\u00e1rio n\u00e3o encontrado',

    // ── Login page ──
    'login.title': 'Asset Manager',
    'login.heroTagline': 'Assuma o controle das suas finan\u00e7as com uma plataforma segura e inteligente, feita para pessoas e casais que querem ter visibilidade real sobre seu dinheiro.',
    'login.feature.encryption': 'Criptografia AES-256',
    'login.feature.encryptionDesc': 'Seus dados criptografados em repouso com seguran\u00e7a banc\u00e1ria',
    'login.feature.analytics': 'An\u00e1lise Visual',
    'login.feature.analyticsDesc': 'Gr\u00e1ficos interativos para receitas, despesas e categorias',
    'login.feature.ai': 'Importa\u00e7\u00e3o com IA',
    'login.feature.aiDesc': 'Envie extratos banc\u00e1rios e deixe a IA extrair as transa\u00e7\u00f5es',
    'login.feature.couples': 'Modo Casal',
    'login.feature.couplesDesc': 'Vincule contas com seu parceiro(a) para acompanhamento compartilhado',
    'login.feature.mobile': 'App Nativo',
    'login.feature.mobileDesc': 'App iOS completo para gerenciar finan\u00e7as em qualquer lugar',
    'login.feature.categories': 'Categorias Inteligentes',
    'login.feature.categoriesDesc': '17 tags integradas para categorização detalhada',
    'login.feature.twoFactor': 'Autenticação em Dois Fatores (2FA)',
    'login.feature.twoFactorDesc': 'Proteja sua conta com apps autenticadores TOTP e códigos de backup',
    'login.feature.aiChat': 'Consultor Financeiro IA',
    'login.feature.aiChatDesc': 'Converse com um consultor IA que analisa seus dados financeiros reais',
    'login.welcome': 'Bem-vindo de Volta',
    'login.subtitle': 'Entre para gerenciar seus ativos',
    'login.usernamePlaceholder': 'Digite seu usu\u00e1rio',
    'login.passwordPlaceholder': 'Digite sua senha',
    'login.signIn': 'Entrar',
    'login.forgotPassword': 'Esqueceu sua senha?',
    'login.resetIt': 'Redefinir',
    'login.noAccount': 'N\u00e3o tem uma conta?',
    'login.createOne': 'Criar conta',
    'login.errorDefault': 'Usu\u00e1rio ou senha inv\u00e1lidos',
    'login.errorGeneric': 'Ocorreu um erro. Por favor, tente novamente.',
    'login.twoFAStep': 'Autentica\u00e7\u00e3o de Dois Fatores',
    'login.twoFAPrompt': 'Digite o c\u00f3digo do seu app autenticador',
    'login.twoFACode': 'C\u00f3digo de Verifica\u00e7\u00e3o',
    'login.twoFAPlaceholder': '000000',
    'login.twoFABackupHint': 'Voc\u00ea tamb\u00e9m pode usar um c\u00f3digo de backup de 8 caracteres',
    'login.verify': 'Verificar',
    'login.backToLogin': 'Voltar ao login',
    'login.twoFAInvalid': 'C\u00f3digo de verifica\u00e7\u00e3o inv\u00e1lido',

    // ── Register page ──
    'register.title': 'Criar Conta',
    'register.subtitle': 'Comece a gerenciar seus ativos hoje',
    'register.usernamePlaceholder': 'Escolha um usu\u00e1rio',
    'register.usernameHelp': '3-30 caracteres, letras, n\u00fameros e underscores',
    'register.emailPlaceholder': 'seu@email.com',
    'register.emailHelp': 'Usado para recupera\u00e7\u00e3o de senha',
    'register.passwordPlaceholder': 'Crie uma senha forte',
    'register.passwordHelp': 'M\u00ednimo 8 caracteres',
    'register.confirmPassword': 'Confirmar Senha',
    'register.confirmPlaceholder': 'Digite a senha novamente',
    'register.paypalToggle': 'N\u00e3o tem um c\u00f3digo de convite? Compre com Cart\u00e3o de Cr\u00e9dito/D\u00e9bito',
    'register.price': 'Pre\u00e7o:',
    'register.paymentConfirmed': 'Pagamento confirmado! C\u00f3digo preenchido automaticamente abaixo.',
    'register.inviteCode': 'C\u00f3digo de Convite',
    'register.invitePlaceholder': 'Digite seu c\u00f3digo de convite',
    'register.inviteHelp': 'Obrigat\u00f3rio. Pe\u00e7a um c\u00f3digo a um administrador.',
    'register.createAccount': 'Criar Conta',
    'register.hasAccount': 'J\u00e1 tem uma conta?',
    'register.signIn': 'Entrar',
    'register.success': 'Conta Criada com Sucesso!',
    'register.redirecting': 'Redirecionando para o login...',
    'register.errorEmail': '\u00c9 necess\u00e1rio um endere\u00e7o de e-mail v\u00e1lido',
    'register.errorPasswordMatch': 'As senhas n\u00e3o coincidem',
    'register.errorPasswordLength': 'A senha deve ter pelo menos 8 caracteres',
    'register.errorUsername': 'O usu\u00e1rio s\u00f3 pode conter letras, n\u00fameros e underscores',
    'register.errorInviteCode': 'C\u00f3digo de convite \u00e9 obrigat\u00f3rio',
    'register.errorGeneric': 'Ocorreu um erro. Por favor, tente novamente.',
    'register.paypalLoadError': 'N\u00e3o foi poss\u00edvel carregar o PayPal no momento. Tente novamente mais tarde.',
    'register.paypalError': 'Erro no pagamento. Por favor, tente novamente.',
    'register.paypalCaptureError': 'Falha na captura do pagamento. Por favor, tente novamente.',

    // ── Forgot password page ──
    'forgot.title': 'Redefinir Senha',
    'forgot.subtitle': 'Digite seu usu\u00e1rio para receber um c\u00f3digo de redefini\u00e7\u00e3o',
    'forgot.sendCode': 'Enviar C\u00f3digo',
    'forgot.sending': 'Enviando',
    'forgot.resetCode': 'C\u00f3digo de Redefini\u00e7\u00e3o',
    'forgot.codePlaceholder': 'Digite o c\u00f3digo recebido por e-mail',
    'forgot.codeHelp': 'Verifique seu e-mail para o c\u00f3digo de 8 caracteres',
    'forgot.newPassword': 'Nova Senha',
    'forgot.newPasswordPlaceholder': 'Crie uma nova senha',
    'forgot.passwordHelp': 'M\u00ednimo 8 caracteres',
    'forgot.confirmPassword': 'Confirmar Senha',
    'forgot.confirmPlaceholder': 'Digite a nova senha novamente',
    'forgot.resetBtn': 'Redefinir Senha',
    'forgot.resetting': 'Redefinindo',
    'forgot.rememberPassword': 'Lembra da sua senha?',
    'forgot.signIn': 'Entrar',
    'forgot.success': 'Senha Redefinida com Sucesso!',
    'forgot.redirecting': 'Redirecionando para o login...',
    'forgot.step2Subtitle': 'Digite o c\u00f3digo enviado para seu e-mail',
    'forgot.errorUsername': 'Por favor, digite seu usu\u00e1rio.',
    'forgot.errorAllFields': 'Todos os campos s\u00e3o obrigat\u00f3rios.',
    'forgot.errorPasswordLength': 'A senha deve ter pelo menos 8 caracteres.',
    'forgot.errorPasswordMatch': 'As senhas n\u00e3o coincidem.',
    'forgot.errorGeneric': 'Ocorreu um erro. Por favor, tente novamente.',
    'forgot.errorResetFailed': 'Falha ao redefinir a senha.',

    // ── AI Chat ──
    'chat.title': 'Consultor Financeiro IA',
    'chat.placeholder': 'Pergunte sobre suas finanças...',
    'chat.send': 'Enviar',
    'chat.close': 'Fechar',
    'chat.welcome': 'Olá! Sou seu consultor financeiro com IA. Posso analisar sua renda, despesas e padrões de gastos para ajudá-lo a tomar melhores decisões financeiras.',
    'chat.welcomeExamples': 'Por exemplo:\n- "Quanto gastei no mês passado?"\n- "Quais são minhas maiores despesas?"\n- "Compare janeiro com fevereiro"',
    'chat.errorNoKey': 'Nenhuma chave API de IA configurada. Adicione sua chave Gemini API nas Configurações para usar o consultor.',
    'chat.errorGeneric': 'Desculpe, algo deu errado. Por favor, tente novamente.',
    'chat.errorRateLimit': 'Muitas mensagens. Por favor, aguarde alguns minutos e tente novamente.',
  }
};

// ── Core Functions ──

function getLang() {
  return localStorage.getItem('app-lang') || 'en';
}

function setLang(lang) {
  localStorage.setItem('app-lang', lang);
  location.reload();
}

function t(key, replacements) {
  const lang = getLang();
  let str = (translations[lang] && translations[lang][key]) || translations.en[key] || key;
  if (replacements) {
    Object.keys(replacements).forEach(function(placeholder) {
      str = str.replace(new RegExp('\\{' + placeholder + '\\}', 'g'), replacements[placeholder]);
    });
  }
  return str;
}

function applyTranslations() {
  // Text content
  document.querySelectorAll('[data-i18n]').forEach(function(el) {
    var key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);
  });
  // Placeholders
  document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
    var key = el.getAttribute('data-i18n-placeholder');
    if (key) el.placeholder = t(key);
  });
  // Titles
  document.querySelectorAll('[data-i18n-title]').forEach(function(el) {
    var key = el.getAttribute('data-i18n-title');
    if (key) el.title = t(key);
  });
  // Aria labels
  document.querySelectorAll('[data-i18n-aria-label]').forEach(function(el) {
    var key = el.getAttribute('data-i18n-aria-label');
    if (key) el.setAttribute('aria-label', t(key));
  });
  // Update html lang attribute
  document.documentElement.lang = getLang() === 'pt' ? 'pt-BR' : 'en';
}

// Auto-run on DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyTranslations);
} else {
  applyTranslations();
}
