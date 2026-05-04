<?php
/**
* ХЕДЕР chernetchenko.pro v6.0 + SEO Override Patch
*/
$sites = [
    'main' => ['id'=>'main', 'page_title'=>'Олег Чернетченко',     'url'=>'https://chernetchenko.pro',     'color'=>'#1a4fa0', 'logo_html'=>'<div class="logo-circle">ОЧ</div>'],
    'waf'  => ['id'=>'waf',  'page_title'=>'Прикладной ИИ',        'url'=>'https://waf.chernetchenko.pro', 'color'=>'#d32f2f', 'logo_html'=>'<div class="logo-text"><span class="logo-title" style="color:var(--c-waf);">Прикладной ИИ</span><span class="logo-subtitle">LLM, RAG и агенты</span></div>'],
    'fun'  => ['id'=>'fun',  'page_title'=>'Лаборатория приколов', 'url'=>'https://fun.chernetchenko.pro', 'color'=>'#6a1b9a', 'logo_html'=>'<div class="logo-text"><span class="logo-title" style="color:var(--c-fun);">Лаборатория приколов</span><span class="logo-subtitle">Инженерный нуар</span></div>'],
    'toc'  => ['id'=>'toc',  'page_title'=>'Что мы сделали',       'url'=>'https://toc.chernetchenko.pro', 'color'=>'#b8860b', 'logo_html'=>'<div class="logo-text"><span class="logo-title" style="color:var(--c-toc);">Что мы сделали</span><span class="logo-subtitle">ПИР, ТОС, расчёты</span></div>'],
];
$siteId  = $siteId ?? 'main';
$current = $sites[$siteId] ?? $sites['main'];
$accent  = $current['color'];

