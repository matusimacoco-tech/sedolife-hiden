/* 仕入れ秘伝の書 — 教科書と問題集のWeb教材
 * データは data/ 以下のJSON（meta.json に読み込むファイルを列挙）。
 * 画面はハッシュ（#/...）で切り替える。採点はAPIを使わず、正解・許容回答と照合する。
 * キャラクター画像は data/characters.json、練習用画像は data/images.json で差し替える。
 */
(function () {
  "use strict";

  var FEE_RATE = 0.1; // メルカリ販売手数料（2026-10-28確認）。validate.py と合わせる
  var app = document.getElementById("app");
  var DB = { meta: null, parts: [], sections: {}, order: [], questions: [], qById: {}, sources: {}, chara: {}, images: {}, work: null };
  var session = null; // 解答中の問題セッション（教科書を見に行っても保持する）

  var BOX_LABEL = {
    fact: "確認した事実",
    own: "まっちゃんの資料より",
    proposal: "練習用の目安（仮）",
    warn: "注意",
    skip: "調べる前に見送るサイン",
    example: "練習用の例",
    check: "チェックリスト",
    ask: "分からないときに確かめること",
    tip: "ひとことメモ"
  };
  var BOX_ICON = { fact: "✓", own: "★", proposal: "仮", warn: "!", skip: "×", example: "例", check: "☑", ask: "?", tip: "＊" };
  var STAGES = [
    { n: 1, label: "見つける", sub: "素材・形・色・状態・付属品を見る" },
    { n: 2, label: "調べる", sub: "同じような商品が、いくらで売れているか" },
    { n: 3, label: "判断する", sub: "費用を引いて、利益が残るか" }
  ];

  // ---------- ユーティリティ ----------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  // **太字**、==マーカー==、[[項目ID|ラベル]] を変換（先にエスケープする）
  function inline(s) {
    return esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/==(.+?)==/g, "<mark>$1</mark>")
      .replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, function (_, id, label) {
        var sec = DB.sections[id];
        var text = label || (sec ? sec.title : id);
        return '<a href="#/book/' + esc(id) + '">' + text + "</a>";
      });
  }
  function yen(n) { return n.toLocaleString("ja-JP") + "円"; }
  function store(key, val) {
    try {
      if (val === undefined) return JSON.parse(localStorage.getItem(key) || "null");
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { return null; }
  }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function genre(id) {
    return DB.meta.genres.filter(function (x) { return x.id === id; })[0] || { id: "all", label: "全ジャンル", icon: "kiso" };
  }
  function questionsFor(sectionId) {
    return DB.questions.filter(function (q) { return q.sectionIds.indexOf(sectionId) >= 0; });
  }
  function readMap() { return store("hiden-read") || {}; }
  function solvedMap() { return store("hiden-solved") || {}; }

  // ---------- 採点の正規化（validate.py と同じ規則） ----------
  function normalizeText(s) {
    s = String(s).normalize("NFKC").toLowerCase();
    s = s.replace(/[ぁ-ゖ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) + 0x60); });
    return s.replace(/[\s・･\-‐－—()（）「」『』]/g, "");
  }
  function normalizeNumber(s) {
    s = String(s).normalize("NFKC").replace(/[\s,，、]/g, "").replace(/(円|点|%|パーセント|cm|センチ)$/, "");
    return /^\d+(\.\d+)?$/.test(s) ? s : null;
  }
  function gradeFill(q, input) {
    if (q.answerType === "number") {
      var n = normalizeNumber(input);
      return n !== null && q.accept.some(function (a) { return Number(normalizeNumber(a)) === Number(n); });
    }
    var t = normalizeText(input);
    return t !== "" && q.accept.some(function (a) { return normalizeText(a) === t; });
  }

  // ---------- イラスト（ジャンルの目印。キャラクターの代わりには使わない） ----------
  var ICONS = {
    kiso: '<path d="M14 12h22a6 6 0 0 1 6 6v26H20a6 6 0 0 1-6-6z"/><path d="M14 38a6 6 0 0 1 6-6h22"/><path d="M22 20h12M22 26h8"/>',
    bag: '<path d="M10 22h36l-4 24H14z"/><path d="M20 22v-4a8 8 0 0 1 16 0v4"/><path d="M24 30h8"/>',
    pumps: '<path d="M8 38c8 0 14-4 20-12l6 2c2 6 6 10 14 10v4H12c-3 0-4-2-4-4z"/><path d="M40 42v6"/>',
    down: '<path d="M18 10h20l8 8-4 6v22H14V24l-4-6z"/><path d="M14 22h28M14 30h28M14 38h28"/><path d="M28 10v36"/>',
    coat: '<path d="M20 8h16l8 8-2 32H14l-2-32z"/><path d="M28 8l-6 12 6 28 6-28z"/><circle cx="31" cy="28" r="1.4"/><circle cx="31" cy="36" r="1.4"/>',
    mil: '<path d="M18 12h20l8 8-2 22H12l-2-22z"/><path d="M12 42h32v4H12z"/><path d="M28 12v30"/><path d="M38 22l4 2"/>',
    leather: '<path d="M18 10h20l8 8-2 28H12l-2-28z"/><path d="M18 10l10 14 10-14"/><path d="M28 24l6 22"/><path d="M14 30h8"/>'
  };
  function icon(id, cls) {
    return '<svg class="gicon ' + (cls || "") + '" viewBox="0 0 56 56" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
      (ICONS[id] || ICONS.kiso) + "</svg>";
  }

  // ---------- キャラクター ----------
  // 画像が未登録（ready=false）または読み込めないときは、名前入りの仮の枠を出す
  function avatar(who, face) {
    var c = DB.chara[who] || { name: who };
    var src = c.ready && c.images ? (c.images[face] || c.images["default"]) : "";
    var ph = '<span class="avatar-ph" aria-hidden="true">' + esc((c.name || "?").slice(0, 1)) + "<small>仮</small></span>";
    if (!src) return '<span class="avatar ' + esc(who) + '" title="' + esc(c.name) + '（画像準備中）">' + ph + "</span>";
    return '<span class="avatar ' + esc(who) + '"><img src="' + esc(src) + '" alt="" onerror="this.replaceWith(this.nextElementSibling.content.cloneNode(true))"><template>' + ph + "</template></span>";
  }
  function pose(who, name, cls) {
    var c = DB.chara[who];
    var src = c && c.ready && c.poses ? c.poses[name] : "";
    return src ? '<img class="pose ' + (cls || "") + '" src="' + esc(src) + '" alt="' + esc(c.name) + '" loading="lazy">' : "";
  }
  function talk(lines) {
    return '<div class="talk">' + lines.map(function (l) {
      var c = DB.chara[l.who] || { name: l.who };
      return '<div class="say ' + esc(l.who) + '">' + avatar(l.who, l.face) +
        '<div class="bubble"><b class="who">' + esc(c.name) + "</b>" + inline(l.text) + "</div></div>";
    }).join("") + "</div>";
  }

  // ---------- 練習用画像 ----------
  // 教科書では、作成済み（ready）の画像だけを表示する（未作成の画像は出さない）。
  // 問題の画面（opts.quiz）では、答えを考えるのに画像が必要なので、未作成なら内容説明つきの仮枠を出す。
  // そのとき説明は答えになる言葉を含まない quizAlt を使い、見出し（caption）も出さない。
  function figure(id, opts) {
    var im = DB.images[id];
    opts = opts || {};
    if (!im) return "";
    var ready = im.status === "ready" && im.file;
    if (!ready && !opts.quiz) return "";
    var alt = opts.quiz ? (im.quizAlt || im.alt) : im.alt;
    var body = ready
      ? '<img src="' + esc(im.file) + '" alt="' + esc(alt) + '" loading="lazy">'
      : '<div class="fig-ph"><b>画像準備中</b><span>この場所には、次の内容のAI生成の練習用画像が入ります。</span><p>' + inline(alt) + "</p></div>";
    return '<figure class="fig' + (opts.small ? " small" : "") + '">' + body +
      "<figcaption>" + (im.caption && !opts.quiz ? inline(im.caption) + "<br>" : "") +
      '<span class="ai-note">AI生成の練習用画像（実際の仕入れ商品・販売実績の写真ではありません）</span></figcaption></figure>';
  }
  function figures(ids) {
    var html = ids.map(function (id) { return figure(id); }).join("");
    return html ? '<div class="figs">' + html + "</div>" : "";
  }

  // ---------- データ読み込み ----------
  function getJSON(path) {
    return fetch("data/" + path, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(path + " を読み込めません（" + r.status + "）");
      return r.json();
    });
  }
  function load() {
    return getJSON("meta.json").then(function (meta) {
      DB.meta = meta;
      return Promise.all([
        Promise.all(meta.bookFiles.map(getJSON)),
        Promise.all(meta.questionFiles.map(getJSON)),
        getJSON("sources.json"),
        getJSON("characters.json"),
        getJSON("images.json"),
        meta.workbookFile ? getJSON(meta.workbookFile) : null
      ]);
    }).then(function (res) {
      DB.parts = res[0].sort(function (a, b) { return a.part.order - b.part.order; });
      DB.parts.forEach(function (p) {
        p.chapters.forEach(function (ch) {
          ch.sections.forEach(function (sec) {
            sec.part = p.part; sec.chapter = ch;
            DB.sections[sec.id] = sec;
            DB.order.push(sec.id);
          });
        });
      });
      res[1].forEach(function (f) { DB.questions = DB.questions.concat(f.questions); });
      DB.questions.forEach(function (q) { DB.qById[q.id] = q; });
      res[2].sources.forEach(function (s) { DB.sources[s.id] = s; });
      DB.chara = res[3].characters;
      res[4].images.forEach(function (im) { DB.images[im.id] = im; });
      DB.work = res[5];
    });
  }

  // ---------- 画面：表紙 ----------
  function progressBar(done, total) {
    var pct = total ? Math.round((done / total) * 100) : 0;
    return '<div class="meter" role="img" aria-label="' + done + " / " + total + '"><span style="width:' + pct + '%"></span></div>';
  }
  function viewHome() {
    var m = DB.meta, read = readMap(), solved = solvedMap();
    var nRead = DB.order.filter(function (id) { return read[id]; }).length;
    var nSolved = DB.questions.filter(function (q) { return solved[q.id] === true; }).length;
    var started = nRead > 0 || Object.keys(solved).length > 0;
    var html =
      '<section class="hero">' +
        '<p class="series">' + esc(m.brand) + "の無料教材</p>" +
        "<h1>" + esc(m.bookTitle) + "</h1>" +
        '<p class="hero-lead">まっちゃんとかわのすけと楽しむ、<br>放課後のお宝探し。</p>' +
        '<p class="hero-sub">お店で「どこを見て、何を調べて、どう決めるか」。<br>二人と一緒に、仕入れのコツをひとつずつ覚えていこう。</p>' +
        '<div class="hero-poses">' + pose("matchan", "good") + pose("kawauso", "joy") + "</div>" +
        '<div class="profiles">' + profile("matchan") + profile("kawauso") + "</div>" +
        talk([
          { who: "kawauso", face: "think", text: "お店の商品、どれを見ればいいのか分からなくて…。" },
          { who: "matchan", text: "最初は「見る順番」を覚えるだけで大丈夫。==見つける → 調べる → 判断する==の3ステップで進めよう。" }
        ]) +
      "</section>";

    html += '<section class="first-steps"><h2>まずはここから</h2><ol class="step-cards">' +
      stepCard(1, "kiso-howto", "この本の使い方（1分）", "読む → 解く → 戻る の進め方") +
      stepCard(2, "kiso-3steps", "見つける・調べる・判断する", "お店で迷わないための3ステップ") +
      stepCard(3, "bag-material", "バッグ：本革か合皮かを見る", "最初の1項目を読んで、ドリルにチャレンジ！") +
      "</ol></section>";

    if (started) {
      html += '<section class="card progress-card"><h2>あなたの進み具合</h2>' +
        '<p>読んだ項目 <b>' + nRead + "</b> / " + DB.order.length + "</p>" + progressBar(nRead, DB.order.length) +
        '<p>ドリルで正解した問題 <b>' + nSolved + "</b> / " + DB.questions.length + "</p>" + progressBar(nSolved, DB.questions.length) +
        "</section>";
    }

    if (DB.work) {
      var wDone = workDoneCount();
      html += '<section><h2>自分の未来を書いてみる</h2><a class="work-card" href="#/work">' +
        '<span class="work-catch">' + esc(DB.work.catch) + "</span><b>" + esc(DB.work.title) + "</b>" +
        "<small>" + esc(DB.work.tagline) + "　全" + DB.work.works.length + "ワーク・書き込み式</small>" +
        (wDone ? '<span class="tile-meter">' + wDone + "/" + DB.work.works.length + " 書いた</span>" : "") + "</a></section>";
    }

    html += '<section><h2>ジャンルから選ぶ</h2><div class="genre-tiles">' +
      DB.parts.filter(function (p) { return p.part.id !== "furoku"; }).map(function (p) {
        var first = p.chapters[0].sections[0];
        var ids = []; p.chapters.forEach(function (ch) { ch.sections.forEach(function (s) { ids.push(s.id); }); });
        var r = ids.filter(function (id) { return read[id]; }).length;
        return '<a class="tile g-' + esc(p.part.id) + '" href="#/book/' + esc(first.id) + '">' + icon(p.part.icon || p.part.id) +
          "<b>" + esc(p.part.title) + "</b><small>" + esc(p.part.catch || "") + "</small>" +
          (r ? '<span class="tile-meter">' + r + "/" + ids.length + " 読んだ</span>" : "") + "</a>";
      }).join("") + "</div></section>";

    html += '<div class="entry">' +
      '<a class="btn primary big" href="#/book">目次を見る<small>' + DB.order.length + "項目</small></a>" +
      '<a class="btn accent big" href="#/quiz">ドリルにチャレンジ！<small>' + DB.questions.length + "問</small></a>" +
      "</div>" +
      '<section><h2>公式LINE</h2>' + lineBox(true) + "</section>" +
      '<p class="small muted center">最終更新：' + esc(m.updated) + "（v" + esc(m.version) + '）　<a href="#/updates">更新履歴</a></p>';
    return html;
  }
  // 公式LINEの入り口。スマホでは自分の画面のQRを読み取れないので、開くボタンも必ず並べる
  // withConsult：個別相談の入口も出す（ワークブックの最終ページは本文に案内があるので出さない）
  function lineBox(withConsult) {
    var L = DB.meta.line;
    if (!L) return "";
    return '<div class="line-box"><a class="btn line-btn" href="' + esc(L.url) + '" target="_blank" rel="noopener">公式LINEを開く</a>' +
      (withConsult ? '<a class="btn line-btn line-consult" href="' + esc(L.consultUrl) + '" target="_blank" rel="noopener">個別相談の日程を相談する<small>無料・Zoom</small></a>' +
        '<p class="small">公式LINEから「個別相談」と送ってください。</p>' +
        '<p class="small muted">相談内容に応じてスクールをご案内する場合がありますが、入会は任意です。</p>' : "") +
      '<img class="line-qr" src="' + esc(L.qr) + '" width="540" height="540" alt="公式LINEのQRコード">' +
      '<p class="small muted">パソコンで見ているときは、スマホのカメラでQRコードを読み取ってください。</p></div>';
  }
  function lineBoxPrint() {
    var L = DB.meta.line;
    if (!L) return "";
    return '<div class="pw-line"><img src="' + esc(L.qr) + '" width="540" height="540" alt="公式LINEのQRコード">' +
      "<p>スマホのカメラで読み取ると、公式LINEが開きます。<br>" + esc(L.url) + "</p></div>";
  }
  // 表紙の二人の紹介（初めて紹介する場所なので、かわのすけは「カワウソのかわのすけ」と書く）
  function profile(who) {
    var c = DB.chara[who];
    if (!c) return "";
    return '<div class="profile ' + esc(who) + '">' + avatar(who) +
      "<p><b>" + esc(c.fullName || c.name) + "</b>" + esc(c.profile || "") + "</p></div>";
  }
  function stepCard(n, id, title, sub) {
    var done = readMap()[id];
    return '<li><a class="step-card' + (done ? " done" : "") + '" href="#/book/' + esc(id) + '"><span class="num">' + n + "</span>" +
      "<span><b>" + esc(title) + "</b><small>" + esc(sub) + "</small></span>" +
      (done ? '<span class="done-mark">読んだ</span>' : '<span class="go">›</span>') + "</a></li>";
  }

  // ---------- 画面：目次 ----------
  function viewToc() {
    var read = readMap();
    var html = "<h1>秘伝の書　目次</h1>" +
      '<p class="muted small">気になる項目から読んでOK。読んだ項目には「読んだ」が付きます。</p>';
    DB.parts.forEach(function (p) {
      html += '<section class="toc-part g-' + esc(p.part.id) + '"><div class="toc-head">' + icon(p.part.icon || p.part.id) +
        "<div><h2>" + esc(p.part.title) + "</h2><p>" + esc(p.part.lead) + "</p></div></div>";
      p.chapters.forEach(function (ch) {
        var hasQ = DB.questions.some(function (q) { return q.genre === ch.genre; });
        html += '<div class="toc-chapter"><h3>' + esc(ch.title) +
          (hasQ && ch.genre && ch.genre !== "kiso" ? ' <a class="chip" href="#/quiz/play?genre=' + esc(ch.genre) + '">ドリルにチャレンジ！</a>' : "") +
          "</h3><ol>";
        ch.sections.forEach(function (s) {
          var n = questionsFor(s.id).length;
          html += '<li><a href="#/book/' + esc(s.id) + '">' +
            "<span>" + esc(s.title) + "<small>" + esc(s.hook || s.summary) + "</small></span>" +
            '<span class="toc-badges">' + (read[s.id] ? '<span class="badge read">読んだ</span>' : "") +
            (n ? '<span class="badge q">ドリル' + n + "問</span>" : "") + "</span></a></li>";
        });
        html += "</ol></div>";
      });
      html += "</section>";
    });
    return html;
  }

  // ---------- 画面：教科書の項目 ----------
  function stagesBar(now) {
    return '<ol class="stages" aria-label="判断の段階">' + STAGES.map(function (s) {
      return '<li class="' + (s.n === now ? "now" : "") + '"' + (s.n === now ? ' aria-current="step"' : "") + ">" +
        '<span class="sn">' + s.n + "</span><b>" + s.label + "</b><small>" + s.sub + "</small>" +
        (s.n === now ? '<em class="here">いまここ</em>' : "") + "</li>";
    }).join("") + "</ol>";
  }
  function stageTag(n) {
    var s = STAGES[n - 1];
    return s ? '<span class="stage-tag s' + n + '"><span class="sn">' + n + "</span>" + s.label + "段階</span>" : "";
  }
  function listHtml(items, ordered) {
    var tag = ordered ? "ol" : "ul";
    return "<" + tag + ">" + items.map(function (i) { return "<li>" + inline(i) + "</li>"; }).join("") + "</" + tag + ">";
  }
  function srcNote(ids) {
    if (!ids || !ids.length) return "";
    return '<p class="box-src">出典：' + ids.map(function (id) { return esc(DB.sources[id] ? DB.sources[id].short || DB.sources[id].title : id); }).join("／") + "</p>";
  }
  function renderBlock(b) {
    switch (b.type) {
      case "p": return "<p>" + inline(b.text) + "</p>";
      case "h": return "<h3>" + inline(b.text) + "</h3>";
      case "formula": return '<div class="formula">' + inline(b.text) + "</div>";
      case "list": return listHtml(b.items, b.ordered);
      case "talk": return talk(b.lines);
      case "stages": return stagesBar(b.now);
      case "figure": return figure(b.image);
      case "figures": return figures(b.images);
      case "tag": return tagHtml(b);
      case "term":
        return '<div class="term"><p class="term-easy">' + inline(b.easy) + "</p>" +
          '<p class="term-word"><span>正式な呼び方</span><b>' + esc(b.word) + "</b>" + (b.reading ? "<small>（" + esc(b.reading) + "）</small>" : "") + "</p>" +
          (b.note ? '<p class="term-note">' + inline(b.note) + "</p>" : "") + "</div>";
      case "memo":
        return '<div class="memo"><p class="memo-title">ここがコツ！</p>' + listHtml(b.items) + "</div>";
      case "steps":
        return '<ol class="steps">' + b.items.map(function (i) {
          return "<li><b>" + inline(i.title) + "</b>" + inline(i.text) + "</li>";
        }).join("") + "</ol>";
      case "box":
        return '<div class="box ' + esc(b.kind) + '"><p class="box-title"><span class="box-icon" aria-hidden="true">' + (BOX_ICON[b.kind] || "") + "</span>" +
          esc(b.title || BOX_LABEL[b.kind] || "") + "</p>" +
          (b.text ? "<p>" + inline(b.text) + "</p>" : "") +
          (b.items ? listHtml(b.items) : "") + srcNote(b.src) + "</div>";
      case "table":
        return '<div class="table-wrap"><table><thead><tr>' +
          b.head.map(function (h) { return "<th>" + inline(h) + "</th>"; }).join("") + "</tr></thead><tbody>" +
          b.rows.map(function (r) { return "<tr>" + r.map(function (c) { return "<td>" + inline(c) + "</td>"; }).join("") + "</tr>"; }).join("") +
          "</tbody></table></div>";
      case "calc": return calcHtml(b);
      case "more":
        return '<details class="more"><summary>' + esc(b.title || "詳しく見る") + "</summary>" + b.blocks.map(renderBlock).join("") + "</details>";
      case "case": return caseHtml(b);
      default: return "";
    }
  }
  // 品質表示タグの見本（文字は画像にせず画面で表示する）
  function tagHtml(b) {
    return '<figure class="tagcard"><div class="tag-body">' + b.lines.map(function (l) { return "<p>" + esc(l) + "</p>"; }).join("") + "</div>" +
      "<figcaption>" + (b.caption ? inline(b.caption) : "練習用のタグの見本（実在の商品のタグではありません）") + "</figcaption></figure>";
  }
  function calcHtml(b) {
    var fee = b.price * FEE_RATE;
    var profit = b.price - fee - b.shipping - (b.packing || 0) - b.cost;
    return '<div class="calc"><p class="calc-title"><span class="ex-tag">練習用の例</span>' + esc(b.title) + "</p><table><tbody>" +
      "<tr><td>売れる値段（予想）</td><td>" + yen(b.price) + "</td></tr>" +
      "<tr><td>販売手数料（売れた値段の10%）</td><td>− " + yen(fee) + "</td></tr>" +
      "<tr><td>送料（" + esc(b.shippingLabel) + "）</td><td>− " + yen(b.shipping) + "</td></tr>" +
      (b.packing ? "<tr><td>梱包資材費</td><td>− " + yen(b.packing) + "</td></tr>" : "") +
      "<tr><td>仕入れ値（税込）</td><td>− " + yen(b.cost) + "</td></tr>" +
      '<tr class="total"><td>残る利益</td><td>' + yen(profit) + "</td></tr>" +
      "</tbody></table>" + (b.note ? '<p class="note">' + inline(b.note) + "</p>" : "") + "</div>";
  }
  // 練習用の例：段階ごとにカードを分け、答えは開いて確認する
  function caseHtml(b) {
    return '<div class="case"><p class="case-title"><span class="ex-tag">練習用の例</span>' + esc(b.title) + "</p>" +
      (b.image ? figure(b.image, { small: true }) : "") +
      b.parts.map(function (pt) {
        return '<div class="case-part">' + stageTag(pt.stage) +
          (pt.lines ? talk(pt.lines) : "") +
          (pt.facts ? listHtml(pt.facts) : "") +
          (pt.calc ? calcHtml(pt.calc) : "") +
          (pt.question ? '<p class="case-q"><b>考えてみよう</b>' + inline(pt.question) + "</p>" : "") +
          (pt.answer ? '<details class="reveal"><summary>まっちゃんの答えを見る</summary>' + talk([{ who: "matchan", text: pt.answer }]) + "</details>" : "") +
          "</div>";
      }).join("") + "</div>";
  }

  function viewSection(id) {
    var s = DB.sections[id];
    if (!s) return viewNotFound();
    var read = readMap();
    if (!read[id]) { read[id] = new Date().toISOString().slice(0, 10); store("hiden-read", read); }
    var idx = DB.order.indexOf(id);
    var prev = DB.sections[DB.order[idx - 1]];
    var next = DB.sections[DB.order[idx + 1]];
    var qs = questionsFor(id);
    var html = '<p class="crumbs"><a href="#/book">目次</a> › ' + esc(s.part.title) + " › " + esc(s.chapter.title) + "</p>" +
      '<header class="sec-head g-' + esc(s.part.id) + '">' + icon(s.part.icon || s.part.id) +
      "<div><h1>" + esc(s.title) + "</h1>" + (s.hook ? '<p class="hook">' + inline(s.hook) + "</p>" : "") + "</div></header>" +
      (s.summary ? '<p class="goal"><b>今日はこれができたらOK！</b>' + inline(s.summary) + "</p>" : "") +
      '<div class="note-page">' + s.blocks.map(renderBlock).join("") + "</div>";
    if (qs.length) {
      html += '<div class="to-quiz"><p class="to-quiz-title">コツ、つかめた？</p>' +
        talk([{ who: "kawauso", text: "読んだら、ドリルで腕試ししてみよう！" }]) +
        '<a class="btn accent big" href="#/quiz/play?section=' + esc(id) + '">ドリルにチャレンジ！<small>この項目から' + qs.length + "問</small></a></div>";
    }
    if (s.sources && s.sources.length) {
      html += '<details class="sources"><summary>この項目の情報源（' + s.sources.length + "件）</summary><ul>" + s.sources.map(function (sid) {
        var src = DB.sources[sid];
        if (!src) return "";
        var title = src.url && /^https?:/.test(src.url)
          ? '<a href="' + esc(src.url) + '" target="_blank" rel="noopener">' + esc(src.title) + "</a>"
          : esc(src.title);
        return "<li>" + title + "（" + esc(src.publisher) + "、確認日 " + esc(src.checked) + "）</li>";
      }).join("") + "</ul></details>";
    }
    html += '<p class="updated">更新日：' + esc(s.updated) + "　ID：" + esc(s.id) + "</p>";
    html += '<nav class="pager">' +
      (prev ? '<a class="btn ghost" href="#/book/' + esc(prev.id) + '"><small>前へ</small>' + esc(prev.title) + "</a>" : "<span></span>") +
      (next ? '<a class="btn ghost" href="#/book/' + esc(next.id) + '"><small>次へ</small>' + esc(next.title) + "</a>" : "<span></span>") +
      "</nav>" +
      '<a class="btn ghost" href="#/book">目次に戻る</a>';
    if (session && !session.done) {
      html += '<a class="btn primary resume" href="#/quiz/play">ドリルに戻る（' + (session.i + 1) + "/" + session.ids.length + "問目）</a>";
    }
    return html;
  }

  // ---------- 画面：問題集トップ ----------
  function viewQuizHome() {
    var last = store("hiden-last") || {};
    var html = "<h1>" + esc(DB.meta.quizTitle) + "</h1>" +
      '<div class="drill-intro"><p>読むだけで終わらず、ちょっと腕試し！<br>かわのすけと一緒に「自分ならどうする？」を考えてみよう。<br>迷ったら秘伝の書を見返してOK。答え合わせで、仕入れのコツをつかもう。</p></div>' +
      talk([{ who: "kawauso", text: "ジャンルを選んでね。答えると、まっちゃんが理由を教えてくれるよ。" }]) +
      '<label class="option"><input type="checkbox" id="opt-shuffle"' + (store("hiden-shuffle") ? " checked" : "") + "> 問題の順番をシャッフルする</label>" +
      '<div class="genre-grid">';
    DB.meta.genres.forEach(function (g) {
      var n = DB.questions.filter(function (q) { return q.genre === g.id; }).length;
      var l = last[g.id];
      html += '<a class="gbtn g-' + esc(g.part || g.id) + '" href="#/quiz/play?genre=' + esc(g.id) + '">' + icon(g.icon || g.id) +
        "<b>" + esc(g.label) + "</b><small>" + n + "問" + (l ? "・前回 " + l.score + "/" + l.total : "") + "</small></a>";
    });
    html += "</div>" +
      '<a class="btn primary" href="#/quiz/play?genre=all">全ジャンルからチャレンジ！（' + DB.questions.length + "問）</a>";
    if (session && !session.done) {
      html += '<a class="btn accent" href="#/quiz/play">とちゅうのドリルに戻る（' + (session.i + 1) + "/" + session.ids.length + "問目）</a>";
    }
    html += '<div class="card small"><b>採点について</b><br>四択は、正解が1つだけになる条件で作っています。穴埋めは、全角・半角、カンマ（1,750 / 1750）、「円」などの単位、ひらがな・カタカナの違いを同じ答えとして採点します。</div>';
    return html;
  }

  function startSession(params) {
    var ids, label, key;
    if (params.section) {
      ids = questionsFor(params.section).map(function (q) { return q.id; });
      label = DB.sections[params.section] ? DB.sections[params.section].title : params.section;
    } else if (params.ids) {
      ids = params.ids.split(",").filter(function (id) { return DB.qById[id]; });
      label = params.label || "選んだ問題";
    } else {
      var g = params.genre || "all";
      key = g;
      ids = DB.questions.filter(function (q) { return g === "all" || q.genre === g; }).map(function (q) { return q.id; });
      label = genre(g).label;
    }
    if (store("hiden-shuffle")) ids = shuffle(ids);
    session = { ids: ids, i: 0, answers: {}, label: label, key: key, done: false, params: params };
  }

  // ---------- 画面：解答 ----------
  function viewPlay() {
    if (!session) return viewQuizHome();
    if (!session.ids.length) return '<p>この条件の問題はまだありません。</p><a class="btn" href="#/quiz">ドリルの一覧へ</a>';
    if (session.i >= session.ids.length) return viewResult();
    var q = DB.qById[session.ids[session.i]];
    var a = session.answers[q.id];
    var total = session.ids.length;
    var html = '<div class="q-head"><span>' + esc(session.label) + "</span><span>" + (session.i + 1) + " / " + total + "</span></div>" +
      '<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="' + total + '" aria-valuenow="' + session.i + '"><div style="width:' + Math.round((session.i / total) * 100) + '%"></div></div>' +
      '<p class="q-meta">' + stageTag(q.stage) + '<span class="pill">' + esc(genre(q.genre).label) + '</span><span class="pill">' + (q.type === "choice" ? "四択" : "穴埋め") + "</span>" +
      '<span class="pill" aria-label="難易度' + q.difficulty + '">難易度 ' + "★★★".slice(0, q.difficulty) + "☆☆☆".slice(0, 3 - q.difficulty) + "</span></p>" +
      (q.scene ? talk(q.scene) : "") +
      (q.image ? figure(q.image, { quiz: true }) : "") +
      (q.tag ? tagHtml(q.tag) : "") +
      '<p class="q-lead">こんなとき、どうする？</p>' +
      '<p class="q-text">' + inline(q.question) + "</p>" +
      (q.condition ? '<div class="q-cond"><b>条件</b>' + inline(q.condition) + "</div>" : "") +
      (q.point ? '<p class="q-point"><b>考えるポイント</b>' + inline(q.point) + "</p>" : "");

    if (q.type === "choice") {
      html += '<div class="choices">' + q.choices.map(function (c, i) {
        var cls = "", tag = "";
        if (a) {
          if (i === q.answer) { cls = " correct"; tag = '<span class="ctag">正解</span>'; }
          else if (i === a.picked) { cls = " wrong"; tag = '<span class="ctag">あなたの答え</span>'; }
        }
        return '<button class="choice' + cls + '" data-choice="' + i + '"' + (a ? " disabled" : "") + '><span class="mark">' + "ABCD"[i] + "</span><span>" + inline(c) + "</span>" + tag + "</button>";
      }).join("") + "</div>";
    } else {
      html += '<form class="fill" id="fill-form" autocomplete="off"><input id="fill-input" ' +
        (q.answerType === "number" ? 'inputmode="numeric" ' : "") +
        'placeholder="ここに入力" aria-label="解答" value="' + esc(a ? a.input : "") + '"' + (a ? " disabled" : "") + ">" +
        (q.unit ? '<span class="unit">' + esc(q.unit) + "</span>" : "") + "</form>" +
        (a ? "" : '<button class="btn primary" id="fill-submit">答える</button>');
    }

    if (a) {
      var correctText = q.type === "choice" ? "ABCD"[q.answer] + "．" + inline(q.choices[q.answer]) : esc(q.answer) + esc(q.unit || "");
      html += '<div class="verdict ' + (a.correct ? "ok" : "ng") + '" tabindex="-1">' +
        '<p class="v-title">' + (a.correct ? '<span class="v-icon" aria-hidden="true">◎</span>正解！ この調子！' : '<span class="v-icon" aria-hidden="true">△</span>ここが覚えどころ！ 答え合わせをしてみよう') + "</p>" +
        (a.correct ? "" : '<p class="v-answer">正解：' + correctText + "</p>") +
        (a.correct && q.gotIt ? '<p class="v-msg">' + inline(q.gotIt) + "</p>" : "") +
        (!a.correct && q.nextHint ? '<p class="v-msg"><b>次はここを見てみよう：</b>' + inline(q.nextHint) + "</p>" : "") +
        "</div>" +
        talk([{ who: "matchan", face: a.correct ? "joy" : "good", text: q.short || q.explanation }]
          .concat(q.wrapUp ? [{ who: "kawauso", face: a.correct ? "laugh" : "think", text: q.wrapUp }] : []));
      html += '<details class="more answer-check"' + (a.correct ? "" : " open") + "><summary>答え合わせ（解説" + (q.type === "choice" ? "と各選択肢" : "") + "）</summary>" +
        "<p>" + inline(q.explanation) + "</p>";
      if (q.type === "choice" && q.choiceNotes) {
        html += '<ul class="notes">' + q.choiceNotes.map(function (n, i) {
          var cls = i === q.answer ? "is-correct" : (i === a.picked ? "is-picked" : "");
          return '<li class="' + cls + '"><span class="mark">' + "ABCD"[i] + "</span><span>" + inline(n) + "</span></li>";
        }).join("") + "</ul>";
      }
      if (q.type === "fill" && q.answerType === "text") {
        html += '<p class="small muted">正解として扱う表記：' + q.accept.map(esc).join("／") + "</p>";
      }
      html += "</details>";
      html += '<p class="small muted">秘伝の書で確かめる</p><div class="backlinks">' + q.sectionIds.map(function (sid) {
        var s = DB.sections[sid];
        return s ? '<a class="btn ghost" href="#/book/' + esc(sid) + '">' + esc(s.title) + "</a>" : "";
      }).join("") + "</div>";
      html += '<button class="btn primary big" id="next-q">' + (session.i + 1 < total ? "次の問題へ" : "結果を見る") + "</button>";
      html += '<p class="updated">問題ID：' + esc(q.id) + "　更新日：" + esc(q.updated) +
        (q.sources.length ? "　出典：" + q.sources.map(function (s) { return esc(DB.sources[s] ? DB.sources[s].short || DB.sources[s].title : s); }).join("／") : "") + "</p>";
    }
    return html;
  }

  function answer(q, payload) {
    var correct = q.type === "choice" ? payload.picked === q.answer : gradeFill(q, payload.input);
    payload.correct = correct;
    session.answers[q.id] = payload;
    var solved = solvedMap(); solved[q.id] = correct; store("hiden-solved", solved);
    render();
    var v = app.querySelector(".verdict");
    if (v) { v.scrollIntoView({ block: "center" }); v.focus({ preventScroll: true }); }
  }

  function bindPlay() {
    if (!session || session.i >= session.ids.length) return;
    var q = DB.qById[session.ids[session.i]];
    if (!q) return;
    app.querySelectorAll("[data-choice]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (!session.answers[q.id]) answer(q, { picked: Number(b.getAttribute("data-choice")) });
      });
    });
    var form = document.getElementById("fill-form");
    var submit = document.getElementById("fill-submit");
    function onFill(e) {
      if (e) e.preventDefault();
      var v = document.getElementById("fill-input").value;
      if (!v.trim()) { document.getElementById("fill-input").focus(); return; }
      answer(q, { input: v });
    }
    if (form) form.addEventListener("submit", onFill);
    if (submit) submit.addEventListener("click", onFill);
    var next = document.getElementById("next-q");
    if (next) next.addEventListener("click", function () {
      session.i += 1;
      if (session.i >= session.ids.length) finish();
      render(); window.scrollTo(0, 0);
    });
  }

  function finish() {
    session.done = true;
    if (session.key) {
      var last = store("hiden-last") || {};
      last[session.key] = { score: score(), total: session.ids.length, date: new Date().toISOString().slice(0, 10) };
      store("hiden-last", last);
    }
  }
  function score() {
    return session.ids.filter(function (id) { return session.answers[id] && session.answers[id].correct; }).length;
  }

  // ---------- 画面：結果 ----------
  function viewResult() {
    var total = session.ids.length, sc = score();
    var wrong = session.ids.filter(function (id) { return !(session.answers[id] && session.answers[id].correct); });
    var msg = sc === total
      ? [{ who: "kawauso", face: "laugh", text: "全問正解！見るポイントが、自分の言葉で説明できるようになってきた。" }, { who: "matchan", face: "joy", text: "その調子。次は別のジャンルでも、同じ順番で見てみよう。" }]
      : [{ who: "kawauso", face: "fire", text: "まちがえたところが、覚えどころだね。もう一回チャレンジ！" }, { who: "matchan", text: "下のリストから秘伝の書を見返して、理由を確かめてから解き直してみよう。" }];
    var html = "<h1>結果</h1>" +
      '<div class="card result-score">' + (sc === total ? pose("kawauso", "joy", "result-pose") : pose("kawauso", "fire", "result-pose")) +
      '<span class="muted">' + esc(session.label) + "</span><b>" + sc + " / " + total + "</b>" +
      "正解 " + Math.round((sc / total) * 100) + "%" + progressBar(sc, total) + "</div>" + talk(msg) +
      '<ul class="result-list">' + session.ids.map(function (id, i) {
        var q = DB.qById[id], a = session.answers[id];
        var s = DB.sections[q.sectionIds[0]];
        var ok = a && a.correct;
        return '<li class="' + (ok ? "ok" : "ng") + '"><span class="rmark">' + (ok ? "正解" : "おさらい") + "</span>" +
          "<span>第" + (i + 1) + "問　" + esc(q.question.length > 40 ? q.question.slice(0, 40) + "…" : q.question) +
          (s ? '<br><a href="#/book/' + esc(s.id) + '">秘伝の書：' + esc(s.title) + "</a>" : "") + "</span></li>";
      }).join("") + "</ul>";
    if (wrong.length && wrong.length < total) {
      html += '<button class="btn accent big" id="retry-wrong">もう一回チャレンジ！<small>まちがえた問題だけ（' + wrong.length + "問）</small></button>";
    }
    html += '<button class="btn primary" id="retry-all">' + (sc === total ? "もう一度ぜんぶ解く" : "もう一回チャレンジ！") + "<small>ぜんぶ（" + total + "問）</small></button>";
    html += '<div class="btn-row"><a class="btn ghost" href="#/quiz">ドリルの一覧へ</a><a class="btn ghost" href="#/book">秘伝の書を読む</a></div>';
    return html;
  }
  function bindResult() {
    var all = document.getElementById("retry-all");
    var wr = document.getElementById("retry-wrong");
    if (all) all.addEventListener("click", function () {
      var p = session.params; startSession(p); render(); window.scrollTo(0, 0);
    });
    if (wr) wr.addEventListener("click", function () {
      var ids = session.ids.filter(function (id) { return !(session.answers[id] && session.answers[id].correct); });
      startSession({ ids: ids.join(","), label: session.label + "（まちがえた問題）" });
      render(); window.scrollTo(0, 0);
    });
  }

  // ---------- 画面：ワークブック（書き込み式） ----------
  // 書いた内容はこの端末の localStorage（hiden-work）にだけ保存し、どこにも送らない
  function workAnswers() { return store("hiden-work") || {}; }
  function workFieldIds(w) {
    var ids = [];
    w.items.forEach(function (it) {
      if (!it.noBox) ids.push(it.id);
      (it.fields || []).forEach(function (f) { ids.push(f.id); });
    });
    return ids;
  }
  function workDoneCount() {
    var ans = workAnswers();
    return DB.work.works.filter(function (w) {
      return workFieldIds(w).some(function (id) { return String(ans[id] || "").trim(); });
    }).length;
  }
  function workPrivacy() {
    return '<p class="work-privacy">書いた内容は、<b>このスマホ（ブラウザ）の中だけ</b>に自動で保存されます。どこにも送られません。</p>';
  }
  function viewWorkHome() {
    var W = DB.work, ans = workAnswers();
    var html = '<section class="work-cover"><p class="work-catch">' + esc(W.catch) + "</p><h1>" + esc(W.title) + "</h1>" +
      '<p class="work-tagline">' + esc(W.tagline) + "</p><p class=\"small muted\">" + esc(W.target) + "</p></section>" +
      talk([
        { who: "kawauso", face: "think", text: "自分のことを書くのって、ちょっと照れるね…。" },
        { who: "matchan", text: "正解はないよ。書けない欄は飛ばしても大丈夫。" }
      ]) +
      '<div class="note-page"><h3>' + esc(W.intro.title) + "</h3><p><b>" + esc(W.intro.lead) + "</b></p>" +
      W.intro.text.map(function (t) { return "<p>" + esc(t) + "</p>"; }).join("") +
      "<h3>" + esc(W.intro.stepsTitle) + '</h3><ol class="steps">' +
      W.intro.steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol>" +
      '<div class="memo"><p class="memo-title">' + esc(W.intro.note) + "</p></div></div>" + workPrivacy() +
      '<ol class="work-list">' + W.works.map(function (w) {
        var n = workFieldIds(w).filter(function (id) { return String(ans[id] || "").trim(); }).length;
        return '<li><a href="#/work/' + esc(w.id) + '"><span class="work-no">' + esc(w.no) + "</span><b>" + esc(w.title) + "</b>" +
          '<small>' + esc(w.lead) + "</small>" + (n ? '<span class="done-mark">書いた</span>' : "") + "</a></li>";
      }).join("") + "</ol>" +
      '<a class="btn primary big" href="#/work/' + esc(W.works[0].id) + '">WORK 01から書いてみる</a>' +
      '<a class="btn ghost" href="#/work/summary">書いた内容をまとめて見る</a>' +
      '<div class="btn-row"><a class="btn ghost" href="#/work/print">書いた内容を印刷</a><a class="btn ghost" href="#/work/print?blank=1">空欄の用紙を印刷</a></div>';
    return html;
  }
  function workItemHtml(it, ans) {
    var html = '<div class="work-item"><p class="work-q">' + esc(it.label) + "</p>" + (it.hint ? '<p class="work-hint">' + esc(it.hint) + "</p>" : "");
    if (it.fields) {
      html += '<p class="work-fields">' + it.fields.map(function (f) {
        return "<label>" + esc(f.before) + '<input class="work-input' + (f.text ? " wide" : "") + '" data-work="' + esc(f.id) + '"' +
          (f.text ? "" : ' inputmode="decimal"') + ' value="' + esc(ans[f.id] || "") + '" aria-label="' + esc(it.label + " " + f.before + f.unit) + '">' + esc(f.unit) + "</label>";
      }).join("") + "</p>";
    }
    if (!it.noBox) {
      html += it.short
        ? '<input class="work-input full" data-work="' + esc(it.id) + '" value="' + esc(ans[it.id] || "") + '" aria-label="' + esc(it.label) + '">'
        : '<textarea class="work-box" data-work="' + esc(it.id) + '" rows="4" aria-label="' + esc(it.label) + '">' + esc(ans[it.id] || "") + "</textarea>";
    }
    return html + "</div>";
  }
  function viewWork(id) {
    var W = DB.work, i = W.works.map(function (w) { return w.id; }).indexOf(id);
    if (i < 0) return viewNotFound();
    var w = W.works[i], ans = workAnswers(), prev = W.works[i - 1], next = W.works[i + 1];
    return '<p class="crumbs"><a href="#/work">' + esc(W.title) + "</a> › " + esc(w.no) + "</p>" +
      '<header class="work-head"><span class="work-no">' + esc(w.no) + "</span><h1>" + esc(w.title) + "</h1></header>" +
      '<p class="work-lead">' + esc(w.lead) + "</p>" +
      '<div class="note-page">' + w.items.map(function (it) { return workItemHtml(it, ans); }).join("") +
      '<p class="work-note">' + esc(w.note) + "</p></div>" +
      '<div class="work-saved" id="work-saved" aria-live="polite">' + workPrivacy() + "</div>" +
      '<nav class="pager">' +
      (prev ? '<a class="btn ghost" href="#/work/' + esc(prev.id) + '"><small>前へ</small>' + esc(prev.title) + "</a>" : '<a class="btn ghost" href="#/work"><small>前へ</small>使い方</a>') +
      (next ? '<a class="btn ghost" href="#/work/' + esc(next.id) + '"><small>次へ</small>' + esc(next.title) + "</a>" : '<a class="btn ghost" href="#/work/next"><small>次へ</small>' + esc(W.next.title) + "</a>") +
      "</nav>" + '<a class="btn ghost" href="#/work">ワークの一覧に戻る</a>';
  }
  function viewWorkNext() {
    var N = DB.work.next;
    return '<p class="crumbs"><a href="#/work">' + esc(DB.work.title) + "</a> › " + esc(N.no) + "</p>" +
      '<header class="work-head"><span class="work-no">' + esc(N.no) + "</span><h1>" + esc(N.title) + "</h1></header>" +
      '<p class="work-lead">' + esc(N.lead) + "</p>" +
      '<div class="note-page">' + N.text.map(function (t) { return "<p>" + esc(t) + "</p>"; }).join("") +
      '<div class="box check"><p class="box-title"><span class="box-icon" aria-hidden="true">☑</span>' + esc(N.listTitle) + "</p>" + listHtml(N.list) + "</div>" +
      '<p class="work-cta">' + esc(N.cta) + "</p>" + lineBox() + N.notes.map(function (t) { return '<p class="small muted">' + esc(t) + "</p>"; }).join("") +
      '<p class="work-sign">' + esc(N.sign) + "</p></div>" +
      '<a class="btn primary big" href="#/work/print">書いた内容を印刷して残す<small>PDFで保存もできます</small></a>' +
      '<a class="btn ghost" href="#/work/summary">書いた内容をまとめて見る</a>' +
      '<div class="btn-row"><a class="btn ghost" href="#/work">ワークの一覧へ</a><a class="btn ghost" href="#/book">秘伝の書を読む</a></div>';
  }
  function workSummaryText() {
    var ans = workAnswers(), out = [DB.work.title];
    DB.work.works.forEach(function (w) {
      out.push("", "■ " + w.no + "　" + w.title);
      w.items.forEach(function (it) {
        var parts = (it.fields || []).map(function (f) { return f.before + (ans[f.id] || "＿") + f.unit; });
        if (!it.noBox && String(ans[it.id] || "").trim()) parts.push(ans[it.id]);
        out.push(it.label, parts.length ? parts.join("\n") : "（未記入）");
      });
    });
    return out.join("\n");
  }
  // 印刷用：PDFのワークブックと同じ並び（使い方 → WORK 01〜07 → NEXT STEP）。各ワークは1ページずつ。
  // blank のときは空欄の用紙（手書き用）。書いていない欄も、手で書き足せるように枠を残す。
  function viewWorkPrint(blank) {
    var W = DB.work, ans = blank ? {} : workAnswers();
    var d = new Date(), today = d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日";
    function answerBox(it) {
      var v = String(ans[it.id] || "");
      return '<div class="pw-box' + (it.short ? " short" : "") + '">' + esc(v) + "</div>";
    }
    var html = '<div class="no-print">' +
      '<p class="crumbs"><a href="#/work">' + esc(W.title) + "</a> › 印刷</p>" +
      "<h1>" + (blank ? "空欄の用紙を印刷" : "書いた内容を印刷") + "</h1>" +
      '<p class="small">' + (blank
        ? "手で書き込める、空欄のワークブックです。"
        : "書いた内容を、ワークブックの形で印刷できます。書いていない欄は空いたままなので、あとから手で書き足せます。") + "</p>" +
      '<button class="btn primary big" id="work-print">印刷・PDFで保存する</button>' +
      '<p class="small muted">スマホでは、印刷の画面から「PDFとして保存」や「ファイルに保存」もできます（機種によって表示が違います）。</p>' +
      '<a class="btn ghost" href="#/work/print' + (blank ? "" : "?blank=1") + '">' + (blank ? "書いた内容を印刷する" : "空欄の用紙を印刷する") + "</a>" +
      '<a class="btn ghost" href="#/work">ワークの一覧へ</a>' +
      '<p class="small muted">↓ 印刷される内容</p></div>' +
      '<div class="print-book">' +
      '<section class="pw-page pw-cover"><p class="pw-catch">' + esc(W.catch) + "</p><h2>" + esc(W.title) + "</h2>" +
      '<p class="pw-tagline">' + esc(W.tagline) + "</p><p>" + esc(W.target) + "</p>" +
      '<p class="pw-name">名前：<span></span></p><p class="pw-date">' + (blank ? "書いた日：<span></span>" : "印刷した日：" + today) + "</p>" +
      '<h3>' + esc(W.intro.title) + "</h3><p><b>" + esc(W.intro.lead) + "</b></p>" +
      W.intro.text.map(function (t) { return "<p>" + esc(t) + "</p>"; }).join("") +
      "<p><b>" + esc(W.intro.stepsTitle) + "</b></p><ol>" + W.intro.steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol>" +
      '<p class="pw-note">' + esc(W.intro.note) + "</p></section>";
    W.works.forEach(function (w) {
      html += '<section class="pw-page"><p class="pw-no">' + esc(w.no) + "</p><h2>" + esc(w.title) + "</h2>" +
        '<p class="pw-lead">' + esc(w.lead) + "</p>" +
        w.items.map(function (it) {
          return '<div class="pw-item"><p class="pw-q">' + esc(it.label) + "</p>" + (it.hint ? '<p class="pw-hint">' + esc(it.hint) + "</p>" : "") +
            (it.fields ? '<p class="pw-fields">' + it.fields.map(function (f) {
              return esc(f.before) + '<span class="pw-blank' + (f.text ? " wide" : "") + '">' + esc(ans[f.id] || "") + "</span>" + esc(f.unit);
            }).join("　") + "</p>" : "") +
            (it.noBox ? "" : answerBox(it)) + "</div>";
        }).join("") +
        '<p class="pw-note">' + esc(w.note) + "</p></section>";
    });
    var N = W.next;
    html += '<section class="pw-page"><p class="pw-no">' + esc(N.no) + "</p><h2>" + esc(N.title) + "</h2>" +
      '<p class="pw-lead">' + esc(N.lead) + "</p>" + N.text.map(function (t) { return "<p>" + esc(t) + "</p>"; }).join("") +
      "<p><b>" + esc(N.listTitle) + "</b></p>" + listHtml(N.list) +
      '<p class="pw-cta">' + esc(N.cta) + "</p>" + lineBoxPrint() + N.notes.map(function (t) { return '<p class="pw-small">' + esc(t) + "</p>"; }).join("") +
      '<p class="pw-sign">' + esc(N.sign) + "</p></section></div>";
    return html;
  }
  function viewWorkSummary() {
    return '<p class="crumbs"><a href="#/work">' + esc(DB.work.title) + "</a> › まとめ</p><h1>書いた内容のまとめ</h1>" + workPrivacy() +
      '<pre class="work-summary">' + esc(workSummaryText()) + "</pre>" +
      '<button class="btn primary" id="work-copy">まとめてコピーする</button>' +
      '<a class="btn accent" href="#/work/print">ワークブックの形で印刷する</a>' +
      '<button class="btn ghost danger" id="work-clear">書いた内容をすべて消す</button>' +
      '<a class="btn ghost" href="#/work">ワークの一覧へ</a>';
  }
  function bindWork() {
    var saved = document.getElementById("work-saved");
    app.querySelectorAll("[data-work]").forEach(function (el) {
      el.addEventListener("input", function () {
        var ans = workAnswers(); ans[el.getAttribute("data-work")] = el.value; store("hiden-work", ans);
        if (saved) saved.innerHTML = '<span class="work-ok">✓ 保存しました</span>（このスマホの中だけ）';
      });
    });
    var copy = document.getElementById("work-copy");
    if (copy) copy.addEventListener("click", function () {
      var t = workSummaryText();
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () {
        copy.textContent = "コピーしました";
      }, function () { copy.textContent = "コピーできませんでした（上の文字を長押しで選べます）"; });
    });
    var pr = document.getElementById("work-print");
    if (pr) pr.addEventListener("click", function () { window.print(); });
    var cl = document.getElementById("work-clear");
    if (cl) cl.addEventListener("click", function () {
      if (window.confirm("このスマホに保存した、ワークの書き込みをすべて消します。よろしいですか？")) { store("hiden-work", {}); render(); }
    });
  }

  // ---------- 画面：出典・更新履歴 ----------
  function viewSources() {
    var STATUS = { verified: "本文を確認", partial: "一部を確認", "summary-only": "本文未確認（参考のみ）", own: "まっちゃんの素材" };
    return "<h1>出典一覧</h1>" +
      '<p class="muted small">教材の根拠にした情報源と確認日です。料金や制度は変わることがあるため、使う前に最新情報を確認してください。</p>' +
      Object.keys(DB.sources).map(function (id) {
        var s = DB.sources[id];
        var title = s.url && /^https?:/.test(s.url)
          ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + "</a>" : esc(s.title);
        return '<div class="card small"><b>' + title + "</b><br>" + esc(s.publisher) + "　確認日：" + esc(s.checked) +
          '　<span class="pill">' + esc(STATUS[s.status] || s.status) + "</span>" +
          "<br>使った内容：" + esc(s.usedFor) + (s.note ? '<br><span class="muted">メモ：' + esc(s.note) + "</span>" : "") +
          '<br><span class="muted">ID：' + esc(s.id) + "</span></div>";
      }).join("");
  }
  function viewUpdates() {
    return "<h1>更新履歴</h1>" +
      '<p class="muted small">最終更新：' + esc(DB.meta.updated) + "（v" + esc(DB.meta.version) + "）</p>" +
      DB.meta.changelog.map(function (c) {
        return '<div class="card"><b>' + esc(c.date) + "　v" + esc(c.version) + '</b><ul class="history">' +
          c.items.map(function (i) { return "<li>" + inline(i) + "</li>"; }).join("") + "</ul></div>";
      }).join("");
  }
  function viewNotFound() {
    return '<h1>ページが見つかりません</h1><a class="btn" href="#/">表紙に戻る</a>';
  }

  // ---------- ルーティング ----------
  function parseHash() {
    var h = location.hash.replace(/^#/, "") || "/";
    var q = h.split("?"); var params = {};
    (q[1] || "").split("&").forEach(function (kv) {
      if (!kv) return; var p = kv.split("="); params[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || "");
    });
    return { path: q[0].split("/").filter(Boolean), params: params };
  }

  var lastHash = null;
  function render() {
    var r = parseHash(), p = r.path, html, nav = "";
    if (p[0] === "book" && p[1]) { html = viewSection(p[1]); nav = "book"; }
    else if (p[0] === "book") { html = viewToc(); nav = "book"; }
    else if (p[0] === "quiz" && p[1] === "play") {
      // パラメータ付きで来たときだけ新しく始める（教科書から戻ったときは続きから）
      if (Object.keys(r.params).length && location.hash !== lastHash) {
        startSession(r.params);
        history.replaceState(null, "", "#/quiz/play");
      }
      html = viewPlay(); nav = "quiz";
    }
    else if (p[0] === "quiz") { html = viewQuizHome(); nav = "quiz"; }
    else if (p[0] === "work" && DB.work) {
      html = p[1] === "next" ? viewWorkNext() : p[1] === "summary" ? viewWorkSummary() : p[1] === "print" ? viewWorkPrint(r.params.blank === "1") :
        p[1] ? viewWork(p[1]) : viewWorkHome();
      nav = "work";
    }
    else if (p[0] === "sources") html = viewSources();
    else if (p[0] === "updates") html = viewUpdates();
    else if (!p.length) html = viewHome();
    else html = viewNotFound();
    lastHash = location.hash;
    app.innerHTML = html;
    document.querySelectorAll("[data-nav]").forEach(function (a) {
      a.classList.toggle("active", a.getAttribute("data-nav") === nav);
    });
    bindPlay(); bindResult(); bindWork();
    var sh = document.getElementById("opt-shuffle");
    if (sh) sh.addEventListener("change", function () { store("hiden-shuffle", sh.checked); });
    var title = app.querySelector("h1");
    document.title = (title && p.length ? title.textContent + "｜" : "") + "仕入れ秘伝の書｜せどらいふ";
  }

  window.addEventListener("hashchange", function () { render(); window.scrollTo(0, 0); });
  load().then(render).catch(function (e) {
    app.innerHTML = '<h1>教材データを読み込めませんでした</h1><p>' + esc(e.message) + "</p>" +
      "<p>ファイルを直接開いた場合は表示できません。kyozai フォルダの <b>start.command</b> をダブルクリックするか、ターミナルで次を実行してください。</p>" +
      '<pre class="card small">python3 -m http.server 8765 --directory kyozai/site</pre>';
  });

  // 検証用に採点関数を公開（画面からは使わない）
  window.__hiden = { gradeFill: gradeFill, normalizeText: normalizeText, normalizeNumber: normalizeNumber, DB: DB };
})();
