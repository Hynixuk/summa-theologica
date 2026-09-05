/**
 * explain-feature.js
 * Adds "Explain" buttons to paragraphs and calls the backend API for explanations
 */

(function () {
  // Cache explanations to avoid re-requesting the same paragraph
  const explanationCache = {};

  /**
   * Fetch explanation from backend API
   */
  async function fetchExplanation(paragraphText, paragraphLabel) {
    const cacheKey = `${paragraphLabel}:${paragraphText.slice(0, 100)}`;
    if (explanationCache[cacheKey]) {
      return explanationCache[cacheKey];
    }

    try {
      const response = await fetch('/api/explain', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          paragraph: paragraphText,
          label: paragraphLabel,
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.statusCode}`);
      }

      const data = await response.json();
      const explanation = data.explanation;
      explanationCache[cacheKey] = explanation;
      return explanation;
    } catch (error) {
      console.error('Failed to fetch explanation:', error);
      throw error;
    }
  }

  /**
   * Show explanation in a modal or inline box
   */
  function showExplanation(explanation, button) {
    // Remove existing explanation if any
    const existing = button.parentElement.querySelector('.explanation-box');
    if (existing) {
      existing.remove();
      return; // Toggle off
    }

    // Create explanation box
    const box = document.createElement('div');
    box.className = 'explanation-box';
    box.innerHTML = `
      <div class="explanation-content">
        <button class="explanation-close" aria-label="Close">×</button>
        <p>${escapeHtml(explanation)}</p>
      </div>
    `;

    // Style
    box.style.cssText = `
      margin: 0.5em 0;
      padding: 0.75em;
      background: #f5f5f5;
      border-left: 3px solid #8b7355;
      border-radius: 2px;
      font-size: 0.95em;
      line-height: 1.5;
    `;

    // Close button
    box.querySelector('.explanation-close').addEventListener('click', () => {
      box.remove();
      button.textContent = 'Explain';
      button.classList.remove('active');
    });

    // Insert after the paragraph
    button.parentElement.insertAdjacentElement('afterend', box);
    button.textContent = 'Hide explanation';
    button.classList.add('active');
  }

  /**
   * Add explain button to a paragraph element
   */
  function addExplainButton(paragraphEl) {
    if (paragraphEl.querySelector('.explain-btn')) {
      return; // Already has a button
    }

    const label = paragraphEl.querySelector('.label')?.textContent || '';
    const text = paragraphEl.textContent.trim();

    if (!text || text.length < 20) {
      return; // Too short to explain
    }

    const button = document.createElement('button');
    button.className = 'explain-btn';
    button.textContent = 'Explain';
    button.title = 'Get an AI explanation of this paragraph';

    button.style.cssText = `
      margin-left: 0.5em;
      padding: 0.25em 0.5em;
      font-size: 0.85em;
      background: #e8d4c4;
      border: 1px solid #8b7355;
      border-radius: 2px;
      cursor: pointer;
      transition: background 0.2s;
    `;

    button.addEventListener('mouseover', () => {
      if (!button.classList.contains('active')) {
        button.style.background = '#dcc4b4';
      }
    });

    button.addEventListener('mouseout', () => {
      if (!button.classList.contains('active')) {
        button.style.background = '#e8d4c4';
      }
    });

    button.addEventListener('click', async () => {
      if (button.classList.contains('loading')) return;

      if (button.classList.contains('active')) {
        showExplanation('', button); // Toggle off
        return;
      }

      button.classList.add('loading');
      button.textContent = 'Generating...';

      try {
        const explanation = await fetchExplanation(text, label);
        showExplanation(explanation, button);
      } catch (error) {
        button.textContent = 'Error';
        button.style.background = '#ffcccc';
        setTimeout(() => {
          button.textContent = 'Explain';
          button.classList.remove('loading');
          button.style.background = '#e8d4c4';
        }, 2000);
      }

      button.classList.remove('loading');
    });

    // Insert button after label/paragraph
    const labelEl = paragraphEl.querySelector('.label');
    if (labelEl) {
      labelEl.appendChild(button);
    } else {
      paragraphEl.insertBefore(button, paragraphEl.firstChild);
    }
  }

  /**
   * Initialize explain buttons for visible paragraphs
   */
  function initializeExplainButtons() {
    const paragraphs = document.querySelectorAll('[data-paragraph]');
    paragraphs.forEach(addExplainButton);
  }

  /**
   * Escape HTML to prevent XSS
   */
  function escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeExplainButtons);
  } else {
    initializeExplainButtons();
  }

  // Re-initialize if new content is added (e.g., after navigation)
  const observer = new MutationObserver(() => {
    initializeExplainButtons();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Expose for manual refresh if needed
  window.reinitializeExplainButtons = initializeExplainButtons;
})();