// ==========================================
// PATCH: SEO OVERRIDE (Для PHP-страниц)
// Читает config/seo_overrides.json и перебивает $pageTitle
// ==========================================
$seoFile = __DIR__ . '/config/seo_overrides.json';
if (file_exists($seoFile)) {
    $ov = json_decode(file_get_contents($seoFile), true) ?: [];
    $curScript = basename($_SERVER['SCRIPT_NAME']);
    if (!empty($ov[$curScript]['title'])) {
        $pageTitle = $ov[$curScript]['title'];
    }
}
// ==========================================
?>
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title><?= htmlspecialchars($pageTitle ?? $current['page_title']) ?></title>
<link rel="icon" type="image/svg+xml" href="https://chernetchenko.pro/favicon.svg">
<link href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700;800&display=swap" rel="stylesheet">
<!-- Yandex.Metrika -->
<script type="text/javascript">
(function(m,e,t,r,i,k,a){
m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
m[i].l=1*new Date();
for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}
k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)
})(window,document,'script','https://mc.yandex.ru/metrika/tag.js?id=108508539','ym');
ym(108508539,'init',{ssr:true,webvisor:true,clickmap:true,ecommerce:"dataLayer",referrer:document.referrer,url:location.href,accurateTrackBounce:true,trackLinks:true});
</script>
<noscript><div><img src="https://mc.yandex.ru/watch/108508539" style="position:absolute;left:-9999px;" alt=""/></div></noscript>
<!-- /Yandex.Metrika -->
<style>
:root {
--bg: #faf7f2; --ink: #1a1612; --ink2: #3a3530; --ink3: #8a837a; --border: #d8d0c4;
--accent: <?= $accent ?>;
--c-main: #1a4fa0; --c-waf: #d32f2f; --c-fun: #6a1b9a; --c-toc: #b8860b;
--font-body: 'Golos Text', sans-serif;
--font-mono: 'JetBrains Mono', monospace;
--font-title: 'Golos Text', sans-serif;
--container-w: 1200px;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--bg); color: var(--ink); font-family: var(--font-body); line-height: 1.5; min-height: 100vh; display: flex; flex-direction: column; }
.site-header { position: sticky; top: 0; z-index: 2000; background: rgba(250,247,242,0.96); backdrop-filter: blur(12px); border-bottom: 4px solid var(--accent); padding: 0.6rem 0; }
.header-inner { max-width: var(--container-w); margin: 0 auto; padding: 0 20px; display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 1rem; }
.header-logo { display: flex; align-items: center; gap: 10px; text-decoration: none; color: var(--ink); transition: opacity 0.2s; }
.header-logo:hover { opacity: 0.8; }
.logo-circle { width: 34px; height: 34px; border-radius: 50%; background: var(--c-main); color: #fff; display: flex; align-items: center; justify-content: center; font-family: var(--font-mono); font-weight: 800; font-size: 0.9rem; }
.logo-text { display: flex; flex-direction: column; line-height: 1.15; }
.logo-title { font-family: var(--font-mono); font-weight: 800; font-size: 0.95rem; letter-spacing: 0.02em; text-transform: uppercase; }
.logo-subtitle { font-size: 0.6rem; color: var(--ink3); font-weight: 500; margin-top: 2px; white-space: nowrap; }
.header-search { position: relative; max-width: 220px; width: 100%; }
.search-input { width: 100%; padding: 6px 12px 6px 30px; border: 1px solid var(--border); border-radius: 4px; background: #f0ede7; font-family: var(--font-mono); font-size: 0.65rem; color: var(--ink3); cursor: not-allowed; }
.search-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); opacity: 0.3; font-size: 0.75rem; }
.header-actions { display: flex; align-items: center; gap: 16px; }
.header-nav { display: flex; align-items: center; gap: 6px; }
.h-badge { display: flex; flex-direction: column; justify-content: center; padding: 5px 10px; border-radius: 4px; border: 1.5px dashed; text-decoration: none; transition: all 0.2s ease; background: transparent; }
.h-badge-title { font-family: var(--font-mono); font-size: 0.6rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px; }
.h-badge-sub   { font-family: var(--font-body); font-size: 0.55rem; font-weight: 500; opacity: 0.8; white-space: nowrap; }
.h-badge-main { border-color: var(--c-main); } .h-badge-main .h-badge-title { color: var(--c-main); } .h-badge-main .h-badge-sub { color: var(--ink3); } .h-badge-main:hover,.h-badge-main.active { background: var(--c-main); border-style: solid; } .h-badge-main:hover .h-badge-title,.h-badge-main:hover .h-badge-sub,.h-badge-main.active .h-badge-title,.h-badge-main.active .h-badge-sub { color: #fff; opacity: 1; }
.h-badge-waf  { border-color: var(--c-waf);  } .h-badge-waf  .h-badge-title { color: var(--c-waf);  } .h-badge-waf  .h-badge-sub { color: var(--ink3); } .h-badge-waf:hover,.h-badge-waf.active  { background: var(--c-waf);  border-style: solid; } .h-badge-waf:hover  .h-badge-title,.h-badge-waf:hover  .h-badge-sub,.h-badge-waf.active  .h-badge-title,.h-badge-waf.active  .h-badge-sub  { color: #fff; opacity: 1; }
.h-badge-fun  { border-color: var(--c-fun);  } .h-badge-fun  .h-badge-title { color: var(--c-fun);  } .h-badge-fun  .h-badge-sub { color: var(--ink3); } .h-badge-fun:hover,.h-badge-fun.active  { background: var(--c-fun);  border-style: solid; } .h-badge-fun:hover  .h-badge-title,.h-badge-fun:hover  .h-badge-sub,.h-badge-fun.active  .h-badge-title,.h-badge-fun.active  .h-badge-sub  { color: #fff; opacity: 1; }
.h-badge-toc  { border-color: var(--c-toc);  } .h-badge-toc  .h-badge-title { color: var(--c-toc);  } .h-badge-toc  .h-badge-sub { color: var(--ink3); } .h-badge-toc:hover,.h-badge-toc.active  { background: var(--c-toc);  border-style: solid; } .h-badge-toc:hover  .h-badge-title,.h-badge-toc:hover  .h-badge-sub,.h-badge-toc.active  .h-badge-title,.h-badge-toc.active  .h-badge-sub  { color: #fff; opacity: 1; }
.header-social { display: flex; gap: 8px; align-items: center; }
.tg-btn { display: flex; align-items: center; gap: 5px; padding: 4px 10px 4px 6px; border-radius: 20px; border: 1.5px solid #229ED9; color: #229ED9; text-decoration: none; font-family: var(--font-mono); font-size: 0.6rem; font-weight: 800; text-transform: uppercase; transition: all 0.2s; }
.tg-btn:hover { background: #229ED9; color: #fff; }
.tg-btn svg { width: 18px; height: 18px; fill: currentColor; }
.container { max-width: var(--container-w); margin: 0 auto; padding: 0 20px; width: 100%; }
.burger { display:none; flex-direction:column; gap:5px; background:none; border:none; cursor:pointer; padding:4px; }
.burger span { display:block; width:22px; height:2px; background:var(--ink); border-radius:2px; transition:all .3s; }
.burger.open span:nth-child(1) { transform:translateY(7px) rotate(45deg); }
.burger.open span:nth-child(2) { opacity:0; }
.burger.open span:nth-child(3) { transform:translateY(-7px) rotate(-45deg); }
@media (max-width: 1200px) { .header-search { display: none; } }
@media (max-width: 1000px) {
.burger { display:flex; }
.header-nav { display:none; position:fixed; top:57px; left:0; right:0;
background:rgba(250,247,242,.98); backdrop-filter:blur(16px);
flex-direction:column; padding:16px 20px; gap:8px;
border-bottom:3px solid var(--accent); z-index:1999; }
.header-nav.open { display:flex; }
}
</style>
</head>
<body>
<header class="site-header">
<div class="header-inner">
<a href="<?= $current['url'] ?>" class="header-logo"><?= $current['logo_html'] ?></a>
<div class="header-search">
<span class="search-icon">⚲</span>
<input type="text" class="search-input" placeholder="Поиск..." disabled>
</div>
<div class="header-actions">
<button class="burger" id="burger" aria-label="Меню"><span></span><span></span><span></span></button>
<nav class="header-nav">
<a href="<?= $sites['waf']['url'] ?>" class="h-badge h-badge-waf <?= ($siteId==='waf')?'active':'' ?>">
<span class="h-badge-title">Прикладной ИИ</span>
<span class="h-badge-sub">LLM, RAG, агенты</span>
</a>
<a href="<?= $sites['fun']['url'] ?>" class="h-badge h-badge-fun <?= ($siteId==='fun')?'active':'' ?>">
<span class="h-badge-title">Лаборатория</span>
<span class="h-badge-sub">Инженерный нуар</span>
</a>
<a href="<?= $sites['toc']['url'] ?>" class="h-badge h-badge-toc <?= ($siteId==='toc')?'active':'' ?>">
<span class="h-badge-title">Что сделали</span>
<span class="h-badge-sub">ПИР, ТОС, расчёты</span>
</a>
<a href="<?= $sites['main']['url'] ?>" class="h-badge h-badge-main <?= ($siteId==='main')?'active':'' ?>">
<span class="h-badge-title">Автор</span>
<span class="h-badge-sub">Цифровая мастерская</span>
</a>
</nav>
<div class="header-social">
<a href="https://t.me/chernetchenko" class="tg-btn" target="_blank">
<svg viewBox="0 0 24 24"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.14.18-.357.223-.548.223l.188-2.85 5.18-4.686c.223-.195-.054-.285-.346-.09l-6.4 4.024-2.76-.86c-.6-.185-.61-.6.125-.89l10.736-4.136c.5-.186.914.114.825.803z"/></svg>
<span>Личный</span>
</a>
<a href="https://t.me/waf_chernetchenko" class="tg-btn" target="_blank">
<svg viewBox="0 0 24 24"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.14.18-.357.223-.548.223l.188-2.85 5.18-4.686c.223-.195-.054-.285-.346-.09l-6.4 4.024-2.76-.86c-.6-.185-.61-.6.125-.89l10.736-4.136c.5-.186.914.114.825.803z"/></svg>
<span>WAF канал</span>
</a>
</div>
</div>
</div>
</header>
<script>
(function(){
const btn=document.getElementById('burger'), nav=document.querySelector('.header-nav');
if(!btn||!nav) return;
btn.addEventListener('click',e=>{e.stopPropagation();nav.classList.toggle('open');btn.classList.toggle('open');});
document.addEventListener('click',e=>{if(!e.target.closest('.header-actions')){nav.classList.remove('open');btn.classList.remove('open');}});
})();
</script>