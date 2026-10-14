/* ===== app.js — UI、路由、回合管理、批改（§4、§8） ===== */
(function () {
  'use strict';
  var S = window.Store;

  // ---------- 題庫索引 ----------
  var BANK = (window.QUESTION_BANK && window.QUESTION_BANK.questions) || [];
  var BY_ID = {};
  BANK.forEach(function (q) { BY_ID[q.id] = q; });
  function srcCount(src) { return BANK.filter(function (q) { return q.source === src; }).length; }
  var LEARN = (window.LEARNING_CONTENT && window.LEARNING_CONTENT.subjects) || [];
  var UNIT_BY_ID = {}; var TOTAL_UNITS = 0;
  LEARN.forEach(function (s) { s.units.forEach(function (u) { UNIT_BY_ID[u.id] = u; TOTAL_UNITS++; }); });

  var SRC_LABEL = { past_exam: '考古題', unit_practice: '單元題', authored: '自編題' };
  var SRC_CLASS = { past_exam: 'src-pe', unit_practice: 'src-gu', authored: 'src-au' };

  // ---------- 小工具 ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function sidOf(q) { return q.subjectId || (q.subject && q.subject.indexOf('考科一') === 0 ? 's1' : 's2'); }
  function unitKeyOf(q) { return q.unit ? String(q.unit).trim().split(/\s+/)[0] : null; }
  function relatedUnit(q) {
    var key = unitKeyOf(q); if (!key) return null;
    var sid = sidOf(q);
    for (var i = 0; i < LEARN.length; i++) if (LEARN[i].id === sid)
      for (var j = 0; j < LEARN[i].units.length; j++)
        if (LEARN[i].units[j].unitKey === key) return LEARN[i].units[j];
    return null;
  }
  var _t;
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(_t); _t = setTimeout(function () { t.classList.remove('show'); }, 1800);
  }

  // ---------- 主題 ----------
  function applyTheme() {
    var th = S.load().settings.theme || 'auto';
    if (th === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', th);
  }

  // ================= 回合管理 =================
  function questionOrder(q) {
    return S.load().settings.shuffleOptions ? S.shuffleKeys() : ['A', 'B', 'C', 'D'];
  }
  function buildRound(opts) {
    // opts: {mode, label, filter, filterDesc, size}
    var today = S.todayStr();
    var served = S.dayLog(today).servedIds;
    var ids = S.pickRound(BANK, {
      mode: opts.mode, size: opts.size, filter: opts.filter,
      servedToday: opts.mode === 'daily' ? served : []
    });
    var order = {};
    ids.forEach(function (id) { order[id] = questionOrder(BY_ID[id]); });
    var round = {
      ids: ids, order: order, answers: {}, cursor: 0,
      startDate: today, mode: opts.mode, label: opts.label || '模擬考',
      filterDesc: opts.filterDesc || '', submitted: false,
      createdAt: new Date().toISOString()
    };
    var p = S.load(); p.currentRound = round; S.save();
    return round;
  }
  function currentRound() { return S.load().currentRound; }

  function submitRound() {
    var r = currentRound(); if (!r || r.submitted) return r;
    var correct = 0;
    r.ids.forEach(function (id) {
      var q = BY_ID[id]; var sel = r.answers[id];
      var isC = sel === q.answer;
      if (isC) correct++;
      S.applyAnswer(id, isC);        // 更新 SRS（§4.4.2）
    });
    // 每日紀錄
    var log = S.dayLog(r.startDate);
    log.rounds += 1; log.correct += correct; log.total += r.ids.length;
    if (r.mode === 'daily') S.markServed(r.ids, r.startDate); // 當日不重複
    r.submitted = true; r.score = correct; S.save();
    return r;
  }

  // ================= 統計 =================
  function stats() {
    var p = S.load(); var today = S.todayStr();
    var readCount = 0; for (var k in p.learningRead) if (p.learningRead[k]) readCount++;
    var totalC = 0, totalN = 0;
    for (var d in p.dailyLog) { totalC += p.dailyLog[d].correct; totalN += p.dailyLog[d].total; }
    var tlog = p.dailyLog[today] || { correct: 0, total: 0 };
    var due = 0, wrong = 0;
    BANK.forEach(function (q) {
      var st = p.questionState[q.id]; if (!st) return;
      if (st.seenCount > 0 && st.dueDate && st.dueDate <= today) due++;
      if (st.lapses > 0 && !st.mastered) wrong++;
    });
    return {
      readCount: readCount, totalUnits: TOTAL_UNITS,
      overallC: totalC, overallN: totalN,
      overallPct: totalN ? Math.round(totalC / totalN * 100) : 0,
      todayC: tlog.correct, todayN: tlog.total,
      due: due, wrong: wrong
    };
  }

  // ================= 路由 =================
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
  function route() {
    var h = location.hash.replace(/^#/, '') || '/';
    var parts = h.split('/').filter(Boolean);
    return { name: parts[0] || 'home', arg: parts[1] ? decodeURIComponent(parts[1]) : null };
  }

  function render() {
    applyTheme();
    if (_hlBar) hideBar();
    var r = route(); var main = $('#app-main'); var html = '';
    switch (r.name) {
      case 'home': html = viewHome(); break;
      case 'quiz': html = viewQuiz(); break;
      case 'result': html = viewResult(); break;
      case 'learn': html = r.arg ? viewUnit(r.arg) : viewLearnHome(); break;
      case 'wrong': html = viewWrong(); break;
      case 'settings': html = viewSettings(); break;
      default: html = viewHome();
    }
    main.innerHTML = html;
    setActiveTab(r.name);
    afterRender(r);
    window.scrollTo(0, 0);
  }
  function setActiveTab(name) {
    var map = { home: 'home', quiz: 'quiz', learn: 'learn', wrong: 'wrong', settings: 'settings', result: 'quiz' };
    $all('nav.tabbar button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === (map[name] || 'home'));
    });
  }

  // ================= 首頁 / Dashboard =================
  function viewHome() {
    var s = stats(); var r = currentRound();
    var resume = r && !r.submitted;
    var readPct = s.totalUnits ? Math.round(s.readCount / s.totalUnits * 100) : 0;
    return '' +
      '<div class="card hero">' +
      '<h2>iPAS 淨零碳規劃管理師（初級）</h2>' +
      '<div class="sub">單機離線模擬考 · 每日抽考 + 記憶曲線複習</div>' +
      '</div>' +
      '<div class="stat-grid">' +
      stat(s.readCount + '/' + s.totalUnits, '學習單元已讀') +
      stat(s.todayN ? (s.todayC + '/' + s.todayN) : '—', '今日已作答') +
      stat(s.overallPct + '%', '整體正確率') +
      stat(s.due, '待複習到期題') +
      '</div>' +
      '<div class="card">' +
      '<div class="section-title" style="margin-top:0">今日模擬考</div>' +
      (resume
        ? '<div class="notice">有一份未完成的「' + esc(r.label) + '」（第 ' + (r.cursor + 1) + '/' + r.ids.length + ' 題），可續作。</div>' +
          '<button class="btn primary block" data-act="resume">▶ 繼續作答</button>'
        : '<button class="btn primary block" data-act="start-daily">開始今日模擬考（10 題）</button>') +
      '</div>' +
      '<div class="card">' +
      '<div class="section-title" style="margin-top:0">學習進度</div>' +
      '<div class="progressbar"><i style="width:' + readPct + '%"></i></div>' +
      '<div class="btn-row" style="margin-top:12px">' +
      '<button class="btn" data-act="nav" data-h="#/learn">📖 繼續學習</button>' +
      '<button class="btn" data-act="nav" data-h="#/wrong">📕 錯題本（' + s.wrong + '）</button>' +
      '</div></div>' +
      '<div class="card">' +
      '<div class="section-title" style="margin-top:0">快速練習</div>' +
      '<div class="btn-row">' +
      practiceBtn('考科一', function () { }, 's1') +
      practiceBtn('考科二', function () { }, 's2') +
      '<button class="btn sm" data-act="practice" data-scope="pe">只練考古題</button>' +
      '<button class="btn sm" data-act="practice" data-scope="gu">只練單元題</button>' +
      (srcCount('authored') ? '<button class="btn sm" data-act="practice" data-scope="au">只練自編題</button>' : '') +
      '</div>' +
      '<div class="src-legend">題庫共 ' + BANK.length + ' 題　·　' +
      '<span class="chip src-pe">考古題 ' + srcCount('past_exam') + '</span>' +
      '<span class="chip src-gu">單元題 ' + srcCount('unit_practice') + '</span>' +
      (srcCount('authored') ? '<span class="chip src-au">自編題 ' + srcCount('authored') + '</span>' : '') +
      '</div></div>';
  }
  function stat(n, l) { return '<div class="stat"><div class="n">' + esc(n) + '</div><div class="l">' + esc(l) + '</div></div>'; }
  function practiceBtn(label, _fn, sid) { return '<button class="btn sm" data-act="practice" data-scope="' + sid + '">' + esc(label) + '</button>'; }

  // ================= 模擬考 — 作答 =================
  function viewQuiz() {
    var r = currentRound();
    if (!r) return emptyState('🎯', '目前沒有進行中的回合', '回首頁開始今日模擬考', '#/');
    if (r.submitted) { location.hash = '#/result'; return ''; }
    var idx = r.cursor; var q = BY_ID[r.ids[idx]];
    var order = r.order[q.id] || ['A', 'B', 'C', 'D'];
    var sel = r.answers[q.id];
    var opts = order.map(function (k, i) {
      var pos = ['A', 'B', 'C', 'D'][i];
      return '<label class="opt' + (sel === k ? ' selected' : '') + '" data-key="' + k + '">' +
        '<span class="key">' + pos + '</span>' +
        '<span class="txt">' + esc(q.options[k]) + '</span></label>';
    }).join('');
    var answered = r.ids.filter(function (id) { return r.answers[id]; }).length;
    var pct = Math.round(answered / r.ids.length * 100);
    return '' +
      '<div class="card">' +
      '<div style="font-size:13px;color:var(--muted);font-weight:700">' + esc(r.label) + (r.filterDesc ? ' · ' + esc(r.filterDesc) : '') + '</div>' +
      '<div class="qprogress"><div class="txt">第 ' + (idx + 1) + ' / ' + r.ids.length + ' 題</div>' +
      '<div class="progressbar" style="flex:1"><i style="width:' + pct + '%"></i></div></div>' +
      '<div>' + srcChips(q) + '</div>' +
      '<div class="qstem">' + esc(q.stem) + '</div>' +
      '<div class="options" id="opts">' + opts + '</div>' +
      '<div class="btn-row" style="margin-top:18px">' +
      '<button class="btn" data-act="prev" ' + (idx === 0 ? 'disabled' : '') + '>← 上一題</button>' +
      (idx < r.ids.length - 1
        ? '<button class="btn accent" data-act="next">下一題 →</button>'
        : '<button class="btn primary" data-act="submit">交卷批改</button>') +
      '<div style="flex:1"></div>' +
      '<button class="btn ghost sm" data-act="submit">交卷（已答 ' + answered + '/' + r.ids.length + '）</button>' +
      '</div>' +
      '<div class="kbd-hint">提示：作答進度會自動暫存，離開後可繼續。</div>' +
      '</div>';
  }
  function srcChips(q) {
    var s = '<span class="chip subj">' + esc(sidOf(q) === 's1' ? '考科一' : '考科二') + '</span>';
    s += '<span class="chip ' + SRC_CLASS[q.source] + '">' + SRC_LABEL[q.source] + (q.exam ? '·' + esc(q.exam) : '') + '</span>';
    if (q.unit) s += '<span class="chip">' + esc(q.unit) + '</span>';
    return s;
  }

  // ================= 模擬考 — 結果 / 檢討 =================
  function viewResult() {
    var r = currentRound();
    if (!r || !r.submitted) return emptyState('📊', '尚無批改結果', '回首頁', '#/');
    var pct = Math.round(r.score / r.ids.length * 100);
    var list = r.ids.map(function (id) { return reviewCard(BY_ID[id], r.answers[id]); }).join('');
    return '' +
      '<div class="card hero">' +
      '<h2>本回合成績</h2>' +
      '<div style="font-size:40px;font-weight:800;margin:6px 0">' + r.score + ' / ' + r.ids.length + '</div>' +
      '<div class="sub">正確率 ' + pct + '%　·　' + esc(r.label) + '</div>' +
      '</div>' +
      '<div class="btn-row">' +
      (r.mode === 'daily'
        ? '<button class="btn primary" data-act="more">考我更多（再來 10 題）</button>'
        : '<button class="btn primary" data-act="again" data-mode="' + r.mode + '">再練一組</button>') +
      '<button class="btn" data-act="nav" data-h="#/">回首頁</button>' +
      '</div>' +
      '<div class="section-title">逐題檢討</div>' + list;
  }
  function reviewCard(q, sel) {
    var isC = sel === q.answer;
    var order = (currentRound().order[q.id]) || ['A', 'B', 'C', 'D'];
    var opts = order.map(function (k, i) {
      var pos = ['A', 'B', 'C', 'D'][i];
      var cls = 'opt', mark = '';
      if (k === q.answer) { cls += ' correct'; mark = '✓ 正解'; }
      if (k === sel && k !== q.answer) { cls += ' wrong'; mark = '✗ 你的選擇'; }
      return '<div class="' + cls + '"><span class="key">' + pos + '</span><span class="txt">' + esc(q.options[k]) +
        '</span>' + (mark ? '<span class="mark">' + mark + '</span>' : '') + '</div>';
    }).join('');
    var st = S.getState(q.id);
    var exp = q.explanation && q.explanation.trim()
      ? '<div class="explain"><span class="lbl">解析</span>' + esc(q.explanation) + '</div>'
      : '<div class="explain placeholder"><span class="lbl">解析</span>解析補充中（考古題解析上線前補寫）</div>';
    var ru = relatedUnit(q);
    var links = '';
    if (ru) links += '<button class="btn ghost sm" data-act="nav" data-h="#/learn/' + encodeURIComponent(ru.id) + '">查看相關學習單元 →</button>';
    links += '<button class="btn ghost sm" data-act="master" data-id="' + q.id + '">' + (st.mastered ? '已標記掌握 ✓' : '標記為已掌握') + '</button>';
    return '<div class="rev-q ' + (isC ? 'isc' : 'isw') + '">' +
      '<div class="rev-head">' +
      '<span class="rev-verdict ' + (isC ? 'c' : 'w') + '">' + (isC ? '答對' : (sel ? '答錯' : '未作答')) + '</span>' +
      srcChips(q) + '</div>' +
      '<div class="qstem" style="font-size:16px">' + esc(q.stem) + '</div>' +
      '<div class="options">' + opts + '</div>' + exp +
      '<div class="btn-row" style="margin-top:10px">' + links + '</div>' +
      '</div>';
  }

  // ================= 學習模組 =================
  function viewLearnHome() { if (LEARN[0]) { location.hash = '#/learn/' + encodeURIComponent(LEARN[0].units[0].id); return ''; } return emptyState('📖', '尚無學習內容', '回首頁', '#/'); }

  function tocHTML(activeId) {
    var p = S.load();
    return LEARN.map(function (s) {
      return '<div class="subj">' + esc(s.name) + '</div>' +
        s.units.map(function (u) {
          var rd = p.learningRead[u.id] ? '<span class="rd">✓</span>' : '';
          return '<a href="#/learn/' + encodeURIComponent(u.id) + '" class="' + (u.id === activeId ? 'active' : '') + '">' +
            esc(u.title.replace(/^單元\s*/, '')) + rd + '</a>';
        }).join('');
    }).join('');
  }
  // ---- 螢光筆：依「元素 key + 字元位置」還原標記 ----
  function unitHLs(uid) { var h = S.load().highlights || {}; return h[uid] || []; }
  function applyHL(uid, key, text) {
    var hs = unitHLs(uid).filter(function (h) { return h.key === key; });
    if (!hs.length) return esc(text);
    var n = text.length, col = new Array(n);
    hs.forEach(function (h) { for (var i = Math.max(0, h.start); i < Math.min(n, h.end); i++) col[i] = h.color; });
    var out = '', i = 0;
    while (i < n) {
      var c = col[i], j = i; while (j < n && col[j] === c) j++;
      var seg = esc(text.slice(i, j));
      out += c ? '<mark class="hl hl-' + esc(c) + '">' + seg + '</mark>' : seg;
      i = j;
    }
    return out;
  }
  function hel(tag, cls, uid, key, text) {
    return '<' + tag + ' class="hlable' + (cls ? ' ' + cls : '') + '" data-hk="' + key + '">' + applyHL(uid, key, text) + '</' + tag + '>';
  }
  function renderBlock(b, uid, base) {
    if (b.type === 'list') return '<ul>' + b.items.map(function (it, ii) { return hel('li', '', uid, base + 'i' + ii, it); }).join('') + '</ul>';
    if (b.type === 'olist') return '<ol>' + b.items.map(function (it, ii) { return hel('li', '', uid, base + 'o' + ii, it); }).join('') + '</ol>';
    if (b.type === 'sub') return hel('h4', 'unit-subhead', uid, base, b.text);
    if (b.type === 'figure') return '<div class="figure-note">🖼 <span class="hlable" data-hk="' + base + '">' + applyHL(uid, base, b.text) + '</span><span>（圖表請參見原教材）</span></div>';
    if (b.type === 'callout') return '<div class="callout">' + (b.title ? '<div class="callout-t">' + esc(b.title) + '</div>' : '') + hel('div', '', uid, base + 'co', b.text) + '</div>';
    if (b.type === 'table') {
      var head = (b.headers || []).map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('');
      var rows = (b.rows || []).map(function (r, ri) { return '<tr>' + r.map(function (c, ci) { return hel('td', '', uid, base + 'r' + ri + 'c' + ci, c); }).join('') + '</tr>'; }).join('');
      return '<div class="tbl-wrap">' + (b.caption ? hel('div', 'tbl-cap', uid, base + 'cap', b.caption) : '') +
        '<table class="data-tbl"><thead><tr>' + head + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
    }
    return hel('p', '', uid, base, b.text);
  }
  function viewUnit(uid) {
    var u = UNIT_BY_ID[uid]; if (!u) return viewLearnHome();
    var p = S.load(); var read = !!p.learningRead[uid];
    var mk = u.mustKnow && u.mustKnow.length
      ? '<div class="mustknow"><h4>★ 必背重點</h4><ul>' + u.mustKnow.map(function (m, i) { return hel('li', '', uid, 'mk' + i, m); }).join('') + '</ul></div>' : '';
    var tm = u.terms && u.terms.length
      ? '<div class="termcards"><h4>🔑 關鍵名詞（中英對照）</h4><div class="term-grid">' +
        u.terms.map(function (t, i) {
          return '<div class="term">' + hel('div', 'term-zh', uid, 'tz' + i, t.zh) +
            (t.en && t.en !== '—' ? hel('div', 'term-en', uid, 'te' + i, t.en) : '') +
            (t.def ? hel('div', 'term-def', uid, 'td' + i, t.def) : '') + '</div>';
        }).join('') + '</div></div>' : '';
    var body = u.sections.map(function (sec, si) {
      var blocks = sec.blocks.map(function (b, bi) { return renderBlock(b, uid, 's' + si + 'b' + bi); }).join('');
      return '<div class="unit-sec"><h3>' + esc(sec.heading) + '</h3>' + blocks + '</div>';
    }).join('');
    var qCount = BANK.filter(unitFilter(u)).length;
    return '' +
      '<input class="searchbar" id="learn-search" placeholder="🔍 搜尋所有學習內容關鍵字…" autocomplete="off">' +
      '<div id="search-results"></div>' +
      '<div class="learn-wrap" id="learn-main">' +
      '<div class="toc">' + tocHTML(uid) + '</div>' +
      '<div class="unit-body">' +
      '<div class="btn-row" style="justify-content:space-between;align-items:center">' +
      '<h2 style="margin:0">' + esc(u.title) + '</h2>' +
      '<button class="btn sm ' + (read ? '' : 'primary') + '" data-act="toggle-read" data-id="' + uid + '">' + (read ? '已讀 ✓（點擊取消）' : '標記已讀') + '</button>' +
      '</div>' + mk + tm + body +
      '<div class="card" style="text-align:center;margin-top:20px">' +
      '<div class="section-title" style="margin-top:0">立即測驗本單元（' + qCount + ' 題可用）</div>' +
      '<button class="btn accent block" data-act="quiz-unit" data-id="' + uid + '">開始本單元小測（10 題）</button>' +
      '</div></div></div>';
  }
  function unitFilter(u) {
    return function (q) { return sidOf(q) === u.subjectId && unitKeyOf(q) === u.unitKey; };
  }

  // 全文搜尋（純前端字串比對，命中高亮）
  function runSearch(term) {
    term = term.trim(); var box = $('#search-results'); var main = $('#learn-main');
    if (!term) { box.innerHTML = ''; main.style.display = ''; return; }
    main.style.display = 'none';
    var re = new RegExp('(' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    var hits = [];
    LEARN.forEach(function (s) {
      s.units.forEach(function (u) {
        var pieces = [];
        (u.mustKnow || []).forEach(function (m) { pieces.push(m); });
        (u.terms || []).forEach(function (t) { pieces.push(t.zh + ' ' + (t.en || '') + ' ' + (t.def || '')); });
        u.sections.forEach(function (sec) {
          pieces.push(sec.heading);
          sec.blocks.forEach(function (b) {
            if (b.items) b.items.forEach(function (i) { pieces.push(i); });
            else if (b.type === 'table') { (b.rows || []).forEach(function (r) { pieces.push(r.join(' ')); }); if (b.caption) pieces.push(b.caption); }
            else if (b.text) pieces.push(b.text);
          });
        });
        pieces.forEach(function (txt) {
          if (txt.toLowerCase().indexOf(term.toLowerCase()) >= 0)
            hits.push({ u: u, s: s, txt: txt });
        });
      });
    });
    if (!hits.length) { box.innerHTML = '<div class="empty">找不到「' + esc(term) + '」相關內容</div>'; return; }
    box.innerHTML = '<div class="section-title">搜尋結果（' + hits.length + '）</div>' +
      hits.slice(0, 60).map(function (h) {
        var frag = esc(h.txt).replace(re, '<mark>$1</mark>');
        return '<div class="searchhit"><a href="#/learn/' + encodeURIComponent(h.u.id) + '"><b>' + esc(h.s.name) + ' · ' + esc(h.u.title) + '</b></a>' +
          '<div style="margin-top:4px">' + frag + '</div></div>';
      }).join('');
  }

  // ================= 錯題本 =================
  function viewWrong() {
    var p = S.load(); var today = S.todayStr();
    var items = BANK.filter(function (q) { var st = p.questionState[q.id]; return st && st.lapses > 0; })
      .map(function (q) { return { q: q, st: p.questionState[q.id] }; })
      .sort(function (a, b) { return (a.st.dueDate || '') < (b.st.dueDate || '') ? -1 : 1; });
    var active = items.filter(function (it) { return !it.st.mastered; });
    var head = '<div class="card"><h2>📕 錯題本</h2>' +
      '<div class="desc" style="color:var(--muted)">凡答錯過的題目自動納入；連續答對可標記已掌握。</div>' +
      (active.length ? '<button class="btn primary block" data-act="practice" data-scope="wrong" style="margin-top:12px">只練錯題（10 題）</button>' : '') +
      '</div>';
    if (!items.length) return head + emptyState('🎉', '目前沒有錯題', '去做今日模擬考吧', '#/');
    var list = items.map(function (it) {
      var st = it.st; var q = it.q;
      var dueTxt, dueCls;
      if (st.mastered) { dueTxt = '已掌握'; dueCls = 'ok'; }
      else if (st.dueDate && st.dueDate <= today) { dueTxt = '待複習'; dueCls = 'due'; }
      else { dueTxt = '下次 ' + (st.dueDate || '—'); dueCls = 'due'; }
      return '<div class="wb-item">' +
        '<div class="meta"><div class="stem">' + esc(q.stem) + '</div>' +
        '<div class="mini">' + (sidOf(q) === 's1' ? '考科一' : '考科二') + ' · ' + SRC_LABEL[q.source] +
        ' · 答錯 ' + st.lapses + ' 次 · 最近' + (st.lastResult === 'correct' ? '答對' : '答錯') + '</div></div>' +
        '<span class="pill ' + dueCls + '">' + dueTxt + '</span>' +
        '<button class="btn ghost sm" data-act="master" data-id="' + q.id + '">' + (st.mastered ? '↺' : '掌握') + '</button>' +
        '</div>';
    }).join('');
    return head + '<div class="section-title">共 ' + items.length + ' 題（待複習 ' + active.length + '）</div>' + list;
  }

  // ================= 設定 =================
  function viewSettings() {
    var st = S.load().settings;
    return '<div class="card"><h2>⚙️ 設定</h2>' +
      row('每回合題數', '每次抽考的題目數量', '<select class="sel" id="set-size">' +
        [5, 10, 15, 20].map(function (n) { return '<option value="' + n + '"' + (st.roundSize === n ? ' selected' : '') + '>' + n + ' 題</option>'; }).join('') + '</select>') +
      row('選項隨機洗牌', '每次作答時打亂選項順序，杜絕背選項位置', switchHTML('set-shuffle', st.shuffleOptions)) +
      row('外觀主題', '淺色 / 深色 / 跟隨系統', '<select class="sel" id="set-theme">' +
        [['auto', '跟隨系統'], ['light', '淺色'], ['dark', '深色']].map(function (o) { return '<option value="' + o[0] + '"' + (st.theme === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>') +
      '</div>' +
      '<div class="card"><div class="section-title" style="margin-top:0">進度備份（跨裝置手動搬移）</div>' +
      '<div class="btn-row">' +
      '<button class="btn" data-act="export">⬇ 匯出進度 JSON</button>' +
      '<button class="btn" data-act="import">⬆ 匯入進度</button>' +
      '<input type="file" id="import-file" accept="application/json,.json" style="display:none">' +
      '</div>' +
      '<div class="src-legend" style="margin-top:10px">資料僅存於本機瀏覽器，不會上傳；清除瀏覽器資料將歸零。</div>' +
      '</div>' +
      '<div class="card"><div class="section-title" style="margin-top:0">學習螢光標記</div>' +
      '<div class="desc" style="color:var(--muted);margin-bottom:10px">在「學習」頁反白選取字句即可上螢光色；標記會隨進度一起匯出／匯入。</div>' +
      '<button class="btn" data-act="clear-hl">清除全部螢光標記</button></div>' +
      '<div class="card"><div class="section-title" style="margin-top:0">危險操作</div>' +
      '<button class="btn" data-act="reset" style="color:var(--bad)">重設所有進度</button></div>' +
      '<div class="src-legend" style="text-align:center;justify-content:center">iPAS 淨零碳規劃管理師（初級）模擬考 · 單機離線 · v1.0</div>';
  }
  function row(t, d, ctrl) { return '<div class="setting-row"><div><div style="font-weight:600">' + esc(t) + '</div><div class="desc">' + esc(d) + '</div></div>' + ctrl + '</div>'; }
  function switchHTML(id, on) { return '<label class="switch"><input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + '><span class="track"></span><span class="thumb"></span></label>'; }

  function emptyState(icon, title, btn, hash) {
    return '<div class="empty"><div class="big">' + icon + '</div><div style="font-size:18px;font-weight:700;margin-bottom:4px">' + esc(title) + '</div>' +
      '<button class="btn primary" data-act="nav" data-h="' + hash + '" style="margin-top:14px">' + esc(btn) + '</button></div>';
  }

  // ================= 事件綁定 =================
  function afterRender(r) {
    // 選項點擊
    var optbox = $('#opts');
    if (optbox) optbox.addEventListener('click', function (e) {
      var lab = e.target.closest('.opt'); if (!lab) return;
      var rd = currentRound(); var q = BY_ID[rd.ids[rd.cursor]];
      rd.answers[q.id] = lab.dataset.key; S.save();
      $all('.opt', optbox).forEach(function (o) { o.classList.toggle('selected', o.dataset.key === lab.dataset.key); });
    });
    // 搜尋
    var sb = $('#learn-search');
    if (sb) sb.addEventListener('input', function () { runSearch(sb.value); });
    // 螢光筆（學習單元頁）
    if (r.name === 'learn' && r.arg) setupHighlighter(r.arg);
  }

  // ================= 螢光筆 =================
  var HL_COLORS = [['y', '黃'], ['g', '綠'], ['p', '粉'], ['b', '藍']];
  var _hlBar = null, _hlUid = null, _hlDocBound = false, _pendingSel = null;
  function hlBar() {
    if (_hlBar) return _hlBar;
    var bar = document.createElement('div');
    bar.className = 'hl-bar'; bar.id = 'hl-bar';
    bar.innerHTML = HL_COLORS.map(function (c) {
      return '<button class="hl-sw hl-' + c[0] + '" data-hlc="' + c[0] + '" title="' + c[1] + '"></button>';
    }).join('') + '<button class="hl-x" data-hlc="erase" title="清除">⌫</button>';
    document.body.appendChild(bar);
    // 保留選取：工具列上的按壓不得清掉文字選取
    bar.addEventListener('mousedown', function (e) { e.preventDefault(); });
    bar.addEventListener('touchstart', function (e) { e.preventDefault(); }, { passive: false });
    var _busy = false;
    var act = function (e) {
      var b = e.target.closest('[data-hlc]'); if (!b) return;
      e.preventDefault();
      if (_busy) return; _busy = true; setTimeout(function () { _busy = false; }, 500);
      if (b.dataset.hlc === 'erase') eraseSelection(); else applySelection(b.dataset.hlc);
    };
    bar.addEventListener('touchend', act);   // iOS：touchstart 被 preventDefault 時 click 可能不觸發
    bar.addEventListener('click', act);      // 桌機
    _hlBar = bar;          // ← 單例：先前漏設，導致每次都新建一條且無法隱藏
    return bar;
  }
  function hideBar() { if (_hlBar) _hlBar.classList.remove('show'); }
  function showBarAt(rect) {
    var bar = hlBar(); bar.classList.add('show');
    var bw = bar.offsetWidth || 180, bh = bar.offsetHeight || 40;
    var left = Math.min(Math.max(8, rect.left + rect.width / 2 - bw / 2), window.innerWidth - bw - 8);
    var top = rect.top - bh - 10;
    if (top < 8) top = rect.bottom + 10;
    bar.style.left = left + 'px'; bar.style.top = top + 'px';
  }
  function curSelection() {
    var s = window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) return null;
    var main = $('#learn-main'); if (!main) return null;
    var rg = s.getRangeAt(0);
    if (!main.contains(rg.commonAncestorContainer)) return null;
    if (!String(s).trim()) return null;
    return { sel: s, range: rg };
  }
  function setupHighlighter(uid) {
    _hlUid = uid;
    var main = $('#learn-main'); if (!main) return;
    var onUp = function () {
      setTimeout(function () {
        var c = curSelection();
        if (c) { _pendingSel = selectionRanges(); if (_pendingSel.length) showBarAt(c.range.getBoundingClientRect()); else { _pendingSel = null; hideBar(); } }
        else { _pendingSel = null; hideBar(); }
      }, 10);
    };
    main.addEventListener('mouseup', onUp);
    main.addEventListener('touchend', onUp);
    if (!_hlDocBound) {
      _hlDocBound = true;
      document.addEventListener('selectionchange', function () { if (_hlBar && _hlBar.classList.contains('show') && !curSelection()) hideBar(); });
    }
  }
  // 計算選取在各 [data-hk] 元素內的字元範圍
  function selectionRanges() {
    var c = curSelection(); if (!c) return [];
    var main = $('#learn-main'); var rg = c.range; var out = [];
    $all('[data-hk]', main).forEach(function (el) {
      var intersects = rg.intersectsNode ? rg.intersectsNode(el) : (el.contains(rg.startContainer) || el.contains(rg.endContainer) || rg.commonAncestorContainer.contains && rg.commonAncestorContainer.contains(el));
      if (!intersects) return;
      var total = el.textContent.length;
      var start = 0, end = total;
      if (el.contains(rg.startContainer)) { var r1 = document.createRange(); r1.selectNodeContents(el); try { r1.setEnd(rg.startContainer, rg.startOffset); start = r1.toString().length; } catch (e) { } }
      if (el.contains(rg.endContainer)) { var r2 = document.createRange(); r2.selectNodeContents(el); try { r2.setEnd(rg.endContainer, rg.endOffset); end = r2.toString().length; } catch (e) { } }
      if (end > start) out.push({ el: el, key: el.getAttribute('data-hk'), start: start, end: end });
    });
    return out;
  }
  function reapply(el) { if (el && el.isConnected !== false) el.innerHTML = applyHL(_hlUid, el.getAttribute('data-hk'), el.textContent); }
  function activeRanges() {
    // 以工具列出現時的快照為準；必要時回退到當前選取
    if (_pendingSel && _pendingSel.length) return _pendingSel;
    return selectionRanges();
  }
  function finishHL() { _pendingSel = null; clearSel(); hideBar(); }
  function applySelection(color) {
    var ranges = activeRanges(); if (!ranges.length) { finishHL(); return; }
    var p = S.load(); if (!p.highlights) p.highlights = {}; if (!p.highlights[_hlUid]) p.highlights[_hlUid] = [];
    ranges.forEach(function (r) { p.highlights[_hlUid].push({ key: r.key, start: r.start, end: r.end, color: color }); });
    S.save();
    ranges.forEach(function (r) { reapply(r.el); });
    finishHL();
  }
  function eraseSelection() {
    var ranges = activeRanges(); if (!ranges.length) { finishHL(); return; }
    var p = S.load(); var arr = (p.highlights && p.highlights[_hlUid]) || [];
    ranges.forEach(function (r) {
      arr = arr.filter(function (h) { return !(h.key === r.key && h.start < r.end && h.end > r.start); });
    });
    p.highlights[_hlUid] = arr; S.save();
    ranges.forEach(function (r) { reapply(r.el); });
    finishHL();
  }
  function clearSel() { var s = window.getSelection(); if (s && s.removeAllRanges) s.removeAllRanges(); }

  function onAction(e) {
    var btn = e.target.closest('[data-act]'); if (!btn) return;
    var act = btn.dataset.act;
    if (act === 'nav') { location.hash = btn.dataset.h; return; }
    if (act === 'start-daily') { buildRound({ mode: 'daily', label: '每日模擬考' }); go('#/quiz'); return; }
    if (act === 'resume') { go('#/quiz'); return; }
    if (act === 'prev') { var r = currentRound(); if (r.cursor > 0) { r.cursor--; S.save(); render(); } return; }
    if (act === 'next') { var r2 = currentRound(); if (r2.cursor < r2.ids.length - 1) { r2.cursor++; S.save(); render(); } return; }
    if (act === 'submit') {
      var r3 = currentRound();
      var un = r3.ids.filter(function (id) { return !r3.answers[id]; }).length;
      if (un > 0 && !confirm('尚有 ' + un + ' 題未作答，未作答將視為答錯。確定交卷？')) return;
      submitRound(); go('#/result'); return;
    }
    if (act === 'more') { buildRound({ mode: 'daily', label: '每日模擬考' }); go('#/quiz'); return; }
    if (act === 'again') { buildRound(lastPracticeOpts || { mode: 'daily', label: '模擬考' }); go('#/quiz'); return; }
    if (act === 'practice') { startPractice(btn.dataset.scope); return; }
    if (act === 'quiz-unit') { startUnitQuiz(btn.dataset.id); return; }
    if (act === 'toggle-read') { toggleRead(btn.dataset.id); return; }
    if (act === 'master') { toggleMaster(btn.dataset.id); return; }
    if (act === 'export') { doExport(); return; }
    if (act === 'import') { $('#import-file').click(); return; }
    if (act === 'reset') { doReset(); return; }
    if (act === 'clear-hl') { doClearHL(); return; }
  }

  var lastPracticeOpts = null;
  function startPractice(scope) {
    var opts;
    if (scope === 's1') opts = { mode: 'practice', label: '考科一練習', filterDesc: '淨零碳規劃管理基礎概論', filter: function (q) { return sidOf(q) === 's1'; } };
    else if (scope === 's2') opts = { mode: 'practice', label: '考科二練習', filterDesc: '溫室氣體盤查規範與程序概要', filter: function (q) { return sidOf(q) === 's2'; } };
    else if (scope === 'pe') opts = { mode: 'practice', label: '考古題練習', filter: function (q) { return q.source === 'past_exam'; } };
    else if (scope === 'gu') opts = { mode: 'practice', label: '單元題練習', filter: function (q) { return q.source === 'unit_practice'; } };
    else if (scope === 'au') opts = { mode: 'practice', label: '自編題練習', filter: function (q) { return q.source === 'authored'; } };
    else if (scope === 'wrong') opts = { mode: 'wrong', label: '只練錯題', filter: function (q) { var st = S.getState(q.id); return st.lapses > 0 && !st.mastered; } };
    else return;
    lastPracticeOpts = opts;
    var round = buildRound(opts);
    if (!round.ids.length) { toast('此範圍目前沒有可出的題目'); return; }
    go('#/quiz');
  }
  function startUnitQuiz(uid) {
    var u = UNIT_BY_ID[uid]; if (!u) return;
    var opts = { mode: 'practice', label: '單元小測', filterDesc: u.title.replace(/^單元\s*/, ''), filter: unitFilter(u) };
    lastPracticeOpts = opts;
    var round = buildRound(opts);
    if (!round.ids.length) { toast('本單元暫無可用題目'); return; }
    go('#/quiz');
  }
  function toggleRead(uid) {
    var p = S.load(); p.learningRead[uid] = !p.learningRead[uid]; S.save();
    toast(p.learningRead[uid] ? '已標記為已讀' : '已取消已讀'); render();
  }
  function toggleMaster(id) {
    var st = S.getState(id); st.mastered = !st.mastered; S.save();
    toast(st.mastered ? '已標記為掌握' : '已取消掌握'); render();
  }
  function doExport() {
    var blob = new Blob([S.exportJSON()], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'nzexam-progress-' + S.todayStr() + '.json'; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast('已匯出進度');
  }
  function doClearHL() {
    var p = S.load(); var n = 0; for (var k in (p.highlights || {})) n += (p.highlights[k] || []).length;
    if (!n) { toast('目前沒有螢光標記'); return; }
    if (!confirm('確定清除全部 ' + n + ' 處螢光標記嗎？此動作無法復原。')) return;
    p.highlights = {}; S.save(); toast('已清除螢光標記'); render();
  }
  function doReset() {
    if (!confirm('確定要重設所有進度嗎？此動作無法復原。')) return;
    if (!confirm('再次確認：所有作答、SRS 記憶狀態與已讀紀錄都會清除。')) return;
    S.reset(); toast('已重設'); go('#/');
  }
  function bindImportOnce() {
    document.addEventListener('change', function (e) {
      if (e.target && e.target.id === 'import-file' && e.target.files[0]) {
        var fr = new FileReader();
        fr.onload = function () {
          try { S.importJSON(fr.result); toast('匯入成功'); render(); }
          catch (err) { alert('匯入失敗：' + err.message); }
        };
        fr.readAsText(e.target.files[0]);
      }
    });
  }

  // ================= 啟動 =================
  function init() {
    if (!window.QUESTION_BANK) { $('#app-main').innerHTML = '<div class="empty">題庫載入失敗</div>'; return; }
    applyTheme();
    bindImportOnce();
    $('#app-main').addEventListener('click', onAction); // 委派點擊（只綁一次）
    window.addEventListener('hashchange', render);
    $('#home-btn').addEventListener('click', function () { go('#/'); });
    $all('nav.tabbar button').forEach(function (b) {
      b.addEventListener('click', function () { go('#/' + (b.dataset.tab === 'home' ? '' : b.dataset.tab)); });
    });
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
