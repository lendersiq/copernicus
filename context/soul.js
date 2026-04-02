/**
 * Copernicus.Soul — how to address the user in Explain / Ask (Copernicus.AI).
 *
 * file:// cannot fetch sibling files (browser security). This module embeds a
 * DEFAULT_SOUL_MARKDOWN in this file. Edit that constant for preferences;
 * optional http(s): the app may fetch soul.md if present (else embedded).
 */
(function (global) {
  'use strict';

  var LA = global.Copernicus;
  if (!LA) return;

  /* file:// reads this embedded text only; edit here to change addressing. */
  var DEFAULT_SOUL_MARKDOWN = [
    '# Soul — how to speak with this user',
    '',
    'Short, human context for assistants when summarizing findings, running agents, or sharing insights. Edit freely.',
    '',
    '## How to refer to me',
    '',
    '- **Name or form of address:** *(e.g. first name only, full name, or no name — just "you")*  ',
    '  — *Your preference:* Jim',
    '',
    '- **Tone:** *(e.g. direct and concise / warm / formal)*  ',
    '  — *Your preference:* _________________________________',
    '',
    '- **When presenting insights:** *(e.g. lead with the takeaway, then numbers; or always include uncertainty; avoid hype)*  ',
    '  — *Your preference:* _________________________________',
    '',
    '## Optional notes',
    '',
    '- **Things I dislike in answers:** *(e.g. excessive bullet lists, "Great question!", repeating the prompt)*  ',
    '',
    '- **Domain reminders:** *(e.g. "Portfolio means customer ID in our extracts")*  ',
    '',
    '---',
    '',
    '**Copernicus:** On **file://**, this text is served from `DEFAULT_SOUL_MARKDOWN` in `context/soul.js` (no network). On **http/https**, the app tries `fetch("soul.md")` first, then falls back to this embedded copy. The first filled-in *Your preference* under **How to refer to me** becomes an addressing prefix (e.g. `Jim — …`) in Explain and Ask.'
  ].join('\n');

  function cleanPreferenceValue(s) {
    s = String(s).replace(/\*+/g, '').replace(/^[\s—\-]+|[\s]+$/g, '').trim();
    s = s.replace(/^[_\s]+|[_\s]+$/g, '').trim();
    if (!s || /^_+$/.test(s)) return null;
    return s;
  }

  function parseSoulPreferences(md) {
    var out = { address: null, tone: null, insightsStyle: null };
    if (!md || typeof md !== 'string') return out;
    var m = md.match(/## How to refer to me\s*([\s\S]*?)(?=\n## |\n---\s*$)/i);
    var block = m ? m[1] : md;
    var re = /Your preference:\s*([^\n]+)/gi;
    var match;
    var prefs = [];
    while ((match = re.exec(block)) !== null) {
      var v = cleanPreferenceValue(match[1]);
      if (v) prefs.push(v);
    }
    if (prefs[0]) out.address = prefs[0];
    if (prefs[1]) out.tone = prefs[1];
    if (prefs[2]) out.insightsStyle = prefs[2];
    return out;
  }

  function applySoulText(self, text, source) {
    self.text = text || '';
    self.loaded = !!text;
    self.error = null;
    self._parsed = null;
    self._source = source || 'unknown';
  }

  LA.Soul = {
    text: '',
    loaded: false,
    error: null,
    _parsed: null,
    _source: '',

    load: function () {
      var self = this;
      self._parsed = null;
      self.text = '';
      self.error = null;
      self._source = '';

      var loc = global.location;
      var isFile = loc && loc.protocol === 'file:';

      if (isFile) {
        applySoulText(self, DEFAULT_SOUL_MARKDOWN, 'embedded-file');
        return Promise.resolve(self.text);
      }

      if (!loc || (loc.protocol !== 'http:' && loc.protocol !== 'https:')) {
        applySoulText(self, DEFAULT_SOUL_MARKDOWN, 'embedded-fallback');
        return Promise.resolve(self.text);
      }

      try {
        var url = new URL('soul.md', loc.href);
        return fetch(url.href, { cache: 'no-cache' })
          .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.text();
          })
          .then(function (t) {
            applySoulText(self, t, 'fetched');
            return t;
          })
          .catch(function () {
            applySoulText(self, DEFAULT_SOUL_MARKDOWN, 'embedded-fetch-fail');
            return self.text;
          });
      } catch (e) {
        applySoulText(self, DEFAULT_SOUL_MARKDOWN, 'embedded-error');
        return Promise.resolve(self.text);
      }
    },

    getParsed: function () {
      if (!this.text) return { address: null, tone: null, insightsStyle: null };
      if (this._parsed) return this._parsed;
      this._parsed = parseSoulPreferences(this.text);
      return this._parsed;
    },

    /** Prefix for insight lines, e.g. "Alex — " or "". */
    getAddressingPrefix: function () {
      var p = this.getParsed();
      if (!p.address) return '';
      var a = String(p.address).trim();
      if (!a) return '';
      if (/^(no name|none|n\/a|omit|skip|\(?just\s+['"]you['"]\)?)$/i.test(a)) return '';
      return a + ' — ';
    },

    /** Full soul document for future prompts (trimmed). */
    toPromptContext: function (maxLen) {
      if (!this.text) return '';
      var s = this.text.replace(/\r\n/g, '\n').trim();
      if (maxLen && s.length > maxLen) return s.slice(0, maxLen) + '\n…';
      return s;
    },

    /** Where the active text came from: embedded-file | fetched | embedded-fetch-fail | … */
    getSource: function () {
      return this._source || '';
    }
  };
})(typeof window !== 'undefined' ? window : this);
