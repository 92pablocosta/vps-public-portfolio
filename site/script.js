/* ============================================================
   Progressive enhancement only. The page is fully readable
   and navigable with JavaScript disabled or failing — in that
   case it stays in English, the language written into the HTML.
   ============================================================ */
(function () {
  'use strict';

  document.documentElement.classList.add('js');

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ============================================================
     Localisation — en (fallback) and pt-BR
     ============================================================ */
  var DEFAULT_LANG = 'en';
  var SUPPORTED = ['en', 'pt-BR'];
  var STORAGE_KEY = 'pcvps-language';

  var dict = window.TRANSLATIONS || {};
  var currentLang = DEFAULT_LANG;

  /* localStorage may throw (disabled, private mode, file:// in some
     browsers). Storage is a convenience here, never a requirement. */
  var storage = {
    get: function () {
      try { return window.localStorage.getItem(STORAGE_KEY); }
      catch (e) { return null; }
    },
    set: function (value) {
      try { window.localStorage.setItem(STORAGE_KEY, value); }
      catch (e) { /* preference simply is not remembered */ }
    }
  };

  var normalise = function (tag) {
    if (!tag) { return null; }
    if (String(tag).toLowerCase().indexOf('pt') === 0) { return 'pt-BR'; }
    if (String(tag).toLowerCase().indexOf('en') === 0) { return 'en'; }
    return null;
  };

  /* Development/QA override, never persisted and never shown in the UI:
     index.html?lang=pt-BR  /  index.html#lang=en  (works on file:// too) */
  var languageFromUrl = function () {
    var match = /[?&#]lang=([A-Za-z-]+)/.exec(window.location.href);
    return match ? normalise(match[1]) : null;
  };

  var detectPreferredLanguage = function () {
    var stored = storage.get();
    if (SUPPORTED.indexOf(stored) !== -1) { return stored; }

    var tags = (navigator.languages && navigator.languages.length)
      ? navigator.languages
      : [navigator.language || navigator.userLanguage];

    for (var i = 0; i < tags.length; i++) {
      var hit = normalise(tags[i]);
      if (hit) { return hit; }
    }
    return DEFAULT_LANG;
  };

  var t = function (key) {
    var table = dict[currentLang] || {};
    if (Object.prototype.hasOwnProperty.call(table, key)) { return table[key]; }
    var fallback = dict[DEFAULT_LANG] || {};
    return Object.prototype.hasOwnProperty.call(fallback, key) ? fallback[key] : null;
  };

  var applyTranslations = function () {
    document.documentElement.lang = currentLang;

    var title = t('meta.title');
    if (title) { document.title = title; }

    var meta = document.querySelector('meta[name="description"]');
    var description = t('meta.description');
    if (meta && description) { meta.setAttribute('content', description); }

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var value = t(el.getAttribute('data-i18n'));
      if (value !== null) { el.textContent = value; }
    });

    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var value = t(el.getAttribute('data-i18n-html'));
      if (value !== null) { el.innerHTML = value; }
    });

    document.querySelectorAll('[data-i18n-aria-label]').forEach(function (el) {
      var value = t(el.getAttribute('data-i18n-aria-label'));
      if (value !== null) { el.setAttribute('aria-label', value); }
    });

    // Let the widgets below re-label whatever they own.
    document.dispatchEvent(new CustomEvent('languagechange', { detail: currentLang }));
  };

  var langButtons = Array.prototype.slice.call(
    document.querySelectorAll('.lang-btn[data-lang]')
  );

  var updateLanguageControls = function () {
    langButtons.forEach(function (button) {
      var active = button.getAttribute('data-lang') === currentLang;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('is-active', active);
    });
  };

  var setLanguage = function (lang, persist) {
    currentLang = SUPPORTED.indexOf(lang) !== -1 ? lang : DEFAULT_LANG;
    if (persist) { storage.set(currentLang); }
    applyTranslations();
    updateLanguageControls();
  };

  langButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      setLanguage(button.getAttribute('data-lang'), true);
    });
  });

  // Runs before the rest of the enhancements so every widget below
  // reads text that is already in the resolved language.
  setLanguage(languageFromUrl() || detectPreferredLanguage(), false);

  /* ---------- Header shadow on scroll ---------- */
  var header = document.getElementById('siteHeader');
  if (header) {
    var onScroll = function () {
      header.classList.toggle('is-stuck', window.scrollY > 8);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ---------- Mobile navigation ---------- */
  var toggle = document.getElementById('navToggle');
  var mobileNav = document.getElementById('mobileNav');

  if (toggle && mobileNav) {
    var navOpen = false;

    var setNav = function (open) {
      navOpen = open;
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', t(open ? 'nav.close' : 'nav.open'));
      mobileNav.hidden = !open;
    };

    setNav(false);
    document.addEventListener('languagechange', function () { setNav(navOpen); });

    toggle.addEventListener('click', function () {
      setNav(!navOpen);
    });

    mobileNav.addEventListener('click', function (e) {
      if (e.target.closest('a')) { setNav(false); }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && navOpen) {
        setNav(false);
        toggle.focus();
      }
    });
  }

  /* ---------- Active section highlighting ---------- */
  var navLinks = Array.prototype.slice.call(
    document.querySelectorAll('.site-nav a[href^="#"]')
  );

  if (navLinks.length && 'IntersectionObserver' in window) {
    var linkFor = {};
    var sections = [];

    navLinks.forEach(function (link) {
      var id = link.getAttribute('href').slice(1);
      var section = document.getElementById(id);
      if (section) {
        linkFor[id] = link;
        sections.push(section);
      }
    });

    var visible = new Set();

    var setActive = function () {
      var current = null;
      sections.forEach(function (section) {
        if (visible.has(section.id)) { current = current || section.id; }
      });
      navLinks.forEach(function (link) {
        link.classList.toggle(
          'is-active',
          current !== null && link === linkFor[current]
        );
      });
    };

    var sectionObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { visible.add(entry.target.id); }
        else { visible.delete(entry.target.id); }
      });
      setActive();
    }, { rootMargin: '-72px 0px -55% 0px', threshold: 0 });

    sections.forEach(function (section) { sectionObserver.observe(section); });
  }

  /* ---------- Subtle reveal on scroll ---------- */
  if (!reduceMotion && 'IntersectionObserver' in window) {
    var blocks = document.querySelectorAll(
      '.section-head, .diagram, .callout, .card, .layer, .panel, .notice, ' +
      '.proof, .status-col, .pipeline-wrap, .loop-step, .quote, .boundaries, ' +
      '.story, .verified-list, .table-scroll, .doc, .cta'
    );

    var revealObserver = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          obs.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });

    Array.prototype.forEach.call(blocks, function (block, i) {
      block.classList.add('reveal');
      // Stagger siblings slightly; cap so nothing waits long.
      block.style.transitionDelay = (Math.min(i % 4, 3) * 55) + 'ms';
      revealObserver.observe(block);
    });
  }

  /* ---------- Copy-to-clipboard for shown commands ---------- */
  document.querySelectorAll('.code[data-copy]').forEach(function (block) {
    var button = block.querySelector('.copy-btn');
    var code = block.querySelector('code');
    if (!button || !code) { return; }

    // Read at click time: the comment lines are localised, so the
    // block content can change after a language switch.
    var commandText = function () {
      return code.textContent
        .split('\n')
        .filter(function (line) { return line.trim() && line.trim().indexOf('# →') !== 0; })
        .join('\n');
    };

    button.addEventListener('click', function () {
      var done = function (ok) {
        button.textContent = t(ok ? 'copy.copied' : 'copy.manual');
        button.classList.add('is-copied');
        window.setTimeout(function () {
          button.textContent = t('copy.label');
          button.classList.remove('is-copied');
        }, 1800);
      };

      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(commandText()).then(function () { done(true); }, function () { done(false); });
      } else {
        // file:// and other non-secure contexts: select the text instead.
        var range = document.createRange();
        range.selectNodeContents(code);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        done(false);
      }
    });
  });
})();
