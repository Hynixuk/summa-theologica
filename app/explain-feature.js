/**
 * explain-feature.js
 * Adds an "Explain" control at the end of each paragraph and calls the
 * backend API (Groq, via api/explain.js) for an on-demand explanation.
 */

(function () {
  var explanationCache = {};
  var stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    var style = document.createElement('style');
    style.textContent = [
      '.explain-btn {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  gap: 0.3em;',
      '  margin-left: 0.5em;',
      '  padding: 0.15em 0.6em;',
      '  font-size: 0.78em;',
      '  font-family: inherit;',
      '  color: var(--accent);',
      '  background: var(--accent-soft);',
      '  border: 1px solid var(--accent);',
      '  border-radius: 999px;',
      '  cursor: pointer;',
      '  vertical-align: middle;',
      '  line-height: 1.6;',
      '  transition: background 0.15s, opacity 0.15s;',
      '}',
      '.explain-btn:hover { background: var(--accent); color: var(--on-accent); }',
      '.explain-btn.active { background: var(--accent); color: var(--on-accent); }',
      '.explain-btn.loading { opacity: 0.6; cursor: default; }',
      '.explain-btn.error { background: var(--danger-soft); border-color: var(--danger); color: var(--danger); }',
      '.explanation-box {',
      '  margin: 0.6em 0 1em;',
      '  padding: 0.75em 0.9em;',
      '  background: var(--accent-soft);',
      '  border-left: 3px solid var(--accent);',
      '  border-radius: 4px;',
      '  font-size: 0.92em;',
      '  line-height: 1.55;',
      '  color: var(--ink);',
      '  position: relative;',
      '}',
      '.explanation-box .explanation-label {',
      '  display: block;',
      '  font-size: 0.78em;',
      '  font-weight: 600;',
      '  letter-spacing: 0.04em;',
      '  text-transform: uppercase;',
      '  color: var(--accent);',
      '  margin-bottom: 0.35em;',
      '}',
      '.explanation-box p { margin: 0; color: inherit; }',
      '.explanation-close {',
      '  position: absolute;',
      '  top: 0.4em;',
      '  right: 0.5em;',
      '  background: none;',
      '  border: none;',
      '  color: var(--ink-soft);',
      '  font-size: 1.1em;',
      '  line-height: 1;',
      '  cursor: pointer;',
      '  padding: 0.2em;',
      '}',
      '.explanation-close:hover { color: var(--ink); }',
    ].join('\n');
    document.head.appendChild(style);
  }

  function escapeHtml(text) {
    var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, function (m) { return map[m]; });
  }

  function fetchExplanation(paragraphText, paragraphLabel) {
    var cacheKey = paragraphLabel + ':' + paragraphText.slice(0, 150);
    if (explanationCache[cacheKey]) {
      return Promise.resolve(explanationCache[cacheKey]);
    }
    return fetch('/api/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paragraph: paragraphText, label: paragraphLabel }),
    }).then(function (response) {
      if (!response.ok) {
        return response.json().catch(function () { return {}; }).then(function (data) {
          throw new Error((data && data.error) || ('Request failed: ' + response.status));
        });
      }
      return response.json();
    }).then(function (data) {
      explanationCache[cacheKey] = data.explanation;
      return data.explanation;
    });
  }

  function toggleExplanation(button, explanation) {
    var existing = button.parentElement.querySelector('.explanation-box');
    if (existing) {
      existing.remove();
      button.classList.remove('active');
      button.textContent = 'Explain';
      return;
    }
    var box = document.createElement('div');
    box.className = 'explanation-box';
    var closeBtn = document.createElement('button');
    closeBtn.className = 'explanation-close';
    closeBtn.setAttribute('aria-label', 'Close explanation');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', function () {
      box.remove();
      button.classList.remove('active');
      button.textContent = 'Explain';
    });
    var labelEl = document.createElement('span');
    labelEl.className = 'explanation-label';
    labelEl.textContent = 'AI Explanation';
    var p = document.createElement('p');
    p.textContent = explanation;
    box.appendChild(closeBtn);
    box.appendChild(labelEl);
    box.appendChild(p);
    button.parentElement.insertAdjacentElement('afterend', box);
    button.classList.add('active');
    button.textContent = 'Hide';
  }

  function addExplainButton(paragraphEl) {
    if (paragraphEl.querySelector('.explain-btn') || paragraphEl.dataset.explainInit) return;

    var labelSpan = paragraphEl.querySelector('.label');
    var label = labelSpan ? labelSpan.textContent : '';
    var text = paragraphEl.textContent.trim();
    if (!text || text.length < 20) return;

    paragraphEl.dataset.explainInit = 'true';

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'explain-btn';
    button.textContent = 'Explain';
    button.title = 'Get an AI explanation of this paragraph';

    button.addEventListener('click', function () {
      if (button.classList.contains('loading')) return;

      if (button.classList.contains('active')) {
        toggleExplanation(button, null);
        return;
      }

      button.classList.add('loading');
      button.classList.remove('error');
      var originalText = button.textContent;
      button.textContent = 'Generating…';

      fetchExplanation(text, label).then(function (explanation) {
        button.classList.remove('loading');
        button.textContent = originalText;
        toggleExplanation(button, explanation);
      }).catch(function (err) {
        console.error('Failed to fetch explanation:', err);
        button.classList.remove('loading');
        button.classList.add('error');
        button.textContent = 'Error – retry';
        setTimeout(function () {
          button.classList.remove('error');
          button.textContent = 'Explain';
        }, 2500);
      });
    });

    // Place the button at the END of the paragraph, not next to the label.
    paragraphEl.appendChild(document.createTextNode(' '));
    paragraphEl.appendChild(button);
  }

  function initializeExplainButtons() {
    injectStyles();
    var paragraphs = document.querySelectorAll('[data-paragraph]');
    for (var i = 0; i < paragraphs.length; i++) addExplainButton(paragraphs[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeExplainButtons);
  } else {
    initializeExplainButtons();
  }

  var debounceTimer = null;
  var observer = new MutationObserver(function () {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(initializeExplainButtons, 150);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  window.reinitializeExplainButtons = initializeExplainButtons;
})();
