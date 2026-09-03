(function () {
  'use strict';

  var PART_NAMES = {
    1: 'Prima Pars',
    2: 'Prima Secundae Partis',
    3: 'Secunda Secundae Partis',
    4: 'Tertia Pars',
  };

  var volumes = window.SUMMA_VOLUMES || [];
  var textIndex = window.SUMMA_TEXT || {};

  var scgBooks = window.SCG_BOOKS || [];
  var scgTextIndex = window.SCG_TEXT || {};

  var metaBooks = window.METAPHYSICS_BOOKS || [];
  var metaTextIndex = window.METAPHYSICS_TEXT || {};

  var trinBooks = window.TRINITY_BOOKS || [];
  var trinTextIndex = window.TRINITY_TEXT || {};
  // Book-level/overview summaries for Trinity ship as their own top-level
  // window.TRINITY_SUMMARIES (overview + a `books` array), the same shape
  // window.METAPHYSICS_SUMMARIES uses — unlike window.SUMMARIES.trinity
  // (from data-summaries.js), which only carries per-chapter summaries.
  var trinSummaries = window.TRINITY_SUMMARIES || { overview: null, books: [] };

  var topicsData = window.TOPICS || { categories: [] };
  var quizData = window.QUIZZES || { st: {}, scg: {}, metaphysics: {} };
  var summaryData = window.SUMMARIES || { st: {}, scg: {}, metaphysics: {} };

  var WPM = 220; // assumed reading speed for time estimates

  // ---- Read-tracking (persisted) ----
  // All works share one localStorage set — keys are plain strings and the three
  // schemes ("P1Q1A1" for ST, "SCG-B1C1" for SCG, "META-B1C1" for Metaphysics,
  // "TRIN-B1C1" for On the Trinity) can never collide, so no migration or
  // separate storage key is needed.
  var readSet = new Set();
  try { readSet = new Set(JSON.parse(localStorage.getItem('summa-read') || '[]')); } catch (e) {}
  function readKey(part, q, a) { return 'P' + part + 'Q' + q + 'A' + a; }
  function isRead(part, q, a) { return readSet.has(readKey(part, q, a)); }
  function saveRead() {
    try { localStorage.setItem('summa-read', JSON.stringify(Array.from(readSet))); } catch (e) {}
    queueSyncPush();
  }
  function setRead(part, q, a, val) {
    var k = readKey(part, q, a);
    if (val) readSet.add(k); else readSet.delete(k);
    saveRead();
  }

  function scgReadKey(book, chapter) { return 'SCG-B' + book + 'C' + chapter; }
  function isReadSCG(book, chapter) { return readSet.has(scgReadKey(book, chapter)); }
  function setReadSCG(book, chapter, val) {
    var k = scgReadKey(book, chapter);
    if (val) readSet.add(k); else readSet.delete(k);
    saveRead();
  }

  function metaReadKey(book, chapter) { return 'META-B' + book + 'C' + chapter; }
  function isReadMeta(book, chapter) { return readSet.has(metaReadKey(book, chapter)); }
  function setReadMeta(book, chapter, val) {
    var k = metaReadKey(book, chapter);
    if (val) readSet.add(k); else readSet.delete(k);
    saveRead();
  }

  function trinReadKey(book, chapter) { return 'TRIN-B' + book + 'C' + chapter; }
  function isReadTrin(book, chapter) { return readSet.has(trinReadKey(book, chapter)); }
  function setReadTrin(book, chapter, val) {
    var k = trinReadKey(book, chapter);
    if (val) readSet.add(k); else readSet.delete(k);
    saveRead();
  }

  // Flat, ordered list of every question we have text for, grouped by part then question number.
  var allQuestions = Object.keys(textIndex)
    .map(function (k) { return textIndex[k]; })
    .sort(function (a, b) { return a.part - b.part || a.question - b.question; });

  // Flat, ordered list of every single article across the whole work — this is the true
  // "page" sequence: one page = one article. Each carries a word count for reading-time estimates.
  var allArticles = [];
  allQuestions.forEach(function (q) {
    q.articles.forEach(function (a) {
      var text = a.paragraphs.map(function (p) { return p.text; }).join(' ');
      var wordCount = text ? text.trim().split(/\s+/).length : 0;
      allArticles.push({ part: q.part, question: q.question, articleNumber: a.number, wordCount: wordCount });
    });
  });

  // Minutes of estimated reading time remaining from index `fromIdx` (inclusive).
  // scope 'question' stops at the end of the current question; scope 'book' runs to the very end.
  function remainingMinutes(fromIdx, scope) {
    if (fromIdx < 0) return 0;
    var anchor = allArticles[fromIdx];
    var words = 0;
    for (var i = fromIdx; i < allArticles.length; i++) {
      var item = allArticles[i];
      if (scope === 'question' && (item.part !== anchor.part || item.question !== anchor.question)) break;
      words += item.wordCount;
    }
    return words / WPM;
  }

  function formatMinutes(mins) {
    var total = Math.max(1, Math.round(mins));
    if (total < 60) return total + ' min';
    var h = Math.floor(total / 60), m = total % 60;
    return h + 'h ' + (m ? m + 'm' : '');
  }

  // Flat, ordered list of every audio track across all volumes, in playback order.
  var allTracks = [];
  volumes.forEach(function (v) {
    (v.tracks || []).forEach(function (t) {
      allTracks.push(Object.assign({}, t, { part: v.part, volume: v.volume }));
    });
  });

  function questionKey(part, q) { return 'P' + part + 'Q' + q; }
  function scgKey(book, chapter) { return 'B' + book + 'C' + chapter; }
  function metaKey(book, chapter) { return 'B' + book + 'C' + chapter; }
  // Unlike scgKey/metaKey, the TRINITY_TEXT index (see build-data-trinity.cjs)
  // is itself keyed by the full "TRIN-B{book}C{chapter}" string (not a plain
  // "B{book}C{chapter}") so it doubles as the AUDIO_URLS lookup key too —
  // there's no bare-key collision risk to work around here since this
  // function's result is never used unprefixed.
  function trinKey(book, chapter) { return 'TRIN-B' + book + 'C' + chapter; }

  // Flat, ordered list of every SCG chapter we have text for — the "page" sequence
  // for SCG, one page = one chapter (SCG has no article-level subdivision).
  var allChaptersSCG = [];
  scgBooks.forEach(function (b) {
    (b.chapters || []).forEach(function (c) {
      var full = scgTextIndex[scgKey(b.book, c.chapter)];
      var text = full && full.paragraphs ? full.paragraphs.map(function (p) { return p.text; }).join(' ') : '';
      var wordCount = text ? text.trim().split(/\s+/).length : 0;
      allChaptersSCG.push({ book: b.book, chapter: c.chapter, wordCount: wordCount });
    });
  });

  function chapterIndexSCG(book, chapterNum) {
    for (var i = 0; i < allChaptersSCG.length; i++) {
      var c = allChaptersSCG[i];
      if (c.book === book && c.chapter === chapterNum) return i;
    }
    return -1;
  }

  // Minutes of estimated reading time remaining from index `fromIdx` (inclusive) in the
  // SCG chapter sequence. scope 'book' stops at the end of the current book; scope
  // 'work' runs to the end of the whole Summa Contra Gentiles.
  function remainingMinutesSCG(fromIdx, scope) {
    if (fromIdx < 0) return 0;
    var anchor = allChaptersSCG[fromIdx];
    var words = 0;
    for (var i = fromIdx; i < allChaptersSCG.length; i++) {
      var item = allChaptersSCG[i];
      if (scope === 'book' && item.book !== anchor.book) break;
      words += item.wordCount;
    }
    return words / WPM;
  }

  // Flat, ordered list of every Metaphysics chapter we have text for — the "page"
  // sequence for the Metaphysics, one page = one chapter (no article-level subdivision).
  // Each entry also carries the audio track number/file so track-boundary lookups
  // (used by the player's prev/next-track buttons and the track-aware reload logic)
  // don't have to re-read metaTextIndex on every call.
  var allChaptersMeta = [];
  metaBooks.forEach(function (b) {
    (b.chapters || []).forEach(function (c) {
      var full = metaTextIndex[metaKey(b.book, c.chapter)];
      var text = full && full.paragraphs ? full.paragraphs.map(function (p) { return p.text; }).join(' ') : '';
      var wordCount = text ? text.trim().split(/\s+/).length : 0;
      allChaptersMeta.push({
        book: b.book,
        chapter: c.chapter,
        wordCount: wordCount,
        hasAudio: !!(full && full.hasAudio),
        audioTrack: full ? full.audioTrack : null,
        audioFile: full ? full.audioFile : null
      });
    });
  });

  function chapterIndexMeta(book, chapterNum) {
    for (var i = 0; i < allChaptersMeta.length; i++) {
      var c = allChaptersMeta[i];
      if (c.book === book && c.chapter === chapterNum) return i;
    }
    return -1;
  }

  // Minutes of estimated reading time remaining from index `fromIdx` (inclusive) in the
  // Metaphysics chapter sequence. scope 'book' stops at the end of the current book;
  // scope 'work' runs to the end of the whole Metaphysics.
  function remainingMinutesMeta(fromIdx, scope) {
    if (fromIdx < 0) return 0;
    var anchor = allChaptersMeta[fromIdx];
    var words = 0;
    for (var i = fromIdx; i < allChaptersMeta.length; i++) {
      var item = allChaptersMeta[i];
      if (scope === 'book' && item.book !== anchor.book) break;
      words += item.wordCount;
    }
    return words / WPM;
  }

  // Flat, ordered list of one entry per distinct Metaphysics audio track (the first
  // chapter that uses it), in playback order — mirrors `allTracks` for ST. Used by the
  // player's prev/next-track buttons and by the "audio ended" handler so they jump to
  // the next/previous *track*, not just the next/previous chapter (several chapters
  // commonly share one track).
  var allTracksMeta = [];
  allChaptersMeta.forEach(function (c) {
    if (c.audioTrack == null) return;
    var last = allTracksMeta[allTracksMeta.length - 1];
    if (!last || last.audioTrack !== c.audioTrack) {
      allTracksMeta.push({ audioTrack: c.audioTrack, audioFile: c.audioFile, book: c.book, chapter: c.chapter });
    }
  });

  function trackIndexMeta(trackNum) {
    for (var i = 0; i < allTracksMeta.length; i++) {
      if (allTracksMeta[i].audioTrack === trackNum) return i;
    }
    return -1;
  }

  // Flat, ordered list of every "On the Trinity" chapter we have text for — the
  // "page" sequence for Trinity, one page = one chapter (no article-level
  // subdivision; chapter 0, where present, is a book's unnumbered
  // Introduction/Preface). Audio is generated one file per chapter (no
  // sharing across chapters like Metaphysics), so this mirrors allChaptersSCG
  // rather than the track-aware allChaptersMeta.
  var allChaptersTrin = [];
  trinBooks.forEach(function (b) {
    (b.chapters || []).forEach(function (c) {
      var full = trinTextIndex[trinKey(b.book, c.chapter)];
      var text = full && full.paragraphs ? full.paragraphs.map(function (p) { return p.text; }).join(' ') : '';
      var wordCount = text ? text.trim().split(/\s+/).length : 0;
      allChaptersTrin.push({ book: b.book, chapter: c.chapter, wordCount: wordCount });
    });
  });

  function chapterIndexTrin(book, chapterNum) {
    for (var i = 0; i < allChaptersTrin.length; i++) {
      var c = allChaptersTrin[i];
      if (c.book === book && c.chapter === chapterNum) return i;
    }
    return -1;
  }

  // Minutes of estimated reading time remaining from index `fromIdx` (inclusive) in the
  // Trinity chapter sequence. scope 'book' stops at the end of the current book; scope
  // 'work' runs to the end of all 15 books.
  function remainingMinutesTrin(fromIdx, scope) {
    if (fromIdx < 0) return 0;
    var anchor = allChaptersTrin[fromIdx];
    var words = 0;
    for (var i = fromIdx; i < allChaptersTrin.length; i++) {
      var item = allChaptersTrin[i];
      if (scope === 'book' && item.book !== anchor.book) break;
      words += item.wordCount;
    }
    return words / WPM;
  }

  // Human-friendly label derived from an audio file's name, e.g.
  // "../audio/metaphysics/02 - Book I Chapters 4-7.mp3" -> "Book I Chapters 4-7".
  function trackLabelFromFile(file) {
    if (!file) return '';
    var base = file.split('/').pop().replace(/\.[^.]+$/, '');
    return base.replace(/^\d+\s*-\s*/, '');
  }

  function findTrackForQuestion(part, q) {
    for (var i = 0; i < allTracks.length; i++) {
      var t = allTracks[i];
      if (t.part === part && t.questionStart != null && t.questionEnd != null &&
          q >= t.questionStart && q <= t.questionEnd) {
        return { track: t, index: i };
      }
    }
    return null;
  }

  function articleIndex(part, qnum, articleNumber) {
    for (var i = 0; i < allArticles.length; i++) {
      var a = allArticles[i];
      if (a.part === part && a.question === qnum && a.articleNumber === articleNumber) return i;
    }
    return -1;
  }

  // ---- State ----
  var state = {
    work: 'ST', // 'ST' (Summa Theologica), 'SCG' (Summa Contra Gentiles), 'META' (Aristotle's Metaphysics), or 'TRIN' (Augustine's On the Trinity)
    part: null,
    question: null,
    article: null,
    book: null, // also used for SCG/META/TRIN (only one work is active at a time)
    chapter: null, // also used for SCG/META/TRIN
    wasPlaying: false,
  };

  var _pendingAudioRestore = null;
  var _pendingAlignmentSeek = null;

  function parseSTHash(hash) {
    var m = hash.match(/^P(\d+)Q(\d+)(?:A(\d+))?$/);
    if (!m) return null;
    var part = parseInt(m[1], 10), qnum = parseInt(m[2], 10);
    var q = textIndex[questionKey(part, qnum)];
    if (!q) return null;
    var artNum = m[3] ? parseInt(m[3], 10) : (q.articles[0] ? q.articles[0].number : 1);
    if (!q.articles.some(function (a) { return a.number === artNum; })) {
      artNum = q.articles[0] ? q.articles[0].number : 1;
    }
    return { work: 'ST', part: part, question: qnum, article: artNum };
  }

  function parseSCGHash(hash) {
    var m = hash.match(/^SCG-B(\d+)C(\d+)$/);
    if (!m) return null;
    var book = parseInt(m[1], 10), chapter = parseInt(m[2], 10);
    if (!scgTextIndex[scgKey(book, chapter)]) return null;
    return { work: 'SCG', book: book, chapter: chapter };
  }

  function parseMetaHash(hash) {
    var m = hash.match(/^META-B(\d+)C(\d+)$/);
    if (!m) return null;
    var book = parseInt(m[1], 10), chapter = parseInt(m[2], 10);
    if (!metaTextIndex[metaKey(book, chapter)]) return null;
    return { work: 'META', book: book, chapter: chapter };
  }

  function parseTrinHash(hash) {
    var m = hash.match(/^TRIN-B(\d+)C(\d+)$/);
    if (!m) return null;
    var book = parseInt(m[1], 10), chapter = parseInt(m[2], 10);
    if (!trinTextIndex[trinKey(book, chapter)]) return null;
    return { work: 'TRIN', book: book, chapter: chapter };
  }

  function initialLocation() {
    var hash = window.location.hash.replace('#', '');
    var loc = parseMetaHash(hash) || parseTrinHash(hash) || parseSCGHash(hash) || parseSTHash(hash);
    if (loc) return loc;

    // Fallback: restore from saved session when navigating to bare URL
    var session = getSavedSession();
    if (session && session.hash) {
      var sloc = parseMetaHash(session.hash) || parseTrinHash(session.hash) || parseSCGHash(session.hash) || parseSTHash(session.hash);
      if (sloc) return sloc;
    }
    if (allArticles.length) return Object.assign({ work: 'ST' }, allArticles[0]);
    return { work: 'ST', part: 1, question: 1, article: 1 };
  }

  // ---- DOM refs ----
  var $ = function (id) { return document.getElementById(id); };
  var menuBtn = $('menuBtn'), closeDrawerBtn = $('closeDrawerBtn'), drawer = $('drawer'), scrim = $('scrim');
  var drawerTree = $('drawerTree');
  var drawerHeadTitle = $('drawerHeadTitle');
  var backToMenuBtn = $('backToMenuBtn');
  var menuScreen = $('menuScreen'), closeMenuBtn = $('closeMenuBtn');
  var questionView = $('questionView');
  var chapterView = $('chapterView');
  var workSwitch = $('workSwitch');
  var topbarWork = $('topbarWork');
  var topbarLocation = $('topbarLocation');
  var prevBtn = $('prevBtn'), nextBtn = $('nextBtn');
  var themeBtn = $('themeBtn');
  var sunIcon = $('sunIcon'), moonIcon = $('moonIcon'), autoIcon = $('autoIcon');
  var audioEl = $('audioEl');
  var playBtn = $('playBtn'), playIcon = $('playIcon'), pauseIcon = $('pauseIcon');
  var prevTrackBtn = $('prevTrackBtn'), nextTrackBtn = $('nextTrackBtn');
  var seek = $('seek'), curTime = $('curTime'), durTime = $('durTime');
  var playerTrackTitle = $('playerTrackTitle');
  var searchBtn = $('searchBtn'), searchOverlay = $('searchOverlay'), searchPanel = $('searchPanel');
  var searchInput = $('searchInput'), closeSearchBtn = $('closeSearchBtn'), searchResultsEl = $('searchResults');
  var speedBtn = $('speedBtn');
  var aiToggle = $('aiToggle'), aiAnswerEl = $('aiAnswer');

  // ---- Drawer open/close ----
  function openDrawer() { drawer.classList.add('open'); scrim.classList.add('open'); }
  function closeDrawer() { drawer.classList.remove('open'); scrim.classList.remove('open'); }
  closeDrawerBtn.addEventListener('click', closeDrawer);
  scrim.addEventListener('click', closeDrawer);

  // ---- Menu screen (choose Metaphysics / SCG / ST / Trinity / Topics) ----
  // A standalone full-viewport landing page, not a tab strip and not the side
  // drawer — the hamburger opens this; picking a work either drops the reader
  // straight into that work's reading view (ST/SCG/META/TRIN) or, for Topics (which
  // isn't itself a reading view), opens the side drawer showing the topics list.
  function openMenuScreen() { menuScreen.classList.add('open'); }
  function closeMenuScreen() { menuScreen.classList.remove('open'); }
  // The hamburger opens navigation for whatever you're currently doing: the
  // chapter/question tree for the book you're reading. To switch to a
  // different work entirely, use the "back to menu" button inside that
  // drawer (below) to reach the full work-picker screen.
  menuBtn.addEventListener('click', function () {
    setActiveWork(state.work);
    openDrawer();
  });
  closeMenuBtn.addEventListener('click', closeMenuScreen);
  backToMenuBtn.addEventListener('click', function () {
    closeDrawer();
    openMenuScreen();
  });

  // ---- Theme ----
  var THEME_NEXT = { system: 'dark', dark: 'light', light: 'system' };
  var THEME_LABEL = { system: 'System (auto)', dark: 'Dark', light: 'Light' };
  function applyTheme(t) {
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('summa-theme', t);

    sunIcon.style.display = t === 'light' ? '' : 'none';
    moonIcon.style.display = t === 'dark' ? '' : 'none';
    autoIcon.style.display = t === 'system' ? '' : 'none';

    var next = THEME_NEXT[t];
    var label = 'Theme: ' + THEME_LABEL[t] + ' (click for ' + THEME_LABEL[next] + ')';
    themeBtn.title = label;
    themeBtn.setAttribute('aria-label', label);
  }
  themeBtn.addEventListener('click', function () {
    var cur = localStorage.getItem('summa-theme') || 'system';
    applyTheme(THEME_NEXT[cur]);
  });
  applyTheme(localStorage.getItem('summa-theme') || 'system');

  // ---- Work switch (ST / SCG / META / TRIN / TOPICS) ----
  var WORK_LABEL = { ST: 'Summa Theologica', SCG: 'Summa Contra Gentiles', META: 'Metaphysics', TRIN: 'On the Trinity', TOPICS: 'Topics' };
  function setActiveWork(work) {
    drawerTree.dataset.activeWork = work;
    if (drawerHeadTitle) drawerHeadTitle.textContent = WORK_LABEL[work] || 'Contents';
    var btns = workSwitch.querySelectorAll('.menu-page-item');
    btns.forEach(function (b) {
      b.classList.toggle('active', b.dataset.work === work);
      b.setAttribute('aria-selected', b.dataset.work === work ? 'true' : 'false');
    });
  }
  // Picking a work from the menu screen either takes the reader straight into
  // that work's reading view (ST/SCG/META/TRIN — jumping to its opening page if
  // it isn't already the active work) or, for Topics, opens the side drawer's
  // cross-reference list since Topics has no reading view of its own.
  workSwitch.addEventListener('click', function (e) {
    var btn = e.target.closest('.menu-page-item');
    if (!btn) return;
    var work = btn.dataset.work;
    setActiveWork(work);
    closeMenuScreen();
    if (work === 'TOPICS') {
      openDrawer();
      return;
    }
    if (state.work === work) return;
    if (work === 'META') {
      var mc = allChaptersMeta[0];
      if (mc) goToChapterMeta(mc.book, mc.chapter);
    } else if (work === 'TRIN') {
      var tc = allChaptersTrin[0];
      if (tc) goToChapterTrinity(tc.book, tc.chapter);
    } else if (work === 'SCG') {
      var sc = allChaptersSCG[0];
      if (sc) goToChapter(sc.book, sc.chapter);
    } else if (work === 'ST') {
      var a = allArticles[0];
      if (a) goTo(a.part, a.question, a.articleNumber);
    }
  });

  // ---- Build nav tree ----
  var stTreeWrap = null, scgTreeWrap = null, metaTreeWrap = null, trinTreeWrap = null, topicsTreeWrap = null;

  function buildTree() {
    stTreeWrap = document.createElement('div');
    stTreeWrap.className = 'work-group';
    stTreeWrap.dataset.work = 'ST';
    for (var part = 1; part <= 4; part++) {
      var partQuestions = allQuestions.filter(function (q) { return q.part === part; });
      if (!partQuestions.length) continue;

      var partVolumes = volumes.filter(function (v) { return v.part === part; });
      var coveredCount = 0;
      partVolumes.forEach(function (v) { coveredCount += (v.questionNumbers || []).length; });
      var useVolumeGrouping = coveredCount >= partQuestions.length * 0.8; // most questions mapped to a volume

      var partEl = document.createElement('div');
      partEl.className = 'tree-part';
      partEl.dataset.part = part;

      var partBtn = document.createElement('button');
      partBtn.className = 'tree-part-btn';
      partBtn.innerHTML = '<span>' + PART_NAMES[part] + '</span><span class="chev">&#9656;</span>';
      partBtn.addEventListener('click', function () {
        this.parentElement.classList.toggle('open');
      });
      partEl.appendChild(partBtn);

      var partBody = document.createElement('div');
      partBody.className = 'tree-part-body';

      if (useVolumeGrouping) {
        partVolumes.forEach(function (v) {
          var qNums = v.questionNumbers && v.questionNumbers.length
            ? v.questionNumbers
            : []; // volumes with no mapped questions yet are skipped
          if (!qNums.length) return;

          var volEl = document.createElement('div');
          volEl.className = 'tree-volume' + (v.hasAudio ? ' has-audio' : '');
          volEl.dataset.volume = v.volume;

          var volBtn = document.createElement('button');
          volBtn.className = 'tree-volume-btn';
          volBtn.innerHTML = '<span>Vol. ' + String(v.volume).padStart(2, '0') + ' — ' + v.title + '</span><span class="audio-dot" title="Audio available"></span>';
          volBtn.addEventListener('click', function () {
            this.parentElement.classList.toggle('open');
          });
          volEl.appendChild(volBtn);

          var volBody = document.createElement('div');
          volBody.className = 'tree-volume-body';
          qNums.forEach(function (qn) {
            volBody.appendChild(makeQuestionButton(part, qn));
          });
          volEl.appendChild(volBody);
          partBody.appendChild(volEl);
        });
      } else {
        partQuestions.forEach(function (q) {
          partBody.appendChild(makeQuestionButton(part, q.question));
        });
      }

      partEl.appendChild(partBody);
      stTreeWrap.appendChild(partEl);
    }
  }

  // SCG tree: Book -> Chapter (no third level, SCG has no articles).
  function buildTreeSCG() {
    scgTreeWrap = document.createElement('div');
    scgTreeWrap.className = 'work-group';
    scgTreeWrap.dataset.work = 'SCG';

    scgBooks.forEach(function (b) {
      if (!b.hasAnyText || !b.chapters.length) return;

      var bookEl = document.createElement('div');
      bookEl.className = 'tree-part';
      bookEl.dataset.book = b.book;

      var bookBtn = document.createElement('button');
      bookBtn.className = 'tree-part-btn';
      var audioCount = b.chapters.filter(function (c) { return c.hasAudio; }).length;
      bookBtn.innerHTML = '<span>Book ' + b.roman + ' — ' + b.bookTitle.replace(/^Book (One|Two|Three|Four): /, '') + '</span><span class="chev">&#9656;</span>';
      bookBtn.title = audioCount + ' of ' + b.chapters.length + ' chapters have audio';
      bookBtn.addEventListener('click', function () {
        this.parentElement.classList.toggle('open');
      });
      bookEl.appendChild(bookBtn);

      var bookBody = document.createElement('div');
      bookBody.className = 'tree-part-body';
      b.chapters.forEach(function (c) {
        bookBody.appendChild(makeChapterButton(b.book, c.chapter, c.title, c.hasAudio));
      });
      bookEl.appendChild(bookBody);
      scgTreeWrap.appendChild(bookEl);
    });
  }

  // Metaphysics tree: Book -> Chapter (no third level, and chapters have no titles in
  // this edition — nav labels fall back to "Chapter N").
  function buildTreeMeta() {
    metaTreeWrap = document.createElement('div');
    metaTreeWrap.className = 'work-group';
    metaTreeWrap.dataset.work = 'META';

    metaBooks.forEach(function (b) {
      if (!b.hasAnyText || !b.chapters.length) return;

      var bookEl = document.createElement('div');
      bookEl.className = 'tree-part';
      bookEl.dataset.book = b.book;

      var bookBtn = document.createElement('button');
      bookBtn.className = 'tree-part-btn';
      var audioCount = b.chapters.filter(function (c) { return c.hasAudio; }).length;
      bookBtn.innerHTML = '<span>Book ' + b.roman + ' — ' + b.bookTitle.replace(/^Book [IVXLCDM]+\s*/, '') + '</span><span class="chev">&#9656;</span>';
      bookBtn.title = audioCount + ' of ' + b.chapters.length + ' chapters have audio';
      bookBtn.addEventListener('click', function () {
        this.parentElement.classList.toggle('open');
      });
      bookEl.appendChild(bookBtn);

      var bookBody = document.createElement('div');
      bookBody.className = 'tree-part-body';
      b.chapters.forEach(function (c) {
        bookBody.appendChild(makeChapterButton(b.book, c.chapter, c.title, c.hasAudio, 'META'));
      });
      bookEl.appendChild(bookBody);
      metaTreeWrap.appendChild(bookEl);
    });
  }

  // Trinity tree: Book -> Chapter (no third level; chapter 0, where present, is a
  // book's unnumbered Introduction/Preface and carries its own title like every
  // other chapter, so no "Chapter N" fallback label is needed here).
  function buildTreeTrinity() {
    trinTreeWrap = document.createElement('div');
    trinTreeWrap.className = 'work-group';
    trinTreeWrap.dataset.work = 'TRIN';

    trinBooks.forEach(function (b) {
      if (!b.hasAnyText || !b.chapters.length) return;

      var bookEl = document.createElement('div');
      bookEl.className = 'tree-part';
      bookEl.dataset.book = b.book;

      var bookBtn = document.createElement('button');
      bookBtn.className = 'tree-part-btn';
      var audioCount = b.chapters.filter(function (c) { return c.hasAudio; }).length;
      bookBtn.innerHTML = '<span>Book ' + b.roman + '</span><span class="chev">&#9656;</span>';
      bookBtn.title = audioCount + ' of ' + b.chapters.length + ' chapters have audio';
      bookBtn.addEventListener('click', function () {
        this.parentElement.classList.toggle('open');
      });
      bookEl.appendChild(bookBtn);

      var bookBody = document.createElement('div');
      bookBody.className = 'tree-part-body';
      b.chapters.forEach(function (c) {
        bookBody.appendChild(makeChapterButton(b.book, c.chapter, c.title, c.hasAudio, 'TRIN'));
      });
      bookEl.appendChild(bookBody);
      trinTreeWrap.appendChild(bookEl);
    });
  }

  // Topics tree: Category -> Topic (question/summary + one or more clickable references
  // into the ST/SCG text). Mirrors the ST/SCG Part -> Question tree visually (same
  // collapsible tree-part pattern) but topics are cross-cutting, so a topic's references
  // can jump into either work.
  function buildTreeTopics() {
    topicsTreeWrap = document.createElement('div');
    topicsTreeWrap.className = 'work-group';
    topicsTreeWrap.dataset.work = 'TOPICS';

    var categories = (topicsData && topicsData.categories) || [];
    if (!categories.length) {
      var empty = document.createElement('div');
      empty.className = 'topics-empty';
      empty.textContent = 'Topics are not available yet.';
      topicsTreeWrap.appendChild(empty);
      return;
    }

    categories.forEach(function (cat) {
      if (!cat.topics || !cat.topics.length) return;

      var catEl = document.createElement('div');
      catEl.className = 'tree-part';
      catEl.dataset.category = cat.key;

      var catBtn = document.createElement('button');
      catBtn.className = 'tree-part-btn';
      catBtn.innerHTML = '<span>' + escapeHtml(cat.label) + '</span><span class="chev">&#9656;</span>';
      catBtn.addEventListener('click', function () {
        this.parentElement.classList.toggle('open');
      });
      catEl.appendChild(catBtn);

      var catBody = document.createElement('div');
      catBody.className = 'tree-part-body';

      cat.topics.forEach(function (topic) {
        catBody.appendChild(makeTopicItem(topic));
      });

      catEl.appendChild(catBody);
      topicsTreeWrap.appendChild(catEl);
    });
  }

  function makeTopicItem(topic) {
    var item = document.createElement('div');
    item.className = 'topic-item';

    var q = document.createElement('div');
    q.className = 'topic-question';
    q.textContent = topic.question;
    item.appendChild(q);

    var s = document.createElement('div');
    s.className = 'topic-summary';
    s.textContent = topic.summary;
    item.appendChild(s);

    var refsEl = document.createElement('div');
    refsEl.className = 'topic-refs';
    topic.references.forEach(function (ref) {
      var btn = document.createElement('button');
      btn.type = 'button';
      if (ref.hash == null) {
        // Reference into a work not yet wired into the reader — show the citation as
        // plain, non-interactive text rather than a dead link.
        btn.className = 'topic-ref-btn topic-ref-unavailable';
        btn.disabled = true;
        btn.title = 'Not yet available in the reader';
      } else {
        btn.className = 'topic-ref-btn';
        btn.addEventListener('click', function () {
          closeDrawer();
          if (ref.work === 'SCG') goToChapter(ref.book, ref.chapter);
          else if (ref.work === 'META') goToChapterMeta(ref.book, ref.chapter);
          else if (ref.work === 'TRIN') goToChapterTrinity(ref.book, ref.chapter);
          else goTo(ref.part, ref.question, ref.article);
        });
      }
      btn.textContent = ref.label;
      refsEl.appendChild(btn);
    });
    item.appendChild(refsEl);

    return item;
  }

  function makeChapterButton(book, chapterNum, title, hasAudio, work) {
    work = work || 'SCG';
    var btn = document.createElement('button');
    btn.className = 'tree-q' + (hasAudio ? '' : ' no-audio');
    btn.dataset.work = work;
    btn.dataset.book = book;
    btn.dataset.chapter = chapterNum;

    var labelSpan = document.createElement('span');
    labelSpan.className = 'tree-q-label';
    // Metaphysics chapters have no title in this edition — fall back to "Chapter N".
    // Trinity's chapter 0 (an Introduction/Preface) always has a title of its own,
    // so it's labeled with that title directly rather than "0. Introduction".
    if (title) {
      labelSpan.textContent = (work === 'TRIN' && chapterNum === 0) ? title : (chapterNum + '. ' + title);
    } else {
      labelSpan.textContent = 'Chapter ' + chapterNum;
    }
    btn.appendChild(labelSpan);

    var badge = document.createElement('span');
    badge.className = 'tree-q-badge';
    btn.appendChild(badge);

    btn.addEventListener('click', function () {
      if (work === 'META') goToChapterMeta(book, chapterNum);
      else if (work === 'TRIN') goToChapterTrinity(book, chapterNum);
      else goToChapter(book, chapterNum);
      closeDrawer();
    });
    return btn;
  }

  function makeQuestionButton(part, qnum) {
    var q = textIndex[questionKey(part, qnum)];
    var firstArticle = q && q.articles[0] ? q.articles[0].number : 1;
    var btn = document.createElement('button');
    btn.className = 'tree-q';
    btn.dataset.work = 'ST';
    btn.dataset.part = part;
    btn.dataset.question = qnum;

    var labelSpan = document.createElement('span');
    labelSpan.className = 'tree-q-label';
    labelSpan.textContent = 'Q' + qnum + '. ' + (q ? q.title : '');
    btn.appendChild(labelSpan);

    var badge = document.createElement('span');
    badge.className = 'tree-q-badge';
    btn.appendChild(badge);

    btn.addEventListener('click', function () {
      goTo(part, qnum, firstArticle);
      closeDrawer();
    });
    return btn;
  }

  // Re-scan all Question nav buttons and mark them fully-read / partially-read / unread
  // based on the current readSet. Call after buildTree() and whenever setRead() runs.
  function updateNavReadBadges() {
    var buttons = drawerTree.querySelectorAll('.tree-q');
    buttons.forEach(function (b) {
      b.classList.remove('fully-read', 'partially-read');
      var work = b.dataset.work;
      if (work === 'SCG' || work === 'META' || work === 'TRIN') {
        var book = parseInt(b.dataset.book, 10);
        var chapter = parseInt(b.dataset.chapter, 10);
        var isDone = work === 'META' ? isReadMeta(book, chapter) : work === 'TRIN' ? isReadTrin(book, chapter) : isReadSCG(book, chapter);
        if (isDone) b.classList.add('fully-read');
        return;
      }
      var part = parseInt(b.dataset.part, 10);
      var qnum = parseInt(b.dataset.question, 10);
      var q = textIndex[questionKey(part, qnum)];
      if (!q) return;
      var total = q.articles.length;
      var readCount = 0;
      q.articles.forEach(function (a) { if (isRead(part, qnum, a.number)) readCount++; });
      if (readCount > 0 && readCount === total) b.classList.add('fully-read');
      else if (readCount > 0) b.classList.add('partially-read');
    });
  }

  function highlightActiveNav() {
    var buttons = drawerTree.querySelectorAll('.tree-q');
    buttons.forEach(function (b) {
      var active;
      var work = b.dataset.work;
      if (work === 'SCG' || work === 'META' || work === 'TRIN') {
        active = state.work === work && parseInt(b.dataset.book, 10) === state.book && parseInt(b.dataset.chapter, 10) === state.chapter;
      } else {
        active = state.work === 'ST' && parseInt(b.dataset.part, 10) === state.part && parseInt(b.dataset.question, 10) === state.question;
      }
      b.classList.toggle('active', active);
      if (active) {
        var volEl = b.closest('.tree-volume');
        if (volEl) volEl.classList.add('open');
        var partEl = b.closest('.tree-part');
        if (partEl) partEl.classList.add('open');
        setActiveWork(state.work);
      }
    });
  }

  // ---- Render a single article as its own page ----
  function renderArticle(part, qnum, articleNumber) {
    var q = textIndex[questionKey(part, qnum)];
    questionView.innerHTML = '';
    if (!q) {
      questionView.innerHTML = '<p>This question has not been loaded yet.</p>';
      return;
    }
    var article = q.articles.find(function (a) { return a.number === articleNumber; }) || q.articles[0];
    var artIdx = q.articles.indexOf(article);

    var eyebrow = document.createElement('div');
    eyebrow.className = 'q-eyebrow';
    eyebrow.textContent = (PART_NAMES[part] || 'Part ' + part) + ' — Question ' + qnum +
      (q.articles.length > 1 ? ' · Article ' + (artIdx + 1) + ' of ' + q.articles.length : '');
    questionView.appendChild(eyebrow);

    var h1 = document.createElement('h1');
    h1.textContent = q.title;
    questionView.appendChild(h1);

    // Book/part-level summary (longer), shown once at the first question of each part.
    if (qnum === 1) {
      var stBook = summaryData.st.books && summaryData.st.books['P' + part];
      var bookSummaryEl = stBook && renderBookSummary(stBook.title || (PART_NAMES[part] || 'Part ' + part), stBook.summary);
      if (bookSummaryEl) questionView.appendChild(bookSummaryEl);
    }

    // Question-level summary (shorter), shown at the top of every question.
    var questionSummaryText = summaryData.st.chapters && summaryData.st.chapters[questionKey(part, qnum)];
    var questionSummaryEl = renderChapterSummary(questionSummaryText);
    if (questionSummaryEl) questionView.appendChild(questionSummaryEl);

    var curIdx = articleIndex(part, qnum, article.number);
    if (curIdx >= 0) {
      var timeRemaining = document.createElement('div');
      timeRemaining.className = 'q-time-remaining';
      var qMins = formatMinutes(remainingMinutes(curIdx, 'question'));
      var bookMins = formatMinutes(remainingMinutes(curIdx, 'book'));
      timeRemaining.textContent = qMins + ' left in this Question · ' + bookMins + ' left in the Summa';
      questionView.appendChild(timeRemaining);
    }

    if (q.articles.length > 1) {
      var pills = document.createElement('div');
      pills.className = 'article-pills';
      q.articles.forEach(function (a) {
        var pill = document.createElement('button');
        var isActive = a.number === articleNumber;
        var isArtRead = isRead(part, qnum, a.number);
        pill.className = 'article-pill' + (isActive ? ' active' : '') + (isArtRead ? ' read' : '');
        pill.type = 'button';
        pill.textContent = a.number;
        pill.title = a.title + (isArtRead ? ' (read)' : '');
        pill.addEventListener('click', function () { goTo(part, qnum, a.number); });
        pills.appendChild(pill);
      });
      questionView.appendChild(pills);
    }

    var artEl = document.createElement('div');
    artEl.className = 'article';

    var h2Row = document.createElement('div');
    h2Row.className = 'article-h2-row';

    var h2 = document.createElement('h2');
    h2.textContent = 'Article ' + article.number + '. ' + article.title;
    h2Row.appendChild(h2);

    var readToggle = document.createElement('button');
    readToggle.type = 'button';
    var articleIsRead = isRead(part, qnum, article.number);
    readToggle.className = 'read-toggle' + (articleIsRead ? ' is-read' : '');
    readToggle.setAttribute('aria-pressed', articleIsRead ? 'true' : 'false');
    readToggle.innerHTML = '<span class="read-toggle-mark">' + (articleIsRead ? '&#10003;' : '') + '</span><span class="read-toggle-label">' +
      (articleIsRead ? 'Read' : 'Mark as read') + '</span>';
    readToggle.addEventListener('click', function () {
      setRead(part, qnum, article.number, !isRead(part, qnum, article.number));
      updateNavReadBadges();
      renderArticle(part, qnum, article.number);
    });
    h2Row.appendChild(readToggle);

    artEl.appendChild(h2Row);

    article.paragraphs.forEach(function (p, pIdx) {
      var pEl = document.createElement('p');
      pEl.dataset.pidx = pIdx;
      var isAnswer = p.label && /^I answer that/i.test(p.label);
      if (isAnswer) pEl.className = 'answer';
      if (p.label) {
        var labelSpan = document.createElement('span');
        labelSpan.className = 'label';
        labelSpan.textContent = p.label;
        pEl.appendChild(labelSpan);
        pEl.appendChild(document.createTextNode(' ' + p.text));
      } else {
        pEl.textContent = p.text;
      }
      artEl.appendChild(pEl);
    });

    questionView.appendChild(artEl);

    // Quiz appears once the reader reaches the last article of the question —
    // i.e. at the "end of the chapter" for the Summa's Question/Article structure.
    var isLastArticle = artIdx === q.articles.length - 1;
    if (isLastArticle) {
      var quizQuestions = quizData.st[questionKey(part, qnum)];
      var quizEl = renderQuiz(quizQuestions, 'ST-' + questionKey(part, qnum));
      if (quizEl) questionView.appendChild(quizEl);
    }
  }

  // ---- Render a single SCG chapter as its own page ----
  function renderChapter(book, chapterNum) {
    var c = scgTextIndex[scgKey(book, chapterNum)];
    chapterView.innerHTML = '';
    if (!c) {
      chapterView.innerHTML = '<p>This chapter has not been loaded yet.</p>';
      return;
    }
    var bookMeta = scgBooks.filter(function (b) { return b.book === book; })[0];

    var eyebrow = document.createElement('div');
    eyebrow.className = 'q-eyebrow';
    eyebrow.textContent = 'Summa Contra Gentiles — Book ' + (bookMeta ? bookMeta.roman : book) + ' · Chapter ' + chapterNum;
    chapterView.appendChild(eyebrow);

    var h1 = document.createElement('h1');
    h1.textContent = c.title;
    chapterView.appendChild(h1);

    // Book-level summary (longer), shown once at the first chapter of each book.
    if (chapterNum === 1) {
      var scgBook = summaryData.scg.books && summaryData.scg.books['B' + book];
      var scgBookSummaryEl = scgBook && renderBookSummary(scgBook.title || ('Book ' + book), scgBook.summary);
      if (scgBookSummaryEl) chapterView.appendChild(scgBookSummaryEl);
    }

    // Chapter-level summary (shorter), shown at the top of every chapter.
    var scgChapterSummaryText = summaryData.scg.chapters && summaryData.scg.chapters[scgKey(book, chapterNum)];
    var scgChapterSummaryEl = renderChapterSummary(scgChapterSummaryText);
    if (scgChapterSummaryEl) chapterView.appendChild(scgChapterSummaryEl);

    var curIdx = chapterIndexSCG(book, chapterNum);
    if (curIdx >= 0) {
      var timeRemaining = document.createElement('div');
      timeRemaining.className = 'q-time-remaining';
      var bookMins = formatMinutes(remainingMinutesSCG(curIdx, 'book'));
      var workMins = formatMinutes(remainingMinutesSCG(curIdx, 'work'));
      timeRemaining.textContent = bookMins + ' left in this Book · ' + workMins + ' left in the Summa Contra Gentiles';
      chapterView.appendChild(timeRemaining);
    }

    var artEl = document.createElement('div');
    artEl.className = 'article';

    var h2Row = document.createElement('div');
    h2Row.className = 'article-h2-row';

    var h2 = document.createElement('h2');
    h2.textContent = 'Chapter ' + chapterNum + '. ' + c.title;
    h2Row.appendChild(h2);

    var readToggle = document.createElement('button');
    readToggle.type = 'button';
    var chapterIsRead = isReadSCG(book, chapterNum);
    readToggle.className = 'read-toggle' + (chapterIsRead ? ' is-read' : '');
    readToggle.setAttribute('aria-pressed', chapterIsRead ? 'true' : 'false');
    readToggle.innerHTML = '<span class="read-toggle-mark">' + (chapterIsRead ? '&#10003;' : '') + '</span><span class="read-toggle-label">' +
      (chapterIsRead ? 'Read' : 'Mark as read') + '</span>';
    readToggle.addEventListener('click', function () {
      setReadSCG(book, chapterNum, !isReadSCG(book, chapterNum));
      updateNavReadBadges();
      renderChapter(book, chapterNum);
    });
    h2Row.appendChild(readToggle);

    artEl.appendChild(h2Row);

    if (!c.hasAudio) {
      var noAudio = document.createElement('div');
      noAudio.className = 'no-audio-note';
      noAudio.textContent = 'Audio not yet available for this chapter.';
      artEl.appendChild(noAudio);
    }

    c.paragraphs.forEach(function (p, pIdx) {
      var pEl = document.createElement('p');
      pEl.dataset.pidx = pIdx;
      pEl.textContent = p.text;
      artEl.appendChild(pEl);
    });

    chapterView.appendChild(artEl);

    var scgQuizQuestions = quizData.scg[scgKey(book, chapterNum)];
    var scgQuizEl = renderQuiz(scgQuizQuestions, 'SCG-' + scgKey(book, chapterNum));
    if (scgQuizEl) chapterView.appendChild(scgQuizEl);
  }

  // ---- Render a single Metaphysics chapter as its own page ----
  function renderChapterMeta(book, chapterNum) {
    var c = metaTextIndex[metaKey(book, chapterNum)];
    chapterView.innerHTML = '';
    if (!c) {
      chapterView.innerHTML = '<p>This chapter has not been loaded yet.</p>';
      return;
    }
    var bookMeta = metaBooks.filter(function (b) { return b.book === book; })[0];
    var chapterLabel = 'Chapter ' + chapterNum; // this edition has no chapter titles

    var eyebrow = document.createElement('div');
    eyebrow.className = 'q-eyebrow';
    eyebrow.textContent = "Aristotle's Metaphysics — Book " + (bookMeta ? bookMeta.roman : book) + ' · ' + chapterLabel;
    chapterView.appendChild(eyebrow);

    var h1 = document.createElement('h1');
    h1.textContent = chapterLabel;
    chapterView.appendChild(h1);

    // Book-level summary (longer, ~150-200 words), shown once at the first chapter of each book.
    if (chapterNum === 1) {
      if (book === 1 && summaryData.metaphysics && summaryData.metaphysics.overview) {
        var overviewSummary = summaryData.metaphysics.overview;
        if (overviewSummary && overviewSummary.content) {
          chapterView.appendChild(renderBookSummary('Overview: Aristotle\'s Metaphysics', overviewSummary.content));
        }
      }
      var metaBook = summaryData.metaphysics && summaryData.metaphysics.books && summaryData.metaphysics.books['B' + book];
      if (metaBook) {
        chapterView.appendChild(renderBookSummary(metaBook.title || ('Book ' + book), metaBook.summary || ''));
      }
    }

    // Chapter-level summary (shorter, ~20-40 words), shown at the top of every chapter.
    var metaChapterSummaryText = summaryData.metaphysics.chapters && summaryData.metaphysics.chapters[metaKey(book, chapterNum)];
    var metaChapterSummaryEl = renderChapterSummary(metaChapterSummaryText);
    if (metaChapterSummaryEl) chapterView.appendChild(metaChapterSummaryEl);

    var curIdx = chapterIndexMeta(book, chapterNum);
    if (curIdx >= 0) {
      var timeRemaining = document.createElement('div');
      timeRemaining.className = 'q-time-remaining';
      var bookMins = formatMinutes(remainingMinutesMeta(curIdx, 'book'));
      var workMins = formatMinutes(remainingMinutesMeta(curIdx, 'work'));
      timeRemaining.textContent = bookMins + ' left in this Book · ' + workMins + ' left in the Metaphysics';
      chapterView.appendChild(timeRemaining);
    }

    var artEl = document.createElement('div');
    artEl.className = 'article';

    var h2Row = document.createElement('div');
    h2Row.className = 'article-h2-row';

    var h2 = document.createElement('h2');
    h2.textContent = chapterLabel;
    h2Row.appendChild(h2);

    var readToggle = document.createElement('button');
    readToggle.type = 'button';
    var chapterIsRead = isReadMeta(book, chapterNum);
    readToggle.className = 'read-toggle' + (chapterIsRead ? ' is-read' : '');
    readToggle.setAttribute('aria-pressed', chapterIsRead ? 'true' : 'false');
    readToggle.innerHTML = '<span class="read-toggle-mark">' + (chapterIsRead ? '&#10003;' : '') + '</span><span class="read-toggle-label">' +
      (chapterIsRead ? 'Read' : 'Mark as read') + '</span>';
    readToggle.addEventListener('click', function () {
      setReadMeta(book, chapterNum, !isReadMeta(book, chapterNum));
      updateNavReadBadges();
      renderChapterMeta(book, chapterNum);
    });
    h2Row.appendChild(readToggle);

    artEl.appendChild(h2Row);

    if (!c.hasAudio) {
      var noAudio = document.createElement('div');
      noAudio.className = 'no-audio-note';
      noAudio.textContent = 'Audio not yet available for this chapter.';
      artEl.appendChild(noAudio);
    }

    c.paragraphs.forEach(function (p, pIdx) {
      var pEl = document.createElement('p');
      pEl.dataset.pidx = pIdx;
      pEl.textContent = p.text;
      artEl.appendChild(pEl);
    });

    chapterView.appendChild(artEl);

    var commentaryText = (window.AQUINAS_COMMENTARY || {})['B' + book + 'C' + chapterNum];
    if (commentaryText) {
      chapterView.appendChild(renderAquinasCommentary(commentaryText));
    }

    var metaQuizQuestions = quizData.metaphysics[metaKey(book, chapterNum)];
    var metaQuizEl = renderQuiz(metaQuizQuestions, 'META-' + metaKey(book, chapterNum));
    if (metaQuizEl) chapterView.appendChild(metaQuizEl);
  }

  // ---- Render a single "On the Trinity" chapter as its own page ----
  // No quiz/summary/commentary data exists for this work yet, so those lookups
  // are all optionally-chained against quizData.trinity/summaryData.trinity
  // (which — unlike quizData.scg/metaphysics — aren't guaranteed to exist on
  // window.QUIZZES/SUMMARIES) rather than assumed present.
  function renderChapterTrinity(book, chapterNum) {
    var c = trinTextIndex[trinKey(book, chapterNum)];
    chapterView.innerHTML = '';
    if (!c) {
      chapterView.innerHTML = '<p>This chapter has not been loaded yet.</p>';
      return;
    }
    var bookMeta = trinBooks.filter(function (b) { return b.book === book; })[0];
    var chapterLabel = chapterNum === 0 ? 'Introduction' : ('Chapter ' + chapterNum);

    var eyebrow = document.createElement('div');
    eyebrow.className = 'q-eyebrow';
    eyebrow.textContent = 'On the Trinity — Book ' + (bookMeta ? bookMeta.roman : book) + ' · ' + chapterLabel;
    chapterView.appendChild(eyebrow);

    var h1 = document.createElement('h1');
    h1.textContent = c.title;
    chapterView.appendChild(h1);

    // Book-level summary (longer), shown once at the first chapter of each book
    // — that's chapter 0 (Introduction/Preface) for the books that have one,
    // chapter 1 otherwise.
    var isFirstChapterOfBook = bookMeta && bookMeta.chapters.length && bookMeta.chapters[0].chapter === chapterNum;
    if (isFirstChapterOfBook) {
      if (book === 1 && trinSummaries.overview && trinSummaries.overview.content) {
        chapterView.appendChild(renderBookSummary(trinSummaries.overview.title || 'Overview: On the Trinity', trinSummaries.overview.content));
      }
      // Prefer summaryData.trinity.books (the SCG/Metaphysics-style merged shape)
      // if a future build ever consolidates into it; fall back to the
      // TRINITY_SUMMARIES.books array actually shipped today.
      var trinBook = (summaryData.trinity && summaryData.trinity.books && summaryData.trinity.books['B' + book]) ||
        (trinSummaries.books || []).filter(function (b) { return b.book === book; })[0];
      var trinBookSummaryEl = trinBook && renderBookSummary(trinBook.title || ('Book ' + book), trinBook.summary);
      if (trinBookSummaryEl) chapterView.appendChild(trinBookSummaryEl);
    }

    // Chapter-level summary (shorter), shown at the top of every chapter.
    var trinChapterSummaryText = summaryData.trinity && summaryData.trinity.chapters && summaryData.trinity.chapters[trinKey(book, chapterNum)];
    var trinChapterSummaryEl = renderChapterSummary(trinChapterSummaryText);
    if (trinChapterSummaryEl) chapterView.appendChild(trinChapterSummaryEl);

    var curIdx = chapterIndexTrin(book, chapterNum);
    if (curIdx >= 0) {
      var timeRemaining = document.createElement('div');
      timeRemaining.className = 'q-time-remaining';
      var bookMins = formatMinutes(remainingMinutesTrin(curIdx, 'book'));
      var workMins = formatMinutes(remainingMinutesTrin(curIdx, 'work'));
      timeRemaining.textContent = bookMins + ' left in this Book · ' + workMins + ' left in On the Trinity';
      chapterView.appendChild(timeRemaining);
    }

    var artEl = document.createElement('div');
    artEl.className = 'article';

    var h2Row = document.createElement('div');
    h2Row.className = 'article-h2-row';

    var h2 = document.createElement('h2');
    // Chapter 0's own title is always literally "Introduction" or "Preface: ..."
    // already, so prefixing "Introduction. " onto it would just repeat itself.
    h2.textContent = chapterNum === 0 ? c.title : (chapterLabel + '. ' + c.title);
    h2Row.appendChild(h2);

    var readToggle = document.createElement('button');
    readToggle.type = 'button';
    var chapterIsRead = isReadTrin(book, chapterNum);
    readToggle.className = 'read-toggle' + (chapterIsRead ? ' is-read' : '');
    readToggle.setAttribute('aria-pressed', chapterIsRead ? 'true' : 'false');
    readToggle.innerHTML = '<span class="read-toggle-mark">' + (chapterIsRead ? '&#10003;' : '') + '</span><span class="read-toggle-label">' +
      (chapterIsRead ? 'Read' : 'Mark as read') + '</span>';
    readToggle.addEventListener('click', function () {
      setReadTrin(book, chapterNum, !isReadTrin(book, chapterNum));
      updateNavReadBadges();
      renderChapterTrinity(book, chapterNum);
    });
    h2Row.appendChild(readToggle);

    artEl.appendChild(h2Row);

    if (!c.hasAudio) {
      var noAudio = document.createElement('div');
      noAudio.className = 'no-audio-note';
      noAudio.textContent = 'Audio not yet available for this chapter.';
      artEl.appendChild(noAudio);
    }

    c.paragraphs.forEach(function (p, pIdx) {
      var pEl = document.createElement('p');
      pEl.dataset.pidx = pIdx;
      pEl.textContent = p.text;
      artEl.appendChild(pEl);
    });

    chapterView.appendChild(artEl);

    var trinQuizQuestions = quizData.trinity && quizData.trinity[trinKey(book, chapterNum)];
    var trinQuizEl = renderQuiz(trinQuizQuestions, trinKey(book, chapterNum));
    if (trinQuizEl) chapterView.appendChild(trinQuizEl);
  }

  // Renders a collapsible summary for Metaphysics (overview or book-level)
  function renderMetaphysicsSummary(summary, type) {
    var details = document.createElement('details');
    details.className = 'metaphysics-summary';
    details.open = true;

    var summaryTitle = type === 'overview'
      ? 'Overview: Aristotle\'s Metaphysics'
      : summary.title || ('Book ' + summary.book + ' Summary');

    var summary_el = document.createElement('summary');
    summary_el.textContent = summaryTitle;
    details.appendChild(summary_el);

    var body = document.createElement('div');
    body.className = 'metaphysics-summary-body';

    (summary.content || '').split(/\n\n+/).forEach(function(para) {
      var t = para.trim();
      if (!t) return;
      var pEl = document.createElement('p');
      pEl.textContent = t;
      body.appendChild(pEl);
    });

    details.appendChild(body);
    return details;
  }

  // ---- Generic book/chapter summary rendering, shared by ST, SCG, and Metaphysics ----
  // Book-level (longer, ~150-200 words): a collapsible block shown once, at the first
  // chapter/question of each book/part, open by default.
  function renderBookSummary(title, text) {
    if (!text) return null;
    var details = document.createElement('details');
    details.className = 'work-summary';
    details.open = true;

    var summaryEl = document.createElement('summary');
    summaryEl.textContent = title;
    details.appendChild(summaryEl);

    var body = document.createElement('div');
    body.className = 'work-summary-body';

    // Parse paragraphs and bullet lists
    text.split(/\n\n+/).forEach(function (section) {
      var sectionText = section.trim();
      // Check if section contains bullet points
      if (sectionText.match(/•/)) {
        // Split on bullet points (including inline ones)
        var bulletMatch = sectionText.match(/^([^•]*)(.*)$/s);
        var prefixText = bulletMatch[1].trim();
        var bulletPart = bulletMatch[2];

        // Render prefix text if any
        if (prefixText) {
          var prefixEl = document.createElement('p');
          var prefixParts = prefixText.split(/(\*\*[^*]+\*\*)/);
          prefixParts.forEach(function (part) {
            if (part.match(/^\*\*.+\*\*$/)) {
              var boldEl = document.createElement('strong');
              boldEl.textContent = part.replace(/\*\*/g, '');
              prefixEl.appendChild(boldEl);
            } else {
              prefixEl.appendChild(document.createTextNode(part));
            }
          });
          body.appendChild(prefixEl);
        }

        // Extract and render bullets
        var bullets = bulletPart.split(/•/).filter(function(b) { return b.trim(); });
        if (bullets.length > 0) {
          var ul = document.createElement('ul');
          bullets.forEach(function (bullet) {
            var li = document.createElement('li');
            var bulletText = bullet.trim();
            var parts = bulletText.split(/(\*\*[^*]+\*\*)/);
            parts.forEach(function (part) {
              if (part.match(/^\*\*.+\*\*$/)) {
                var boldEl = document.createElement('strong');
                boldEl.textContent = part.replace(/\*\*/g, '');
                li.appendChild(boldEl);
              } else {
                li.appendChild(document.createTextNode(part));
              }
            });
            ul.appendChild(li);
          });
          body.appendChild(ul);
        }
      } else {
        // No bullets, render as paragraph
        var pEl = document.createElement('p');
        var parts = sectionText.split(/(\*\*[^*]+\*\*)/);
        parts.forEach(function (part) {
          if (part.match(/^\*\*.+\*\*$/)) {
            var boldEl = document.createElement('strong');
            boldEl.textContent = part.replace(/\*\*/g, '');
            pEl.appendChild(boldEl);
          } else {
            pEl.appendChild(document.createTextNode(part));
          }
        });
        body.appendChild(pEl);
      }
    });

    details.appendChild(body);
    return details;
  }

  // Chapter-level (shorter, ~20-40 words): a small non-collapsible box shown at the top
  // of every chapter/question, right under the title.
  function renderChapterSummary(text) {
    if (!text) return null;
    var box = document.createElement('div');
    box.className = 'chapter-summary-box';
    var label = document.createElement('span');
    label.className = 'cs-label';
    label.textContent = 'In this chapter';
    box.appendChild(label);
    var body = document.createElement('span');
    body.className = 'cs-text';
    body.textContent = text;
    box.appendChild(body);
    return box;
  }

  // Renders a collapsible "Aquinas's Commentary" block for a Metaphysics chapter.
  // Splits on blank lines / paragraph breaks so multi-paragraph commentary reads cleanly;
  // a commentary that is really a short "no surviving commentary" note (e.g. Book 12's
  // uncovered chapters) still renders fine as a single short paragraph.
  function renderAquinasCommentary(text) {
    var details = document.createElement('details');
    details.className = 'aquinas-commentary';

    var summary = document.createElement('summary');
    summary.innerHTML = "St. Thomas Aquinas's Commentary <span class=\"aq-sub\">(paraphrased)</span>";
    details.appendChild(summary);

    var body = document.createElement('div');
    body.className = 'aquinas-commentary-body';

    var isBreaksOff = /breaks? off|no surviving commentary/i.test(text);
    if (isBreaksOff) {
      var note = document.createElement('div');
      note.className = 'aquinas-commentary-note';
      note.textContent = text;
      body.appendChild(note);
    } else {
      text.split(/\n\s*\n/).forEach(function (para) {
        var t = para.trim();
        if (!t) return;
        var pEl = document.createElement('p');
        pEl.textContent = t;
        body.appendChild(pEl);
      });
    }

    details.appendChild(body);
    return details;
  }

  // ---- Chapter-end quizzes ----
  // Renders a multiple-choice quiz block. `questions` is an array of
  // { q, options: [4 strings], correct: index, explanation }.
  // `storageKey` is a unique string per chapter/question used to remember the
  // learner's best score across visits (localStorage, same pattern as read-tracking).
  function quizScoreKey(storageKey) { return 'quiz-' + storageKey; }
  function getQuizBestScore(storageKey) {
    try {
      var raw = localStorage.getItem('summa-quiz-scores');
      var map = raw ? JSON.parse(raw) : {};
      return map[quizScoreKey(storageKey)] || null;
    } catch (e) { return null; }
  }
  function setQuizBestScore(storageKey, correct, total) {
    try {
      var raw = localStorage.getItem('summa-quiz-scores');
      var map = raw ? JSON.parse(raw) : {};
      var k = quizScoreKey(storageKey);
      var prev = map[k];
      if (!prev || correct > prev.correct) map[k] = { correct: correct, total: total };
      localStorage.setItem('summa-quiz-scores', JSON.stringify(map));
    } catch (e) {}
    queueSyncPush();
  }

  function renderQuiz(questions, storageKey) {
    if (!questions || !questions.length) return null;

    var wrap = document.createElement('div');
    wrap.className = 'quiz-section';

    var heading = document.createElement('h3');
    heading.className = 'quiz-heading';
    heading.textContent = 'Check your understanding';
    wrap.appendChild(heading);

    var best = getQuizBestScore(storageKey);
    var bestBadge = document.createElement('div');
    bestBadge.className = 'quiz-best-badge';
    if (best) bestBadge.textContent = 'Best score: ' + best.correct + ' / ' + best.total;
    wrap.appendChild(bestBadge);

    var form = document.createElement('form');
    form.className = 'quiz-form';
    form.noValidate = true;

    questions.forEach(function (item, qIdx) {
      // Plain <div> with role="group" instead of <fieldset>/<legend>: browsers
      // render a fieldset's border straddling through the legend's own box
      // (the border-top line is drawn through the legend's vertical center,
      // per the HTML rendering spec), which visually breaks a multi-line
      // question out of its rounded box no matter how the legend is styled.
      // A div avoids that special-case layout entirely.
      var qEl = document.createElement('div');
      qEl.className = 'quiz-q';
      qEl.setAttribute('role', 'group');
      var legendId = 'quiz-q-label-' + storageKey.replace(/[^a-zA-Z0-9]/g, '') + '-' + qIdx;
      qEl.setAttribute('aria-labelledby', legendId);

      // Use textContent (not innerHTML) to render quiz questions as plain text,
      // preventing unintended link styling or HTML injection.
      var legend = document.createElement('div');
      legend.id = legendId;
      legend.className = 'quiz-q-label';
      legend.textContent = (qIdx + 1) + '. ' + item.q;
      qEl.appendChild(legend);

      var optsEl = document.createElement('div');
      optsEl.className = 'quiz-options';

      // Display options in shuffled order so the correct answer isn't
      // guessable by position alone — across this app's quiz data the
      // correct answer sits at a fixed index (usually the 2nd option) far
      // more often than chance, which let a reader skip straight to a good
      // score without reading anything. input.value keeps the option's
      // ORIGINAL index regardless of display order, so grading below still
      // just compares against item.correct unchanged.
      var displayOrder = item.options.map(function (_, i) { return i; });
      for (var si = displayOrder.length - 1; si > 0; si--) {
        var sj = Math.floor(Math.random() * (si + 1));
        var tmp = displayOrder[si]; displayOrder[si] = displayOrder[sj]; displayOrder[sj] = tmp;
      }

      displayOrder.forEach(function (originalIdx) {
        var label = document.createElement('label');
        label.className = 'quiz-option';

        var input = document.createElement('input');
        input.type = 'radio';
        input.name = 'quiz-' + storageKey + '-q' + qIdx;
        input.value = String(originalIdx);

        // Use textContent for option text to prevent unwanted HTML rendering
        var span = document.createElement('span');
        span.textContent = item.options[originalIdx];

        label.appendChild(input);
        label.appendChild(span);
        optsEl.appendChild(label);
      });

      qEl.appendChild(optsEl);

      var explanation = document.createElement('div');
      explanation.className = 'quiz-explanation';
      explanation.hidden = true;
      qEl.appendChild(explanation);

      form.appendChild(qEl);
    });

    var checkBtn = document.createElement('button');
    checkBtn.type = 'submit';
    checkBtn.className = 'quiz-check-btn';
    checkBtn.textContent = 'Check answers';
    form.appendChild(checkBtn);

    var resultEl = document.createElement('div');
    resultEl.className = 'quiz-result';
    resultEl.setAttribute('role', 'status');
    form.appendChild(resultEl);

    form.addEventListener('submit', function (evt) {
      evt.preventDefault();
      var correct = 0;
      var allAnswered = true;

      questions.forEach(function (item, qIdx) {
        var qEl = form.querySelectorAll('.quiz-q')[qIdx];
        var options = qEl.querySelectorAll('.quiz-option');
        var selected = qEl.querySelector('input[type="radio"]:checked');
        var explanation = qEl.querySelector('.quiz-explanation');

        if (!selected) { allAnswered = false; return; }

        var selectedIdx = parseInt(selected.value, 10);
        var isCorrect = selectedIdx === item.correct;
        if (isCorrect) correct++;

        // Options render in a shuffled display order (see renderQuiz above),
        // so each option's real identity is its radio input's value — the
        // DOM position (oIdx) no longer corresponds to item.correct.
        options.forEach(function (optLabel) {
          var optIdx = parseInt(optLabel.querySelector('input').value, 10);
          optLabel.classList.remove('is-correct', 'is-incorrect');
          if (optIdx === item.correct) optLabel.classList.add('is-correct');
          else if (optIdx === selectedIdx) optLabel.classList.add('is-incorrect');
        });

        // Use textContent for explanations to ensure plain text rendering
        explanation.textContent = item.explanation || '';
        explanation.hidden = false;
      });

      if (!allAnswered) {
        resultEl.textContent = 'Please answer every question before checking.';
        resultEl.className = 'quiz-result quiz-result-incomplete';
        return;
      }

      setQuizBestScore(storageKey, correct, questions.length);
      var pct = Math.round((correct / questions.length) * 100);
      resultEl.textContent = 'You scored ' + correct + ' / ' + questions.length + ' (' + pct + '%)';
      resultEl.className = 'quiz-result ' + (correct === questions.length ? 'quiz-result-perfect' : 'quiz-result-partial');
      bestBadge.textContent = 'Best score: ' + Math.max(correct, best ? best.correct : 0) + ' / ' + questions.length;
      best = getQuizBestScore(storageKey);
    });

    wrap.appendChild(form);
    return wrap;
  }

  function hashFor(part, qnum, articleNumber) {
    return 'P' + part + 'Q' + qnum + 'A' + articleNumber;
  }

  function hashForSCG(book, chapterNum) {
    return 'SCG-B' + book + 'C' + chapterNum;
  }

  function hashForMeta(book, chapterNum) {
    return 'META-B' + book + 'C' + chapterNum;
  }

  function hashForTrinity(book, chapterNum) {
    return 'TRIN-B' + book + 'C' + chapterNum;
  }

  function updateTopbar() {
    if (state.work === 'SCG') {
      topbarWork.textContent = 'SUMMA CONTRA GENTILES';
      var bookMeta = scgBooks.filter(function (b) { return b.book === state.book; })[0];
      topbarLocation.textContent = 'Book ' + (bookMeta ? bookMeta.roman : state.book) + ' · Ch. ' + state.chapter;
    } else if (state.work === 'META') {
      topbarWork.textContent = 'ARISTOTLE — METAPHYSICS';
      var metaBookMeta = metaBooks.filter(function (b) { return b.book === state.book; })[0];
      topbarLocation.textContent = 'Book ' + (metaBookMeta ? metaBookMeta.roman : state.book) + ' · Ch. ' + state.chapter;
    } else if (state.work === 'TRIN') {
      topbarWork.textContent = 'AUGUSTINE — ON THE TRINITY';
      var trinBookMeta = trinBooks.filter(function (b) { return b.book === state.book; })[0];
      topbarLocation.textContent = 'Book ' + (trinBookMeta ? trinBookMeta.roman : state.book) + ' · Ch. ' + state.chapter;
    } else {
      topbarWork.textContent = 'SUMMA THEOLOGICA';
      topbarLocation.textContent = (PART_NAMES[state.part] || '') + ' · Q' + state.question;
    }
  }

  function updatePagerButtons() {
    if (state.work === 'SCG') { updatePagerButtonsSCG(); return; }
    if (state.work === 'META') { updatePagerButtonsMeta(); return; }
    if (state.work === 'TRIN') { updatePagerButtonsTrinity(); return; }
    var idx = articleIndex(state.part, state.question, state.article);
    prevBtn.disabled = idx <= 0;
    nextBtn.disabled = idx < 0 || idx >= allArticles.length - 1;

    var prevItem = idx > 0 ? allArticles[idx - 1] : null;
    var nextItem = idx >= 0 && idx < allArticles.length - 1 ? allArticles[idx + 1] : null;

    prevBtn.textContent = prevItem
      ? (prevItem.question === state.question ? '← Previous Article' : '← Previous Question')
      : '← Previous Article';
    nextBtn.textContent = nextItem
      ? (nextItem.question === state.question ? 'Next Article →' : 'Next Question →')
      : 'Next Article →';

    prevBtn.onclick = function () {
      if (prevItem) goTo(prevItem.part, prevItem.question, prevItem.articleNumber);
    };
    nextBtn.onclick = function () {
      if (nextItem) goTo(nextItem.part, nextItem.question, nextItem.articleNumber);
    };
  }

  function updatePagerButtonsSCG() {
    var idx = chapterIndexSCG(state.book, state.chapter);
    prevBtn.disabled = idx <= 0;
    nextBtn.disabled = idx < 0 || idx >= allChaptersSCG.length - 1;

    var prevItem = idx > 0 ? allChaptersSCG[idx - 1] : null;
    var nextItem = idx >= 0 && idx < allChaptersSCG.length - 1 ? allChaptersSCG[idx + 1] : null;

    prevBtn.textContent = prevItem
      ? (prevItem.book === state.book ? '← Previous Chapter' : '← Previous Book')
      : '← Previous Chapter';
    nextBtn.textContent = nextItem
      ? (nextItem.book === state.book ? 'Next Chapter →' : 'Next Book →')
      : 'Next Chapter →';

    prevBtn.onclick = function () {
      if (prevItem) goToChapter(prevItem.book, prevItem.chapter);
    };
    nextBtn.onclick = function () {
      if (nextItem) goToChapter(nextItem.book, nextItem.chapter);
    };
  }

  function updatePagerButtonsMeta() {
    var idx = chapterIndexMeta(state.book, state.chapter);
    prevBtn.disabled = idx <= 0;
    nextBtn.disabled = idx < 0 || idx >= allChaptersMeta.length - 1;

    var prevItem = idx > 0 ? allChaptersMeta[idx - 1] : null;
    var nextItem = idx >= 0 && idx < allChaptersMeta.length - 1 ? allChaptersMeta[idx + 1] : null;

    prevBtn.textContent = prevItem
      ? (prevItem.book === state.book ? '← Previous Chapter' : '← Previous Book')
      : '← Previous Chapter';
    nextBtn.textContent = nextItem
      ? (nextItem.book === state.book ? 'Next Chapter →' : 'Next Book →')
      : 'Next Chapter →';

    prevBtn.onclick = function () {
      if (prevItem) goToChapterMeta(prevItem.book, prevItem.chapter);
    };
    nextBtn.onclick = function () {
      if (nextItem) goToChapterMeta(nextItem.book, nextItem.chapter);
    };
  }

  function updatePagerButtonsTrinity() {
    var idx = chapterIndexTrin(state.book, state.chapter);
    prevBtn.disabled = idx <= 0;
    nextBtn.disabled = idx < 0 || idx >= allChaptersTrin.length - 1;

    var prevItem = idx > 0 ? allChaptersTrin[idx - 1] : null;
    var nextItem = idx >= 0 && idx < allChaptersTrin.length - 1 ? allChaptersTrin[idx + 1] : null;

    prevBtn.textContent = prevItem
      ? (prevItem.book === state.book ? '← Previous Chapter' : '← Previous Book')
      : '← Previous Chapter';
    nextBtn.textContent = nextItem
      ? (nextItem.book === state.book ? 'Next Chapter →' : 'Next Book →')
      : 'Next Chapter →';

    prevBtn.onclick = function () {
      if (prevItem) goToChapterTrinity(prevItem.book, prevItem.chapter);
    };
    nextBtn.onclick = function () {
      if (nextItem) goToChapterTrinity(nextItem.book, nextItem.chapter);
    };
  }

  // ---- Audio sync ----
  function fmtTime(s) {
    if (!isFinite(s) || s < 0) s = 0;
    var m = Math.floor(s / 60);
    var sec = Math.floor(s % 60);
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  // ---- Playback speed ----
  var SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  var playbackRate = 1;
  try {
    var savedSpeed = parseFloat(localStorage.getItem('summa-speed'));
    if (SPEED_PRESETS.indexOf(savedSpeed) !== -1) playbackRate = savedSpeed;
  } catch (e) {}

  function formatSpeedLabel(rate) {
    // Trim trailing zeros (1.50 -> 1.5, 1.00 -> 1) while keeping e.g. 0.25 intact.
    var s = rate.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    return s + 'x';
  }

  function applyPlaybackRate() {
    audioEl.playbackRate = playbackRate;
    var label = formatSpeedLabel(playbackRate);
    speedBtn.textContent = label;
    var full = 'Playback speed: ' + label;
    speedBtn.title = full + ' (click to change)';
    speedBtn.setAttribute('aria-label', full);
  }

  function setPlaybackRate(rate) {
    playbackRate = rate;
    try { localStorage.setItem('summa-speed', String(rate)); } catch (e) {}
    applyPlaybackRate();
  }

  speedBtn.addEventListener('click', function () {
    var idx = SPEED_PRESETS.indexOf(playbackRate);
    var next = SPEED_PRESETS[(idx + 1) % SPEED_PRESETS.length];
    setPlaybackRate(next);
  });

  applyPlaybackRate();

  function loadTrack(trackInfo, autoplay) {
    if (!trackInfo) {
      playerTrackTitle.textContent = 'No audio available for this section';
      audioEl.removeAttribute('src');
      delete audioEl.dataset.currentFile;
      audioEl.dataset.work = 'ST';
      return;
    }
    var t = trackInfo.track;
    // Resolve through AUDIO_URLS (t.audioFile is the lookup key) exactly like
    // SCG/Metaphysics audio does, rather than always building a same-origin
    // URL from the local /audio/... path — that path was never actually
    // deployed with the app (audio is hosted on GitHub Releases), so it 404s.
    var resolved = resolveAudioUrl(t.audioFile);
    if (audioEl.dataset.currentFile !== t.file) {
      audioEl.src = resolved;
      audioEl.dataset.currentFile = t.file;
      audioEl.dataset.trackIndex = trackInfo.index;
      audioEl.dataset.work = 'ST';
      audioEl.playbackRate = playbackRate;
      if (autoplay) audioEl.play().catch(function () {});
    }
    playerTrackTitle.textContent = 'Vol. ' + String(t.volume).padStart(2, '0') + ' — ' + t.title;
  }

  function syncAudioToQuestion(autoplayIfWasPlaying) {
    var found = findTrackForQuestion(state.part, state.question);
    var shouldAutoplay = !!(autoplayIfWasPlaying && state.wasPlaying);
    loadTrack(found, shouldAutoplay);
  }

  // ---- SCG audio (chapter-level, no mid-chapter alignment) ----
  function loadChapterAudio(book, chapterNum, autoplay) {
    var c = scgTextIndex[scgKey(book, chapterNum)];
    if (!c || !c.hasAudio) {
      playerTrackTitle.textContent = c ? 'Audio not yet available for this chapter' : 'No audio available for this section';
      audioEl.removeAttribute('src');
      delete audioEl.dataset.currentFile;
      audioEl.dataset.work = 'SCG';
      return;
    }
    var resolved = resolveAudioUrl(c.audioFile);
    if (audioEl.dataset.currentFile !== c.audioFile) {
      audioEl.src = resolved;
      audioEl.dataset.currentFile = c.audioFile;
      audioEl.dataset.work = 'SCG';
      audioEl.playbackRate = playbackRate;
      if (autoplay) audioEl.play().catch(function () {});
    }
    var bookMeta = scgBooks.filter(function (b) { return b.book === book; })[0];
    playerTrackTitle.textContent = 'Book ' + (bookMeta ? bookMeta.roman : book) + ' — ' + c.title;
  }

  function syncAudioToChapter(autoplayIfWasPlaying) {
    var shouldAutoplay = !!(autoplayIfWasPlaying && state.wasPlaying);
    loadChapterAudio(state.book, state.chapter, shouldAutoplay);
  }

  // Resolve audio URL: check AUDIO_URLS map (Supabase) first, fall back to local path
  function resolveAudioUrl(localPath) {
    if (!localPath) return null;
    var mapped = (window.AUDIO_URLS || {})[localPath];
    if (mapped) return mapped;
    return new URL(localPath, window.location.href).href;
  }

  // ---- Metaphysics audio (track-aware: several chapters commonly share one audio
  // file, so — like loadChapterAudio above — this only touches audioEl.src, and
  // therefore only interrupts playback, when the resolved file actually changes.
  // Stepping between chapters that share a track leaves the audio element alone. ----
  function loadChapterAudioMeta(book, chapterNum, autoplay) {
    var c = metaTextIndex[metaKey(book, chapterNum)];
    if (!c || !c.hasAudio || !c.audioFile) {
      playerTrackTitle.textContent = c ? 'Audio not yet available for this chapter' : 'No audio available for this section';
      audioEl.removeAttribute('src');
      delete audioEl.dataset.currentFile;
      audioEl.dataset.work = 'META';
      return;
    }
    var resolved = resolveAudioUrl(c.audioFile);
    if (audioEl.dataset.currentFile !== c.audioFile) {
      audioEl.src = resolved;
      audioEl.dataset.currentFile = c.audioFile;
      audioEl.dataset.work = 'META';
      audioEl.playbackRate = playbackRate;
      if (autoplay) audioEl.play().catch(function () {});
    }
    // c.audioFile is a lookup key (e.g. "B1C1"), not a filename, so there's no
    // label to extract from it — build one instead from the actual range of
    // chapters that share this chapter's audio track (several chapters
    // commonly share one recording), e.g. "Book I — Chapter 1-3".
    var bookMeta = metaBooks.filter(function (b) { return b.book === book; })[0];
    var trackChapters = [];
    Object.keys(metaTextIndex).forEach(function (k) {
      var e = metaTextIndex[k];
      if (e.book === book && e.audioTrack === c.audioTrack) trackChapters.push(e.chapter);
    });
    var chapterLabel = 'Chapter ' + chapterNum;
    if (trackChapters.length > 1) {
      var lo = Math.min.apply(null, trackChapters), hi = Math.max.apply(null, trackChapters);
      chapterLabel = 'Chapter ' + lo + '-' + hi;
    }
    playerTrackTitle.textContent = 'Book ' + (bookMeta ? bookMeta.roman : book) + ' — ' + chapterLabel;
  }

  function syncAudioToChapterMeta(autoplayIfWasPlaying) {
    var shouldAutoplay = !!(autoplayIfWasPlaying && state.wasPlaying);
    loadChapterAudioMeta(state.book, state.chapter, shouldAutoplay);
  }

  // ---- Trinity audio (chapter-level, one TTS file per chapter, no mid-chapter
  // alignment or track-sharing across chapters — mirrors loadChapterAudio (SCG)
  // rather than the track-aware loadChapterAudioMeta). Resolves through
  // resolveAudioUrl() like every other work's audio, so it correctly picks up
  // a GitHub-Releases-hosted URL from AUDIO_URLS instead of ever falling back
  // to a local /audio/... path that was never actually deployed. ----
  function loadChapterAudioTrinity(book, chapterNum, autoplay) {
    var c = trinTextIndex[trinKey(book, chapterNum)];
    if (!c || !c.hasAudio) {
      playerTrackTitle.textContent = c ? 'Audio not yet available for this chapter' : 'No audio available for this section';
      audioEl.removeAttribute('src');
      delete audioEl.dataset.currentFile;
      audioEl.dataset.work = 'TRIN';
      return;
    }
    var resolved = resolveAudioUrl(c.audioFile);
    if (audioEl.dataset.currentFile !== c.audioFile) {
      audioEl.src = resolved;
      audioEl.dataset.currentFile = c.audioFile;
      audioEl.dataset.work = 'TRIN';
      audioEl.playbackRate = playbackRate;
      if (autoplay) audioEl.play().catch(function () {});
    }
    var bookMeta = trinBooks.filter(function (b) { return b.book === book; })[0];
    playerTrackTitle.textContent = 'Book ' + (bookMeta ? bookMeta.roman : book) + ' — ' + c.title;
  }

  function syncAudioToChapterTrinity(autoplayIfWasPlaying) {
    var shouldAutoplay = !!(autoplayIfWasPlaying && state.wasPlaying);
    loadChapterAudioTrinity(state.book, state.chapter, shouldAutoplay);
  }

  // If article-level alignment data exists for this part/question/article (see
  // scripts/build-alignment-index.cjs -> app/alignment-data.js), seek the audio element to it.
  // No-op (falls back to current whole-track behavior) when there's no matching audio track
  // for this question, or no alignment entry for this article yet — the alignment data is
  // produced incrementally by a background batch job and only covers some questions so far.
  function maybeSeekToAlignment(part, qnum, articleNumber) {
    var found = findTrackForQuestion(part, qnum);
    if (!found) return;
    var alignment = window.SUMMA_ALIGNMENT || {};
    var qAlign = alignment['P' + part + 'Q' + qnum];
    if (!qAlign) return;
    var sec = qAlign['A' + articleNumber];
    if (typeof sec !== 'number') return;
    if (audioEl.readyState >= 1) {
      audioEl.currentTime = sec;
      _pendingAlignmentSeek = null;
    } else {
      _pendingAlignmentSeek = sec;
    }
  }

  playBtn.addEventListener('click', function () {
    if (audioEl.paused) { audioEl.play().catch(function () {}); } else { audioEl.pause(); }
  });
  audioEl.addEventListener('play', function () {
    playIcon.style.display = 'none';
    pauseIcon.style.display = '';
    state.wasPlaying = true;
  });
  audioEl.addEventListener('pause', function () {
    playIcon.style.display = '';
    pauseIcon.style.display = 'none';
    state.wasPlaying = false;
  });
  audioEl.addEventListener('loadedmetadata', function () {
    durTime.textContent = fmtTime(audioEl.duration);
    audioEl.playbackRate = playbackRate;
    if (_pendingAudioRestore != null) {
      audioEl.currentTime = _pendingAudioRestore;
      _pendingAudioRestore = null;
      _pendingAlignmentSeek = null; // session restore takes priority over article-start alignment
    } else if (_pendingAlignmentSeek != null) {
      audioEl.currentTime = _pendingAlignmentSeek;
      _pendingAlignmentSeek = null;
    }
  });
  audioEl.addEventListener('timeupdate', function () {
    if (audioEl.duration) {
      seek.value = String(Math.round((audioEl.currentTime / audioEl.duration) * 1000));
      curTime.textContent = fmtTime(audioEl.currentTime);
    }
  });
  seek.addEventListener('input', function () {
    if (audioEl.duration) {
      audioEl.currentTime = (parseInt(seek.value, 10) / 1000) * audioEl.duration;
    }
  });
  audioEl.addEventListener('ended', function () {
    if (audioEl.dataset.work === 'SCG') {
      var cidx = chapterIndexSCG(state.book, state.chapter);
      var nextC = cidx >= 0 ? allChaptersSCG[cidx + 1] : null;
      if (nextC) goToChapter(nextC.book, nextC.chapter, true);
      return;
    }
    if (audioEl.dataset.work === 'META') {
      // Jump to the first chapter of the *next track* (not just the next chapter —
      // several consecutive chapters commonly share one track, and re-landing on one
      // of those wouldn't reload/restart the just-ended audio).
      var curChapter = metaTextIndex[metaKey(state.book, state.chapter)];
      var tIdx = curChapter ? trackIndexMeta(curChapter.audioTrack) : -1;
      var nextT = tIdx >= 0 ? allTracksMeta[tIdx + 1] : null;
      if (nextT) goToChapterMeta(nextT.book, nextT.chapter, true);
      return;
    }
    if (audioEl.dataset.work === 'TRIN') {
      var tcidx = chapterIndexTrin(state.book, state.chapter);
      var nextTC = tcidx >= 0 ? allChaptersTrin[tcidx + 1] : null;
      if (nextTC) goToChapterTrinity(nextTC.book, nextTC.chapter, true);
      return;
    }
    var idx = parseInt(audioEl.dataset.trackIndex, 10);
    var next = allTracks[idx + 1];
    if (next) {
      goTo(next.part, next.questionStart != null ? next.questionStart : state.question, 1, true);
    }
  });
  prevTrackBtn.addEventListener('click', function () {
    if (state.work === 'SCG') {
      var cidx = chapterIndexSCG(state.book, state.chapter);
      if (cidx < 0) return;
      var prevC = allChaptersSCG[cidx - 1];
      if (prevC) goToChapter(prevC.book, prevC.chapter, true);
      return;
    }
    if (state.work === 'META') {
      var curChapterP = metaTextIndex[metaKey(state.book, state.chapter)];
      var tIdxP = curChapterP ? trackIndexMeta(curChapterP.audioTrack) : -1;
      var prevT = tIdxP > 0 ? allTracksMeta[tIdxP - 1] : null;
      if (prevT) goToChapterMeta(prevT.book, prevT.chapter, true);
      return;
    }
    if (state.work === 'TRIN') {
      var tcidxP = chapterIndexTrin(state.book, state.chapter);
      if (tcidxP < 0) return;
      var prevTC = allChaptersTrin[tcidxP - 1];
      if (prevTC) goToChapterTrinity(prevTC.book, prevTC.chapter, true);
      return;
    }
    var idx = parseInt(audioEl.dataset.trackIndex, 10);
    if (isNaN(idx)) return;
    var prev = allTracks[idx - 1];
    if (prev) goTo(prev.part, prev.questionStart != null ? prev.questionStart : state.question, 1, true);
  });
  nextTrackBtn.addEventListener('click', function () {
    if (state.work === 'SCG') {
      var cidx = chapterIndexSCG(state.book, state.chapter);
      if (cidx < 0) return;
      var nextC = allChaptersSCG[cidx + 1];
      if (nextC) goToChapter(nextC.book, nextC.chapter, true);
      return;
    }
    if (state.work === 'META') {
      var curChapterN = metaTextIndex[metaKey(state.book, state.chapter)];
      var tIdxN = curChapterN ? trackIndexMeta(curChapterN.audioTrack) : -1;
      var nextTB = tIdxN >= 0 ? allTracksMeta[tIdxN + 1] : null;
      if (nextTB) goToChapterMeta(nextTB.book, nextTB.chapter, true);
      return;
    }
    if (state.work === 'TRIN') {
      var tcidxN = chapterIndexTrin(state.book, state.chapter);
      if (tcidxN < 0) return;
      var nextTC2 = allChaptersTrin[tcidxN + 1];
      if (nextTC2) goToChapterTrinity(nextTC2.book, nextTC2.chapter, true);
      return;
    }
    var idx = parseInt(audioEl.dataset.trackIndex, 10);
    if (isNaN(idx)) return;
    var next = allTracks[idx + 1];
    if (next) goTo(next.part, next.questionStart != null ? next.questionStart : state.question, 1, true);
  });

  var skip10bBtn = $('skip10bBtn'), skip10fBtn = $('skip10fBtn');
  skip10bBtn.addEventListener('click', function () {
    audioEl.currentTime = Math.max(0, audioEl.currentTime - 10);
  });
  skip10fBtn.addEventListener('click', function () {
    audioEl.currentTime = Math.min(audioEl.duration, audioEl.currentTime + 10);
  });

  // ---- Navigation ----
  function showWork(work) {
    questionView.style.display = work === 'ST' ? '' : 'none';
    chapterView.style.display = work !== 'ST' ? '' : 'none';
  }

  function goTo(part, qnum, articleNumber, forceAutoplay) {
    if (articleNumber == null) {
      var q = textIndex[questionKey(part, qnum)];
      articleNumber = q && q.articles[0] ? q.articles[0].number : 1;
    }
    var wasPlaying = state.wasPlaying || forceAutoplay;
    var questionChanged = state.work !== 'ST' || part !== state.part || qnum !== state.question;
    state.work = 'ST';
    state.part = part;
    state.question = qnum;
    state.article = articleNumber;
    window.location.hash = hashFor(part, qnum, articleNumber);
    showWork('ST');
    renderArticle(part, qnum, articleNumber);
    updateTopbar();
    updatePagerButtons();
    highlightActiveNav();
    if (questionChanged) syncAudioToQuestion(wasPlaying);
    maybeSeekToAlignment(part, qnum, articleNumber);
    if (_pendingScrollParagraph && _pendingScrollParagraph.work === 'ST' && _pendingScrollParagraph.part === part &&
        _pendingScrollParagraph.question === qnum && _pendingScrollParagraph.articleNumber === articleNumber) {
      scrollToPendingParagraph();
    } else {
      window.scrollTo(0, 0);
    }
  }

  function goToChapter(book, chapterNum, forceAutoplay) {
    var wasPlaying = state.wasPlaying || forceAutoplay;
    var chapterChanged = state.work !== 'SCG' || book !== state.book || chapterNum !== state.chapter;
    state.work = 'SCG';
    state.book = book;
    state.chapter = chapterNum;
    window.location.hash = hashForSCG(book, chapterNum);
    showWork('SCG');
    renderChapter(book, chapterNum);
    updateTopbar();
    updatePagerButtons();
    highlightActiveNav();
    if (chapterChanged) syncAudioToChapter(wasPlaying);
    if (_pendingScrollParagraph && _pendingScrollParagraph.work === 'SCG' &&
        _pendingScrollParagraph.book === book && _pendingScrollParagraph.chapter === chapterNum) {
      scrollToPendingParagraph();
    } else {
      window.scrollTo(0, 0);
    }
  }

  function goToChapterMeta(book, chapterNum, forceAutoplay) {
    var wasPlaying = state.wasPlaying || forceAutoplay;
    var chapterChanged = state.work !== 'META' || book !== state.book || chapterNum !== state.chapter;
    state.work = 'META';
    state.book = book;
    state.chapter = chapterNum;
    window.location.hash = hashForMeta(book, chapterNum);
    showWork('META');
    renderChapterMeta(book, chapterNum);
    updateTopbar();
    updatePagerButtons();
    highlightActiveNav();
    if (chapterChanged) syncAudioToChapterMeta(wasPlaying);
    if (_pendingScrollParagraph && _pendingScrollParagraph.work === 'META' &&
        _pendingScrollParagraph.book === book && _pendingScrollParagraph.chapter === chapterNum) {
      scrollToPendingParagraph();
    } else {
      window.scrollTo(0, 0);
    }
  }

  function goToChapterTrinity(book, chapterNum, forceAutoplay) {
    var wasPlaying = state.wasPlaying || forceAutoplay;
    var chapterChanged = state.work !== 'TRIN' || book !== state.book || chapterNum !== state.chapter;
    state.work = 'TRIN';
    state.book = book;
    state.chapter = chapterNum;
    window.location.hash = hashForTrinity(book, chapterNum);
    showWork('TRIN');
    renderChapterTrinity(book, chapterNum);
    updateTopbar();
    updatePagerButtons();
    highlightActiveNav();
    if (chapterChanged) syncAudioToChapterTrinity(wasPlaying);
    if (_pendingScrollParagraph && _pendingScrollParagraph.work === 'TRIN' &&
        _pendingScrollParagraph.book === book && _pendingScrollParagraph.chapter === chapterNum) {
      scrollToPendingParagraph();
    } else {
      window.scrollTo(0, 0);
    }
  }

  window.addEventListener('hashchange', function () {
    var loc = initialLocation();
    if (loc.work === 'SCG') {
      if (state.work !== 'SCG' || loc.book !== state.book || loc.chapter !== state.chapter) {
        goToChapter(loc.book, loc.chapter);
      }
    } else if (loc.work === 'META') {
      if (state.work !== 'META' || loc.book !== state.book || loc.chapter !== state.chapter) {
        goToChapterMeta(loc.book, loc.chapter);
      }
    } else if (loc.work === 'TRIN') {
      if (state.work !== 'TRIN' || loc.book !== state.book || loc.chapter !== state.chapter) {
        goToChapterTrinity(loc.book, loc.chapter);
      }
    } else if (loc.part !== state.part || loc.question !== state.question || loc.article !== state.article || state.work !== 'ST') {
      goTo(loc.part, loc.question, loc.article);
    }
  });

  // ---- Session persistence ----
  function getSavedSession() {
    try { return JSON.parse(localStorage.getItem('summa-session') || 'null'); } catch (e) { return null; }
  }

  function saveSession() {
    try {
      localStorage.setItem('summa-session', JSON.stringify({
        hash: window.location.hash.replace('#', ''),
        audioFile: audioEl.dataset.currentFile || null,
        audioTime: audioEl.currentTime || 0,
        scrollY: window.scrollY || 0
      }));
    } catch (e) {}
    queueSyncPush();
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') saveSession();
  });
  window.addEventListener('pagehide', function () { saveSession(); });

  // ---- Search ----
  var searchIndex = [];
  var _pendingScrollParagraph = null;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Flatten every question/article (and every SCG/Metaphysics chapter) into a searchable
  // entry, with lower-cased text pre-computed once so each keystroke only does cheap
  // substring scans. Search covers all three works — entries are tagged `work` so
  // results can route to the right renderer/hash scheme.
  function buildSearchIndex() {
    searchIndex = [];
    allQuestions.forEach(function (q) {
      q.articles.forEach(function (a) {
        var paragraphs = a.paragraphs.map(function (p) {
          return { label: p.label, text: p.text, lower: p.text.toLowerCase() };
        });
        var combined = q.title + ' ' + a.title + ' ' + a.paragraphs.map(function (p) { return p.text; }).join(' ');
        searchIndex.push({
          work: 'ST',
          part: q.part,
          question: q.question,
          articleNumber: a.number,
          qTitle: q.title,
          aTitle: a.title,
          qTitleLower: q.title.toLowerCase(),
          aTitleLower: a.title.toLowerCase(),
          paragraphs: paragraphs,
          combinedLower: combined.toLowerCase()
        });
      });
    });
    allChaptersSCG.forEach(function (c) {
      var full = scgTextIndex[scgKey(c.book, c.chapter)];
      if (!full) return;
      var paragraphs = full.paragraphs.map(function (p) {
        return { label: null, text: p.text, lower: p.text.toLowerCase() };
      });
      var combined = full.title + ' ' + full.paragraphs.map(function (p) { return p.text; }).join(' ');
      searchIndex.push({
        work: 'SCG',
        book: c.book,
        chapter: c.chapter,
        qTitle: full.title, // treated as the "question title" tier for scoring purposes
        aTitle: full.title, // SCG has no separate article title — chapter title fills both
        qTitleLower: full.title.toLowerCase(),
        aTitleLower: full.title.toLowerCase(),
        paragraphs: paragraphs,
        combinedLower: combined.toLowerCase()
      });
    });
    allChaptersMeta.forEach(function (c) {
      var full = metaTextIndex[metaKey(c.book, c.chapter)];
      if (!full) return;
      var bookMeta = metaBooks.filter(function (b) { return b.book === c.book; })[0];
      var chapterLabel = 'Chapter ' + c.chapter; // this edition has no chapter titles
      var bookLabel = bookMeta ? bookMeta.bookTitle : ('Book ' + c.book);
      var paragraphs = full.paragraphs.map(function (p) {
        return { label: null, text: p.text, lower: p.text.toLowerCase() };
      });
      var combined = bookLabel + ' ' + chapterLabel + ' ' + full.paragraphs.map(function (p) { return p.text; }).join(' ');
      searchIndex.push({
        work: 'META',
        book: c.book,
        chapter: c.chapter,
        qTitle: bookLabel, // treated as the "question title" tier for scoring purposes
        aTitle: chapterLabel, // no per-chapter title in this edition
        qTitleLower: bookLabel.toLowerCase(),
        aTitleLower: chapterLabel.toLowerCase(),
        paragraphs: paragraphs,
        combinedLower: combined.toLowerCase()
      });
    });
    allChaptersTrin.forEach(function (c) {
      var full = trinTextIndex[trinKey(c.book, c.chapter)];
      if (!full) return;
      var bookMeta = trinBooks.filter(function (b) { return b.book === c.book; })[0];
      var chapterLabel = c.chapter === 0 ? 'Introduction' : ('Chapter ' + c.chapter);
      var bookLabel = bookMeta ? ('Book ' + bookMeta.roman) : ('Book ' + c.book);
      var paragraphs = full.paragraphs.map(function (p) {
        return { label: null, text: p.text, lower: p.text.toLowerCase() };
      });
      var combined = bookLabel + ' ' + chapterLabel + ' ' + full.title + ' ' + full.paragraphs.map(function (p) { return p.text; }).join(' ');
      searchIndex.push({
        work: 'TRIN',
        book: c.book,
        chapter: c.chapter,
        qTitle: bookLabel, // treated as the "question title" tier for scoring purposes
        aTitle: full.title,
        qTitleLower: bookLabel.toLowerCase(),
        aTitleLower: full.title.toLowerCase(),
        paragraphs: paragraphs,
        combinedLower: combined.toLowerCase()
      });
    });
  }

  // Score how well an entry (one article) matches the query, and pick the best spot
  // (article title / question title / a specific paragraph) to show as the snippet.
  // Phrase matches and title matches rank far above scattered token-only matches, so a
  // query like "existence of angels" surfaces the actual angels-related articles first
  // rather than any article that happens to contain "existence" and "angels" separately.
  function analyzeEntry(entry, tokens, phrase) {
    var isPhrase = tokens.length > 1;
    var titleTokenCount = 0, qTitleTokenCount = 0;
    var i;
    for (i = 0; i < tokens.length; i++) {
      if (entry.aTitleLower.indexOf(tokens[i]) !== -1) titleTokenCount++;
      if (entry.qTitleLower.indexOf(tokens[i]) !== -1) qTitleTokenCount++;
    }
    var phraseInTitle = isPhrase && entry.aTitleLower.indexOf(phrase) !== -1;
    var phraseInQTitle = isPhrase && entry.qTitleLower.indexOf(phrase) !== -1;

    var bestParaIdx = -1, bestParaCount = 0, phraseParaIdx = -1;
    for (var pi = 0; pi < entry.paragraphs.length; pi++) {
      var p = entry.paragraphs[pi];
      var c = 0;
      for (i = 0; i < tokens.length; i++) { if (p.lower.indexOf(tokens[i]) !== -1) c++; }
      if (c > bestParaCount) { bestParaCount = c; bestParaIdx = pi; }
      if (phraseParaIdx === -1 && isPhrase && p.lower.indexOf(phrase) !== -1) phraseParaIdx = pi;
    }

    if (!titleTokenCount && !qTitleTokenCount && !bestParaCount) return null;

    // Distinct query tokens found ANYWHERE in the entry (title, question title,
    // or body combined) — a breadth signal independent of where/how often they
    // land. Used to tell a genuine multi-word match apart from a single
    // incidental shared word (see sharedTokenCount below).
    var sharedTokenCount = 0;
    for (i = 0; i < tokens.length; i++) {
      if (entry.combinedLower.indexOf(tokens[i]) !== -1) sharedTokenCount++;
    }

    var score = titleTokenCount * 40 + qTitleTokenCount * 20 + bestParaCount * 10;
    if (phraseInTitle) score += 5000;
    else if (phraseParaIdx !== -1) score += 2000;
    else if (phraseInQTitle) score += 1000;
    // A match that shares more than one distinct significant query word is a
    // much stronger relevance signal than a match sharing just one — reward
    // breadth so, e.g., a passage sharing two of a question's content words
    // outranks a passage that only happens to contain one of them (even if
    // that one word lands in its title). Without this, a single incidental
    // shared word can win purely on the title/qtitle weight above.
    if (tokens.length > 1 && sharedTokenCount > 1) score += 300 * (sharedTokenCount - 1);

    var match;
    if (titleTokenCount > 0) {
      match = { from: 'title', text: entry.aTitle, lower: entry.aTitleLower };
    } else if (phraseParaIdx !== -1) {
      var pp = entry.paragraphs[phraseParaIdx];
      match = { from: 'paragraph', text: pp.text, lower: pp.lower, paragraphIndex: phraseParaIdx };
    } else if (bestParaIdx !== -1) {
      var bp = entry.paragraphs[bestParaIdx];
      match = { from: 'paragraph', text: bp.text, lower: bp.lower, paragraphIndex: bestParaIdx };
    } else {
      match = { from: 'qtitle', text: entry.qTitle, lower: entry.qTitleLower };
    }
    return { score: score, match: match, sharedTokenCount: sharedTokenCount };
  }

  // Build a short (~15 word) window of context around the first matching token,
  // with every occurrence of any search token wrapped in <mark> for highlighting.
  function buildSnippet(match, tokens) {
    var text = match.text, lower = match.lower;
    var firstIdx = -1;
    for (var i = 0; i < tokens.length; i++) {
      var idx = lower.indexOf(tokens[i]);
      if (idx !== -1 && (firstIdx === -1 || idx < firstIdx)) firstIdx = idx;
    }
    if (firstIdx === -1) firstIdx = 0;

    var CONTEXT_CHARS = 70;
    var start = Math.max(0, firstIdx - CONTEXT_CHARS);
    var end = Math.min(text.length, firstIdx + CONTEXT_CHARS + 40);
    // Snap to word boundaries so we don't chop a word in half.
    while (start > 0 && /\S/.test(text.charAt(start))) start--;
    while (end < text.length && /\S/.test(text.charAt(end))) end++;

    var snippet = text.slice(start, end);
    var prefix = start > 0 ? '…' : '';
    var suffix = end < text.length ? '…' : '';

    var escaped = escapeHtml(snippet);
    var tokenPattern = tokens.map(escapeRegex).filter(Boolean).join('|');
    if (tokenPattern) {
      var re = new RegExp('(' + tokenPattern + ')', 'ig');
      escaped = escaped.replace(re, '<mark>$1</mark>');
    }
    return prefix + escaped + suffix;
  }

  var MAX_RESULTS = 40;
  var MAX_SCAN_MATCHES = 400; // cap scoring work per keystroke on the full corpus

  // Words too common to be useful as retrieval signals — stripped only for the
  // lenient AI-grounding search below, not the exact keyword search, so
  // natural-language questions ("why does Aquinas think...") aren't defeated by
  // requiring every filler word to literally appear in the text.
  var SEARCH_STOPWORDS = {
    'a': 1, 'an': 1, 'the': 1, 'is': 1, 'are': 1, 'was': 1, 'were': 1, 'be': 1, 'been': 1,
    'why': 1, 'what': 1, 'how': 1, 'does': 1, 'do': 1, 'did': 1, 'think': 1, 'thinks': 1,
    'says': 1, 'said': 1, 'about': 1, 'to': 1, 'of': 1, 'in': 1, 'on': 1, 'for': 1, 'and': 1,
    'or': 1, 'that': 1, 'this': 1, 'it': 1, 'not': 1, 'can': 1, 'according': 1
  };

  function runSearch(query) {
    var normalized = query.toLowerCase().trim().replace(/\s+/g, ' ');
    var tokens = normalized.split(' ').filter(Boolean);
    if (!tokens.length) return [];
    var scored = [];
    for (var i = 0; i < searchIndex.length; i++) {
      var entry = searchIndex[i];
      var matchesAll = true;
      for (var t = 0; t < tokens.length; t++) {
        if (entry.combinedLower.indexOf(tokens[t]) === -1) { matchesAll = false; break; }
      }
      if (!matchesAll) continue;
      var analysis = analyzeEntry(entry, tokens, normalized);
      if (!analysis) continue;
      scored.push({ entry: entry, score: analysis.score, match: analysis.match });
      if (scored.length >= MAX_SCAN_MATCHES) break;
    }
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, MAX_RESULTS).map(function (s) {
      return { entry: s.entry, snippetHtml: buildSnippet(s.match, tokens), from: s.match.from, paragraphIndex: s.match.paragraphIndex };
    });
  }

  // Looser variant for AI-answer grounding: scores every entry that contains
  // ANY significant (non-stopword) query token, ranked the same way as
  // runSearch, instead of requiring every token to be present. A natural
  // question in English rarely reuses every one of its own words verbatim in
  // the source text, so the strict AND search above is too brittle to power
  // retrieval for it.
  function runSearchLenient(query, maxResults) {
    var normalized = query.toLowerCase().trim().replace(/\s+/g, ' ');
    var allTokens = normalized.split(' ').filter(Boolean);
    var tokens = allTokens.filter(function (t) { return !SEARCH_STOPWORDS[t]; });
    if (!tokens.length) tokens = allTokens;
    if (!tokens.length) return [];
    var scored = [];
    for (var i = 0; i < searchIndex.length; i++) {
      var entry = searchIndex[i];
      var hasAny = false;
      for (var t = 0; t < tokens.length; t++) {
        if (entry.combinedLower.indexOf(tokens[t]) !== -1) { hasAny = true; break; }
      }
      if (!hasAny) continue;
      var analysis = analyzeEntry(entry, tokens, normalized);
      if (!analysis) continue;
      scored.push({ entry: entry, score: analysis.score, match: analysis.match, sharedTokenCount: analysis.sharedTokenCount });
      if (scored.length >= MAX_SCAN_MATCHES) break;
    }
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, maxResults || 5).map(function (s) {
      // Low confidence: the query had more than one significant (non-stopword)
      // word, but this entry only actually shares one of them — the rest of
      // the match's score, if any, comes from where that single word landed
      // (e.g. a title), not from genuine topical overlap. This is exactly the
      // "corrupted" habit-vs-Scripture case: one incidental shared word.
      var lowConfidence = tokens.length > 1 && s.sharedTokenCount <= 1;
      return {
        entry: s.entry, snippetHtml: buildSnippet(s.match, tokens), from: s.match.from,
        paragraphIndex: s.match.paragraphIndex, sharedTokenCount: s.sharedTokenCount,
        queryTokenCount: tokens.length, lowConfidence: lowConfidence
      };
    });
  }

  function locationLabelFor(entry) {
    if (entry.work === 'SCG') {
      var bookMeta = scgBooks.filter(function (b) { return b.book === entry.book; })[0];
      return 'SCG — Book ' + (bookMeta ? bookMeta.roman : entry.book) + ', Ch. ' + entry.chapter;
    } else if (entry.work === 'META') {
      var metaBookMeta = metaBooks.filter(function (b) { return b.book === entry.book; })[0];
      return 'Metaphysics — Book ' + (metaBookMeta ? metaBookMeta.roman : entry.book) + ', Ch. ' + entry.chapter;
    } else if (entry.work === 'TRIN') {
      var trinBookMeta = trinBooks.filter(function (b) { return b.book === entry.book; })[0];
      return 'On the Trinity — Book ' + (trinBookMeta ? trinBookMeta.roman : entry.book) + ', Ch. ' + entry.chapter;
    }
    return (PART_NAMES[entry.part] || 'Part ' + entry.part) + ' — Q' + entry.question + ', Art. ' + entry.articleNumber;
  }

  // ---- AI search (in-browser LLM via WebLLM/WebGPU — no server, no API key) ----
  // Runs entirely on-device: the model downloads once (cached by the browser)
  // and every answer is generated locally. Grounded on the app's own existing
  // search index so the model can only draw on text actually in the corpus,
  // and is explicitly instructed to answer briefly and point the reader to the
  // full passage rather than substitute for reading it.
  // Preference order, most-preferred first — small-but-capable instruct models.
  // Matched by substring against whatever WebLLM's current prebuilt list actually
  // contains (rather than hardcoding one exact versioned ID) so a library update
  // that renames/retires a quantization variant doesn't silently break this.
  // Qwen2.5-0.5B first: it's the smallest capable instruct model WebLLM ships
  // (roughly a third the download of the 1B/1.5B options), so first load is
  // much faster — worth more here than the small quality gap for 2-sentence
  // grounded answers. Larger models stay as fallbacks only if it's missing.
  var AI_MODEL_PREFERENCE = ['Qwen2.5-0.5B-Instruct', 'Llama-3.2-1B-Instruct', 'Qwen2.5-1.5B-Instruct', 'gemma-2-2b-it'];
  var _webllmModulePromise = null;
  var _aiEngine = null;
  var _aiEngineLoading = null;
  var _aiQuerySeq = 0; // guards against a stale response landing after a newer query

  function loadWebLLMModule() {
    if (!_webllmModulePromise) {
      _webllmModulePromise = import('https://esm.run/@mlc-ai/web-llm');
    }
    return _webllmModulePromise;
  }

  function pickAIModel(webllm) {
    var list = (webllm.prebuiltAppConfig && webllm.prebuiltAppConfig.model_list) || [];
    var ids = list.map(function (m) { return m.model_id; });
    for (var i = 0; i < AI_MODEL_PREFERENCE.length; i++) {
      var hit = ids.filter(function (id) { return id.indexOf(AI_MODEL_PREFERENCE[i]) === 0; })[0];
      if (hit) return hit;
    }
    if (ids.length) return ids[0]; // last resort: whatever the library ships first
    throw new Error('No AI models available from WebLLM.');
  }

  // A device/browser without WebGPU support (older browsers, most mobile
  // browsers as of this writing, Safari without the feature flag, corporate
  // GPU-disabled machines) will otherwise sit on the initial "Loading…" state
  // forever with no explanation — the WebLLM module loads fine, it's the
  // model init call inside it that eventually errors, but only after however
  // long the browser takes to give up on requesting a GPU adapter. Checking
  // navigator.gpu directly first fails fast with an actionable message.
  function checkAISupport() {
    if (!('gpu' in navigator)) {
      return 'This browser doesn’t support the technology (WebGPU) the on-device AI needs. ' +
        'Try a recent Chrome or Edge on a laptop/desktop, or turn AI off to use keyword search.';
    }
    return null;
  }

  function getAIEngine(onProgress) {
    if (_aiEngine) return Promise.resolve(_aiEngine);
    if (_aiEngineLoading) return _aiEngineLoading;

    var unsupported = checkAISupport();
    if (unsupported) return Promise.reject(new Error(unsupported));

    _aiEngineLoading = loadWebLLMModule()
      .then(function (webllm) {
        var modelId = pickAIModel(webllm);
        return webllm.CreateMLCEngine(modelId, { initProgressCallback: onProgress });
      })
      .then(function (engine) {
        _aiEngine = engine;
        return engine;
      })
      .catch(function (err) {
        _aiEngineLoading = null; // allow retrying on a subsequent query
        throw err;
      });
    return _aiEngineLoading;
  }

  // Pull the fullest text available for one search-index entry (a handful of
  // paragraphs), used as grounding context for the model — not just the short
  // snippet shown in ordinary keyword results.
  function entryContextText(entry) {
    return entry.paragraphs.slice(0, 4).map(function (p) { return p.text; }).join(' ').slice(0, 900);
  }

  // Once a device is confirmed unable to run the on-device model at all (no
  // WebGPU adapter, not just a slow/failed one-off attempt), skip straight to
  // the non-AI fallback on every later query in this session instead of
  // re-attempting and re-failing each time.
  var _aiConfirmedUnsupported = false;

  // Non-AI fallback for devices that can't run the on-device model: the same
  // "brief answer, then push to the source" shape as the real AI answer, just
  // built by extraction (the top matching passage's own opening) instead of
  // generation. Keeps the feature usable everywhere even without WebGPU.
  function renderExtractiveFallback(sources) {
    if (!sources.length) {
      aiAnswerEl.innerHTML =
        '<div class="ai-answer-label">AI answer</div>' +
        '<div class="ai-answer-error">This device can’t run the on-device AI model, and no closely ' +
        'matching passage was found either. Try rephrasing, or turn AI off to browse keyword results.</div>';
      return;
    }
    var top = sources[0];
    var excerpt = entryContextText(top.entry).slice(0, 220).trim();
    var lastSpace = excerpt.lastIndexOf(' ');
    if (lastSpace > 160) excerpt = excerpt.slice(0, lastSpace);
    var text = excerpt + '… Read the full passage below for the complete argument.';
    // The retrieval that picked this passage is weak (see runSearchLenient's
    // lowConfidence) — say so plainly instead of presenting a likely-irrelevant
    // excerpt with the same confident framing as a real match.
    var warning = top.lowConfidence
      ? '<div class="ai-answer-warning">This is a weak match — it may only share an incidental word with ' +
        'your question, not its actual topic. Verify it&rsquo;s relevant before relying on it, or try ' +
        'rephrasing your question.</div>'
      : '';
    var html =
      '<div class="ai-answer-label">Closest passage — on-device AI isn’t available on this device</div>' +
      warning +
      '<div class="ai-answer-text">' + escapeHtml(text) + '</div>' +
      '<div class="ai-answer-sources">' + sources.map(function (r, i) {
        return '<button type="button" class="ai-answer-source" data-src-index="' + i + '">[' + (i + 1) + '] ' +
          escapeHtml(locationLabelFor(r.entry)) + ' — ' + escapeHtml(r.entry.aTitle) +
          (r.lowConfidence ? ' <span class="ai-answer-source-weak">(weak match)</span>' : '') + '</button>';
      }).join('') + '</div>';
    aiAnswerEl.innerHTML = html;
    aiAnswerEl.querySelectorAll('.ai-answer-source').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.dataset.srcIndex, 10);
        var r = sources[idx];
        if (r) activateResult(r);
      });
    });
  }

  function renderAIAnswerShell() {
    aiAnswerEl.hidden = false;
    aiAnswerEl.classList.remove('ai-answer-stale');
    aiAnswerEl.innerHTML =
      '<div class="ai-answer-label"><span class="ai-answer-spinner"></span><span id="aiAnswerStage">Loading on-device AI model…</span></div>' +
      '<div id="aiAnswerBody" class="ai-answer-progress">This runs entirely in your browser. The model downloads once (a few hundred MB) and is cached for next time.</div>';
  }

  function setAIProgress(text) {
    var stageEl = $('aiAnswerStage');
    if (stageEl) stageEl.textContent = text;
  }

  function renderAIError(message) {
    aiAnswerEl.innerHTML =
      '<div class="ai-answer-label">AI answer</div>' +
      '<div class="ai-answer-error">' + escapeHtml(message) + '</div>';
  }

  function renderAIAnswerText(text, sources, done) {
    var allLowConfidence = sources.length > 0 && sources.every(function (r) { return r.lowConfidence; });
    var label = done
      ? '<div class="ai-answer-label">AI answer — always verify against the text</div>'
      : '<div class="ai-answer-label"><span class="ai-answer-spinner"></span><span>Answering…</span></div>';
    var warning = (done && allLowConfidence)
      ? '<div class="ai-answer-warning">The passages found for this question are weak matches — they may ' +
        'only share an incidental word with it, not its actual topic. Treat this answer with extra caution.</div>'
      : '';
    var html = label + warning + '<div class="ai-answer-text">' + escapeHtml(text) + '</div>';
    if (done && sources.length) {
      html += '<div class="ai-answer-sources">' + sources.map(function (r, i) {
        return '<button type="button" class="ai-answer-source" data-src-index="' + i + '">[' + (i + 1) + '] ' +
          escapeHtml(locationLabelFor(r.entry)) + ' — ' + escapeHtml(r.entry.aTitle) +
          (r.lowConfidence ? ' <span class="ai-answer-source-weak">(weak match)</span>' : '') + '</button>';
      }).join('') + '</div>';
    }
    aiAnswerEl.innerHTML = html;
    if (done) {
      aiAnswerEl.querySelectorAll('.ai-answer-source').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var idx = parseInt(btn.dataset.srcIndex, 10);
          var r = sources[idx];
          if (r) activateResult(r);
        });
      });
    }
  }

  function runAISearch(query) {
    query = query.trim();
    if (!query) { aiAnswerEl.hidden = true; aiAnswerEl.classList.remove('ai-answer-stale'); return; }

    var seq = ++_aiQuerySeq;
    var sources = runSearchLenient(query, 5);

    if (_aiConfirmedUnsupported) {
      aiAnswerEl.hidden = false;
      aiAnswerEl.classList.remove('ai-answer-stale');
      renderExtractiveFallback(sources);
      return;
    }

    renderAIAnswerShell();

    // If no progress callback has fired at all after a while, the download
    // likely never started (network/extension blocking esm.run or the model
    // host) rather than just being slow — a real in-progress download reports
    // percentages well before this. Surface that instead of an unexplained
    // spinner. Cleared as soon as any real progress or the answer arrives.
    var gotProgress = false;
    var stallTimer = setTimeout(function () {
      if (seq !== _aiQuerySeq || gotProgress) return;
      setAIProgress('Still trying to start the download… if this doesn’t move, your network or browser extensions may be blocking it.');
    }, 12000);

    getAIEngine(function (report) {
      if (seq !== _aiQuerySeq) return;
      gotProgress = true;
      clearTimeout(stallTimer);
      setAIProgress(report && report.text ? report.text : 'Loading on-device AI model…');
    }).then(function (engine) {
      if (seq !== _aiQuerySeq) return;
      clearTimeout(stallTimer);
      setAIProgress('Thinking…');

      var context = sources.length
        ? sources.map(function (r, i) {
            return '[' + (i + 1) + '] ' + locationLabelFor(r.entry) + ' — ' + r.entry.aTitle +
              (r.lowConfidence ? ' (WEAK MATCH — only an incidental word in common with the question, likely off-topic)' : '') +
              '\n' + entryContextText(r.entry);
          }).join('\n\n')
        : '(No closely matching passages were found in the corpus for this question.)';

      var allLowConfidence = sources.length > 0 && sources.every(function (r) { return r.lowConfidence; });

      // IMPORTANT: do not put a fully-written example answer in here. Earlier
      // versions of this prompt included one (a worked "Q: Is the soul
      // immortal? A: ... Read [3] for the complete argument." sample), and
      // small on-device models under-trained on instruction-following will,
      // when given weak/sparse grounding, sometimes just echo that vivid
      // example back verbatim instead of answering the real question — the
      // reader then sees an answer (and a citation number) for a completely
      // different question than the one they asked, with nothing in the
      // rendering pipeline able to tell the difference since, as far as the
      // seq-guarded streaming code is concerned, it's a normal in-sequence
      // response. Describing the format structurally, with no real sentence
      // content to copy, closes that off at the source.
      var systemPrompt =
        'You are a study assistant inside a reading app containing Aristotle\'s Metaphysics, ' +
        'Aquinas\'s Summa Contra Gentiles, and Aquinas\'s Summa Theologica. Base your answer ONLY on ' +
        'the numbered excerpts given below, and answer ONLY the exact question in the final "Question" ' +
        'line — never answer any other question, and never reuse wording from these instructions ' +
        'themselves as if it were an answer. You MUST always state the actual answer first — never skip ' +
        'straight to telling the reader where to read it.\n\n' +
        'Every reply has exactly two parts, in this order, with nothing before or between them:\n' +
        'PART 1 (required, never omit): 2 sentences that directly answer the question, giving the real ' +
        'content of the answer, in your own words, about THIS question only.\n' +
        'PART 2 (required, always last): 1 sentence starting with "Read " naming the excerpt number(s) ' +
        '(e.g. "Read [2]." or "Read [1, 3].") that contain the full argument — only numbers that appear ' +
        'in the excerpts below.\n\n' +
        'If (and only if) none of the excerpts actually address the question — including any excerpt ' +
        'marked WEAK MATCH, which was retrieved only because it shares one incidental word with the ' +
        'question and is probably NOT actually about it — reply with a single sentence saying the corpus ' +
        'doesn\'t seem to address this question, and give no citation.\n\n' +
        (allLowConfidence
          ? 'IMPORTANT: every excerpt below is a weak match for this question — retrieval only found ' +
            'incidental word overlap, not real topical relevance. Read them critically before answering.\n\n'
          : '') +
        'Excerpts:\n' + context + '\n\nQuestion: ' + query;

      var accumulated = '';
      // WebLLM serializes (queues) concurrent completions on the same engine
      // rather than truly running them in parallel, but a still-running prior
      // generation is otherwise left to finish on its own — pointlessly
      // consuming the GPU and delaying this new answer until it does. Ask the
      // engine to stop any in-flight generation before starting this one.
      var interruptPrior = (typeof engine.interruptGenerate === 'function')
        ? (function () { try { engine.interruptGenerate(); } catch (e) {} return Promise.resolve(); })()
        : Promise.resolve();
      return interruptPrior.then(function () {
        if (seq !== _aiQuerySeq) return;
        return engine.chat.completions.create({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: query }
          ],
          stream: true,
          temperature: 0.3,
          max_tokens: 220 // keeps small on-device models from running past a brief answer
        });
      }).then(function (stream) {
        if (!stream) return;
        return (async function () {
          for await (var chunk of stream) {
            if (seq !== _aiQuerySeq) return;
            var delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content;
            if (delta) {
              accumulated += delta;
              renderAIAnswerText(accumulated, sources, false);
            }
          }
          if (seq === _aiQuerySeq) renderAIAnswerText(accumulated || 'No answer generated.', sources, true);
        })();
      });
    }).catch(function (err) {
      clearTimeout(stallTimer);
      if (seq !== _aiQuerySeq) return;
      console.error('[AI search]', err);
      var raw = String((err && err.message) || err || '');
      // Covers both our own checkAISupport() message and WebLLM/the browser's
      // own wording ("Unable to find a compatible GPU", "No adapter found",
      // etc.) for a device that has no usable WebGPU adapter at all — as
      // opposed to some other, possibly-transient failure (network, etc.).
      var isGpuUnsupported = /webgpu|compatible gpu|gpu adapter|no adapter|requestadapter/i.test(raw);
      if (isGpuUnsupported) {
        _aiConfirmedUnsupported = true;
        renderExtractiveFallback(sources);
        return;
      }
      renderAIError('Could not load or run the on-device AI model. Turn AI off to use keyword search instead.');
    });
  }

  var AI_SEARCH_KEY = 'summa-ai-search';
  function getAISearchOn() {
    try { return localStorage.getItem(AI_SEARCH_KEY) === '1'; } catch (e) { return false; }
  }
  function setAISearchOn(on) {
    try { localStorage.setItem(AI_SEARCH_KEY, on ? '1' : '0'); } catch (e) {}
  }
  if (aiToggle) {
    aiToggle.checked = getAISearchOn();
    aiToggle.addEventListener('change', function () {
      setAISearchOn(aiToggle.checked);
      aiAnswerEl.hidden = true;
      aiAnswerEl.classList.remove('ai-answer-stale');
      aiAnswerEl.innerHTML = '';
      if (aiToggle.checked && searchInput.value.trim()) runAISearch(searchInput.value);
    });
  }

  var searchResultItems = []; // currently rendered result data, in display order
  var searchActiveIndex = -1;

  function renderSearchResults(results, query) {
    searchResultsEl.innerHTML = '';
    searchResultItems = results;
    searchActiveIndex = results.length ? 0 : -1;

    if (!query.trim()) {
      searchResultsEl.innerHTML = '<div class="search-empty">Search across the Metaphysics, the Summa Contra Gentiles, and the Summa Theologica.</div>';
      return;
    }
    if (!results.length) {
      searchResultsEl.innerHTML = '<div class="search-empty">No results for &ldquo;' + escapeHtml(query) + '&rdquo;.</div>';
      return;
    }

    results.forEach(function (r, i) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'search-result' + (i === 0 ? ' active' : '');
      btn.dataset.index = i;

      var loc = document.createElement('div');
      loc.className = 'search-result-loc';
      loc.textContent = locationLabelFor(r.entry);
      btn.appendChild(loc);

      var title = document.createElement('div');
      title.className = 'search-result-title';
      title.textContent = r.entry.aTitle;
      btn.appendChild(title);

      var snippet = document.createElement('div');
      snippet.className = 'search-result-snippet';
      snippet.innerHTML = r.snippetHtml;
      btn.appendChild(snippet);

      btn.addEventListener('click', function () { activateResult(r); });
      searchResultsEl.appendChild(btn);
    });
  }

  function updateSearchActiveHighlight() {
    var items = searchResultsEl.querySelectorAll('.search-result');
    items.forEach(function (el, i) {
      el.classList.toggle('active', i === searchActiveIndex);
    });
    if (searchActiveIndex >= 0 && items[searchActiveIndex]) {
      items[searchActiveIndex].scrollIntoView({ block: 'nearest' });
    }
  }

  function activateResult(result) {
    if (!result) return;
    var isSCG = result.entry.work === 'SCG';
    var isMeta = result.entry.work === 'META';
    var isTrin = result.entry.work === 'TRIN';
    if (result.from === 'paragraph' && result.paragraphIndex != null) {
      _pendingScrollParagraph = (isSCG || isMeta || isTrin)
        ? { work: result.entry.work, book: result.entry.book, chapter: result.entry.chapter, paragraphIndex: result.paragraphIndex }
        : { work: 'ST', part: result.entry.part, question: result.entry.question, articleNumber: result.entry.articleNumber, paragraphIndex: result.paragraphIndex };
    } else {
      _pendingScrollParagraph = null;
    }
    closeSearch();
    if (isSCG) {
      goToChapter(result.entry.book, result.entry.chapter);
    } else if (isMeta) {
      goToChapterMeta(result.entry.book, result.entry.chapter);
    } else if (isTrin) {
      goToChapterTrinity(result.entry.book, result.entry.chapter);
    } else {
      goTo(result.entry.part, result.entry.question, result.entry.articleNumber);
    }
  }

  function scrollToPendingParagraph() {
    var pending = _pendingScrollParagraph;
    if (!pending) return;
    var container;
    if (pending.work === 'SCG' || pending.work === 'META' || pending.work === 'TRIN') {
      if (state.work !== pending.work || pending.book !== state.book || pending.chapter !== state.chapter) return;
      container = chapterView;
    } else {
      if (state.work !== 'ST' || pending.part !== state.part || pending.question !== state.question || pending.articleNumber !== state.article) return;
      container = questionView;
    }
    _pendingScrollParagraph = null;
    var pEl = container.querySelector('.article p[data-pidx="' + pending.paragraphIndex + '"]');
    if (pEl) {
      requestAnimationFrame(function () {
        pEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
        pEl.classList.add('search-flash');
        setTimeout(function () { pEl.classList.remove('search-flash'); }, 2100);
      });
    }
  }

  var searchDebounceTimer = null;
  searchInput.addEventListener('input', function () {
    var query = searchInput.value;
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(function () {
      renderSearchResults(runSearch(query), query);
    }, 250);
    // A previously-shown AI answer/fallback was generated for whatever text
    // was in the box when Enter was last pressed — once the user edits that
    // text further, the answer on screen no longer corresponds to what's in
    // the box. Dim it rather than leaving it looking current until they
    // press Enter again and the old content is abruptly replaced.
    if (aiToggle && aiToggle.checked && !aiAnswerEl.hidden) {
      aiAnswerEl.classList.add('ai-answer-stale');
    }
  });

  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSearch();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (aiToggle && aiToggle.checked) {
        runAISearch(searchInput.value);
      } else if (searchActiveIndex >= 0 && searchResultItems[searchActiveIndex]) {
        activateResult(searchResultItems[searchActiveIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (searchResultItems.length) {
        searchActiveIndex = Math.min(searchResultItems.length - 1, searchActiveIndex + 1);
        updateSearchActiveHighlight();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (searchResultItems.length) {
        searchActiveIndex = Math.max(0, searchActiveIndex - 1);
        updateSearchActiveHighlight();
      }
    }
  });

  function openSearch() {
    searchOverlay.classList.add('open');
    searchInput.value = '';
    renderSearchResults([], '');
    aiAnswerEl.hidden = true;
    aiAnswerEl.classList.remove('ai-answer-stale');
    aiAnswerEl.innerHTML = '';
    setTimeout(function () { searchInput.focus(); }, 10);
  }
  function closeSearch() {
    searchOverlay.classList.remove('open');
    searchInput.blur();
  }
  searchBtn.addEventListener('click', openSearch);
  closeSearchBtn.addEventListener('click', closeSearch);
  searchOverlay.addEventListener('click', function (e) {
    if (e.target === searchOverlay) closeSearch();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && searchOverlay.classList.contains('open')) closeSearch();
    if (e.key === 'Escape' && menuScreen.classList.contains('open')) closeMenuScreen();
    if (e.key === 'Escape' && drawer.classList.contains('open')) closeDrawer();
    if ((e.key === '/' || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) &&
        document.activeElement !== searchInput &&
        !searchOverlay.classList.contains('open')) {
      var tag = document.activeElement && document.activeElement.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        openSearch();
      }
    }
  });

  // ---- Account + cross-device sync (Supabase) ----
  // One row per signed-in user (table user_progress, see supabase-schema.sql)
  // mirrors the three localStorage keys this app already used solo:
  // summa-read, summa-quiz-scores, summa-session. Signed-out visitors are
  // completely unaffected — everything falls back to localStorage-only,
  // exactly as before this feature existed.
  var accountBtn = $('accountBtn'), accountOverlay = $('accountOverlay'), closeAccountBtn = $('closeAccountBtn'), accountBody = $('accountBody');

  var supabaseClient = null;
  if (window.supabase && window.SUPABASE_URL && window.SUPABASE_ANON_KEY) {
    try { supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY); } catch (e) { supabaseClient = null; }
  }
  var currentUser = null; // { id, email } | null
  var _syncPushTimer = null;
  var _syncInFlight = false; // guards mergeRemoteIntoLocal's own writes from immediately re-queuing a push

  function queueSyncPush() {
    if (!supabaseClient || !currentUser || _syncInFlight) return;
    clearTimeout(_syncPushTimer);
    _syncPushTimer = setTimeout(pushLocalToRemote, 1500);
  }

  function pushLocalToRemote() {
    if (!supabaseClient || !currentUser) return;
    var readKeys = [], quizScores = {}, session = null;
    try { readKeys = JSON.parse(localStorage.getItem('summa-read') || '[]'); } catch (e) {}
    try { quizScores = JSON.parse(localStorage.getItem('summa-quiz-scores') || '{}'); } catch (e) {}
    try { session = JSON.parse(localStorage.getItem('summa-session') || 'null'); } catch (e) {}
    supabaseClient.from('user_progress').upsert({
      user_id: currentUser.id,
      read_keys: readKeys,
      quiz_scores: quizScores,
      session: session
    }).then(function (res) {
      if (res.error) console.error('[sync] push failed', res.error);
    });
  }

  // Union read markers, keep the higher of each quiz score, and only adopt
  // the remote reading/audio position if this device doesn't already have
  // one of its own (never clobber an in-progress local session).
  function mergeRemoteIntoLocal(remote) {
    if (!remote) return;
    _syncInFlight = true;
    try {
      var localReadArr = [];
      try { localReadArr = JSON.parse(localStorage.getItem('summa-read') || '[]'); } catch (e) {}
      var merged = new Set(localReadArr);
      (remote.read_keys || []).forEach(function (k) { merged.add(k); });
      readSet = merged;
      saveRead();

      var localScores = {};
      try { localScores = JSON.parse(localStorage.getItem('summa-quiz-scores') || '{}'); } catch (e) {}
      var remoteScores = remote.quiz_scores || {};
      Object.keys(remoteScores).forEach(function (k) {
        var r = remoteScores[k], l = localScores[k];
        if (!l || r.correct > l.correct) localScores[k] = r;
      });
      localStorage.setItem('summa-quiz-scores', JSON.stringify(localScores));

      if (!getSavedSession() && remote.session) {
        localStorage.setItem('summa-session', JSON.stringify(remote.session));
      }
    } finally {
      _syncInFlight = false;
    }
  }

  function pullRemoteAndMerge() {
    if (!supabaseClient || !currentUser) return;
    supabaseClient.from('user_progress').select('*').eq('user_id', currentUser.id).maybeSingle()
      .then(function (res) {
        if (res.error) { console.error('[sync] pull failed', res.error); return; }
        if (res.data) mergeRemoteIntoLocal(res.data);
        else pushLocalToRemote(); // first sign-in on this account: seed the row from local data
        updateNavReadBadges();
        renderAccountBody();
      });
  }

  function sendMagicLink(email) {
    if (!supabaseClient) return Promise.resolve({ error: { message: 'Sync is not available right now.' } });
    return supabaseClient.auth.signInWithOtp({
      email: email,
      options: { emailRedirectTo: window.location.origin + window.location.pathname }
    });
  }

  function signOutAccount() {
    if (!supabaseClient) return;
    supabaseClient.auth.signOut();
  }

  function renderAccountBody() {
    if (!accountBody) return;
    if (!supabaseClient) {
      accountBody.innerHTML = '<p class="account-lede">Account sync isn’t available right now.</p>';
      return;
    }
    if (currentUser) {
      accountBody.innerHTML =
        '<div class="account-signedin-email">' + escapeHtml(currentUser.email) + '</div>' +
        '<div class="account-signedin-sub">Signed in — your reading progress, quiz scores, and position sync automatically across devices.</div>' +
        '<button type="button" id="accountSignOutBtn" class="account-btn account-btn-secondary">Sign out</button>';
      var signOutBtn = $('accountSignOutBtn');
      if (signOutBtn) signOutBtn.addEventListener('click', signOutAccount);
    } else {
      accountBody.innerHTML =
        '<p class="account-lede">Sign in with your email to sync your reading progress, quiz scores, and position across devices. No password — we’ll email you a sign-in link.</p>' +
        '<form id="accountForm" novalidate>' +
        '<div class="account-field"><label for="accountEmail">Email</label>' +
        '<input type="email" id="accountEmail" required autocomplete="email" placeholder="you@example.com"></div>' +
        '<button type="submit" class="account-btn">Send sign-in link</button>' +
        '</form>' +
        '<div id="accountStatus" class="account-status" role="status"></div>';
      var form = $('accountForm');
      if (form) {
        form.addEventListener('submit', function (evt) {
          evt.preventDefault();
          var emailInput = $('accountEmail');
          var status = $('accountStatus');
          var submitBtn = form.querySelector('button[type="submit"]');
          var email = emailInput.value.trim();
          if (!email) return;
          submitBtn.disabled = true;
          status.textContent = 'Sending…';
          status.className = 'account-status';
          sendMagicLink(email).then(function (res) {
            submitBtn.disabled = false;
            if (res.error) {
              status.textContent = res.error.message || 'Could not send sign-in link.';
              status.className = 'account-status is-error';
            } else {
              status.textContent = 'Check your email for a sign-in link.';
              status.className = 'account-status is-success';
            }
          });
        });
      }
    }
  }

  function openAccount() { accountOverlay.classList.add('open'); renderAccountBody(); }
  function closeAccount() { accountOverlay.classList.remove('open'); }
  if (accountBtn) accountBtn.addEventListener('click', openAccount);
  if (closeAccountBtn) closeAccountBtn.addEventListener('click', closeAccount);
  if (accountOverlay) {
    accountOverlay.addEventListener('click', function (e) { if (e.target === accountOverlay) closeAccount(); });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && accountOverlay && accountOverlay.classList.contains('open')) closeAccount();
  });

  if (supabaseClient) {
    supabaseClient.auth.onAuthStateChange(function (event, session) {
      var wasSignedIn = !!currentUser;
      currentUser = (session && session.user) ? { id: session.user.id, email: session.user.email } : null;
      renderAccountBody();
      if (currentUser && !wasSignedIn) pullRemoteAndMerge();
    });
    supabaseClient.auth.getSession().then(function (res) {
      var session = res.data && res.data.session;
      currentUser = (session && session.user) ? { id: session.user.id, email: session.user.email } : null;
      renderAccountBody();
      if (currentUser) pullRemoteAndMerge();
    });
  }

  // ---- Init ----
  buildTree();
  buildTreeSCG();
  buildTreeMeta();
  buildTreeTrinity();
  buildTreeTopics();
  drawerTree.appendChild(metaTreeWrap);
  drawerTree.appendChild(scgTreeWrap);
  drawerTree.appendChild(stTreeWrap);
  drawerTree.appendChild(trinTreeWrap);
  drawerTree.appendChild(topicsTreeWrap);
  updateNavReadBadges();
  buildSearchIndex();
  var savedSession = getSavedSession();
  var hasLocation = window.location.hash.replace('#', '') || (savedSession && savedSession.hash);

  if (!hasLocation) {
    // Show menu screen on first visit
    openMenuScreen();
  } else {
    var start = initialLocation();
    setActiveWork(start.work);
    if (start.work === 'SCG') {
      goToChapter(start.book, start.chapter);
    } else if (start.work === 'META') {
      goToChapterMeta(start.book, start.chapter);
    } else if (start.work === 'TRIN') {
      goToChapterTrinity(start.book, start.chapter);
    } else {
      goTo(start.part, start.question, start.article);
    }
  }

  // Restore audio position from saved session
  if (savedSession && savedSession.audioFile &&
      savedSession.audioFile === audioEl.dataset.currentFile &&
      savedSession.audioTime > 0) {
    _pendingAudioRestore = savedSession.audioTime;
    // If metadata already loaded, seek immediately
    if (audioEl.readyState >= 1) {
      audioEl.currentTime = _pendingAudioRestore;
      _pendingAudioRestore = null;
    }
  }

  // Restore scroll position if returning to the same article
  if (savedSession && savedSession.scrollY > 0 &&
      savedSession.hash === window.location.hash.replace('#', '')) {
    requestAnimationFrame(function () { window.scrollTo(0, savedSession.scrollY); });
  }
})();
