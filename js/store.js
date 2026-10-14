/* ===== store.js — 進度儲存 + SRS 引擎（§4.4、§7.4） ===== */
(function (global) {
  'use strict';

  var STORE_KEY = 'nzexam.progress.v1';
  var SCHEMA = 1;

  // ---------- 日期工具（以裝置本地日期為準，§4.2.1） ----------
  function pad(n){ return (n<10?'0':'')+n; }
  function todayStr(d){ d = d || new Date(); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function addDaysStr(dateStr, days){
    var p = dateStr.split('-'); var dt = new Date(+p[0], +p[1]-1, +p[2]);
    dt.setDate(dt.getDate() + Math.round(days));
    return todayStr(dt);
  }
  function daysBetween(a, b){ // b - a，以天為單位（整數）
    var pa=a.split('-'), pb=b.split('-');
    var da=Date.UTC(+pa[0],+pa[1]-1,+pa[2]), db=Date.UTC(+pb[0],+pb[1]-1,+pb[2]);
    return Math.round((db-da)/86400000);
  }

  // ---------- 預設進度 ----------
  function defaultProgress(){
    return {
      schemaVersion: SCHEMA,
      questionState: {},   // id -> SRSState
      dailyLog: {},        // 'YYYY-MM-DD' -> {servedIds:[], rounds, correct, total}
      currentRound: null,  // 進行中的回合，供續作
      learningRead: {},    // unitId -> true
      highlights: {},      // unitId -> [{key,start,end,color}]（學習區螢光標記）
      flags: {},           // qid -> {unfamiliar:bool, important:bool}（手動標記清單）
      settings: { roundSize:10, shuffleOptions:true, theme:'auto' },
      createdAt: new Date().toISOString()
    };
  }
  function defaultSRS(){
    return { ease:2.5, intervalDays:0, dueDate:null, reps:0, lapses:0,
             lastResult:null, lastSeen:null, seenCount:0, mastered:false };
  }

  // ---------- 讀寫 ----------
  var _cache = null;
  function load(){
    if (_cache) return _cache;
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw){ _cache = JSON.parse(raw); }
    } catch(e){ console.warn('progress load failed', e); }
    if (!_cache || typeof _cache !== 'object'){ _cache = defaultProgress(); }
    // 補齊缺欄位（向前相容）
    var d = defaultProgress();
    for (var k in d){ if (!(k in _cache)) _cache[k] = d[k]; }
    for (var sk in d.settings){ if (!(sk in _cache.settings)) _cache.settings[sk] = d.settings[sk]; }
    return _cache;
  }
  function save(){
    try { localStorage.setItem(STORE_KEY, JSON.stringify(_cache)); }
    catch(e){ console.warn('progress save failed', e); }
  }
  function reset(){
    try { localStorage.removeItem(STORE_KEY); } catch(e){}
    _cache = defaultProgress(); save(); return _cache;
  }
  function exportJSON(){ return JSON.stringify(load(), null, 2); }
  function importJSON(text){
    var obj = JSON.parse(text);
    if (!obj || typeof obj !== 'object' || !('questionState' in obj))
      throw new Error('檔案格式不正確');
    _cache = obj; save(); return _cache;
  }

  function getState(id){
    var p = load();
    if (!p.questionState[id]) p.questionState[id] = defaultSRS();
    return p.questionState[id];
  }

  // ---------- 手動標記清單（不熟悉 / 重要） ----------
  function getFlags(id){ var p = load(); return p.flags[id] || { unfamiliar:false, important:false }; }
  function isFlagged(id, which){ var f = load().flags[id]; return !!(f && f[which]); }
  function toggleFlag(id, which){
    var p = load();
    var f = p.flags[id] || { unfamiliar:false, important:false };
    f[which] = !f[which];
    if (!f.unfamiliar && !f.important) delete p.flags[id];
    else p.flags[id] = f;
    save();
    return !!f[which];
  }

  // ---------- SRS 作答後更新（§4.4.2） ----------
  function applyAnswer(id, correct){
    var p = load();
    var st = getState(id);
    var today = todayStr();
    st.seenCount += 1;
    st.lastSeen = new Date().toISOString();
    if (correct){
      st.reps += 1;
      st.ease = Math.min(2.7, st.ease + 0.1);
      if (st.reps === 1) st.intervalDays = 1;
      else if (st.reps === 2) st.intervalDays = 3;
      else st.intervalDays = Math.round((st.intervalDays || 1) * st.ease);
      st.dueDate = addDaysStr(today, st.intervalDays);
      st.lastResult = 'correct';
    } else {
      st.lapses += 1;
      st.reps = 0;
      st.ease = Math.max(1.3, st.ease - 0.2);
      st.intervalDays = 0;      // 立即列入可再現
      st.dueDate = today;       // 今天到期（§4.4.2）
      st.lastResult = 'wrong';
    }
    save();
    return st;
  }

  // ---------- 每日紀錄 ----------
  function dayLog(dateStr){
    var p = load(); dateStr = dateStr || todayStr();
    if (!p.dailyLog[dateStr]) p.dailyLog[dateStr] = { servedIds:[], rounds:0, correct:0, total:0 };
    return p.dailyLog[dateStr];
  }
  function markServed(ids, dateStr){
    var log = dayLog(dateStr);
    ids.forEach(function(id){ if (log.servedIds.indexOf(id) < 0) log.servedIds.push(id); });
    save();
  }

  // ---------- 選題演算法（§4.4.3） ----------
  // opts: { size, mode:'daily'|'wrong'|'filter', filter:fn(q), servedToday:[] }
  function priorityOf(st, today){
    var seen = st.seenCount > 0;
    var due = seen && st.dueDate && st.dueDate <= today;
    var score;
    if (due){
      score = 100;
      if (st.lapses > 0) score += 40;
      var overdue = daysBetween(st.dueDate, today);      // today - due
      score += Math.max(0, overdue) * 2;
    } else if (!seen){
      score = 60;                                        // 全新未見題，確保新題持續進入
    } else {
      score = 20;
      var toDue = st.dueDate ? daysBetween(today, st.dueDate) : 30;
      score += Math.max(0, 10 - toDue);                  // 越接近到期分數越高
    }
    if (st.mastered) score *= 0.3;
    return { score: score, seen: seen, due: due };
  }

  function weightedDraw(cands, n, exclude, out){
    var pool = cands.filter(function(c){ return !exclude[c.id]; });
    var got = 0;
    while (got < n && pool.length){
      var total = 0, i;
      for (i=0;i<pool.length;i++) total += Math.max(0.0001, pool[i].score);
      var r = Math.random() * total, idx = 0;
      for (i=0;i<pool.length;i++){ r -= Math.max(0.0001, pool[i].score); if (r <= 0){ idx = i; break; } }
      var c = pool.splice(idx,1)[0];
      exclude[c.id] = true; out.push(c.id); got++;
    }
    return got;
  }

  function pickRound(allQuestions, opts){
    opts = opts || {};
    var size = opts.size || load().settings.roundSize || 10;
    var today = todayStr();

    // 1) 建立候選池
    var served = {};
    (opts.servedToday || []).forEach(function(id){ served[id] = true; });
    var pool = allQuestions.filter(function(q){
      if (opts.filter && !opts.filter(q)) return false;
      if (opts.mode === 'daily' && served[q.id]) return false; // 當日不重複
      return true;
    });

    var scored = pool.map(function(q){
      var pr = priorityOf(getState(q.id), today);
      return { id:q.id, score:pr.score, seen:pr.seen, due:pr.due, lapses:getState(q.id).lapses };
    });

    var dueWrong  = scored.filter(function(s){ return s.due && s.lapses > 0; });
    var fresh     = scored.filter(function(s){ return !s.seen; });
    var dueReview = scored.filter(function(s){ return s.due && s.lapses === 0; });
    var rest      = scored.filter(function(s){ return !s.due && s.seen; });

    var chosen = [], ex = {};
    // 組卷配額（§4.4.3-3）：到期錯題 ≤6、全新 3~4、其餘由到期複習補足
    weightedDraw(dueWrong, Math.min(6, size), ex, chosen);
    var freshTarget = Math.min(4, size - chosen.length);
    weightedDraw(fresh, freshTarget, ex, chosen);
    weightedDraw(dueReview, size - chosen.length, ex, chosen);
    if (chosen.length < size) weightedDraw(rest, size - chosen.length, ex, chosen);
    // 全新題若配額用完仍有空位，允許再補新題
    if (chosen.length < size) weightedDraw(fresh, size - chosen.length, ex, chosen);

    // 邊界（§4.5）：當日可出題不足 → 允許重複「最該複習」之當日已出題
    if (chosen.length < size && opts.mode === 'daily'){
      var reScored = allQuestions
        .filter(function(q){ return (!opts.filter || opts.filter(q)) && !ex[q.id]; })
        .map(function(q){ var pr = priorityOf(getState(q.id), today);
                          return { id:q.id, score:pr.score }; });
      weightedDraw(reScored, size - chosen.length, ex, chosen);
    }
    return chosen;
  }

  // ---------- 選項顯示順序（§5.3 執行期洗牌） ----------
  function shuffleKeys(){
    var keys = ['A','B','C','D'];
    for (var i=keys.length-1;i>0;i--){ var j=Math.floor(Math.random()*(i+1)); var t=keys[i];keys[i]=keys[j];keys[j]=t; }
    return keys;
  }

  global.Store = {
    STORE_KEY: STORE_KEY,
    todayStr: todayStr, addDaysStr: addDaysStr, daysBetween: daysBetween,
    load: load, save: save, reset: reset,
    exportJSON: exportJSON, importJSON: importJSON,
    getState: getState, defaultSRS: defaultSRS,
    getFlags: getFlags, isFlagged: isFlagged, toggleFlag: toggleFlag,
    applyAnswer: applyAnswer,
    dayLog: dayLog, markServed: markServed,
    pickRound: pickRound, priorityOf: priorityOf, shuffleKeys: shuffleKeys
  };
})(window);
