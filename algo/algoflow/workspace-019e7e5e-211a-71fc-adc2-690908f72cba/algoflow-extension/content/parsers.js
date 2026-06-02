/**
 * ============================================================================
 * AlgoFlow — Platform-Specific Parsers
 * ============================================================================
 *
 * Robust DOM scrapers for LeetCode and Codeforces.
 * Each parser returns a normalised object:
 *
 *   {
 *     title:      string,
 *     platform:   'leetcode' | 'codeforces',
 *     difficulty: 'Easy' | 'Med' | 'Hard',
 *     testCases:  Array<{ in: string, out: string }>,
 *     tags:       string[],
 *     url:        string,
 *     scrapedAt:  ISO timestamp
 *   }
 *
 * Selectors are tried in priority order with fallbacks to survive DOM
 * changes. Every getter returns `null` on failure instead of throwing.
 * ============================================================================
 */

// Guard against double-injection
if (typeof window.__AlgoFlowParsers === "undefined") {
  window.__AlgoFlowParsers = true;

  // ─── Utility helpers ──────────────────────────────────────────────────────

  const Parsers = {
    /**
     * Try multiple selectors, return textContent of first match.
     * @param {Element} root
     * @param {string[]} selectors
     * @returns {string|null}
     */
    _firstText(root, selectors) {
      for (const sel of selectors) {
        try {
          const el = root.querySelector(sel);
          if (el && el.textContent.trim()) return el.textContent.trim();
        } catch { /* invalid selector — skip */ }
      }
      return null;
    },

    /**
     * Try multiple selectors, return the element itself.
     * @param {Element} root
     * @param {string[]} selectors
     * @returns {Element|null}
     */
    _firstEl(root, selectors) {
      for (const sel of selectors) {
        try {
          const el = root.querySelector(sel);
          if (el) return el;
        } catch { /* skip */ }
      }
      return null;
    },

    /**
     * Normalise whitespace: collapse runs, trim ends.
     */
    _clean(str) {
      if (!str) return "";
      return str.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    },

    /**
     * Normalise LeetCode's difficulty text → Easy | Med | Hard
     */
    _normaliseDifficulty(raw) {
      if (!raw) return "Med";
      const lower = raw.toLowerCase();
      if (lower.includes("easy"))   return "Easy";
      if (lower.includes("medium")) return "Med";
      if (lower.includes("hard"))   return "Hard";
      return "Med";
    },

    // ═══════════════════════════════════════════════════════════════════════
    // LEETCODE PARSER
    // ═══════════════════════════════════════════════════════════════════════

    LeetCode: {
      /** Detect if current page is a LeetCode problem. */
      isMatch() {
        return /^leetcode\.(com|cn)\/problems\/[^/]+/.test(location.hostname + location.pathname);
      },

      /** Extract problem title. */
      getTitle() {
        // Primary: the h1 / title link in the left pane
        const selectors = [
          '[data-cy="question-title"]',                   // data attribute (stable)
          'div.text-title-large a',                       // Tailwind-class based
          'div[class*="text-title"] a',                   // Tailwind variant
          '[class*="question-title"]',                    // generic class match
          'a[href*="/problems/"] > div',                  // link > div pattern
          '.css-v3d350',                                  // legacy LC class
          'h1.text-lg',                                   // fallback
          'h1',                                           // last resort
        ];

        const title = this._firstText(document, selectors);
        if (title) return title;

        // Fallback: parse from <title> tag  → "Two Sum - LeetCode"
        const docTitle = document.title || "";
        const match = docTitle.match(/^(.+?)\s*[-–—]\s*LeetCode/i);
        return match ? match[1].trim() : null;
      },

      _firstText(root, sels) { return Parsers._firstText(root, sels); },

      /** Extract difficulty. */
      getDifficulty() {
        const selectors = [
          '[diff]',                                        // attribute diff="easy"
          '[data-cy="question-difficulty"]',
          '[class*="question-difficulty"]',
          '[class*="difficulty"]',
          'div.text-olg',                                  // green/yellow/red text
          '.text-difficulty-easy',
          '.text-difficulty-medium',
          '.text-difficulty-hard',
          // Side-panel difficulty — often a div with colour coding
          '.flex.gap-1 > div[class*="text-"]',             // newer Tailwind layout
        ];

        for (const sel of selectors) {
          try {
            const el = document.querySelector(sel);
            if (el) {
              // Check attribute first
              const attr = el.getAttribute("diff");
              if (attr) return Parsers._normaliseDifficulty(attr);
              // Then textContent
              const text = el.textContent.trim();
              if (/easy|medium|hard/i.test(text)) {
                return Parsers._normaliseDifficulty(text);
              }
            }
          } catch { /* skip */ }
        }

        // Fallback: scan all text for "Easy", "Medium", "Hard" in the side panel
        const sidePanel = document.querySelector('.flex.flex-col.gap-4') ||
                          document.querySelector('#ide-top-btns')?.closest('.flex');
        if (sidePanel) {
          const text = sidePanel.textContent;
          const m = text.match(/\b(Easy|Medium|Hard)\b/i);
          if (m) return Parsers._normaliseDifficulty(m[1]);
        }

        return "Med"; // safe default
      },

      /** Extract example test cases from the problem description. */
      getTestCases() {
        const cases = [];

        // Strategy 1: LeetCode's structured example blocks
        // Each example is in an <strong>Example N:</strong> followed by
        // <pre> blocks containing Input:/Output:

        const descriptionEl = document.querySelector(
          '[data-track-load="description_content"]'
        ) || document.querySelector('.elfjS') || document.querySelector(
          'div[data-cy="question-content"]'
        ) || document.querySelector(
          '.question-content'
        ) || document.querySelector(
          '.content__1c2R'
        ) || document.querySelector(
          '[class*="question-detail"]'
        );

        if (!descriptionEl) {
          // Fallback: grab entire problem area (innerText may not exist in jsdom)
          const rawText = document.body.innerText || document.body.textContent || "";
          return this._parseFromRawText(rawText);
        }

        const html = descriptionEl.innerHTML;
        const text = descriptionEl.innerText || descriptionEl.textContent || "";

        // Try structured pre blocks first
        const preBlocks = descriptionEl.querySelectorAll("pre");
        if (preBlocks.length > 0) {
          for (const pre of preBlocks) {
            const preText = pre.textContent;
            const tc = this._extractInputOutput(preText);
            if (tc) cases.push(tc);
          }
          if (cases.length > 0) return cases;
        }

        // Try <strong>Example</strong> sections with code blocks
        const exampleHeaders = descriptionEl.querySelectorAll("strong");
        for (const header of exampleHeaders) {
          if (!/example\s*\d*/i.test(header.textContent)) continue;

          // Walk siblings until next <strong>Example</strong> or end
          let sibling = header.nextElementSibling;
          let block = "";
          while (sibling) {
            if (sibling.tagName === "STRONG" &&
                /example\s*\d*/i.test(sibling.textContent)) break;
            block += sibling.textContent + "\n";
            sibling = sibling.nextElementSibling;
          }

          const tc = this._extractInputOutput(block);
          if (tc) cases.push(tc);
        }

        if (cases.length > 0) return cases;

        // Fallback: regex on full text
        return this._parseFromRawText(text);
      },

      /** Parse Input:/Output: from a text block. */
      _extractInputOutput(text) {
        const inputMatch = text.match(/Input\s*:?\s*(.+?)(?=Output\s*:)/is);
        const outputMatch = text.match(/Output\s*:?\s*(.+?)(?=Explanation|$)/is);

        if (inputMatch && outputMatch) {
          return {
            in: Parsers._clean(inputMatch[1]),
            out: Parsers._clean(outputMatch[1]),
          };
        }
        return null;
      },

      /** Last-resort: regex on raw page text. */
      _parseFromRawText(text) {
        const cases = [];
        // Match each Input:/Output: pair.  The output capture stops at the next
        // "Input:", "Explanation:", "Example:", "Constraints:", or end-of-string.
        const regex = /Input\s*:?\s*([\s\S]*?)Output\s*:?\s*([\s\S]*?)(?=Explanation|Example|Constraints|Input\s*:|\s*$)/gi;
        let match;
        while ((match = regex.exec(text)) !== null) {
          const tc = {
            in: Parsers._clean(match[1]),
            out: Parsers._clean(match[2]),
          };
          if (tc.in && tc.out) cases.push(tc);
        }
        return cases;
      },

      /** Extract problem tags (topics). */
      getTags() {
        const tags = [];
        const tagEls = document.querySelectorAll(
          'a[href*="/tag/"], a[href*="/tags/"]'
        );
        tagEls.forEach((el) => {
          const t = el.textContent.trim();
          if (t && t.length < 50) tags.push(t);
        });
        return tags;
      },

      /** Build full scrape result. */
      parse() {
        if (!this.isMatch()) return null;
        const title = this.getTitle();
        if (!title) return null;
        return {
          title,
          platform: "leetcode",
          difficulty: this.getDifficulty(),
          testCases: this.getTestCases(),
          tags: this.getTags(),
          url: location.href,
          scrapedAt: new Date().toISOString(),
        };
      },
    },

    // ═══════════════════════════════════════════════════════════════════════
    // CODEFORCES PARSER
    // ═══════════════════════════════════════════════════════════════════════

    Codeforces: {
      /** Detect if current page is a Codeforces problem. */
      isMatch() {
        return /codeforces\.com\/(contest|gym)\/\d+\/problem\//i
          .test(location.href) ||
          /codeforces\.com\/problemset\/problem\/\d+\//i
            .test(location.href);
      },

      /** Extract problem title (e.g., "A. Two Sum"). */
      getTitle() {
        // CF uses .title class for problem header
        const selectors = [
          ".title",
          ".problem-statement > .header > .title",
          "div.header > div.title",
        ];

        for (const sel of selectors) {
          try {
            const el = document.querySelector(sel);
            if (el && el.textContent.trim()) {
              // Strip the leading "A. " prefix for cleanliness
              const raw = el.textContent.trim();
              return raw.replace(/^[A-Z]\.\s*/, "").trim();
            }
          } catch { /* skip */ }
        }

        // Fallback: parse from <title>
        const m = document.title.match(/^(.+?)\s*-\s*Codeforces/i);
        return m ? m[1].replace(/^[A-Z]\.\s*/, "").trim() : null;
      },

      /** Codeforces difficulty from problem index or tags. */
      getDifficulty() {
        // CF doesn't have explicit Easy/Med/Hard — infer from contest rating
        // or problem index (A=Easy, B=Easy-Med, C=Med, D+=Hard)

        const header = document.querySelector(".problem-statement > .header");
        if (header) {
          const indexEl = header.querySelector(".title");
          if (indexEl) {
            const letter = indexEl.textContent.trim().charAt(0);
            if ("AB".includes(letter)) return "Easy";
            if ("CD".includes(letter)) return "Med";
            return "Hard"; // E, F, G, ...
          }
        }

        // Check if difficulty rating is shown (Problemset page)
        const diffEl = document.querySelector(".tag-box span[class*='Difficulty']");
        if (diffEl) {
          const rating = parseInt(diffEl.textContent.replace(/\D/g, ""), 10);
          if (rating <= 1200) return "Easy";
          if (rating <= 1900) return "Med";
          return "Hard";
        }

        return "Med";
      },

      /**
       * Extract test cases from Codeforces sample blocks.
       * CF uses a very consistent structure:
       *   div.sample-test > div.input > pre   → input
       *   div.sample-test > div.output > pre  → output
       */
      getTestCases() {
        const cases = [];

        // Primary: structured sample-test blocks
        const sampleBlocks = document.querySelectorAll(
          ".sample-test, .sample"
        );

        if (sampleBlocks.length > 0) {
          for (const block of sampleBlocks) {
            const inputs = block.querySelectorAll(
              ".input pre, .input > div > pre"
            );
            const outputs = block.querySelectorAll(
              ".output pre, .output > div > pre"
            );

            const count = Math.min(inputs.length, outputs.length);
            for (let i = 0; i < count; i++) {
              // CF uses <div class="test-example-line"> for each line
              // or plain text with newlines in <pre>
              const inText = this._extractPreText(inputs[i]);
              const outText = this._extractPreText(outputs[i]);

              if (inText !== null && outText !== null) {
                cases.push({ in: inText, out: outText });
              }
            }
          }
          if (cases.length > 0) return cases;
        }

        // Fallback: look for "Input" / "Output" headers with <pre> blocks
        const pres = document.querySelectorAll(".problem-statement pre");
        for (let i = 0; i < pres.length - 1; i += 2) {
          cases.push({
            in: Parsers._clean(pres[i].textContent),
            out: Parsers._clean(pres[i + 1].textContent),
          });
        }

        return cases;
      },

      /**
       * Extract text from a CF <pre> block.
       * CF sometimes wraps each line in a <div class="test-example-line">.
       */
      _extractPreText(preEl) {
        if (!preEl) return null;

        // Check for line-by-line divs
        const lines = preEl.querySelectorAll(".test-example-line");
        if (lines.length > 0) {
          return Array.from(lines)
            .map((l) => l.textContent)
            .join("\n")
            .trim();
        }

        return Parsers._clean(preEl.textContent);
      },

      /** Extract problem tags. */
      getTags() {
        const tags = [];
        const tagBox = document.querySelector(".tag-box");
        if (tagBox) {
          const tagEls = tagBox.querySelectorAll("a[href*='/problemset?tags=']");
          tagEls.forEach((el) => {
            const t = el.textContent.trim().replace(/^,\s*/, "");
            if (t) tags.push(t);
          });
        }
        return tags;
      },

      /** Build full scrape result. */
      parse() {
        if (!this.isMatch()) return null;
        const title = this.getTitle();
        if (!title) return null;
        return {
          title,
          platform: "codeforces",
          difficulty: this.getDifficulty(),
          testCases: this.getTestCases(),
          tags: this.getTags(),
          url: location.href,
          scrapedAt: new Date().toISOString(),
        };
      },
    },

    // ═══════════════════════════════════════════════════════════════════════
    // UNIFIED ENTRY POINT
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Auto-detect platform and scrape.
     * @returns {Object|null} Normalised problem data or null.
     */
    scrape() {
      if (this.LeetCode.isMatch())    return this.LeetCode.parse();
      if (this.Codeforces.isMatch())  return this.Codeforces.parse();
      return null;
    },

    /**
     * Detect which platform we're on.
     * @returns {'leetcode'|'codeforces'|null}
     */
    detectPlatform() {
      if (this.LeetCode.isMatch())   return "leetcode";
      if (this.Codeforces.isMatch()) return "codeforces";
      return null;
    },
  };

  // Expose globally for injector.js
  window.__AlgoFlowParsers = Parsers;
}
