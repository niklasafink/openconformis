(() => {
  const languageButton = document.querySelector('.lang');
  const draftButton = document.querySelector('.top-actions .secondary');
  if (!languageButton) return;

  draftButton?.remove();
  state.lang = 'de';

  const topActions = document.querySelector('.top-actions');
  const frameworkSearch = document.querySelector('.catalog-toolbar .search');
  const scopeSearch = document.querySelector('#scope-search')?.closest('.search');
  if (frameworkSearch) {
    frameworkSearch.classList.add('topbar-search');
    topActions.insertBefore(frameworkSearch, scopeSearch || languageButton);
  }

  const text = (de, en) => state.lang === 'de' ? de : en;
  const setText = (selector, de, en) => {
    const element = document.querySelector(selector);
    if (element) element.textContent = text(de, en);
  };
  const setPlaceholder = (selector, de, en) => {
    const element = document.querySelector(selector);
    if (element) element.placeholder = text(de, en);
  };

  const updateTopbar = () => {
    const context = document.querySelector('.breadcrumbs > span');
    const separator = document.querySelector('.breadcrumbs > b');
    const firstStep = state.screen === '1';
    const selectedFramework = FRAMEWORKS.find(framework => framework.id === state.framework);
    const selectedFrameworkName = document.querySelector('.selected-framework b');
    if (selectedFramework && selectedFrameworkName) selectedFrameworkName.textContent = selectedFramework.name;
    if (context) {
      context.textContent = selectedFramework?.name || '';
      context.hidden = firstStep || !selectedFramework;
    }
    if (separator) separator.hidden = firstStep || !selectedFramework;
    if (frameworkSearch) frameworkSearch.hidden = !firstStep;
    if (scopeSearch) scopeSearch.hidden = state.screen !== '3';
  };

  const localizeFrameworks = () => {
    document.querySelectorAll('.framework-card').forEach(card => {
      const meta = card.querySelector('.framework-card-meta');
      if (meta) meta.textContent = text(`${FRAMEWORKS.find(framework => framework.id === card.dataset.fw)?.requirementCount || 0} Anforderungen`, `${FRAMEWORKS.find(framework => framework.id === card.dataset.fw)?.requirementCount || 0} requirements`);
    });
    setText('.framework-featured > h2', 'Enthalten', 'Included');
    setText('.framework-premium > h2', 'Weitere Rahmenwerke in Pro', 'More frameworks in Pro');
  };

  const localizeScope = () => {
    const head = document.querySelector('.scope-head');
    if (head) head.innerHTML = `<span></span><span>${text('Regulatorische Anforderung', 'Regulatory requirement')}</span><span>${text('Subanforderungen', 'Sub-requirements')}</span><span>${text('Best Practices', 'Best practices')}</span><span></span>`;
    document.querySelectorAll('.scope-subs .cell-empty').forEach(element => element.textContent = text('Keine', 'None'));
    document.querySelectorAll('.context-button').forEach(button => {
      const id = button.dataset.context;
      const hasContext = Boolean(state.scope[id]?.bp);
      const title = button.querySelector('b');
      const caption = button.querySelector('small');
      if (title) title.textContent = hasContext ? text('Hinterlegt', 'Added') : text('Hinzufügen', 'Add');
      if (caption && !hasContext) caption.textContent = text('Unternehmenskontext', 'Company context');
    });
    const applicable = REQUIREMENTS.filter(requirement => state.scope[requirement.id].on).length;
    setText('#scope-count', `${applicable}/${REQUIREMENTS.length}`, `${applicable}/${REQUIREMENTS.length}`);
    setText('#analysis-count', `0 von ${applicable} Anforderungen`, `0 of ${applicable} requirements`);
  };

  const localizeResult = () => {
    const counts = {erfuellt: 0, teilweise: 0, nicht: 0, na: 0};
    REQUIREMENTS.forEach(requirement => counts[eff(requirement)]++);
    const applicable = REQUIREMENTS.filter(requirement => state.scope[requirement.id].on).length;
    const confirmed = Object.values(state.confirmed).filter(Boolean).length;
    const metrics = document.querySelector('#metrics');
    if (metrics) metrics.innerHTML = `<div class="result-summary"><span><b>${applicable}</b> ${text('geprüft', 'reviewed')}</span><span><i class="dot ok"></i><b>${counts.erfuellt}</b> ${text('erfüllt', 'met')}</span><span><i class="dot part"></i><b>${counts.teilweise}</b> ${text('teilweise', 'partial')}</span><span><i class="dot bad"></i><b>${counts.nicht}</b> ${text('nicht erfüllt', 'not met')}</span><span><i class="dot neutral"></i><b>${counts.na}</b> ${text('nicht einschlägig', 'not applicable')}</span></div>`;
    setText('#confirmed-count', `${confirmed} von ${applicable} bestätigt`, `${confirmed} of ${applicable} confirmed`);
    const listHead = document.querySelector('.finding-list-head');
    if (listHead) listHead.innerHTML = `<span>${text('Reg-ID / Anforderung', 'Reg ID / Requirement')}</span><span>Status</span>`;
  };

  const translateResultLabels = () => {
    if (state.lang !== 'en') return;
    const labels = new Map([
      ['Regulatorische Anforderung', 'Regulatory requirement'],
      ['Unternehmenskontext', 'Company context'],
      ['Begründung der Bewertung', 'Assessment rationale'],
      ['Begründung der Nicht-Einschlägigkeit', 'Reason for non-applicability'],
      ['Belegstellen', 'Evidence'],
      ['Subanforderungen', 'Sub-requirements'],
      ['Menschliche Validierung ausstehend', 'Human validation pending'],
      ['Bewertung bestätigen', 'Confirm assessment'],
      ['Originaldokument', 'Original document']
    ]);
    document.querySelectorAll('.finding-detail h3, .confirmation span, .confirmation button, .document-toolbar small').forEach(element => {
      const current = element.textContent.trim();
      if (labels.has(current)) element.textContent = labels.get(current);
    });
  };

  const applyLanguage = () => {
    document.documentElement.lang = state.lang;
    languageButton.textContent = state.lang === 'de' ? '🇩🇪' : '🇺🇸';
    languageButton.title = text('Zu Englisch wechseln', 'Switch to German');
    languageButton.setAttribute('aria-label', languageButton.title);

    Object.assign(titles, state.lang === 'de' ? {
      1: 'Rahmenwerk wählen', 2: 'Policy bereitstellen', 3: 'Prüfungsumfang', run: 'Analyse läuft', 4: 'Ergebnis', chat: 'Chat', admin: 'Administration'
    } : {
      1: 'Select framework', 2: 'Provide policy', 3: 'Analysis scope', run: 'Analysis running', 4: 'Results', chat: 'Chat', admin: 'Administration'
    });
    Object.assign(sl, state.lang === 'de' ? {
      erfuellt: 'Erfüllt', teilweise: 'Teilweise erfüllt', nicht: 'Nicht erfüllt', na: 'Nicht einschlägig'
    } : {
      erfuellt: 'Met', teilweise: 'Partially met', nicht: 'Not met', na: 'Not applicable'
    });

    setText('.nav-label-text', 'Gap-Analyse', 'Gap analysis');
    const steps = document.querySelectorAll('.flow-step b');
    const stepLabels = state.lang === 'de' ? ['Rahmenwerk', 'Policy', 'Prüfungsumfang', 'Ergebnis'] : ['Framework', 'Policy', 'Scope', 'Results'];
    steps.forEach((step, index) => step.textContent = stepLabels[index]);

    setText('[data-screen="1"] .eyebrow', 'Schritt 1 von 4', 'Step 1 of 4');
    setText('[data-screen="1"] h1', 'Regulatorisches Rahmenwerk wählen', 'Select regulatory framework');
    setPlaceholder('#fw-search', 'Rahmenwerk suchen', 'Search frameworks');
    setText('.catalog-count', `${FRAMEWORKS.length} Rahmenwerke`, `${FRAMEWORKS.length} frameworks`);
    setText('#to-policy', 'Weiter zur Policy →', 'Continue to policy →');

    setText('[data-screen="2"] .eyebrow', 'Schritt 2 von 4', 'Step 2 of 4');
    setText('[data-screen="2"] h1', 'Policy bereitstellen', 'Provide policy');
    setText('[data-screen="2"] .field-group > label', 'Eigenes Dokument', 'Your document');
    setText('#upload b', 'DOCX oder PDF hier ablegen', 'Drop DOCX or PDF here');
    setText('#upload p', 'oder klicken, um eine Datei auszuwählen · max. 25 MB', 'or click to select a file · max. 25 MB');
    setText('.choice-divider span', 'oder', 'or');
    setText('#sample > span:last-child', 'Auswählen', 'Select');
    setText('#file-card small', 'Dokument ist bereit', 'Document is ready');
    setText('[data-screen="2"] .page-actions .secondary', '← Zurück', '← Back');
    setText('#to-scope', 'Weiter zum Prüfungsumfang →', 'Continue to scope →');

    setText('[data-screen="3"] .eyebrow', 'Schritt 3 von 4', 'Step 3 of 4');
    setText('[data-screen="3"] h1', 'Prüfungsumfang und Kontext', 'Scope and context');
    setText('.summary-card span', 'einschlägig', 'applicable');
    setPlaceholder('#scope-search', 'Anforderungen durchsuchen', 'Search requirements');
    setText('[data-screen="3"] .page-actions .secondary', '← Zurück', '← Back');
    setText('#run-analysis', 'Analyse starten →', 'Start analysis →');
    setText('.scope-edit-dialog h2', 'Anforderung bearbeiten', 'Edit requirement');
    [['#scope-edit-cite', 'Regulatorische ID', 'Regulatory ID'], ['#scope-edit-title', 'Titel', 'Title'], ['#scope-edit-legal', 'Regulatorischer Wortlaut', 'Regulatory wording'], ['#scope-edit-bp', 'Best Practice', 'Best practice']].forEach(([selector, de, en]) => {
      const field = document.querySelector(selector);
      if (field?.previousElementSibling) field.previousElementSibling.textContent = text(de, en);
    });
    setText('.scope-primary-section .scope-section-heading > h3', 'Anforderung', 'Requirement');
    setText('.scope-assessment-section > h3', 'Bewertungskontext', 'Assessment context');
    setText('.scope-edit-dialog .editor-check b', 'Einschlägig', 'Applicable');
    setText('.scope-subsection-title', 'Subanforderungen', 'Sub-requirements');
    setText('.scope-edit-dialog footer .secondary', 'Abbrechen', 'Cancel');
    setText('.scope-edit-dialog footer .primary', 'Speichern', 'Save');

    setText('[data-screen="run"] .eyebrow', 'KI-Analyse', 'AI analysis');
    setText('[data-screen="run"] h1', 'Policy wird gegen DORA geprüft', 'Policy is being assessed against DORA');
    setText('#analysis-status', 'Dokument und Anforderungen werden vorbereitet …', 'Preparing document and requirements …');
    setText('.activity b', 'Sichere Verarbeitung', 'Secure processing');
    setText('.activity small', 'Das Dokument verbleibt innerhalb des geschützten Workspace.', 'The document remains within the protected workspace.');

    setText('.result-actions button', 'Exportieren', 'Export');
    setPlaceholder('#finding-search', 'Anforderung suchen', 'Search requirements');
    const options = document.querySelectorAll('#status-filter option');
    const optionLabels = state.lang === 'de' ? ['Alle Status', 'Teilweise erfüllt', 'Erfüllt', 'Nicht erfüllt', 'Nicht einschlägig'] : ['All statuses', 'Partially met', 'Met', 'Not met', 'Not applicable'];
    options.forEach((option, index) => option.textContent = optionLabels[index]);
    setText('.document-toolbar small', 'Originaldokument', 'Original document');

    setText('#chat-launcher .chat-label', state.screen === 'chat' ? 'Zur Analyse' : 'Chat', state.screen === 'chat' ? 'Back to analysis' : 'Chat');
    setText('.chat-welcome h1', 'Wie kann ich helfen?', 'How can I help?');
    setPlaceholder('#chat-question', 'Frage zum Rahmenwerk stellen …', 'Ask about the framework …');
    const chatFrameworkTrigger = document.querySelector('#chat-framework-trigger');
    if (chatFrameworkTrigger) chatFrameworkTrigger.setAttribute('aria-label', text('Rahmenwerk auswählen', 'Select framework'));
    const emptyFrameworkOption = document.querySelector('[data-chat-framework=""]');
    if (emptyFrameworkOption) emptyFrameworkOption.textContent = text('Rahmenwerk', 'Framework');
    if (!document.querySelector('#chat-framework-value')?.value) setText('#chat-framework-label', 'Rahmenwerk', 'Framework');
    setText('.chat-disclaimer', 'KI kann Fehler machen. Antworten ersetzen keine fachliche oder rechtliche Prüfung.', 'AI can make mistakes. Answers do not replace professional or legal review.');
    setText('.chat-quick-actions > span', 'Schnellaktionen', 'Quick actions');
    const quickActions = document.querySelectorAll('.chat-quick-actions button');
    const quickActionLabels = state.lang === 'de' ? ['Lücken erklären', 'Belegstellen finden', 'Anforderungen vergleichen', 'Maßnahmen ableiten'] : ['Explain gaps', 'Find evidence', 'Compare requirements', 'Derive actions'];
    quickActions.forEach((button, index) => button.textContent = quickActionLabels[index]);

    setText('#context-dialog .dialog-head b', 'Unternehmensspezifischer Kontext', 'Company-specific context');
    setText('#context-dialog .dialog-body label:first-of-type', 'Best Practice (optional)', 'Best practice (optional)');
    setText('#context-dialog .reason-label', 'Begründung der Nicht-Einschlägigkeit', 'Reason for non-applicability');
    setText('#context-dialog .dialog-foot .secondary', 'Abbrechen', 'Cancel');
    setText('#context-dialog .dialog-foot .primary', 'Speichern', 'Save');

    document.querySelector('#crumb-title').textContent = titles[state.screen];
    updateTopbar();
    localizeFrameworks();
    if (state.screen === '3') localizeScope();
    if (state.screen === '4') {
      renderFindingList();
      renderDetail();
      localizeResult();
      translateResultLabels();
    }
  };

  const originalRenderFrameworks = renderFrameworks;
  renderFrameworks = function localizedFrameworks(query = '') {
    originalRenderFrameworks(query);
    localizeFrameworks();
  };

  const originalRenderScope = renderScope;
  renderScope = function localizedScope(query = '') {
    originalRenderScope(query);
    localizeScope();
  };

  const originalRenderFindingList = renderFindingList;
  renderFindingList = function localizedFindingList() {
    originalRenderFindingList();
    const listHead = document.querySelector('.finding-list-head');
    if (listHead) listHead.innerHTML = `<span>${text('Reg-ID / Anforderung', 'Reg ID / Requirement')}</span><span>Status</span>`;
  };

  const originalRenderDetail = renderDetail;
  renderDetail = function localizedDetail() {
    originalRenderDetail();
    const activeRequirement = REQUIREMENTS.find(requirement => requirement.id === state.active);
    const requirementHeading = document.querySelector('.finding-detail .detail-block h3');
    if (activeRequirement && requirementHeading) requirementHeading.textContent = activeRequirement.cite;
    translateResultLabels();
  };

  const originalRenderResult = renderResult;
  renderResult = function localizedResult() {
    originalRenderResult();
    localizeResult();
  };

  const originalGo = go;
  go = function localizedNavigation(screen) {
    originalGo(screen);
    const chatLabel = document.querySelector('#chat-launcher .chat-label');
    if (chatLabel) chatLabel.textContent = state.screen === 'chat' ? text('Zur Analyse', 'Back to analysis') : 'Chat';
    updateTopbar();
  };

  const analysisStatus = document.querySelector('#analysis-status');
  new MutationObserver(() => {
    if (state.lang !== 'en') return;
    const value = analysisStatus.textContent;
    if (value === 'Ergebnis wird aufbereitet …') analysisStatus.textContent = 'Preparing results …';
    else if (value.includes(' wird gegen das Dokument geprüft')) analysisStatus.textContent = value.replace(' wird gegen das Dokument geprüft …', ' is being assessed against the document …');
  }).observe(analysisStatus, {childList: true});

  languageButton.addEventListener('click', () => {
    state.lang = state.lang === 'de' ? 'en' : 'de';
    applyLanguage();
  });

  applyLanguage();
})();
