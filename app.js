(function () {
  'use strict';

  var EMOJI = {
    'ごはん': '🍜', '小籠包': '🥟', 'タピオカ・ドリンク': '🧋', '観光': '🏯',
    'カフェ': '☕', '夜市': '🏮', 'その他': '📍',
    'スイーツ': '🍰', 'ドリンク': '🧋', 'お土産・買い物': '🛍️', 'デート': '💕'
  };
  var CAT_ORDER = ['ごはん', 'スイーツ', 'ドリンク', 'カフェ', '観光', 'お土産・買い物', '夜市', 'デート', 'その他'];
  var GROUP_ORDER = ['台北のエリア', '台北近郊', '夜市', '地方'];
  var DEV = /[?&]dev=1/.test(location.search);
  var BASE = DEV ? '_dev/' : 'data/';
  var AREAS = {
    '台北': { c: [25.04, 121.54], z: 12 },
    '九份': { c: [25.1095, 121.845], z: 15 }
  };
  var TAIWAN = { c: [23.7, 121.0], z: 7 };

  var $ = function (id) { return document.getElementById(id); };
  var state = { all: [], cat: 'すべて', kind: 'すべて', q: '', area: 'すべて', min: 0, view: 'list', metro: true };
  var map = null, layer = null, markers = {};
  var metroRenderer = null, metroData = null, spots = [], metroGroup = null, metroLayers = [];
  var spotStories = {}, guideData = null;
  var METRO_MINZ = 11;

  function emoji(cat) { return EMOJI[cat] || '📍'; }
  function iconOf(p) { return p.icon || emoji(p.category); }
  function norm(t) { return String(t == null ? '' : t).normalize('NFKC').toLowerCase(); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function starStr(n) {
    n = Math.max(0, Math.min(5, Math.round(+n || 0)));
    return '★'.repeat(n) + '☆'.repeat(5 - n);
  }
  function starCls(n) { return 's' + Math.max(0, Math.min(5, Math.round(+n || 0))); }
  function safeUrl(p) {
    if (p.gmaps_url && /^https?:\/\//i.test(p.gmaps_url)) return p.gmaps_url;
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.lat + ',' + p.lng);
  }

  // ---------- データ読み込み ----------
  function fetchJson(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.json();
    });
  }
  function load() {
    return fetchJson(BASE + 'places.json').catch(function () {
      return fetchJson('data/places.sample.json').then(function (d) { d._sample = true; return d; });
    });
  }
  function loadExtra() {
    var a = fetchJson(BASE + 'metro.geojson').then(function (d) {
      if (d && Array.isArray(d.features)) metroData = d;
    }).catch(function () {});
    var b = fetchJson(BASE + 'spots.json').then(function (d) {
      if (Array.isArray(d)) spots = d.filter(function (x) {
        return x && x.name && typeof x.lat === 'number' && typeof x.lng === 'number';
      });
    }).catch(function () {});
    var c = fetchJson(BASE + 'spot_stories.json').then(function (d) {
      if (d && typeof d === 'object' && !Array.isArray(d)) spotStories = d;
    }).catch(function () {});
    var g = fetchJson(BASE + 'guide.json').then(function (d) {
      if (d && Array.isArray(d.sections) && d.sections.length) guideData = d;
    }).catch(function () {});
    return Promise.all([a, b, c, g]);
  }
  function normalize(arr) {
    if (!Array.isArray(arr)) throw new Error('not array');
    return arr.filter(function (p) {
      return p && typeof p.lat === 'number' && typeof p.lng === 'number' && p.name;
    });
  }

  // ---------- フィルタ ----------
  function matchQ(p) {
    var q = norm(state.q).trim();
    if (!q) return true;
    var hay = norm([p.name, p.name_zh, p.kind, p.district, p.comment, p.story].join('\n'));
    return q.split(/\s+/).every(function (w) { return hay.indexOf(w) >= 0; });
  }
  function filtered() {
    return state.all.filter(function (p) {
      return (state.cat === 'すべて' || p.category === state.cat) &&
        (state.kind === 'すべて' || p.kind === state.kind) &&
        matchQ(p) &&
        (state.area === 'すべて' || p.area === state.area) &&
        (+p.stars || 0) >= state.min;
    }).sort(function (a, b) {
      return (+b.stars || 0) - (+a.stars || 0) ||
        (a.stars_provisional ? 1 : 0) - (b.stars_provisional ? 1 : 0);
    });
  }

  function uniq(key) {
    var s = [];
    state.all.forEach(function (p) { if (p[key] && s.indexOf(p[key]) < 0) s.push(p[key]); });
    return s;
  }

  function buildFilters() {
    var chips = $('chips-cat');
    chips.textContent = '';
    var cats = uniq('category');
    cats.sort(function (a, b) {
      var i = CAT_ORDER.indexOf(a), j = CAT_ORDER.indexOf(b);
      return (i < 0 ? 99 : i) - (j < 0 ? 99 : j);
    });
    ['すべて'].concat(cats).forEach(function (c) {
      var b = el('button', 'chip' + (c === state.cat ? ' on' : ''), (c === 'すべて' ? '' : emoji(c) + ' ') + c);
      b.onclick = function () { state.cat = c; state.kind = 'すべて'; buildFilters(); render(); };
      chips.appendChild(b);
    });
    var kc = $('chips-kind');
    kc.textContent = '';
    var kinds = [];
    if (state.cat !== 'すべて') {
      state.all.forEach(function (p) {
        if (p.category === state.cat && p.kind && kinds.indexOf(p.kind) < 0) kinds.push(p.kind);
      });
    }
    kc.hidden = kinds.length < 1;
    if (kinds.length) {
      ['すべて'].concat(kinds).forEach(function (k) {
        var b = el('button', 'chip sub' + (k === state.kind ? ' on' : ''), k);
        b.onclick = function () { state.kind = k; buildFilters(); render(); };
        kc.appendChild(b);
      });
    }
    var sel = $('sel-area');
    sel.textContent = '';
    ['すべて'].concat(uniq('area')).forEach(function (a) {
      var o = el('option', null, a === 'すべて' ? 'エリア: すべて' : a);
      o.value = a;
      if (a === state.area) o.selected = true;
      sel.appendChild(o);
    });
  }

  // ---------- カード ----------
  function cardBody(p, withMapBtn) {
    var body = el('div', 'body');
    body.appendChild(el('p', 'name', p.name));
    if (p.name_zh) body.appendChild(el('div', 'zh', p.name_zh));
    var meta = el('div', 'meta');
    var st = el('span', 'stars ' + starCls(p.stars), starStr(p.stars));
    meta.appendChild(st);
    if (p.stars_provisional) meta.appendChild(el('span', 'tag prov', '仮'));
    meta.appendChild(document.createTextNode(' '));
    if (p.category) meta.appendChild(el('span', 'tag', p.category));
    if (p.fav) meta.appendChild(el('span', 'tag fav', '♥ ムイのお気に入り'));
    if (p.classic) meta.appendChild(el('span', 'tag classic', '定番'));
    if (p.kind) meta.appendChild(el('span', 'tag kind', p.kind));
    if (p.area) meta.appendChild(el('span', 'tag', p.area + (p.district ? '・' + p.district : '')));
    if (p.visited) meta.appendChild(el('span', 'tag visited', '行った'));
    body.appendChild(meta);
    var note = p.comment || p.memo;
    if (note) body.appendChild(el('div', 'memo', note));
    if (p.story) {
      var sb = el('div', 'story');
      sb.appendChild(el('b', null, '🧋 ムイの思い出'));
      sb.appendChild(document.createTextNode(String(p.story)));
      body.appendChild(sb);
    }
    var act = el('div', 'actions');
    var a = el('a', 'btn main', 'Google Maps で開く');
    a.href = safeUrl(p);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    act.appendChild(a);
    if (withMapBtn) {
      var b = el('button', 'btn', '地図で見る');
      b.onclick = function () { showMap(); focusPlace(p); };
      act.appendChild(b);
    }
    body.appendChild(act);
    return body;
  }

  function renderList(items) {
    var ul = $('list');
    ul.textContent = '';
    items.forEach(function (p) {
      var li = el('li', 'card');
      li.appendChild(el('div', 'emo', iconOf(p)));
      li.appendChild(cardBody(p, true));
      ul.appendChild(li);
    });
  }

  // ---------- 地図 ----------
  function pinIcon(p) {
    var s = Math.max(1, Math.min(5, Math.round(+p.stars || 1)));
    var size = { 5: 42, 4: 34, 3: 28, 2: 21, 1: 21 }[s];
    return L.divIcon({
      className: '',
      html: '<div class="pin-w" style="font-size:' + (size * 0.55) + 'px"><div class="pin s' + s + (p.stars_provisional ? ' prov' : '') +
        '">' + iconOf(p).replace(/[<>&]/g, '') + '</div>' +
        (p.fav ? '<span class="pin-heart">♥</span>' : '') + '</div>',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2]
    });
  }
  function initMap() {
    if (map || typeof L === 'undefined') return;
    map = L.map('map', { zoomControl: true }).setView(TAIWAN.c, TAIWAN.z);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    map.createPane('metro').style.zIndex = 450; // 店のピン(600)より下
    metroRenderer = L.svg({ pane: 'metro' });
    // ピンが重なる所はまとめる（markercluster が読めなければ普通のレイヤー）
    layer = (L.markerClusterGroup ? L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 45, spiderfyOnMaxZoom: true }) : L.layerGroup()).addTo(map);
    // 寄れるボタン
    var ctl = L.control({ position: 'topright' });
    ctl.onAdd = function () {
      var d = L.DomUtil.create('div', 'leaflet-bar');
      var mt = L.DomUtil.create('a', 'metro-toggle' + (state.metro ? ' on' : ''), d);
      mt.href = '#'; mt.textContent = '🚇 メトロ';
      mt.style.cssText = 'width:auto;padding:0 10px;font-size:13px;line-height:34px;height:34px;';
      L.DomEvent.on(mt, 'click', function (e) {
        L.DomEvent.preventDefault(e);
        state.metro = !state.metro;
        mt.classList.toggle('on', state.metro);
        applyMetro();
      });
      [['台湾', TAIWAN], ['台北', AREAS['台北']], ['九份', AREAS['九份']]].forEach(function (x) {
        var a = L.DomUtil.create('a', '', d);
        a.href = '#'; a.textContent = x[0];
        a.style.cssText = 'width:auto;padding:0 10px;font-size:13px;line-height:34px;height:34px;';
        L.DomEvent.on(a, 'click', function (e) {
          L.DomEvent.preventDefault(e);
          map.setView(x[1].c, x[1].z);
        });
      });
      L.DomEvent.disableClickPropagation(d);
      return d;
    };
    ctl.addTo(map);
    map.on('click', closeSheet);
    map.on('zoomend', function () { applyMetro(); });
    buildMetro();
  }

  // ---------- 台北メトロ ----------
  function lineNames(codes) {
    var names = [];
    ((metroData && metroData.features) || []).forEach(function (f) {
      var pr = f.properties || {};
      if (pr.type === 'line' && !pr.branch && codes.indexOf(pr.code) >= 0 && names.indexOf(pr.line) < 0) names.push(pr.line);
    });
    return names;
  }
  function buildMetro() {
    if (!map || !metroData || metroGroup) return;
    var feats = metroData.features.filter(function (f) { return f && f.geometry && f.properties; });
    var lines = feats.filter(function (f) { return f.properties.type === 'line'; });
    var sts = feats.filter(function (f) { return f.properties.type === 'station' && f.geometry.type === 'Point'; });
    metroGroup = L.layerGroup();
    L.geoJSON(lines, { pane: 'metro', renderer: metroRenderer, interactive: false,
      style: function () { return { color: '#fff', weight: 9, opacity: .95, lineCap: 'round', lineJoin: 'round' }; } }).addTo(metroGroup);
    L.geoJSON(lines, { pane: 'metro', renderer: metroRenderer, interactive: false,
      style: function (f) { return { color: f.properties.color || '#888', weight: 5, opacity: 1, lineCap: 'round', lineJoin: 'round' }; } }).addTo(metroGroup);
    metroLayers = [];
    sts.forEach(function (f) {
      var pr = f.properties, c = f.geometry.coordinates;
      var lc = lineColor(pr.lines && pr.lines[0]);
      var big = !!pr.transfer;
      var m = L.circleMarker([c[1], c[0]], { pane: 'metro', renderer: metroRenderer,
        radius: big ? 8 : 5, weight: big ? 4 : 3, color: lc, fillColor: '#fff', fillOpacity: 1 });
      var box = el('div', 'st-pop');
      box.appendChild(el('b', null, pr.name_ja || pr.name_zh || ''));
      var ln = lineNames(pr.lines || []);
      if (ln.length) box.appendChild(el('div', 'st-lines', ln.join('・')));
      m.bindPopup(box, { closeButton: false, offset: [0, -4], className: 'st-popup' });
      if (pr.name_ja) m.bindTooltip(pr.name_ja, { permanent: true, direction: 'right', offset: [big ? 8 : 5, 0], className: 'st-label', interactive: false });
      metroLayers.push(m);
      m.addTo(metroGroup);
    });
    applyMetro();
  }
  function lineColor(code) {
    var col = '#888';
    ((metroData && metroData.features) || []).forEach(function (f) {
      var pr = f.properties || {};
      if (pr.type === 'line' && pr.code === code && pr.color && !pr.branch) col = pr.color;
    });
    return col;
  }
  function applyMetro() {
    if (!map || !metroGroup) return;
    var on = state.metro && map.getZoom() >= METRO_MINZ;
    if (on) { if (!map.hasLayer(metroGroup)) metroGroup.addTo(map); updateLabels(); }
    else if (map.hasLayer(metroGroup)) map.removeLayer(metroGroup);
  }
  function updateLabels() {
    if (!map || !state.metro || map.getZoom() < METRO_MINZ) return;
    var show = map.getZoom() >= 13;
    metroLayers.forEach(function (m) {
      if (show) m.openTooltip(); else m.closeTooltip();
    });
  }

  // ---------- ワープ ----------
  function openWarp() {
    var b = $('warp-body');
    b.textContent = '';
    var groups = {};
    spots.forEach(function (s) { (groups[s.group || 'その他'] = groups[s.group || 'その他'] || []).push(s); });
    var keys = GROUP_ORDER.filter(function (g) { return groups[g]; });
    Object.keys(groups).forEach(function (g) { if (keys.indexOf(g) < 0) keys.push(g); });
    keys.forEach(function (g) {
      b.appendChild(el('div', 'warp-g', g));
      var row = el('div', 'warp-row');
      groups[g].forEach(function (s) {
        var btn = el('button', 'chip warp-chip', s.name);
        if (s.name_zh && s.name_zh !== s.name) btn.title = s.name_zh;
        btn.onclick = function () { warpTo(s); };
        row.appendChild(btn);
      });
      b.appendChild(row);
    });
    if (!keys.length) b.appendChild(el('div', 'zh', 'ワープ先がまだありません。'));
    $('warp').hidden = false; $('warp-back').hidden = false;
  }
  function closeWarp() { $('warp').hidden = true; $('warp-back').hidden = true; }
  function warpTo(s) {
    closeWarp();
    if (state.view !== 'map') showMap(true);
    if (!map) return;
    closeSheet();
    map.stop();
    map.flyTo([s.lat, s.lng], +s.zoom || 15, { duration: 1.2 });
    showSpotStory(s);
  }
  // ---------- 土地の思い出 ----------
  function showSpotStory(s) {
    var arr = s && spotStories[s.name];
    if (!Array.isArray(arr) || !arr.length) { closeSpotStory(); return; }
    var b = $('spot-story-body');
    b.textContent = '';
    b.appendChild(el('h3', null, '🧋 ムイの思い出 — ' + s.name));
    arr.forEach(function (t) { b.appendChild(el('p', null, String(t))); });
    $('spot-story').hidden = false;
  }
  function closeSpotStory() { $('spot-story').hidden = true; }
  function renderMarkers(items) {
    if (!map) return;
    layer.clearLayers();
    markers = {};
    items.forEach(function (p) {
      var m = L.marker([p.lat, p.lng], { icon: pinIcon(p), title: p.name, zIndexOffset: (+p.stars || 0) * 100 });
      m.on('click', function () { openSheet(p); });
      m.addTo(layer);
      markers[p.id] = m;
    });
  }
  function fitItems(items) {
    if (!map || !items.length) return;
    if (items.length === 1) { map.setView([items[0].lat, items[0].lng], 15); return; }
    map.fitBounds(L.latLngBounds(items.map(function (p) { return [p.lat, p.lng]; })), { padding: [40, 40], maxZoom: 15 });
  }
  function focusPlace(p) {
    if (!map) return;
    map.setView([p.lat, p.lng], 16);
    openSheet(p);
  }

  // ---------- 下から出るカード ----------
  function openSheet(p) {
    var b = $('sheet-body');
    b.textContent = '';
    var wrap = el('div', 'card');
    wrap.style.cssText = 'box-shadow:none;padding:0;margin:0 30px 0 0';
    wrap.appendChild(el('div', 'emo', iconOf(p)));
    wrap.appendChild(cardBody(p, false));
    b.appendChild(wrap);
    $('sheet').hidden = false;
  }
  function closeSheet() { $('sheet').hidden = true; }

  // ---------- 表示切替 ----------
  function setTab(v) {
    state.view = v;
    ['list', 'map', 'guide'].forEach(function (k) {
      var on = k === v;
      $(k).hidden = !on;
      $('btn-' + k).classList.toggle('on', on);
      $('btn-' + k).setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('filters').hidden = v === 'guide';
    if (v === 'guide') hideState();
    if (v !== 'map') closeSpotStory();
  }
  function showList() {
    setTab('list');
    closeSheet();
    render();
  }
  function showMap(noFit) {
    setTab('map');
    if (typeof L === 'undefined') {
      showState('🗺️', '地図ライブラリを読み込めませんでした。ネット接続を確認してください。', '一覧に戻る', showList);
      return;
    }
    initMap();
    map.invalidateSize();
    render(noFit === true ? false : true);
  }
  function showGuide() {
    if (!guideData) return;
    setTab('guide');
    closeSheet();
    renderGuide();
  }

  // ---------- ガイド ----------
  var GKEY = 'muimui-guide-done';
  function loadDone() {
    try { return JSON.parse(localStorage.getItem(GKEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function saveDone(d) { try { localStorage.setItem(GKEY, JSON.stringify(d)); } catch (e) {} }
  function renderGuide() {
    var g = $('guide');
    var open = {};
    [].forEach.call(g.querySelectorAll('details'), function (d) { open[d.dataset.id] = d.open; });
    g.textContent = '';
    if (!guideData) return;
    var done = loadDone();
    if (guideData.updated) g.appendChild(el('p', 'g-updated', '最終確認: ' + guideData.updated));
    guideData.sections.forEach(function (sec, si) {
      var id = String(sec.id || si);
      var det = el('details', 'g-sec');
      det.dataset.id = id;
      if (open[id]) det.open = true;
      var sum = el('summary');
      sum.appendChild(document.createTextNode((sec.icon ? sec.icon + ' ' : '') + (sec.title || '')));
      var prog = el('span', 'g-prog');
      sum.appendChild(prog);
      det.appendChild(sum);
      var body = el('div', 'g-body');
      if (sec.intro) body.appendChild(el('p', 'g-intro', sec.intro));
      var items = Array.isArray(sec.items) ? sec.items : [];
      var boxes = [];
      function upd() {
        var n = boxes.filter(function (x) { return x.checked; }).length;
        prog.textContent = items.length ? n + '/' + items.length : '';
      }
      items.forEach(function (it) {
        var key = id + '|' + it.text;
        var row = el('label', 'g-item' + (done[key] ? ' done' : ''));
        var cb = el('input');
        cb.type = 'checkbox';
        cb.checked = !!done[key];
        cb.onchange = function () {
          var d = loadDone();
          if (cb.checked) d[key] = 1; else delete d[key];
          saveDone(d);
          row.classList.toggle('done', cb.checked);
          upd();
        };
        boxes.push(cb);
        row.appendChild(cb);
        var tx = el('div');
        tx.appendChild(el('div', 'g-text', it.text || ''));
        if (it.detail) tx.appendChild(el('div', 'g-detail', it.detail));
        if (Array.isArray(it.tags) && it.tags.length) {
          var tg = el('div', 'g-tags');
          it.tags.forEach(function (t) { tg.appendChild(el('span', 'tag', t)); });
          tx.appendChild(tg);
        }
        if (it.source && /^https?:\/\//i.test(it.source)) {
          var sr = el('div', 'g-src');
          var a = el('a', null, '出典: ' + (it.source_title || it.source));
          a.href = it.source; a.target = '_blank'; a.rel = 'noopener noreferrer';
          a.onclick = function (e) { e.stopPropagation(); };
          sr.appendChild(a);
          tx.appendChild(sr);
        }
        row.appendChild(tx);
        body.appendChild(row);
      });
      upd();
      det.appendChild(body);
      g.appendChild(det);
    });
  }

  // ---------- 状態表示 ----------
  function showState(icon, msg, btnText, btnFn) {
    var s = $('state');
    s.textContent = '';
    s.appendChild(el('div', 'big', icon));
    s.appendChild(el('div', null, msg));
    if (btnText) {
      var b = el('button', 'btn main', btnText);
      b.onclick = btnFn;
      s.appendChild(b);
    }
    s.hidden = false;
  }
  function hideState() { $('state').hidden = true; }

  function render(fit) {
    var items = filtered();
    $('count').textContent = items.length + ' 件';
    hideState();
    if (!state.all.length) return;
    if (!items.length) {
      showState('🔍', '条件に合う場所がありません。', '絞り込みを解除', function () {
        state.cat = 'すべて'; state.kind = 'すべて'; state.q = ''; $('q').value = ''; state.area = 'すべて'; state.min = 0;
        $('sel-stars').value = '0';
        buildFilters(); render();
      });
    }
    renderList(items);
    if (state.view === 'map' && map) {
      renderMarkers(items);
      if (fit !== false) {
        if (state.area !== 'すべて' && AREAS[state.area]) map.setView(AREAS[state.area].c, AREAS[state.area].z);
        else fitItems(items);
      }
    }
  }

  // ---------- 起動 ----------
  // 共有用リンク: #at=西門町（ワープ先の名前）か #at=25.04,121.51,16（緯度,経度,ズーム）で、地図をその場所で開く
  function openFromHash() {
    if (location.hash === '#guide') { showGuide(); return; }
    var m = /^#at=(.+)$/.exec(location.hash || '');
    if (!m) return;
    var v = decodeURIComponent(m[1]);
    var ll = /^(-?[\d.]+),(-?[\d.]+)(?:,(\d+))?$/.exec(v);
    var s = ll ? { lat: +ll[1], lng: +ll[2], zoom: +(ll[3] || 16) }
      : spots.filter(function (x) { return x.name === v || x.name_zh === v; })[0]
        || spots.filter(function (x) { return (x.name || '').indexOf(v) >= 0; })[0];
    if (!s) return;
    if (state.view !== 'map') showMap(true);
    if (map) { closeSheet(); map.setView([s.lat, s.lng], +s.zoom || 15); }
    if (s.name) showSpotStory(s);
  }
  window.addEventListener('hashchange', openFromHash);

  function init() {
    $('btn-list').onclick = showList;
    $('btn-map').onclick = showMap;
    $('btn-guide').onclick = showGuide;
    $('spot-story-close').onclick = closeSpotStory;
    $('sheet-close').onclick = closeSheet;
    $('btn-warp').onclick = openWarp;
    $('warp-close').onclick = closeWarp;
    $('warp-back').onclick = closeWarp;
    $('q').oninput = function () { state.q = this.value; render(); };
    $('sel-area').onchange = function () { state.area = this.value; render(); };
    $('sel-stars').onchange = function () { state.min = +this.value; render(); };

    showState('⏳', '読み込み中…');
    var extraReady = loadExtra().then(function () {
      $('btn-warp').hidden = !spots.length;
      $('btn-guide').hidden = !guideData;
      buildMetro();
    });
    load().then(function (d) {
      var sample = d._sample;
      state.all = normalize(d);
      hideState();
      if (!state.all.length) {
        $('count').textContent = '0 件';
        $('list').textContent = '';
        showState('🧋', 'まだ登録された場所がありません。');
        return;
      }
      buildFilters();
      render();
      extraReady.then(openFromHash);
      if (sample) {
        var n = el('div', 'meta', '※ サンプルデータ表示中（data/places.json が無いため）');
        n.style.cssText = 'padding:6px 12px;background:#fff0c2';
        document.querySelector('.filters').appendChild(n);
      }
    }).catch(function () {
      $('list').textContent = '';
      showState('😢', 'データを読み込めませんでした。', '再読み込み', function () { location.reload(); });
    });
  }
  init();
})();
